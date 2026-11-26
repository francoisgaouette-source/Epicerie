// Console de L'Établi : l'avis de Claude sur une idée reçue d'une app (bonne idée ou non, pour quelle app elle fait du sens).
// Réservé aux comptes de console_admins. Les avis sont gardés dans console_idees_avis (un par idée; « rafraichir » en redemande un).
//   { action: "tous" }                                   → tous les avis déjà donnés
//   { action: "avis", idee: { id, app, type, texte, ecran }, rafraichir? } → l'avis de Claude (gardé)
// Secret : ANTHROPIC_API_KEY_CONSOLE (sinon ANTHROPIC_API_KEY du projet).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINES = /^https:\/\/(console\.holdingai\.app|console\.letabli\.ai|[a-z0-9-]+\.francois-gaouette\.workers\.dev)$/;
const COMPTE_URL = "https://wwakxuzuhmdmweluafiz.supabase.co";
const COMPTE_CLE = "sb_publishable_OyU2dc38EwE-kS8qdbkqpg_w2g-rTYd"; // clé publique de la liste des apps
const MODELE = Deno.env.get("MODEL_AVIS_IDEE") || "claude-sonnet-5-5";
const PRIX = { entree: 2, sortie: 10 }; // $ US par million de jetons (Sonnet 5.5)
const TYPES: Record<string, string> = { idee: "une idée", probleme: "un problème signalé", aime: "un compliment", autre: "un commentaire" };
const CLES: Record<string, string> = { lechange: "echange", lescale: "escale" };
const cle = (slug: string) => CLES[slug] || slug.replace(/^(le|la)-/, "");

