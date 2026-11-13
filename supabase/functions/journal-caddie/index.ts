// Note dans la console HoldingAI les questions posées au Caddie (l'assistant de Fanion).
// Appelée par le serveur de Fanion avec le jeton Firebase du membre : le jeton est revérifié ici, aucun secret à partager.
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
async function membreFirebase(tok: string): Promise<string> {
  const [h, p, sig] = tok.split("."); if (!sig) throw new Error("jeton manquant");
  const tete = JSON.parse(new TextDecoder().decode(b64u(h))), corps = JSON.parse(new TextDecoder().decode(b64u(p)));
  if (tete.alg !== "RS256") throw new Error("jeton invalide");
  // deno-lint-ignore no-explicit-any
  const jwk = (await clesGoogle()).find((k: any) => k.kid === tete.kid); if (!jwk) throw new Error("clé inconnue");
  const cle = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cle, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok || corps.aud !== PROJET || corps.iss !== `https://securetoken.google.com/${PROJET}` || corps.exp < Date.now() / 1000) throw new Error("jeton invalide");
  if (!["password", "phone"].includes((corps.firebase || {}).sign_in_provider)) throw new Error("membre requis");
  return String(corps.user_id || corps.sub);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);
  let uid: string;
  try { uid = await membreFirebase((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")); }
  catch { return json({ erreur: "Connexion requise." }, 401); }
  let b: { question?: string; reponse?: string } = {};
  try { b = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const question = String(b.question || "").trim().slice(0, 2000);
  if (!question) return json({ erreur: "Question manquante." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Garde-fou : au plus 60 questions notées par membre et par heure
  const { count } = await admin.from("console_questions").select("id", { count: "exact", head: true }).eq("app", "fanion").eq("qui", uid).gte("cree", new Date(Date.now() - 3600e3).toISOString());
  if ((count || 0) >= 60) return json({ ok: true, ignore: true });
  const { error } = await admin.from("console_questions").insert({ app: "fanion", qui: uid, question, reponse: String(b.reponse || "").slice(0, 4000) || null });
  if (error) return json({ erreur: "Non noté." }, 500);
  return json({ ok: true });
});
