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
  const { data: membres } = await sb.from("membres").select("email").limit(1);
  if (!membres || !membres.length) return json({ erreur: "Accès réservé aux membres." }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ erreur: "La clé ANTHROPIC_API_KEY n'est pas configurée dans Supabase." }, 500);

  let body: { image?: string; media_type?: string };
  try { body = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const image = (body.image || "").replace(/^data:[^,]+,/, "");
  const media = ["image/jpeg", "image/png", "image/webp"].includes(body.media_type || "") ? body.media_type : "image/jpeg";
  if (!image || image.length > 7_000_000) return json({ erreur: "Image manquante ou trop lourde." }, 400);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("MODEL_PHOTO") || "claude-haiku-5-5",
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
