// Active un foyer pour 12 mois quand Stripe confirme un paiement, et note le paiement pour la console HoldingAI.
// Stripe > Développeurs > Webhooks : cette adresse, événement checkout.session.completed.
// Secret requis : STRIPE_WEBHOOK_SECRET (commence par whsec_).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function signatureValide(raw: string, entete: string, secret: string) {
  const parts = Object.fromEntries(entete.split(",").map((p) => p.split("=", 2)).filter((p) => p.length === 2)) as Record<string, string>;
  const signatures = entete.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !signatures.length || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const attendu = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)));
  return signatures.some((s) => s.length === attendu.length && [...s].every((c, i) => c === attendu[i]));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ erreur: "STRIPE_WEBHOOK_SECRET manquant" }, 503);
  const raw = await req.text();
  if (!(await signatureValide(raw, req.headers.get("Stripe-Signature") || "", secret))) return json({ erreur: "Signature invalide" }, 400);

  let ev: { type?: string; data?: { object?: Record<string, unknown> } } = {};
  try { ev = JSON.parse(raw); } catch { return json({ erreur: "JSON invalide" }, 400); }
  if (ev.type !== "checkout.session.completed" && ev.type !== "checkout.session.async_payment_succeeded") return json({ recu: true, ignore: ev.type });

  const s = ev.data?.object || {};
  if (s.payment_status && s.payment_status !== "paid") return json({ recu: true, ignore: "paiement non complété" });
  const foyer = String(s.client_reference_id || "");
  const foyerValide = /^[0-9a-f-]{36}$/i.test(foyer);
  const session = String(s.id || "");
  const client = (s.customer_details || {}) as Record<string, unknown>;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Le paiement est noté une seule fois (session_id unique) : si Stripe renvoie le même avis, le foyer n'est pas prolongé deux fois.
  if (session) {
    const { data: deja } = await admin.from("console_paiements").select("id, active").eq("session_id", session).maybeSingle();
    if (deja?.active) return json({ recu: true, deja: true });
    if (!deja) {
      const { error: e0 } = await admin.from("console_paiements").insert({
        app: "commis", session_id: session, reference: foyer || null,
        montant: Number(s.amount_total) || null, devise: String(s.currency || "").slice(0, 8) || null,
        courriel: String(client.email || "").slice(0, 200) || null, nom: String(client.name || "").slice(0, 200) || null,
      });
      if (e0) console.error("paiement non noté", e0.message);
    }
  }
  if (!foyerValide) return json({ recu: true, erreur: "client_reference_id absent : activer le foyer à la main" });

  const { data, error } = await admin.rpc("activer_foyer", { p_foyer: foyer, p_annees: 1 });
  if (error) return json({ erreur: error.message }, 500); // Stripe réessaiera
  if (session) await admin.from("console_paiements").update({ active: true }).eq("session_id", session);
  return json({ recu: true, foyer, actif_jusqua: data });
});
