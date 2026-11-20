// Lit une facture d'épicerie (photo) et propose un panier à approuver.
// Réservé aux membres du ménage. Secret requis : ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const CATS = ["Fruits et légumes", "Viandes et poissons", "Produits laitiers et œufs", "Boulangerie", "Épicerie sèche",
  "Surgelés", "Boissons", "Collations", "Hygiène et beauté", "Entretien ménager", "Autre"];

// ---------- Coût de l'appel (table couts_ia, lue par la console). Prix en $ US par million de jetons :
// entrée, sortie, écriture en cache, lecture en cache. Haiku 5.5 coûte plus cher au-delà de 100 000 jetons d'entrée.
const PRIX: Record<string, number[]> = {
  "claude-haiku-5-5": [0.10, 0.50, 0.125, 0.01],
  "claude-haiku-5-5+": [0.50, 2.50, 0.625, 0.05],
  "claude-sonnet-5-5": [2, 10, 2.5, 0.10],
  "claude-opus-5-5": [4, 20, 5, 0.20],
};
// deno-lint-ignore no-explicit-any
function coutAppel(modele: string, u: any) {
  const e = u?.input_tokens || 0, s = u?.output_tokens || 0, ce = u?.cache_creation_input_tokens || 0, cl = u?.cache_read_input_tokens || 0;
  const r = u?.server_tool_use?.web_search_requests || 0;
  const long = modele.startsWith("claude-haiku-5-5") && e + ce + cl > 100_000;
  const p = PRIX[long ? "claude-haiku-5-5+" : modele] || PRIX["claude-sonnet-5-5"];
  return { entree: e, sortie: s, cache_ecrit: ce, cache_lu: cl, recherches: r, cout_usd: (e * p[0] + s * p[1] + ce * p[2] + cl * p[3]) / 1e6 + r * 0.01 };
}
// deno-lint-ignore no-explicit-any
async function noterCout(fonction: string, foyer_id: string | null, modele: string, usage: any) {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    await admin.from("couts_ia").insert({ app: "commis", fonction, foyer_id, modele, ...coutAppel(modele, usage) });
  } catch { /* la mesure ne doit jamais bloquer la réponse */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: membres } = await sb.from("membres").select("id, foyer_id").limit(1);
  if (!membres || !membres.length) return json({ erreur: "Accès réservé aux membres." }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ erreur: "La clé ANTHROPIC_API_KEY n'est pas configurée dans Supabase." }, 500);

  let body: { images?: string[]; image?: string; lieu_id?: string };
  try { body = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const images = (body.images || (body.image ? [body.image] : [])).map((s) => String(s).replace(/^data:[^,]+,/, "")).slice(0, 4);
  if (!images.length || images.some((i) => !i || i.length > 7_000_000)) return json({ erreur: "Image manquante ou trop lourde." }, 400);

  // Contexte du ménage : espaces du lieu ouvert, produits connus, épiceries
  let qEsp = sb.from("espaces").select("id, nom").order("ordre");
  if (body.lieu_id && /^[0-9a-f-]{36}$/i.test(body.lieu_id)) qEsp = qEsp.eq("lieu_id", body.lieu_id);
  const [{ data: espaces }, { data: produits }, { data: config }] = await Promise.all([
    qEsp,
    sb.from("produits").select("id, nom, marque, format").limit(600),
    sb.from("config").select("magasins").eq("id", 1).maybeSingle(),
  ]);
  const esp = espaces || [], prods = produits || [];
  const magasins: string[] = (config && config.magasins) || [];
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Nous sommes le ${today}. Ces photos montrent une facture (reçu de caisse) d'épicerie au Québec.
Lis chaque article acheté. Ignore les sous-totaux, taxes, consignes, sacs, rabais globaux et modes de paiement.
Si une ligne de rabais suit un article, déduis-la du prix de cet article.
Les abréviations de caisse doivent être traduites en nom clair (ex. « LAIT 2% NAT 2L » → « Lait 2 % Natrel », format « 2 L »).

Produits déjà connus du ménage (id | nom | marque | format) :
${prods.map((p) => `${p.id} | ${p.nom} | ${p.marque || ""} | ${p.format || ""}`).join("\n") || "(aucun)"}

Espaces de rangement du lieu (id | nom) :
${esp.map((e) => `${e.id} | ${e.nom}`).join("\n") || "(aucun)"}

Épiceries suivies : ${magasins.join(", ") || "(aucune)"}.

Réponds uniquement avec un objet JSON :
{"magasin":"nom de l'épicerie, écrit exactement comme dans la liste des épiceries suivies si c'est l'une d'elles",
 "date":"AAAA-MM-JJ de l'achat ou null",
 "articles":[{
   "texte":"texte de la ligne tel qu'imprimé",
   "produit_id":"id du produit connu s'il s'agit clairement du même produit, sinon null",
   "nom":"nom clair en français (reprends exactement le nom du produit connu si produit_id est donné)",
   "marque":"", "format":"",
   "categorie":"une valeur parmi : ${CATS.join(", ")}",
   "quantite":1,
   "prix_unitaire":0.00,
   "prix_total":0.00,
   "espace_id":"id de l'espace le plus logique pour ranger ce produit (frigo pour le frais, congélateur pour le surgelé, etc.), ou null",
   "conservation_jours":"nombre de jours typique avant péremption une fois acheté et rangé dans cet espace (ex. lait 10, pain 5, conserve 730), ou null si non périssable",
   "confiance":"haute | moyenne | basse"}]}
Pour un article vendu au poids, mets quantite = 1 et indique le poids dans format.`;

  const content: unknown[] = images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
  content.push({ type: "text", text: prompt });

  const MODELE = Deno.env.get("MODEL_FACTURE") || "claude-sonnet-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELE, max_tokens: 8000, messages: [{ role: "user", content }] }),
  });
  const out = await res.json();
  if (res.ok) await noterCout("facture", membres[0].foyer_id || null, MODELE, out.usage);
  if (!res.ok) return json({ erreur: "Le service de lecture n'a pas répondu.", detail: out?.error?.message }, 502);
  const texte = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const m = texte.match(/\{[\s\S]*\}/);
  let r: { magasin?: string; date?: string; articles?: Record<string, unknown>[] } = {};
  try { r = m ? JSON.parse(m[0]) : {}; } catch { r = {}; }

  const espIds = new Set(esp.map((e) => e.id)), prodIds = new Set(prods.map((p) => p.id));
  const num = (v: unknown) => { const n = Number(String(v ?? "").replace(",", ".")); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
  const dateAchat = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")) ? String(r.date) : today;
  const articles = (r.articles || []).slice(0, 120).map((a) => {
    const jours = Number(a.conservation_jours);
    let peremption: string | null = null;
    if (isFinite(jours) && jours > 0 && jours < 3650) {
      const d = new Date(dateAchat + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + Math.round(jours)); peremption = d.toISOString().slice(0, 10);
    }
    return {
      texte: String(a.texte || "").slice(0, 120),
      produit_id: prodIds.has(String(a.produit_id)) ? String(a.produit_id) : null,
      nom: String(a.nom || a.texte || "").slice(0, 120),
      marque: String(a.marque || "").slice(0, 80),
      format: String(a.format || "").slice(0, 40),
      categorie: CATS.includes(String(a.categorie)) ? String(a.categorie) : "Autre",
      quantite: num(a.quantite) || 1,
      prix_unitaire: num(a.prix_unitaire),
      prix_total: num(a.prix_total),
      espace_id: espIds.has(String(a.espace_id)) ? String(a.espace_id) : null,
      peremption,
      confiance: ["haute", "moyenne", "basse"].includes(String(a.confiance)) ? String(a.confiance) : "moyenne",
    };
  }).filter((a) => a.nom);
  const magasin = String(r.magasin || "").slice(0, 60);
  const magasinConnu = magasins.find((x) => x.toLowerCase() === magasin.toLowerCase()) || magasin;
  return json({ magasin: magasinConnu, date: dateAchat, articles });
});