Deno.serve(async (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const CORS = { "Access-Control-Allow-Origin": ORIGINES.test(o) ? o : "https://console.holdingai.app", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u } = await db.auth.getUser((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
  const uid = u?.user?.id;
  if (!uid) return json({ erreur: "Connexion requise." }, 401);
  const { data: acces } = await db.from("console_admins").select("role").eq("user_id", uid).maybeSingle();
  if (!acces) return json({ erreur: "Ce compte n'a pas accès à la console." }, 403);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }

  if (b.action === "tous") {
    const { data, error } = await db.from("console_idees_avis").select("app, idee_id, avis, cree").order("cree", { ascending: false }).limit(2000);
    if (error) return json({ erreur: error.message }, 500);
    return json({ avis: data });
  }
  if (b.action !== "avis") return json({ erreur: "Action inconnue." }, 400);

  const i = (b.idee || {}) as Record<string, unknown>;
  const id = String(i.id || "").slice(0, 80), app = String(i.app || "commis").slice(0, 40), texte = String(i.texte || "").trim().slice(0, 3000);
  if (!id || !texte) return json({ erreur: "Idée vide." }, 400);
  if (!b.rafraichir) {
    const { data } = await db.from("console_idees_avis").select("avis, cree").eq("app", app).eq("idee_id", id).maybeSingle();
    if (data) return json({ avis: data.avis, cree: data.cree, garde: true });
  }
  const key = Deno.env.get("ANTHROPIC_API_KEY_CONSOLE") || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ erreur: "Claude n'est pas branché à la console (clé ANTHROPIC_API_KEY absente)." }, 503);

  // Les apps de L'Établi, avec ce qu'elles font, pour que Claude dise où l'idée a sa place
  let apps: { slug: string; nom: string; description: string | null; personnage_nom: string | null }[] = [];
  try {
    const r = await fetch(`${COMPTE_URL}/rest/v1/apps?select=slug,nom,description,personnage_nom&active=eq.true&slug=neq.holdingai&order=nom`, { headers: { apikey: COMPTE_CLE } });
    if (r.ok) apps = await r.json();
  } catch { /* liste vide : Claude répond quand même */ }
  const listeApps = apps.map((a) => `- ${cle(a.slug)} : ${a.nom}${a.personnage_nom ? ` (avec ${a.personnage_nom})` : ""}. ${a.description || ""}`).join("\n");
  const source = apps.find((a) => cle(a.slug) === app);

  const SYSTEME = `Tu es le conseiller produit de L'Établi, une petite famille d'apps québécoises en français pour la vie de tous les jours (un seul compte pour toutes, chaque app a son personnage). Le fondateur, François, lit les idées que les membres envoient depuis les apps et te demande ton avis.

Les apps de L'Établi (clé : nom. description) :
${listeApps || "(liste indisponible)"}

Ta tâche : juger l'idée honnêtement et dire dans quelle app elle a le plus de sens (souvent celle d'où elle vient, mais pas toujours). Pense à la valeur pour les membres, à l'effort, au risque de compliquer l'app, et à ce qui ferait revenir ou parler de l'app. Si c'est un problème signalé, juge l'urgence plutôt que l'idée. Si l'idée ne va dans aucune app, dis-le; si elle justifierait une nouvelle app, dis-le avec "nouvelle".
Réponds en français québécois simple, au vouvoiement neutre, sans jargon.
Réponds SEULEMENT avec un objet JSON :
{"verdict":"bonne"|"a_creuser"|"pas_maintenant"|"non","resume":"une phrase : ce que la personne demande vraiment","pourquoi":"2 à 3 phrases : ton jugement","apps":[{"app":"clé de l'app ou nouvelle","raison":"une phrase"}],"effort":"petit"|"moyen"|"gros","prochaine_etape":"une phrase concrète"}
"apps" : 1 à 3 apps, la meilleure en premier.`;
  const message = `Idée reçue de l'app ${source ? source.nom : app} (${TYPES[String(i.type || "idee")] || "une idée"}${i.ecran ? `, écran ${String(i.ecran).slice(0, 40)}` : ""}) :\n« ${texte} »`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELE, max_tokens: 700, system: SYSTEME, messages: [{ role: "user", content: message }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Claude", r.status, out?.error?.message); return json({ erreur: "Claude n'a pas pu répondre. Réessayez dans un moment." }, 502); }
  const brut = (out.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  let avis: Record<string, unknown> | null = null;
  try { const s = brut.indexOf("{"), e = brut.lastIndexOf("}"); avis = JSON.parse(brut.slice(s, e + 1)); } catch { avis = null; }
  if (!avis || !avis.verdict) return json({ erreur: "La réponse de Claude n'a pas pu être lue. Réessayez." }, 502);
  const net = (v: unknown, n: number) => String(v || "").slice(0, n);
  const propre = {
    verdict: ["bonne", "a_creuser", "pas_maintenant", "non"].includes(String(avis.verdict)) ? avis.verdict : "a_creuser",
    resume: net(avis.resume, 300), pourquoi: net(avis.pourquoi, 900), prochaine_etape: net(avis.prochaine_etape, 300),
    effort: ["petit", "moyen", "gros"].includes(String(avis.effort)) ? avis.effort : null,
    apps: (Array.isArray(avis.apps) ? avis.apps : []).slice(0, 3).map((a: Record<string, unknown>) => ({ app: net(a.app, 40), raison: net(a.raison, 300) })),
  };
  await db.from("console_idees_avis").upsert({ app, idee_id: id, avis: propre, modele: MODELE, demande_par: uid, cree: new Date().toISOString() }, { onConflict: "app,idee_id" });
  try {
    const e = out.usage?.input_tokens || 0, s = out.usage?.output_tokens || 0;
    await db.from("couts_ia").insert({ app: "console", fonction: "avis-idee", modele: MODELE, entree: e, sortie: s, cout_usd: (e * PRIX.entree + s * PRIX.sortie) / 1e6 });
  } catch { /* la mesure ne bloque jamais la réponse */ }
  return json({ avis: propre, cree: new Date().toISOString() });
});
