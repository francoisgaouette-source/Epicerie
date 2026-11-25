// Console HoldingAI : pont déployé DANS les projets du Commis, du Tiroir, du Gousset, du Seuil et de La Voûte (projet commun)
// et de HoldingAI Compte (même fichier).
// Aucun secret à ajouter : la fonction utilise la clé de service de son propre projet, et vérifie la personne
// auprès du projet du Commis (RPC console_suis_admin avec le jeton de la console). Le journal passe par console_noter.
//   { action: "tout" }                                   → données de l'app (console_donnees) + rôle
//   Le Tiroir  : { action: "foyer", id, geste: "activer" | "retirer", paiement? } → forfait 12 mois (gestion)
//   Le Gousset : { action: "demande", id, statut: "approved" | "declined" | "pending" } → demande d'accès (gestion)
//   Le Seuil et La Voûte, HoldingAI Compte : lecture seulement (« tout »)
//   { action: "viralite" }                               → console_viralite() du projet (Commis, Gousset, Tiroir, HoldingAI Compte)
// Déployer avec verify_jwt = false : le jeton vient du projet du Commis, la vérification est faite ici.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const COMMIS_URL = "https://gandliltstmtfsmsjaew.supabase.co";
const COMMIS_CLE = "sb_publishable_8b0VbS6YyEf5vrsn5u9m4Q_JJZ1vkmP"; // clé publique
const ORIGINES = /^https:\/\/(console\.holdingai\.app|[a-z0-9-]+\.francois-gaouette\.workers\.dev)$/;
const UUID = /^[0-9a-f-]{36}$/i;
const PROJETS: Record<string, string> = { gandliltstmtfsmsjaew: "commis", inhheqccvhwybmcdboip: "tiroir", jdgflxesnaiumxodrkzd: "gousset", wuvpckyktoukttkbdzql: "seuil", wwakxuzuhmdmweluafiz: "compte" };
const APP = Object.entries(PROJETS).find(([ref]) => (Deno.env.get("SUPABASE_URL") || "").includes(ref))?.[1] || "inconnu";

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

  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jeton) return json({ erreur: "Connexion requise." }, 401);
  const commis = (fn: string, args: Record<string, unknown> = {}) =>
    fetch(`${COMMIS_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: COMMIS_CLE, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const r = await commis("console_suis_admin");
  if (r.status === 401) return json({ erreur: "Connexion requise." }, 401);
  const role = r.ok ? await r.json() : null;
  if (!role) return json({ erreur: "Ce compte n'a pas accès à la console." }, 403);
  const noter = (geste: string, cible: string, detail: Record<string, unknown> = {}) =>
    commis("console_noter", { p_app: APP, p_action: `${APP}.${geste}`, p_cible: cible, p_detail: detail }).catch(() => null);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const action = String(b.action || "");

  try {
    if (action === "tout") {
      const { data, error } = await db.rpc("console_donnees");
      if (error) return json({ erreur: error.message }, 500);
      return json({ ...data, role });
    }
    if (action === "viralite") {
      const { data, error } = await db.rpc("console_viralite");
      if (error) return json({ erreur: error.message }, 500);
      return json(data);
    }
    if (role !== "proprio" && role !== "gestion") return json({ erreur: "Votre accès permet seulement de consulter." }, 403);

    if (APP === "tiroir" && action === "foyer") {
      const id = String(b.id || ""); if (!UUID.test(id)) return json({ erreur: "Foyer invalide." }, 400);
      const { data: f } = await db.from("carnet_foyers").select("nom, paye_jusqua").eq("id", id).maybeSingle();
      if (!f) return json({ erreur: "Foyer introuvable." }, 404);
      let paye: string | null = null;
      if (b.geste === "activer") {
        const depart = new Date(Math.max(Date.now(), f.paye_jusqua ? new Date(f.paye_jusqua).getTime() : 0));
        depart.setFullYear(depart.getFullYear() + 1); paye = depart.toISOString();
      } else if (b.geste !== "retirer") return json({ erreur: "Geste inconnu." }, 400);
      const { error } = await db.from("carnet_foyers").update({ paye_jusqua: paye }).eq("id", id);
      if (error) return json({ erreur: error.message }, 500);
      if (b.paiement && Number.isInteger(Number(b.paiement))) await db.from("console_paiements").update({ active: true }).eq("id", Number(b.paiement));
      await noter("foyer", f.nom || id, { geste: b.geste, jusqua: paye });
      return json({ ok: true, paye_jusqua: paye });
    }
    if (APP === "gousset" && action === "demande") {
      const id = String(b.id || ""); if (!UUID.test(id)) return json({ erreur: "Demande invalide." }, 400);
      const statut = String(b.statut || ""); if (!["approved", "declined", "pending"].includes(statut)) return json({ erreur: "État invalide." }, 400);
      const { data, error } = await db.from("access_requests").update({ status: statut }).eq("id", id).select("email").maybeSingle();
      if (error) return json({ erreur: error.message }, 500);
      if (!data) return json({ erreur: "Demande introuvable." }, 404);
      await noter("demande", data.email, { statut });
      return json({ ok: true });
    }
    return json({ erreur: "Action inconnue." }, 400);
  } catch (e) {
    console.error(action, String(e));
    return json({ erreur: "L'app ne répond pas. Réessayez dans un instant." }, 502);
  }
});
