// Rappel du bilan quotidien (notifications Web Push).
//  - POST {action:"cle"} (membre connecté)   -> clé publique VAPID pour s'abonner
//  - POST {action:"test"} (membre connecté)  -> envoie une notification d'essai à ses appareils
//  - POST {action:"envoyer"} + en-tête x-cron  -> appelé par pg_cron; envoie le rappel à 21 h (heure de Montréal)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function cles() {
  const { data } = await admin.from("push_cles").select("nom, valeur");
  const m = new Map((data || []).map((r) => [r.nom, r.valeur]));
  if (!m.get("vapid_public") || !m.get("vapid_private")) {
    const k = webpush.generateVAPIDKeys();
    await admin.from("push_cles").upsert([{ nom: "vapid_public", valeur: k.publicKey }, { nom: "vapid_private", valeur: k.privateKey }]);
    m.set("vapid_public", k.publicKey); m.set("vapid_private", k.privateKey);
  }
  webpush.setVapidDetails("mailto:notre-epicerie@example.com", m.get("vapid_public")!, m.get("vapid_private")!);
  return m;
}

// Membre connecté (par courriel ou par cellulaire) : renvoie son identifiant de compte
async function membreDe(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return null;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  const { data } = await sb.from("membres").select("id").limit(1);
  return data && data.length && u?.user?.id ? u.user.id : null;
}

async function envoyer(userId: string | null, payload: Record<string, unknown>) {
  let q = admin.from("abonnements").select("id, endpoint, p256dh, auth");
  if (userId) q = q.eq("user_id", userId);
  const { data: subs } = await q;
  let ok = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("abonnements").delete().eq("id", s.id); // abonnement expiré
    }
  }
  return { envoyes: ok, total: (subs || []).length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* vide */ }
  const k = await cles();

  if (body.action === "envoyer") {
    const cron = req.headers.get("x-cron") || "";
    if (!cron || cron !== k.get("cron")) return json({ erreur: "Non autorisé" }, 401);
    const heure = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: "America/Toronto" }).format(new Date()));
    const { data: cfg } = await admin.from("config").select("bilan_heure, dernier_bilan").eq("id", 1).maybeSingle();
    const cible = Number(cfg?.bilan_heure ?? 21);
    const auj = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
    if (heure !== cible) return json({ ignore: `heure ${heure}, rappel prévu à ${cible} h` });
    if (cfg?.dernier_bilan === auj) return json({ ignore: "bilan déjà fait aujourd'hui" });
    const r = await envoyer(null, { title: "Bilan de la journée", body: "Qu'est-ce qui a été consommé aujourd'hui ? Touchez pour mettre la Maison à jour.", url: "./#bilan" });
    return json(r);
  }

  const userId = await membreDe(req);
  if (!userId) return json({ erreur: "Accès réservé aux membres." }, 403);
  if (body.action === "cle") return json({ cle: k.get("vapid_public") });
  if (body.action === "test") return json(await envoyer(userId, { title: "Notre épicerie", body: "Les rappels sont activés sur cet appareil. Le bilan vous sera demandé chaque soir.", url: "./#bilan" }));
  return json({ erreur: "Action inconnue" }, 400);
});
