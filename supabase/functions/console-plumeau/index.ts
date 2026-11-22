// Console HoldingAI : pont vers Le Plumeau, qui a son propre projet Supabase (comptes séparés du Commis).
// La personne doit être dans console_admins (projet du Commis). La fonction lit et écrit ensuite dans le projet du Plumeau
// avec sa clé de service (secret PLUMEAU_SERVICE_ROLE_KEY, jamais vue par le navigateur).
//   { action: "tout" }                                → comptes, idées, nouveautés, questions à Colette, coûts IA
//   { action: "idee", id, statut?, reponse? }        → répondre à une idée ou changer son état (gestion)
//   { action: "nouveaute", titre, texte?, idee_id? } → annoncer une nouveauté; { action: "nouveaute", retirer: id } la retire (gestion)
//   { action: "bloquer", user_id, bloque }           → couper ou rendre l'IA à un compte (gestion)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PLUMEAU_URL = "https://xpgpzhfmfusdenbwrpny.supabase.co";
const ORIGINES = /^https:\/\/(console\.holdingai\.app|[a-z0-9-]+\.francois-gaouette\.workers\.dev)$/;
const UUID = /^[0-9a-f-]{36}$/i;
const STATUTS = ["recue", "etudiee", "prevue", "faite", "non"];

Deno.serve(async (req: Request) => {
  const origine = req.headers.get("Origin") || "";
  const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": ORIGINES.test(origine) ? origine : "https://console.holdingai.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
  const uid = u?.user?.id;
  if (!uid) return json({ erreur: "Connexion requise." }, 401);
  const { data: ok } = await admin.from("console_admins").select("role").eq("user_id", uid).maybeSingle();
  if (!ok) return json({ erreur: "Ce compte n'a pas accès à la console." }, 403);
  const role = String(ok.role);

  const cle = Deno.env.get("PLUMEAU_SERVICE_ROLE_KEY");
  if (!cle) return json({ erreur: "La console n'est pas encore reliée au Plumeau (secret PLUMEAU_SERVICE_ROLE_KEY manquant).", code: "NON_RELIE" }, 503);
  const pl = createClient(PLUMEAU_URL, cle, { auth: { persistSession: false } });

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const action = String(b.action || "");
  const noter = (geste: string, cible: string, detail: Record<string, unknown> = {}) =>
    admin.from("console_journal").insert({ admin: uid, app: "plumeau", action: "plumeau." + geste, cible, detail });

  try {
    if (action === "tout") {
      const { data, error } = await pl.rpc("console_donnees");
      if (error) return json({ erreur: error.message }, 500);
      return json(data);
    }
    if (role !== "proprio" && role !== "gestion") return json({ erreur: "Votre accès permet seulement de consulter." }, 403);

    if (action === "idee") {
      const id = String(b.id || ""); if (!UUID.test(id)) return json({ erreur: "Idée invalide." }, 400);
      const maj: Record<string, unknown> = { maj: new Date().toISOString() };
      if (b.statut != null) { if (!STATUTS.includes(String(b.statut))) return json({ erreur: "État invalide." }, 400); maj.statut = String(b.statut); }
      if (b.reponse != null) {
        const rep = String(b.reponse).trim().slice(0, 2000);
        maj.reponse = rep || null; maj.repondu = rep ? new Date().toISOString() : null;
        if (rep) maj.vu = false; // Colette avertit la personne dans l'app
      }
      const { data, error } = await pl.from("plumeau_idees").update(maj).eq("id", id).select("texte").maybeSingle();
      if (error) return json({ erreur: error.message }, 500);
      if (!data) return json({ erreur: "Idée introuvable." }, 404);
      await noter("idee", String(data.texte).slice(0, 60), { statut: b.statut ?? null, repondu: !!maj.repondu });
      return json({ ok: true });
    }
    if (action === "nouveaute") {
      if (b.retirer) {
        const id = String(b.retirer); if (!UUID.test(id)) return json({ erreur: "Nouveauté invalide." }, 400);
        const { error } = await pl.from("plumeau_nouveautes").delete().eq("id", id);
        if (error) return json({ erreur: error.message }, 500);
        await noter("nouveaute", id, { geste: "retirer" });
        return json({ ok: true });
      }
      const titre = String(b.titre || "").trim().slice(0, 120);
      if (titre.length < 2) return json({ erreur: "Donnez un titre à la nouveauté." }, 400);
      const idee = b.idee_id && UUID.test(String(b.idee_id)) ? String(b.idee_id) : null;
      const { error } = await pl.from("plumeau_nouveautes").insert({ titre, texte: String(b.texte || "").trim().slice(0, 1000) || null, idee_id: idee });
      if (error) return json({ erreur: error.message }, 500);
      if (idee) await pl.from("plumeau_idees").update({ statut: "faite", maj: new Date().toISOString() }).eq("id", idee);
      await noter("nouveaute", titre, { geste: "annoncer" });
      return json({ ok: true });
    }
    if (action === "bloquer") {
      const id = String(b.user_id || ""); if (!UUID.test(id)) return json({ erreur: "Compte invalide." }, 400);
      const { error } = await pl.from("plumeau_comptes").update({ bloque: !!b.bloque }).eq("user_id", id);
      if (error) return json({ erreur: error.message }, 500);
      await noter("compte", id, { geste: b.bloque ? "bloquer" : "debloquer" });
      return json({ ok: true });
    }
    return json({ erreur: "Action inconnue." }, 400);
  } catch (e) {
    console.error(action, String(e));
    return json({ erreur: "Le Plumeau ne répond pas. Réessayez dans un instant." }, 502);
  }
});
