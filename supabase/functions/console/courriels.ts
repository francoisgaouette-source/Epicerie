// Courriels de la console HoldingAI : lecture, état « traité » et réponse.
// La réponse part par le Worker Cloudflare (console.letabli.ai/api/envoyer), protégé par le secret COURRIEL_SECRET.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export class Refus extends Error { constructor(m: string, public code = 400) { super(m); } }
const NOMS: Record<string, string> = { holdingai: "L’Établi", commis: "Le Commis", fanion: "Fanion" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Noter = (app: string, cible: string, detail?: Record<string, unknown>) => unknown;

export async function listeCourriels(admin: SupabaseClient) {
  const { data } = await admin.from("console_courriels")
    .select("id, cree, sens, app, de, de_nom, a, repondre_a, sujet, texte, fil, pieces, auto, tronque, copie, traite, desabonner_url, desabonner_mailto, desabonner_un_clic, desabonne_le")
    .order("cree", { ascending: false }).limit(300);
  return data || [];
}
export async function listeBloques(admin: SupabaseClient) {
  const { data } = await admin.from("console_bloques").select("adresse, cree").order("cree", { ascending: false }).limit(500);
  return data || [];
}

// Une adresse web de désabonnement doit être publique (jamais une adresse interne ou une IP)
function urlPublique(brut: string) {
  try {
    const u = new URL(brut);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
    if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(h)) return null;
    return u;
  } catch { return null; }
}
async function envoyerCourriel(secret: string, corps: Record<string, unknown>) {
  const r = await fetch("https://console.letabli.ai/api/envoyer", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Courriel-Secret": secret }, body: JSON.stringify(corps),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok) return;
  console.error("Envoi refusé", r.status, d);
  if (r.status === 501) throw new Refus("L'envoi de courriels n'est pas encore activé dans Cloudflare.", 503);
  if (r.status === 403 || d.code === "SECRET_ABSENT") throw new Refus("Le secret COURRIEL_SECRET n'est pas le même dans Cloudflare et dans Supabase.", 503);
  if (/SENDER/.test(String(d.code))) throw new Refus(`Le domaine de ${corps.de} n'est pas encore autorisé à envoyer dans Cloudflare.`, 503);
  throw new Refus(`Le courriel n'est pas parti (${d.code || d.erreur || r.status}).`, 502);
}

export async function actionCourriel(action: string, b: Record<string, unknown>, admin: SupabaseClient, uid: string, noter: Noter) {
  if (action === "courriel.etat") {
    const id = String(b.id || ""); if (!UUID.test(id)) throw new Refus("Courriel invalide.");
    const traite = b.traite === true;
    const { data: c } = await admin.from("console_courriels").select("fil, app, de, sujet").eq("id", id).maybeSingle();
    if (!c) throw new Refus("Courriel introuvable.", 404);
    // Tout l'échange change d'état d'un coup
    const { error } = await admin.from("console_courriels").update({ traite, traite_par: traite ? uid : null, traite_le: traite ? new Date().toISOString() : null }).eq("fil", c.fil).eq("sens", "recu");
    if (error) throw new Refus(error.message, 500);
    await noter(c.app, `${c.de} : ${c.sujet || "(sans objet)"}`.slice(0, 200), { geste: traite ? "traite" : "atraiter" });
    return { ok: true };
  }
  if (action === "courriel.repondre") {
    const id = String(b.id || ""); if (!UUID.test(id)) throw new Refus("Courriel invalide.");
    const texte = String(b.texte || "").replace(/\r\n/g, "\n").trim();
    if (!texte) throw new Refus("La réponse est vide.");
    if (texte.length > 20000) throw new Refus("La réponse est trop longue.");
    const { data: c } = await admin.from("console_courriels").select("*").eq("id", id).maybeSingle();
    if (!c || c.sens !== "recu") throw new Refus("Courriel introuvable.", 404);
    const secret = Deno.env.get("COURRIEL_SECRET");
    if (!secret) throw new Refus("L'envoi de courriels n'est pas encore configuré (secret COURRIEL_SECRET absent).", 503);
    const vers = c.repondre_a || c.de;
    if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(vers) || /\.invalid$/.test(vers)) throw new Refus("L'adresse de cette personne est invalide.");
    const sujet = (/^\s*re\s*:/i.test(c.sujet) ? c.sujet : `Re: ${c.sujet || ""}`).trim().slice(0, 300);
    const quand = new Intl.DateTimeFormat("fr-CA", { dateStyle: "long", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(c.cree));
    const cite = String(c.texte || "").slice(0, 8000).split("\n").map((l: string) => `> ${l}`).join("\n");
    const corps = `${texte}\n\nLe ${quand}, ${c.de_nom ? `${c.de_nom} <${c.de}>` : c.de} a écrit :\n${cite}`;
    const entetes: Record<string, string> = {};
    if (c.message_id) { entetes["In-Reply-To"] = c.message_id; entetes["References"] = [...String(c.refs || "").split(/\s+/).filter(Boolean).slice(-8), c.message_id].join(" ").slice(0, 1900); }
    // Un courriel reçu à l’ancienne adresse @holdingai.app reçoit sa réponse depuis @letabli.ai
    const de = String(c.a || "").replace(/@holdingai\.app$/i, "@letabli.ai");
    const r = await fetch("https://console.letabli.ai/api/envoyer", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Courriel-Secret": secret },
      body: JSON.stringify({ de, nom: NOMS[c.app] || "L’Établi", a: vers, sujet, texte: corps, entetes }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Envoi refusé", r.status, d);
      if (r.status === 501) throw new Refus("L'envoi de courriels n'est pas encore activé dans Cloudflare.", 503);
      if (r.status === 403 || d.code === "SECRET_ABSENT") throw new Refus("Le secret COURRIEL_SECRET n'est pas le même dans Cloudflare et dans Supabase.", 503);
      if (/SENDER/.test(String(d.code))) throw new Refus(`Le domaine de ${de} n'est pas encore autorisé à envoyer dans Cloudflare.`, 503);
      throw new Refus(`Le courriel n'est pas parti (${d.code || d.erreur || r.status}).`, 502);
    }
    const { error } = await admin.from("console_courriels").insert({ sens: "envoye", app: c.app, de, de_nom: NOMS[c.app] || "L’Établi", a: vers, sujet, texte, fil: c.fil, en_reponse_a: c.message_id, traite: true, envoye_par: uid });
    await admin.from("console_courriels").update({ traite: true, traite_par: uid, traite_le: new Date().toISOString() }).eq("fil", c.fil).eq("sens", "recu").eq("traite", false);
    await noter(c.app, `${vers} : ${sujet}`.slice(0, 200), { geste: "repondu" });
    // Le courriel est parti : si la note a échoué, on le dit sans faire croire à un échec d'envoi
    return { ok: true, note: !error };
  }
  // Effacer un échange au complet (tous les messages du fil). La copie reçue dans la boîte personnelle n'est pas touchée.
  if (action === "courriel.supprimer") {
    const id = String(b.id || ""); if (!UUID.test(id)) throw new Refus("Courriel invalide.");
    const { data: c } = await admin.from("console_courriels").select("fil, app, de, sujet").eq("id", id).maybeSingle();
    if (!c) throw new Refus("Courriel introuvable.", 404);
    const { data: effaces, error } = await admin.from("console_courriels").delete().eq("fil", c.fil).select("id");
    if (error) throw new Refus(error.message, 500);
    await noter(c.app, `${c.de} : ${c.sujet || "(sans objet)"}`.slice(0, 200), { geste: "efface", messages: (effaces || []).length });
    return { ok: true, effaces: (effaces || []).length };
  }
  // Se désabonner avec le lien fourni par l'expéditeur (List-Unsubscribe)
  if (action === "courriel.desabonner") {
    const id = String(b.id || ""); if (!UUID.test(id)) throw new Refus("Courriel invalide.");
    const { data: c } = await admin.from("console_courriels").select("*").eq("id", id).maybeSingle();
    if (!c || c.sens !== "recu") throw new Refus("Courriel introuvable.", 404);
    const marquer = async (mode: string) => {
      await admin.from("console_courriels").update({ desabonne_le: new Date().toISOString(), traite: true, traite_par: uid, traite_le: new Date().toISOString() }).eq("de", c.de).eq("sens", "recu");
      await noter(c.app, `${c.de}`.slice(0, 200), { geste: "desabonne", mode });
    };
    const url = c.desabonner_url ? urlPublique(c.desabonner_url) : null;
    // 1. Désabonnement en un clic (RFC 8058) : fait ici, sans ouvrir la page de l'expéditeur
    if (url && c.desabonner_un_clic) {
      let r: Response;
      try {
        r = await fetch(url, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click", signal: AbortSignal.timeout(10000) });
      } catch { throw new Refus("Le site de l'expéditeur ne répond pas. Réessayez plus tard, ou bloquez l'expéditeur.", 502); }
      if (r.status >= 400) throw new Refus(`Le site de l'expéditeur a refusé le désabonnement (${r.status}). Bloquez-le plutôt.`, 502);
      await marquer("un_clic");
      return { ok: true, mode: "un_clic" };
    }
    // 2. Par courriel : on écrit à l'adresse de désabonnement, depuis l'adresse qui a reçu le message
    const mailto = String(c.desabonner_mailto || "");
    if (mailto) {
      const [adr, q] = mailto.replace(/^mailto:/i, "").split("?");
      const p = new URLSearchParams(q || "");
      const vers = decodeURIComponent(adr || "").trim().toLowerCase();
      if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(vers)) throw new Refus("L'adresse de désabonnement est invalide. Bloquez l'expéditeur plutôt.");
      const secret = Deno.env.get("COURRIEL_SECRET");
      if (!secret) throw new Refus("L'envoi de courriels n'est pas encore configuré (secret COURRIEL_SECRET absent).", 503);
      const de = String(c.a || "").replace(/@holdingai\.app$/i, "@letabli.ai");
      await envoyerCourriel(secret, { de, nom: NOMS[c.app] || "L’Établi", a: vers, sujet: (p.get("subject") || "unsubscribe").slice(0, 300), texte: (p.get("body") || "unsubscribe").slice(0, 2000) });
      await marquer("courriel");
      return { ok: true, mode: "courriel" };
    }
    // 3. Seulement une page web : la console l'ouvre pour que vous confirmiez sur le site de l'expéditeur
    if (url) { await marquer("page"); return { ok: true, mode: "page", url: url.toString() }; }
    throw new Refus("Cet expéditeur ne fournit pas de moyen de se désabonner. Bloquez-le plutôt.");
  }
  // Bloquer un expéditeur (ou tout son domaine) : ses prochains courriels ne sont plus notés, et ceux déjà reçus sont effacés
  if (action === "courriel.bloquer") {
    const id = String(b.id || ""); if (!UUID.test(id)) throw new Refus("Courriel invalide.");
    const { data: c } = await admin.from("console_courriels").select("app, de, sens").eq("id", id).maybeSingle();
    if (!c || c.sens !== "recu") throw new Refus("Courriel introuvable.", 404);
    const de = String(c.de || "").toLowerCase(), domaine = de.split("@")[1] || "";
    if (!domaine || /\.invalid$/.test(domaine)) throw new Refus("Cet expéditeur n'a pas d'adresse valide.");
    if (["letabli.ai", "holdingai.app", "lecommis.ai", "fanion.ai"].includes(domaine)) throw new Refus("On ne bloque pas une adresse de L'Établi.");
    const tout = b.domaine === true;
    const adresse = tout ? "@" + domaine : de;
    const { error } = await admin.from("console_bloques").upsert({ adresse, par: uid }, { onConflict: "adresse" });
    if (error) throw new Refus(error.message, 500);
    let q = admin.from("console_courriels").delete().eq("sens", "recu");
    q = tout ? q.ilike("de", `%@${domaine.replace(/[%_\\]/g, "\\$&")}`) : q.eq("de", de);
    const { data: effaces } = await q.select("id");
    await noter(c.app, adresse, { geste: "bloque", effaces: (effaces || []).length });
    return { ok: true, adresse, effaces: (effaces || []).length };
  }
  if (action === "courriel.debloquer") {
    const adresse = String(b.adresse || "").toLowerCase().slice(0, 254);
    const { error } = await admin.from("console_bloques").delete().eq("adresse", adresse);
    if (error) throw new Refus(error.message, 500);
    await noter("holdingai", adresse, { geste: "debloque" });
    return { ok: true };
  }
  throw new Refus("Action inconnue.");
}
