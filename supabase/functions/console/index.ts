// Console HoldingAI : suivre et approuver les avis, les forfaits, les inscriptions et les questions
// pour Le Commis (Supabase) et Fanion (Firebase). Réservée aux comptes inscrits dans console_admins.
// Secret facultatif : FIREBASE_SERVICE_ACCOUNT (le fichier JSON du compte de service du projet Firebase « pelland »).
// Sans lui, la partie Fanion reste en lecture seule (groupes et avis déjà publiés).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINES = ["https://console.holdingai.app", "https://app.lecommis.ai", "https://lecommis.netlify.app"];
const cors = (o: string) => ({
  "Access-Control-Allow-Origin": ORIGINES.includes(o) ? o : ORIGINES[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOUR = 864e5;
class Refus extends Error { constructor(m: string, public code = 400) { super(m); } }

// ---------- Firebase (Fanion) ----------
const PROJET = "pelland";
const DOCS = `projects/${PROJET}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
type Val = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
const dec = (v: any): any =>
  v == null ? null
  : "stringValue" in v ? v.stringValue
  : "integerValue" in v ? Number(v.integerValue)
  : "doubleValue" in v ? v.doubleValue
  : "booleanValue" in v ? v.booleanValue
  : "timestampValue" in v ? v.timestampValue
  : "arrayValue" in v ? (v.arrayValue.values || []).map(dec)
  : "mapValue" in v ? obj(v.mapValue.fields)
  : null;
const obj = (f: Record<string, Val> | undefined) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
const idDe = (name: string) => name.split("/").pop() || "";

let JETON: { t: string; exp: number } | null = null;
const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function jetonGoogle(): Promise<string | null> {
  const brut = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!brut) return null;
  if (JETON && JETON.exp > Date.now() + 60_000) return JETON.t;
  const sa = JSON.parse(brut);
  if (sa.project_id !== PROJET) throw new Refus("Le compte de service n'est pas celui du projet Firebase de Fanion.", 500);
  const now = Math.floor(Date.now() / 1000);
  const tete = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corps = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const cle = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cle, new TextEncoder().encode(`${tete}.${corps}`)));
  let bin = ""; for (const x of sig) bin += String.fromCharCode(x);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${tete}.${corps}.${b64u(bin)}` }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Refus("Google a refusé le compte de service de Fanion.", 502);
  JETON = { t: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return JETON.t;
}
const entetes = (tok: string | null) => ({ "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) });
async function requete(tok: string | null, q: Record<string, unknown>) {
  const r = await fetch(`${FS}:runQuery`, { method: "POST", headers: entetes(tok), body: JSON.stringify({ structuredQuery: q }) });
  if (!r.ok) throw new Refus(`Firestore ${r.status}`, 502);
  // deno-lint-ignore no-explicit-any
  return ((await r.json()) as any[]).filter((x) => x.document).map((x) => ({ id: idDe(x.document.name), ...obj(x.document.fields) }));
}
async function lireDoc(tok: string, chemin: string) {
  const r = await fetch(`${FS}/${chemin}`, { headers: entetes(tok) });
  if (r.status === 404) throw new Refus("Introuvable dans Fanion.", 404);
  if (!r.ok) throw new Refus(`Firestore ${r.status}`, 502);
  const d = await r.json();
  return obj(d.fields);
}
// Écrit seulement les champs nommés ; un champ nommé mais absent de « valeurs » est retiré du document
async function ecrireDoc(tok: string, chemin: string, champs: string[], valeurs: Record<string, Val>) {
  const qs = champs.map((c) => `updateMask.fieldPaths=${encodeURIComponent(c)}`).join("&") + "&currentDocument.exists=true";
  const r = await fetch(`${FS}/${chemin}?${qs}`, { method: "PATCH", headers: entetes(tok), body: JSON.stringify({ fields: valeurs }) });
  if (r.status === 404) throw new Refus("Introuvable dans Fanion.", 404);
  if (!r.ok) throw new Refus(`Firestore ${r.status}`, 502);
}

async function donneesFanion() {
  const tok = await jetonGoogle();
  const borne = (suffixe: string) => ({ referenceValue: `${DOCS}/players/_groupe${suffixe}` });
  const groupes = await requete(tok, {
    from: [{ collectionId: "players" }], limit: 1000,
    where: { compositeFilter: { op: "AND", filters: [
      { fieldFilter: { field: { fieldPath: "__name__" }, op: "GREATER_THAN_OR_EQUAL", value: borne("_") } },
      { fieldFilter: { field: { fieldPath: "__name__" }, op: "LESS_THAN", value: borne("`") } },
    ] } },
  });
  // Nom du propriétaire de chaque groupe
  const proprios = [...new Set(groupes.map((g) => String(g.owner || "")).filter((x) => /^[\w-]{1,80}$/.test(x)))];
  const noms: Record<string, string> = {};
  if (proprios.length) {
    const r = await fetch(`${FS}:batchGet`, { method: "POST", headers: entetes(tok), body: JSON.stringify({ documents: proprios.slice(0, 500).map((p) => `${DOCS}/players/${p}`), mask: { fieldPaths: ["name"] } }) });
    // deno-lint-ignore no-explicit-any
    if (r.ok) for (const x of (await r.json()) as any[]) if (x.found) noms[idDe(x.found.name)] = dec((x.found.fields || {}).name) || "";
  }
  let avis: Record<string, unknown>[], demandes: Record<string, unknown>[] = [];
  const parties: Record<string, { n: number; derniere: number }> = {};
  if (tok) {
    avis = await requete(tok, { from: [{ collectionId: "avis" }], limit: 500 });
    demandes = (await requete(tok, { from: [{ collectionId: "requests" }], limit: 200 })).filter((d) => !d.done);
    const jeux = await requete(tok, {
      from: [{ collectionId: "games" }], orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }], limit: 1000,
      select: { fields: [{ fieldPath: "groupId" }, { fieldPath: "createdAt" }] },
    });
    for (const j of jeux) {
      const g = String(j.groupId || "pelland"), p = parties[g] || (parties[g] = { n: 0, derniere: 0 });
      p.n++; p.derniere = Math.max(p.derniere, Number(j.createdAt) || 0);
    }
  } else {
    avis = await requete(null, { from: [{ collectionId: "avis" }], limit: 100, where: { fieldFilter: { field: { fieldPath: "approved" }, op: "EQUAL", value: { booleanValue: true } } } });
  }
  return {
    pret: !!tok,
    groupes: groupes.map((g) => {
      const id = String(g.id).replace(/^_groupe_/, "");
      return { id, nom: g.name || id, proprio: noms[String(g.owner)] || "", cree: g.createdAt || null, joueurs: g.nPlayers ?? null, plan: g.plan || "", paye_jusqua: g.paidUntil || null, ref: g.ref || "", parties: parties[id]?.n ?? null, derniere_partie: parties[id]?.derniere || null };
    }).sort((a, b) => (Number(b.cree) || 0) - (Number(a.cree) || 0)),
    avis: avis.map((a) => ({ id: a.id, cree: a.at || null, texte: a.text || "", etoiles: a.stars || null, prenom: a.name || "", groupe: a.groupName || "", accord: a.ok === true, publie: a.approved === true, ecarte: a.ecarte === true }))
      .sort((a, b) => (Number(b.cree) || 0) - (Number(a.cree) || 0)),
    demandes: demandes.map((d) => ({ id: d.id, cree: d.at || null, nom: d.name || "", lien: d.url || "", texte: d.text || "", groupe: d.group || "", par: d.by || "" }))
      .sort((a, b) => (Number(b.cree) || 0) - (Number(a.cree) || 0)),
  };
}

Deno.serve(async (req: Request) => {
  const CORS = cors(req.headers.get("Origin") || "");
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Qui appelle ? Le jeton est vérifié auprès de Supabase, puis le compte doit être dans console_admins.
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jeton);
  const uid = u?.user?.id;
  if (!uid) return json({ erreur: "Connexion requise." }, 401);
  const { data: ok } = await admin.from("console_admins").select("user_id").eq("user_id", uid).maybeSingle();
  if (!ok) return json({ erreur: "Ce compte n'a pas accès à la console." }, 403);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const action = String(b.action || "");
  const noter = (app: string, cible: string, detail: Record<string, unknown> = {}) =>
    admin.from("console_journal").insert({ admin: uid, app, action, cible, detail });

  try {
    if (action === "tout") {
      const { data: commis, error } = await admin.rpc("console_donnees");
      if (error) throw new Refus(error.message, 500);
      let fanion: Record<string, unknown>;
      try { fanion = await donneesFanion(); } catch (e) { fanion = { pret: false, erreur: (e as Error).message, groupes: [], avis: [], demandes: [] }; }
      return json({ commis, fanion, courriel: u.user.email });
    }

    // ---------- Le Commis ----------
    if (action === "commis.avis") {
      const id = String(b.id || ""); if (!UUID.test(id)) throw new Refus("Avis invalide.");
      const etat = String(b.etat || "");
      if (!["publie", "attente", "ecarte"].includes(etat)) throw new Refus("État invalide.");
      const { data: t } = await admin.from("temoignages").select("affichage_ok").eq("id", id).maybeSingle();
      if (!t) throw new Refus("Avis introuvable.", 404);
      if (etat === "publie" && !t.affichage_ok) throw new Refus("La personne n'a pas accepté que son avis soit affiché.");
      const { error } = await admin.from("temoignages").update({ publie: etat === "publie", ecarte: etat === "ecarte" }).eq("id", id);
      if (error) throw new Refus(error.message, 500);
      await noter("commis", id, { etat });
      return json({ ok: true });
    }
    if (action === "commis.foyer") {
      const id = String(b.id || ""); if (!UUID.test(id)) throw new Refus("Foyer invalide.");
      const geste = String(b.geste || "");
      const { data: f } = await admin.from("foyers").select("nom, essai_fin, paye_jusqua").eq("id", id).maybeSingle();
      if (!f) throw new Refus("Foyer introuvable.", 404);
      if (geste === "essai") {
        const jours = Math.max(1, Math.min(365, Math.round(Number(b.jours) || 30)));
        const fin = new Date(Math.max(Date.now(), new Date(f.essai_fin).getTime()) + jours * JOUR).toISOString();
        const { error } = await admin.from("foyers").update({ essai_fin: fin }).eq("id", id);
        if (error) throw new Refus(error.message, 500);
        await noter("commis", f.nom, { geste, jours, essai_fin: fin });
      } else if (geste === "activer") {
        const { data, error } = await admin.rpc("activer_foyer", { p_foyer: id, p_annees: 1 });
        if (error) throw new Refus(error.message, 500);
        await noter("commis", f.nom, { geste, paye_jusqua: data, raison: String(b.raison || "").slice(0, 200) });
      } else if (geste === "retirer") {
        const { error } = await admin.from("foyers").update({ paye_jusqua: null }).eq("id", id);
        if (error) throw new Refus(error.message, 500);
        await noter("commis", f.nom, { geste, avant: f.paye_jusqua });
      } else throw new Refus("Geste invalide.");
      return json({ ok: true });
    }

    // ---------- Fanion ----------
    if (action.startsWith("fanion.")) {
      const tok = await jetonGoogle();
      if (!tok) throw new Refus("Fanion n'est pas encore relié à la console.", 503);
      if (action === "fanion.avis") {
        const id = String(b.id || ""); if (!/^[A-Za-z0-9]{10,60}$/.test(id)) throw new Refus("Avis invalide.");
        const etat = String(b.etat || "");
        if (!["publie", "attente", "ecarte"].includes(etat)) throw new Refus("État invalide.");
        const a = await lireDoc(tok, `avis/${id}`);
        if (etat === "publie" && a.ok !== true) throw new Refus("Le joueur n'a pas accepté que son avis soit affiché.");
        await ecrireDoc(tok, `avis/${id}`, ["approved", "ecarte"], { approved: { booleanValue: etat === "publie" }, ecarte: { booleanValue: etat === "ecarte" } });
        await noter("fanion", `${a.name || ""}, ${a.groupName || ""}`, { etat });
        return json({ ok: true });
      }
      if (action === "fanion.groupe") {
        const id = String(b.id || ""); if (!/^[\w-]{1,80}$/.test(id)) throw new Refus("Groupe invalide.");
        const geste = String(b.geste || "");
        const g = await lireDoc(tok, `players/_groupe_${id}`);
        if (geste === "activer") {
          const base = g.plan === "groupe" && Number(g.paidUntil) > Date.now() ? Number(g.paidUntil) : Date.now();
          const fin = base + 365 * JOUR;
          await ecrireDoc(tok, `players/_groupe_${id}`, ["plan", "paidUntil"], { plan: { stringValue: "groupe" }, paidUntil: { integerValue: String(Math.round(fin)) } });
          await noter("fanion", String(g.name || id), { geste, paye_jusqua: new Date(fin).toISOString(), raison: String(b.raison || "").slice(0, 200) });
        } else if (geste === "retirer") {
          await ecrireDoc(tok, `players/_groupe_${id}`, ["plan", "paidUntil"], {});
          await noter("fanion", String(g.name || id), { geste, avant: g.paidUntil || null });
        } else throw new Refus("Geste invalide.");
        return json({ ok: true });
      }
      if (action === "fanion.demande") {
        const id = String(b.id || ""); if (!/^[A-Za-z0-9]{6,60}$/.test(id)) throw new Refus("Demande invalide.");
        const d = await lireDoc(tok, `requests/${id}`);
        await ecrireDoc(tok, `requests/${id}`, ["done"], { done: { booleanValue: true } });
        await noter("fanion", String(d.name || id), { geste: "traitee" });
        return json({ ok: true });
      }
    }
    throw new Refus("Action inconnue.");
  } catch (e) {
    if (e instanceof Refus) return json({ erreur: e.message }, e.code);
    console.error(e);
    return json({ erreur: "Erreur du serveur." }, 500);
  }
});
