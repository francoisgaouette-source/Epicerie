// Console HoldingAI : frais variables des 30 derniers jours, lus directement dans les factures.
// Réservé aux comptes de console_admins. Les clés restent ici, côté serveur : la console ne reçoit que des montants.
//
// Secrets (Supabase > Edge Functions > Secrets), tous facultatifs; chaque source manquante est signalée dans la console :
//   ANTHROPIC_ADMIN_KEY      clé d'administration Anthropic (sk-ant-admin…), pour l'usage et le coût de Claude
//   TWILIO_ACCOUNT_SID       identifiant du compte Twilio (AC…)
//   TWILIO_API_KEY           clé API Twilio (SK…) et TWILIO_API_SECRET, ou à défaut TWILIO_AUTH_TOKEN
//   STRIPE_CLE_LECTURE       clé Stripe restreinte (rk_live_…) avec lecture des soldes et des paiements
//
// Partage par app : Claude par clé API (une clé par app, reconnue à son nom), Twilio Verify par service
// (nom du service), textos directs par numéro d'envoi (nom du numéro), Stripe par la description du paiement.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINES = /^https:\/\/(console\.holdingai\.app|app\.lecommis\.ai|[a-z0-9-]+\.francois-gaouette\.workers\.dev)$/;
const JOUR = 864e5;

// Tarifs en $ US par million de jetons : entrée, sortie, écriture en cache, lecture en cache (mêmes valeurs que les apps)
const PRIX: Record<string, number[]> = { haiku: [0.10, 0.50, 0.125, 0.01], sonnet: [2, 10, 2.5, 0.10], opus: [4, 20, 5, 0.20] };
const famille = (m: string) => (/haiku/i.test(m) ? "haiku" : /opus/i.test(m) ? "opus" : "sonnet");

// Reconnaît l'app à partir d'un nom (clé API, service Verify, numéro, description de paiement)
const APPS: [RegExp, string][] = [
  [/commis|epicerie|rosalie/, "commis"], [/fanion|pelland|caddie|golf/, "fanion"], [/plumeau|colette|collette/, "plumeau"],
  [/tiroir|carnet|gaston/, "tiroir"], [/gousset|margaux|shopping/, "gousset"], [/seuil/, "seuil"], [/voute/, "voute"],
  [/pourquoi|simon/, "pourquoi"], [/nostalgie|jeanne/, "nostalgie"], [/echange/, "echange"], [/vestibule|lucie/, "vestibule"],
  [/donne|tapis|marcel/, "donne"], [/escale|celeste/, "escale"], [/holding|etabli|compte|albert|console/, "holdingai"],
];
const appDe = (nom: unknown) => {
  const n = String(nom || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return (APPS.find(([re]) => re.test(n)) || [null, null])[1];
};

let CACHE: { t: number; d: unknown } | null = null;

// deno-lint-ignore no-explicit-any
async function lireJson(url: string, init: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || d?.message || `erreur ${r.status}`);
  return d;
}

