// Identifie un produit d'épicerie à partir d'une photo (Claude, vision).
// Réservé aux membres du ménage (table public.membres).
// Déployée sur Supabase sous le nom « identifier-produit ». Secret requis : ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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

const CATS = ["Fruits et légumes", "Viandes et poissons", "Produits laitiers et œufs", "Boulangerie", "Épicerie sèche",
  "Surgelés", "Boissons", "Collations", "Hygiène et beauté", "Entretien ménager", "Autre"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  // Vérifier que l'utilisateur est membre du ménage
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: membres } = await sb.from("membres").select("email, foyer_id").limit(1);
  if (!membres || !membres.length) return json({ erreur: "Accès réservé aux membres." }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ erreur: "La clé ANTHROPIC_API_KEY n'est pas configurée dans Supabase." }, 500);

  let body: { image?: string; media_type?: string };
  try { body = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const image = (body.image || "").replace(/^data:[^,]+,/, "");
  const media = ["image/jpeg", "image/png", "image/webp"].includes(body.media_type || "") ? body.media_type : "image/jpeg";
  if (!image || image.length > 7_000_000) return json({ erreur: "Image manquante ou trop lourde." }, 400);

  const MODELE = Deno.env.get("MODEL_PHOTO") || "claude-haiku-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELE,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: image } },
          { type: "text", text:
`Cette photo montre un article à ajouter à une liste d'épicerie au Québec.
Identifie le produit. Réponds uniquement avec un objet JSON :
{"nom":"nom court en français comme on l'écrirait sur une liste, avec la marque si visible (ex. « Beurre Lactantia salé »)",
 "marque":"marque ou chaîne vide",
 "format":"format ou poids visible (ex. 454 g, 2 L, 12 rouleaux) ou chaîne vide",
 "categorie":"une valeur parmi : ${CATS.join(", ")}",
 "confiance":"haute | moyenne | basse"}
Si ce n'est pas un produit d'épicerie ou si c'est illisible, mets nom à "" et confiance à "basse".` },
        ],
      }],
    }),
  });
  const out = await res.json();
  if (res.ok) await noterCout("photo-produit", membres[0].foyer_id || null, MODELE, out.usage);
  if (!res.ok) return json({ erreur: "Le service d'identification n'a pas répondu.", detail: out?.error?.message }, 502);
  const texte = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const m = texte.match(/\{[\s\S]*\}/);
  let r: Record<string, string> = {};
  try { r = m ? JSON.parse(m[0]) : {}; } catch { r = {}; }
  return json({
    nom: String(r.nom || "").slice(0, 120),
    marque: String(r.marque || "").slice(0, 80),
    format: String(r.format || "").slice(0, 40),
    categorie: CATS.includes(r.categorie) ? r.categorie : "Autre",
    confiance: ["haute", "moyenne", "basse"].includes(r.confiance) ? r.confiance : "moyenne",
  });
});
