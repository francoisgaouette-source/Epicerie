// Boucle de retour de Fanion : idées et commentaires des joueurs, réponses de l'équipe, nouveautés, sondage éclair.
// Appelée par le serveur de Fanion (fanion.ai/api/retour) avec le jeton Firebase du membre : le jeton est revérifié ici.
// Chaque joueur ne lit que ses propres envois ; les réponses et états se gèrent dans la console HoldingAI (onglet Idées).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROJET = "pelland";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const b64u = (s: string) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };

let CLES: JsonWebKey[] | null = null, CLES_A = 0;
async function clesGoogle() {
  if (CLES && Date.now() - CLES_A < 3600e3) return CLES;
  const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  CLES = (await r.json()).keys; CLES_A = Date.now(); return CLES!;
}
async function membreFirebase(tok: string): Promise<{ uid: string; tel: string }> {
  const [h, p, sig] = tok.split("."); if (!sig) throw new Error("jeton manquant");
  const tete = JSON.parse(new TextDecoder().decode(b64u(h))), corps = JSON.parse(new TextDecoder().decode(b64u(p)));
  if (tete.alg !== "RS256") throw new Error("jeton invalide");
  // deno-lint-ignore no-explicit-any
  const jwk = (await clesGoogle()).find((k: any) => k.kid === tete.kid); if (!jwk) throw new Error("clé inconnue");
  const cle = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cle, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok || corps.aud !== PROJET || corps.iss !== `https://securetoken.google.com/${PROJET}` || corps.exp < Date.now() / 1000) throw new Error("jeton invalide");
  if (!["password", "phone"].includes((corps.firebase || {}).sign_in_provider)) throw new Error("membre requis");
  return { uid: String(corps.user_id || corps.sub), tel: String(corps.phone_number || "") };
}

const txt = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const TYPES = ["idee", "probleme", "aime", "autre"];

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);
  let m: { uid: string; tel: string };
  try { m = await membreFirebase((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")); }
  catch { return json({ erreur: "Connexion requise." }, 401); }
  // deno-lint-ignore no-explicit-any
  let b: any = {};
  try { b = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const depuis = (ms: number) => new Date(Date.now() - ms).toISOString();

  if (b.action === "lire") {
    const [i, n, s] = await Promise.all([
      admin.from("fanion_idees").select("id, cree, type, texte, statut, reponse, repondu").eq("qui", m.uid).order("cree", { ascending: false }).limit(50),
      admin.from("fanion_nouveautes").select("id, cree, titre, texte").order("cree", { ascending: false }).limit(10),
      admin.from("fanion_sondages").select("cree").eq("qui", m.uid).order("cree", { ascending: false }).limit(1),
    ]);
    if (i.error || n.error) return json({ erreur: "Lecture impossible." }, 500);
    return json({ idees: i.data || [], nouveautes: n.data || [], sondageDernier: s.data && s.data[0] ? s.data[0].cree : null });
  }

  if (b.action === "idee") {
    const texte = txt(b.texte, 2000);
    if (texte.length < 2) return json({ erreur: "Message trop court." }, 400);
    const { count } = await admin.from("fanion_idees").select("id", { count: "exact", head: true }).eq("qui", m.uid).gte("cree", depuis(3600e3));
    if ((count || 0) >= 20) return json({ erreur: "Beaucoup d'envois d'un coup : réessayez dans une heure." }, 429);
    const contact_ok = !!b.contact;
    const { data, error } = await admin.from("fanion_idees").insert({
      qui: m.uid, type: TYPES.includes(b.type) ? b.type : "idee", texte, prenom: txt(b.prenom, 40) || null, groupe: txt(b.groupe, 80) || null,
      ecran: txt(b.ecran, 40) || null, appareil: txt(b.appareil, 160) || null, source: b.source === "sondage" ? "sondage" : "app",
      contact_ok, contact: contact_ok ? (m.tel || txt(b.tel, 40) || null) : null,
    }).select("id, cree, type, texte, statut, reponse, repondu").single();
    if (error) return json({ erreur: "Envoi impossible." }, 500);
    return json({ ok: true, idee: data });
  }

  if (b.action === "sondage") {
    const note = Number(b.note);
    if (!Number.isInteger(note) || note < 0 || note > 10) return json({ erreur: "Note invalide." }, 400);
    const { count } = await admin.from("fanion_sondages").select("id", { count: "exact", head: true }).eq("qui", m.uid).gte("cree", depuis(86400e3));
    if ((count || 0) >= 3) return json({ ok: true, ignore: true });
    const { error } = await admin.from("fanion_sondages").insert({ qui: m.uid, note, raison: txt(b.raison, 2000) || null, groupe: txt(b.groupe, 80) || null });
    if (error) return json({ erreur: "Envoi impossible." }, 500);
    return json({ ok: true });
  }

  return json({ erreur: "Action inconnue." }, 400);
});
