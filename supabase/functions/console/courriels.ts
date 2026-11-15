// Courriels de la console HoldingAI : lecture, état « traité » et réponse.
// La réponse part par le Worker Cloudflare (console.holdingai.app/api/envoyer), protégé par le secret COURRIEL_SECRET.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export class Refus extends Error { constructor(m: string, public code = 400) { super(m); } }
const NOMS: Record<string, string> = { holdingai: "HoldingAI", commis: "Le Commis", fanion: "Fanion" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Noter = (app: string, cible: string, detail?: Record<string, unknown>) => unknown;

export async function listeCourriels(admin: SupabaseClient) {
  const { data } = await admin.from("console_courriels")
    .select("id, cree, sens, app, de, de_nom, a, repondre_a, sujet, texte, fil, pieces, auto, tronque, copie, traite")
    .order("cree", { ascending: false }).limit(300);
  return data || [];
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
    const r = await fetch("https://console.holdingai.app/api/envoyer", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Courriel-Secret": secret },
      body: JSON.stringify({ de: c.a, nom: NOMS[c.app] || "HoldingAI", a: vers, sujet, texte: corps, entetes }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Envoi refusé", r.status, d);
      if (r.status === 501) throw new Refus("L'envoi de courriels n'est pas encore activé dans Cloudflare.", 503);
      if (r.status === 403 || d.code === "SECRET_ABSENT") throw new Refus("Le secret COURRIEL_SECRET n'est pas le même dans Cloudflare et dans Supabase.", 503);
      if (/SENDER/.test(String(d.code))) throw new Refus(`Le domaine de ${c.a} n'est pas encore autorisé à envoyer dans Cloudflare.`, 503);
      throw new Refus(`Le courriel n'est pas parti (${d.code || d.erreur || r.status}).`, 502);
    }
    const { error } = await admin.from("console_courriels").insert({ sens: "envoye", app: c.app, de: c.a, de_nom: NOMS[c.app] || "HoldingAI", a: vers, sujet, texte, fil: c.fil, en_reponse_a: c.message_id, traite: true, envoye_par: uid });
    await admin.from("console_courriels").update({ traite: true, traite_par: uid, traite_le: new Date().toISOString() }).eq("fil", c.fil).eq("sens", "recu").eq("traite", false);
    await noter(c.app, `${vers} : ${sujet}`.slice(0, 200), { geste: "repondu" });
    // Le courriel est parti : si la note a échoué, on le dit sans faire croire à un échec d'envoi
    return { ok: true, note: !error };
  }
  throw new Refus("Action inconnue.");
}