async function anthropic(debut: Date, fin: Date) {
  const cle = Deno.env.get("ANTHROPIC_ADMIN_KEY");
  if (!cle) return { pret: false };
  const h = { "x-api-key": cle, "anthropic-version": "2023-06-01" };
  const base = "https://api.anthropic.com/v1/organizations";
  const q = `starting_at=${debut.toISOString()}&ending_at=${fin.toISOString()}&bucket_width=1d&limit=31`;
  // Noms des clés API
  const noms: Record<string, string> = {};
  for (let page = "", n = 0; n < 10; n++) {
    const d = await lireJson(`${base}/api_keys?limit=100${page ? `&after_id=${page}` : ""}`, { headers: h });
    for (const k of d.data || []) noms[k.id] = k.name || k.id;
    if (!d.has_more || !d.last_id) break; page = d.last_id;
  }
  // Usage par clé et par modèle
  const parCle: Record<string, { entree: number; sortie: number; cache: number; recherches: number; usd: number; modeles: Set<string> }> = {};
  for (let page = "", n = 0; n < 20; n++) {
    const d = await lireJson(`${base}/usage_report/messages?${q}&group_by[]=api_key_id&group_by[]=model${page ? `&page=${page}` : ""}`, { headers: h });
    for (const b of d.data || []) for (const r of b.results || []) {
      const id = r.api_key_id || "console";
      const x = parCle[id] || (parCle[id] = { entree: 0, sortie: 0, cache: 0, recherches: 0, usd: 0, modeles: new Set() });
      const p = PRIX[famille(r.model || "")];
      const cw = (r.cache_creation?.ephemeral_5m_input_tokens || 0) + (r.cache_creation?.ephemeral_1h_input_tokens || 0);
      const e = r.uncached_input_tokens || 0, s = r.output_tokens || 0, cl = r.cache_read_input_tokens || 0, ws = r.server_tool_use?.web_search_requests || 0;
      x.entree += e + cw + cl; x.sortie += s; x.cache += cl; x.recherches += ws; x.modeles.add(String(r.model || "").replace(/^claude-/, ""));
      x.usd += (e * p[0] + s * p[1] + cw * p[2] + cl * p[3]) / 1e6 + ws * 0.01;
    }
    if (!d.has_more || !d.next_page) break; page = d.next_page;
  }
  // Coût exact facturé (toutes clés confondues)
  let exact = 0;
  for (let page = "", n = 0; n < 20; n++) {
    const d = await lireJson(`${base}/cost_report?starting_at=${debut.toISOString()}&ending_at=${fin.toISOString()}&limit=31${page ? `&page=${page}` : ""}`, { headers: h });
    for (const b of d.data || []) for (const r of b.results || []) exact += Number(r.amount || 0) / 100; // montant en cents US
    if (!d.has_more || !d.next_page) break; page = d.next_page;
  }
  const estime = Object.values(parCle).reduce((s, x) => s + x.usd, 0);
  const facteur = estime > 0 && exact > 0 ? exact / estime : 1; // ramène l'estimation par clé au montant facturé
  const cles = Object.entries(parCle).map(([id, x]) => ({
    id, nom: id === "console" ? "Console Anthropic (essais)" : noms[id] || id, app: id === "console" ? null : appDe(noms[id]),
    entree: x.entree, sortie: x.sortie, recherches: x.recherches, modeles: [...x.modeles], usd: x.usd * facteur,
  })).sort((a, b) => b.usd - a.usd);
  return { pret: true, total_usd: exact || estime, exact: exact > 0, cles };
}

async function twilio(debut: Date) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const u = Deno.env.get("TWILIO_API_KEY") || sid, p = Deno.env.get("TWILIO_API_SECRET") || Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !u || !p) return { pret: false };
  const h = { Authorization: "Basic " + btoa(`${u}:${p}`) };
  const api = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  // Total par catégorie (Twilio répartit lui-même : textos, Verify, numéros…); on garde les catégories de détail payantes
  const us = await lireJson(`${api}/Usage/Records/Last30Days.json?PageSize=1000`, { headers: h });
  type Cat = { cle: string; nom: string; nombre: number; usd: number };
  const toutes: Cat[] = (us.usage_records || []).map((r: { category: string; description: string; count: string; price: string }) =>
    ({ cle: r.category, nom: r.description, nombre: Number(r.count) || 0, usd: Number(r.price) || 0 }));
  const total = (toutes.find((c) => c.cle === "totalprice") || { usd: 0 }).usd;
  // Twilio range ses catégories en arbre (« sms » contient « sms-outbound »…) : on ne garde que les feuilles payantes
  const categories = toutes.filter((c) => c.usd > 0 && c.cle !== "totalprice" && !toutes.some((d) => d.cle !== c.cle && d.cle.startsWith(c.cle + "-") && d.usd > 0));
  const verifyUsd = categories.filter((c) => c.cle.startsWith("verify")).reduce((s, c) => s + c.usd, 0);

  // Verify : tentatives par service, pour partager le coût de Verify entre les apps
  const services: Record<string, string> = {};
  const sv = await lireJson("https://verify.twilio.com/v2/Services?PageSize=100", { headers: h }).catch(() => ({ services: [] }));
  for (const s of sv.services || []) services[s.sid] = s.friendly_name;
  const parService: Record<string, number> = {};
  let url = `https://verify.twilio.com/v2/Attempts?DateCreatedAfter=${debut.toISOString()}&PageSize=1000`;
  for (let n = 0; url && n < 10; n++) {
    const d = await lireJson(url, { headers: h }).catch(() => ({ attempts: [], meta: {} }));
    for (const a of d.attempts || []) parService[a.service_sid] = (parService[a.service_sid] || 0) + 1;
    url = d.meta?.next_page_url || "";
  }
  const nbTentatives = Object.values(parService).reduce((s, n) => s + n, 0);
  const verify = Object.entries(parService).map(([s, n]) => ({ service: services[s] || s, app: appDe(services[s]), tentatives: n, usd: nbTentatives ? verifyUsd * n / nbTentatives : 0 }))
    .sort((a, b) => b.tentatives - a.tentatives);

  // Textos envoyés directement (hors Verify) : par numéro d'envoi
  const numeros: Record<string, string> = {};
  const nu = await lireJson(`${api}/IncomingPhoneNumbers.json?PageSize=100`, { headers: h }).catch(() => ({ incoming_phone_numbers: [] }));
  for (const x of nu.incoming_phone_numbers || []) numeros[x.phone_number] = x.friendly_name || x.phone_number;
  const parNumero: Record<string, { nombre: number; usd: number }> = {};
  let mu = `${api}/Messages.json?DateSent%3E=${debut.toISOString().slice(0, 10)}&PageSize=1000`;
  for (let n = 0; mu && n < 10; n++) {
    const d = await lireJson(mu, { headers: h }).catch(() => ({ messages: [] }));
    for (const m of d.messages || []) {
      if (!String(m.direction || "").startsWith("outbound")) continue;
      const x = parNumero[m.from] || (parNumero[m.from] = { nombre: 0, usd: 0 });
      x.nombre++; x.usd += Math.abs(Number(m.price) || 0);
    }
    mu = d.next_page_uri ? `https://api.twilio.com${d.next_page_uri}` : "";
  }
  const textos = Object.entries(parNumero).map(([num, x]) => ({ numero: num, nom: numeros[num] || num, app: appDe(numeros[num]), ...x })).sort((a, b) => b.usd - a.usd);
  return { pret: true, total_usd: total || categories.reduce((x, c) => x + c.usd, 0), categories, verify, textos };
}

