// Reçoit du Worker Cloudflare chaque courriel écrit à @letabli.ai, @lecommis.ai ou @fanion.ai (et à l'ancienne @holdingai.app)
// et le note dans console_courriels, pour l'onglet « Courriels » de la console.
// Garde aussi le lien de désabonnement de l'expéditeur (List-Unsubscribe) et ignore les expéditeurs bloqués (console_bloques).
// Appelée sans jeton Supabase (verify_jwt = false) : elle exige le secret COURRIEL_SECRET, partagé avec le Worker.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import PostalMime from "npm:postal-mime@4.2.1";

const APPS: Record<string, string> = { "letabli.ai": "holdingai", "holdingai.app": "holdingai", "lecommis.ai": "commis", "fanion.ai": "fanion" };
// List-Unsubscribe : « <https://…>, <mailto:…> ». On garde la première adresse web (https seulement) et la première adresse courriel.
function desabonnement(valeur: string, post: string) {
  const liens = [...String(valeur || "").matchAll(/<([^>]+)>/g)].map((x) => x[1].trim());
  const url = liens.find((l) => /^https:\/\//i.test(l) && l.length <= 2000) || null;
  const mailto = liens.find((l) => /^mailto:/i.test(l) && l.length <= 1000) || null;
  return { desabonner_url: url, desabonner_mailto: mailto, desabonner_un_clic: !!url && /List-Unsubscribe=One-Click/i.test(post || "") };
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function memeSecret(a: string | null, b: string | undefined) {
  if (!a || !b) return false;
  const h = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const ENTITES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", rsquo: "’", lsquo: "‘", laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—" };
// Version texte d'un courriel qui n'a qu'une version HTML : jamais affichée comme du HTML dans la console
function texteDe(html: string) {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h[1-6]|li|table|blockquote)>/gi, "\n").replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16) || 32))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
const adresse = (s: unknown) => { const x = String(s || "").trim().toLowerCase(); return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(x) && x.length <= 254 ? x : ""; };
const decoder = (s: string | null) => { try { return decodeURIComponent(s || ""); } catch { return ""; } };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);
  const secret = Deno.env.get("COURRIEL_SECRET");
  if (!secret) return json({ erreur: "COURRIEL_SECRET absent" }, 503);
  if (!(await memeSecret(req.headers.get("X-Courriel-Secret"), secret))) return json({ erreur: "Refusé" }, 403);

  const brut = new Uint8Array(await req.arrayBuffer());
  if (!brut.length || brut.length > 8 * 1024 * 1024) return json({ erreur: "Message vide ou trop gros" }, 413);
  const a = adresse(decoder(req.headers.get("X-Enveloppe-A")));
  const app = APPS[a.split("@")[1] || ""];
  if (!app) return json({ erreur: "Destinataire inconnu" }, 400);

  let m;
  try { m = await PostalMime.parse(brut); } catch (e) { console.error(e); return json({ erreur: "Message illisible" }, 422); }
  const enTete = (n: string) => (m.headers || []).find((h: { key: string }) => h.key === n)?.value || "";
  const de = adresse(m.from?.address) || adresse(decoder(req.headers.get("X-Enveloppe-De"))) || "inconnu@invalide.invalid";
  const repondreA = adresse(m.replyTo?.[0]?.address);
  const texte = (m.text && m.text.trim() ? m.text : m.html ? texteDe(m.html) : "").replace(/\u0000/g, "").trim();
  // Message automatique : avis d'un service, infolettre, réponse d'absence
  const auto = /auto-(generated|replied|notified)/i.test(enTete("auto-submitted")) || /bulk|list|junk/i.test(enTete("precedence")) || !!enTete("list-unsubscribe") || !!enTete("list-id")
    || /^(no-?reply|ne-?pas-?repondre|noreply|donotreply|do-not-reply|mailer-daemon|postmaster|notifications?|bounces?)[+@.-]/i.test(de);
  const idMsg = String(m.messageId || "").trim().slice(0, 500) || null;
  const enReponseA = String(m.inReplyTo || "").trim().slice(0, 500) || null;
  const refs = String(m.references || "").trim().slice(0, 4000) || null;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Expéditeur bloqué dans la console (adresse exacte ou tout son domaine) : rien n'est noté
  const { data: bloque } = await admin.from("console_bloques").select("adresse").in("adresse", [de, "@" + de.split("@")[1]]).limit(1);
  if (bloque?.length) return json({ ok: true, bloque: true });
  if (idMsg) {
    const { data: deja } = await admin.from("console_courriels").select("id").eq("message_id", idMsg).maybeSingle();
    if (deja) return json({ ok: true, deja: true });
  }
  // Même fil que le message auquel celui-ci répond, s'il est déjà dans la console
  let fil: string | null = null;
  const parents = [...new Set([enReponseA, ...(refs || "").split(/\s+/)].filter((x): x is string => !!x && x.length <= 500))].slice(-12);
  if (parents.length) {
    const { data: p } = await admin.from("console_courriels").select("fil").in("message_id", parents).order("cree", { ascending: false }).limit(1);
    fil = p?.[0]?.fil || null;
  }
  const sujet = String(m.subject || "").replace(/\s+/g, " ").trim().slice(0, 300);
  // Sinon : réponse à un courriel envoyé de la console (même personne, même adresse, même objet)
  if (!fil && /^re\s*:/i.test(sujet)) {
    const { data: p } = await admin.from("console_courriels").select("fil").eq("sens", "envoye").eq("a", de).eq("de", a).eq("sujet", sujet).order("cree", { ascending: false }).limit(1);
    fil = p?.[0]?.fil || null;
  }
  const ligne: Record<string, unknown> = {
    sens: "recu", app, de, de_nom: String(m.from?.name || "").slice(0, 200) || null, a, repondre_a: repondreA && repondreA !== de ? repondreA : null,
    sujet, texte: texte.slice(0, 60000),
    message_id: idMsg, en_reponse_a: enReponseA, refs,
    ...desabonnement(enTete("list-unsubscribe"), enTete("list-unsubscribe-post")),
    pieces: (m.attachments || []).filter((p: { disposition?: string | null; filename?: string | null }) => p.disposition !== "inline" || p.filename).slice(0, 30)
      .map((p: { filename?: string | null; mimeType?: string; content?: ArrayBuffer | Uint8Array | string }) => ({ nom: String(p.filename || "sans nom").slice(0, 200), type: String(p.mimeType || "").slice(0, 100), taille: typeof p.content === "string" ? p.content.length : p.content?.byteLength ?? null })),
    auto, tronque: req.headers.get("X-Tronque") === "1" || texte.length > 60000, copie: req.headers.get("X-Copie") === "1",
    // Un message automatique n'attend pas de réponse : il ne s'ajoute pas à la liste à traiter
    traite: auto,
  };
  if (fil) ligne.fil = fil;
  const { error } = await admin.from("console_courriels").insert(ligne);
  if (error) {
    if (error.code === "23505") return json({ ok: true, deja: true });
    console.error(error); return json({ erreur: "Écriture impossible" }, 500);
  }
  return json({ ok: true });
});