async function stripe(debut: Date) {
  const cle = Deno.env.get("STRIPE_CLE_LECTURE");
  if (!cle) return { pret: false };
  const h = { Authorization: `Bearer ${cle}` };
  const lignes: { app: string | null; ventes: number; frais: number; devise: string; type: string }[] = [];
  let apres = "";
  for (let n = 0; n < 20; n++) {
    const d = await lireJson(`https://api.stripe.com/v1/balance_transactions?limit=100&created[gte]=${Math.floor(debut.getTime() / 1000)}&expand[]=data.source${apres ? `&starting_after=${apres}` : ""}`, { headers: h });
    for (const t of d.data || []) {
      const src = typeof t.source === "object" && t.source ? t.source : {};
      const nom = [src.description, src.calculated_statement_descriptor, src.statement_descriptor_suffix, src.metadata?.app, t.description].filter(Boolean).join(" ");
      // Frais : ceux prélevés sur chaque paiement, plus les frais facturés à part par Stripe (type stripe_fee…)
      const fraisAPart = /fee/.test(t.type) && t.amount < 0 ? -t.amount : 0;
      lignes.push({ app: appDe(nom), ventes: ["charge", "payment"].includes(t.type) ? t.amount / 100 : 0, frais: (t.fee + fraisAPart) / 100, devise: t.currency, type: t.type });
    }
    if (!d.has_more || !d.data?.length) break; apres = d.data[d.data.length - 1].id;
  }
  const devise = (lignes[0] || {}).devise || "cad";
  const parApp: Record<string, { ventes: number; frais: number; paiements: number }> = {};
  for (const l of lignes) {
    const k = l.app || "inconnue", x = parApp[k] || (parApp[k] = { ventes: 0, frais: 0, paiements: 0 });
    x.ventes += l.ventes; x.frais += l.frais; if (l.ventes) x.paiements++;
  }
  return { pret: true, devise, frais: lignes.reduce((s, l) => s + l.frais, 0), ventes: lignes.reduce((s, l) => s + l.ventes, 0), par_app: parApp };
}

Deno.serve(async (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const CORS = { "Access-Control-Allow-Origin": ORIGINES.test(o) ? o : "https://console.holdingai.app", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
  if (!u?.user) return json({ erreur: "Connexion requise." }, 401);
  const { data: ok } = await admin.from("console_admins").select("role").eq("user_id", u.user.id).maybeSingle();
  if (!ok) return json({ erreur: "Ce compte n'a pas accès à la console." }, 403);

  const b = await req.json().catch(() => ({}));
  if (CACHE && Date.now() - CACHE.t < 10 * 60e3 && !b.rafraichir) return json(CACHE.d);
  const fin = new Date(), debut = new Date(fin.getTime() - 30 * JOUR);
  const garde = async <T,>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { pret: false, erreur: (e as Error).message.slice(0, 200) }; } };
  const [a, t, s] = await Promise.all([garde(() => anthropic(debut, fin)), garde(() => twilio(debut)), garde(() => stripe(debut))]);
  const d = { du: debut.toISOString(), au: fin.toISOString(), lu: fin.toISOString(), anthropic: a, twilio: t, stripe: s };
  CACHE = { t: Date.now(), d };
  return json(d);
});
