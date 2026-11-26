// CRM de la console HoldingAI : contacts (clients et prospects), notes, tâches, courriels et import.
// Réservé aux comptes de console_admins. « lecture » consulte; « gestion » et « proprio » modifient.
// Les courriels partent par le Worker Cloudflare (console.holdingai.app/api/envoyer), avec le secret COURRIEL_SECRET.
//   { action: "tout" }                                         → contacts, notes, tâches
//   { action: "contact.enregistrer", contact }                 → crée (sans id) ou modifie (avec id); invite_par, invite_app, invite_le : invitation à la bêta
//   { action: "contact.supprimer", id }
//   { action: "note.ajouter", contact_id, texte } · { action: "note.supprimer", id }
//   { action: "tache.ajouter", contact_id, titre, echeance? } · { action: "tache.faite", id, faite } · { action: "tache.supprimer", id }
//   { action: "courriel.envoyer", contact_id, de, sujet, texte }
//   { action: "importer", lignes: [...] }                       → ajoute ou complète (même courriel ou même cellulaire)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINES = /^https:\/\/(console\.holdingai\.app|app\.lecommis\.ai|[a-z0-9-]+\.francois-gaouette\.workers\.dev)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COURRIEL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
const TYPES = ["client", "prospect", "partenaire", "testeur", "media", "autre"];
const ETAPES = ["a_contacter", "contacte", "interesse", "converti", "perdu"];
const APPS = ["echange", "gousset", "pourquoi", "commis", "fanion", "seuil", "plumeau", "vestibule", "tiroir", "voute", "donne", "nostalgie", "escale"];
const EXPEDITEURS: Record<string, { app: string; nom: string }> = {
  "bonjour@holdingai.app": { app: "holdingai", nom: "HoldingAI" },
  "bonjour@lecommis.ai": { app: "commis", nom: "Le Commis" },
  "bonjour@fanion.ai": { app: "fanion", nom: "Le Fanion" },
};
class Refus extends Error { constructor(m: string, public code = 400) { super(m); } }

const texte = (v: unknown, max: number) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };
// Cellulaire au format +15145550100 (10 chiffres nord-américains, ou déjà international)
export function cellulaire(v: unknown): string | null {
  const brut = String(v ?? "").trim(); if (!brut) return null;
  const d = brut.replace(/\D/g, "");
  if (brut.startsWith("+") && d.length >= 8 && d.length <= 15) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}
const liste = (v: unknown, permis?: string[]) => {
  const l = (Array.isArray(v) ? v : String(v ?? "").split(/[;,|]/)).map((x) => String(x).trim().toLowerCase().slice(0, 40)).filter(Boolean);
  return [...new Set(permis ? l.filter((x) => permis.includes(x)) : l)].slice(0, 20);
};
// Nettoie une fiche reçue de la console ou d'un import. « partiel » : seuls les champs présents comptent.
export function propre(c: Record<string, unknown>, partiel = false) {
  const p: Record<string, unknown> = {};
  const a = (k: string) => !partiel || k in c;
  if (a("nom")) p.nom = texte(c.nom, 120);
  if (a("courriel")) {
    const m = texte(c.courriel, 200)?.toLowerCase() ?? null;
    if (m && !COURRIEL.test(m)) throw new Refus(`Courriel invalide : ${m}`);
    p.courriel = m;
  }
  if (a("cellulaire")) {
    const n = cellulaire(c.cellulaire);
    if (String(c.cellulaire ?? "").trim() && !n) throw new Refus(`Cellulaire invalide : ${String(c.cellulaire).slice(0, 30)}`);
    p.cellulaire = n;
  }
  if (a("organisation")) p.organisation = texte(c.organisation, 120);
  if (a("source")) p.source = texte(c.source, 120);
  if (a("type")) { const t = String(c.type || "prospect").toLowerCase(); if (!TYPES.includes(t)) throw new Refus(`Type inconnu : ${t}`); p.type = t; }
  if (a("etape")) { const e = c.etape ? String(c.etape).toLowerCase() : null; if (e && !ETAPES.includes(e)) throw new Refus(`Étape inconnue : ${e}`); p.etape = e; }
  if (a("etiquettes")) p.etiquettes = liste(c.etiquettes);
  if (a("apps")) p.apps = liste(c.apps, APPS);
  if (a("holdingai_uid")) p.holdingai_uid = texte(c.holdingai_uid, 80);
  // Invitation à la bêta inscrite à la main : invité par (une autre fiche), pour quelle app, quand
  if (a("invite_par")) { const v = c.invite_par ? String(c.invite_par) : null; if (v && !UUID.test(v)) throw new Refus("Invité par : fiche invalide."); p.invite_par = v; }
  if (a("invite_app")) { const v = c.invite_app ? String(c.invite_app).toLowerCase() : null; if (v && !APPS.includes(v)) throw new Refus(`App inconnue : ${v}`); p.invite_app = v; }
  if (a("invite_le")) { const v = c.invite_le ? String(c.invite_le).slice(0, 10) : null; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Refus("Date d'invitation invalide."); p.invite_le = v; }
  return p;
}

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
  const action = String(b.action || "");
  const noter = (geste: string, cible: string, detail: Record<string, unknown> = {}) =>
    db.from("console_journal").insert({ admin: uid, app: "console", action: `crm.${geste}`, cible: cible.slice(0, 200), detail });
  const contact = async (id: unknown) => {
    if (!UUID.test(String(id || ""))) throw new Refus("Contact invalide.");
    const { data } = await db.from("crm_contacts").select("*").eq("id", String(id)).maybeSingle();
    if (!data) throw new Refus("Contact introuvable.", 404);
    return data;
  };
  const doublon = (e: { code?: string; message?: string } | null) => {
    if (e?.code === "23505") throw new Refus(/cellulaire/.test(e.message || "") ? "Un autre contact a déjà ce cellulaire." : /holdingai/.test(e.message || "") ? "Ce compte HoldingAI a déjà sa fiche." : "Un autre contact a déjà ce courriel.");
    if (e) throw new Refus(e.message || "Erreur", 500);
  };

  try {
    if (action === "tout") {
      const { data, error } = await db.rpc("crm_donnees");
      if (error) throw new Refus(error.message, 500);
      return json(data);
    }
    if (acces.role !== "proprio" && acces.role !== "gestion") throw new Refus("Votre accès permet seulement de consulter.", 403);

    if (action === "contact.enregistrer") {
      const c = (b.contact || {}) as Record<string, unknown>;
      if (c.id) {
        const avant = await contact(c.id);
        const p = propre(c, true);
        if ("nom" in p && !p.nom) throw new Refus("Le nom est obligatoire.");
        if (p.invite_par && p.invite_par === avant.id) throw new Refus("Une personne ne peut pas s'inviter elle-même.");
        if (p.invite_par) await contact(p.invite_par);
        const { data, error } = await db.from("crm_contacts").update({ ...p, maj: new Date().toISOString() }).eq("id", avant.id).select().single();
        doublon(error);
        if (p.etape && p.etape !== avant.etape) await noter("etape", data.nom, { etape: p.etape });
        if ("invite_par" in p && p.invite_par !== avant.invite_par) await noter("invitation", data.nom, { invite_par: p.invite_par, app: p.invite_app ?? avant.invite_app });
        return json({ ok: true, contact: data });
      }
      const p = propre(c);
      if (!p.nom) throw new Refus("Le nom est obligatoire.");
      const { data, error } = await db.from("crm_contacts").insert({ ...p, cree_par: uid }).select().single();
      doublon(error);
      await noter("ajout", data.nom, { type: data.type });
      return json({ ok: true, contact: data });
    }
    if (action === "contact.supprimer") {
      const c = await contact(b.id);
      const { error } = await db.from("crm_contacts").delete().eq("id", c.id);
      if (error) throw new Refus(error.message, 500);
      await noter("suppression", c.nom);
      return json({ ok: true });
    }
    const toucher = (id: string) => db.from("crm_contacts").update({ maj: new Date().toISOString() }).eq("id", id);

    if (action === "note.ajouter") {
      const c = await contact(b.contact_id);
      const t = String(b.texte || "").trim().slice(0, 5000);
      if (!t) throw new Refus("La note est vide.");
      const { error } = await db.from("crm_notes").insert({ contact_id: c.id, auteur: uid, texte: t });
      if (error) throw new Refus(error.message, 500);
      await toucher(c.id);
      return json({ ok: true });
    }
    if (action === "note.supprimer") {
      if (!UUID.test(String(b.id || ""))) throw new Refus("Note invalide.");
      const { error } = await db.from("crm_notes").delete().eq("id", String(b.id));
      if (error) throw new Refus(error.message, 500);
      return json({ ok: true });
    }
    if (action === "tache.ajouter") {
      const c = await contact(b.contact_id);
      const titre = String(b.titre || "").trim().slice(0, 300);
      if (!titre) throw new Refus("Décrivez la tâche.");
      const ech = b.echeance ? String(b.echeance) : null;
      if (ech && !/^\d{4}-\d{2}-\d{2}$/.test(ech)) throw new Refus("Date invalide.");
      const { error } = await db.from("crm_taches").insert({ contact_id: c.id, auteur: uid, titre, echeance: ech });
      if (error) throw new Refus(error.message, 500);
      await toucher(c.id);
      return json({ ok: true });
    }
    if (action === "tache.faite" || action === "tache.supprimer") {
      if (!UUID.test(String(b.id || ""))) throw new Refus("Tâche invalide.");
      const q = action === "tache.supprimer" ? db.from("crm_taches").delete().eq("id", String(b.id))
        : db.from("crm_taches").update({ faite: b.faite !== false, faite_le: b.faite !== false ? new Date().toISOString() : null }).eq("id", String(b.id));
      const { error } = await q;
      if (error) throw new Refus(error.message, 500);
      return json({ ok: true });
    }

    if (action === "courriel.envoyer") {
      const c = await contact(b.contact_id);
      if (!c.courriel) throw new Refus("Ce contact n'a pas de courriel.");
      const de = String(b.de || "bonjour@holdingai.app").toLowerCase();
      const exp = EXPEDITEURS[de]; if (!exp) throw new Refus("Adresse d'envoi inconnue.");
      const sujet = String(b.sujet || "").replace(/\s+/g, " ").trim().slice(0, 300);
      const corps = String(b.texte || "").replace(/\r\n/g, "\n").trim();
      if (!sujet) throw new Refus("Écrivez un objet.");
      if (!corps) throw new Refus("Le message est vide.");
      if (corps.length > 20000) throw new Refus("Le message est trop long.");
      const secret = Deno.env.get("COURRIEL_SECRET");
      if (!secret) throw new Refus("L'envoi de courriels n'est pas encore configuré (secret COURRIEL_SECRET absent).", 503);
      const r = await fetch("https://console.holdingai.app/api/envoyer", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Courriel-Secret": secret },
        body: JSON.stringify({ de, nom: exp.nom, a: c.courriel, sujet, texte: corps }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("Envoi refusé", r.status, d);
        if (r.status === 501) throw new Refus("L'envoi de courriels n'est pas encore activé dans Cloudflare (Email Sending).", 503);
        if (r.status === 403 || d.code === "SECRET_ABSENT") throw new Refus("Le secret COURRIEL_SECRET n'est pas le même dans Cloudflare et dans Supabase.", 503);
        if (/SENDER/.test(String(d.code))) throw new Refus(`Le domaine de ${de} n'est pas encore autorisé à envoyer dans Cloudflare.`, 503);
        throw new Refus(`Le courriel n'est pas parti (${d.code || d.erreur || r.status}).`, 502);
      }
      // Le courriel est gardé avec les autres, et paraît dans la fiche du contact
      await db.from("console_courriels").insert({ sens: "envoye", app: exp.app, de, de_nom: exp.nom, a: c.courriel, sujet, texte: corps, traite: true, envoye_par: uid });
      // Un prospect « à contacter » passe à « contacté »
      await db.from("crm_contacts").update({ maj: new Date().toISOString(), ...(c.etape === "a_contacter" ? { etape: "contacte" } : {}) }).eq("id", c.id);
      await noter("courriel", c.nom, { sujet });
      return json({ ok: true });
    }

    if (action === "importer") {
      const lignes = Array.isArray(b.lignes) ? b.lignes as Record<string, unknown>[] : [];
      if (!lignes.length) throw new Refus("Aucune ligne à importer.");
      if (lignes.length > 1000) throw new Refus("Maximum de 1000 lignes par import.");
      const { data: existants } = await db.from("crm_contacts").select("*");
      const parCourriel = new Map<string, Record<string, unknown>>(), parCell = new Map<string, Record<string, unknown>>();
      for (const c of existants || []) { if (c.courriel) parCourriel.set(String(c.courriel).toLowerCase(), c); if (c.cellulaire) parCell.set(c.cellulaire, c); }
      let ajoutes = 0, completes = 0;
      const erreurs: string[] = [];
      for (const [i, l] of lignes.entries()) {
        try {
          const note = String(l.note || l.notes || "").trim().slice(0, 5000);
          const p = propre({ type: "prospect", ...l });
          if (!p.nom) p.nom = (p.courriel as string) || (p.cellulaire as string) || null;
          if (!p.nom) throw new Refus("ni nom, ni courriel, ni cellulaire");
          const deja = (p.courriel && parCourriel.get(p.courriel as string)) || (p.cellulaire && parCell.get(p.cellulaire as string));
          let id: string;
          if (deja) {
            // Complète la fiche sans rien écraser : champs vides remplis, étiquettes et apps ajoutées
            const maj: Record<string, unknown> = {};
            for (const k of ["courriel", "cellulaire", "organisation", "source", "etape"]) if (!deja[k] && p[k]) maj[k] = p[k];
            const etq = [...new Set([...(deja.etiquettes as string[] || []), ...(p.etiquettes as string[])])];
            const ap = [...new Set([...(deja.apps as string[] || []), ...(p.apps as string[])])];
            if (etq.length !== (deja.etiquettes as string[] || []).length) maj.etiquettes = etq;
            if (ap.length !== (deja.apps as string[] || []).length) maj.apps = ap;
            if (Object.keys(maj).length) { const { error } = await db.from("crm_contacts").update({ ...maj, maj: new Date().toISOString() }).eq("id", deja.id as string); doublon(error); }
            id = deja.id as string; completes++;
          } else {
            const { data, error } = await db.from("crm_contacts").insert({ ...p, etape: p.etape ?? (p.type === "prospect" ? "a_contacter" : null), cree_par: uid }).select().single();
            doublon(error);
            id = data.id; ajoutes++;
            if (data.courriel) parCourriel.set(data.courriel, data); if (data.cellulaire) parCell.set(data.cellulaire, data);
          }
          if (note) await db.from("crm_notes").insert({ contact_id: id, auteur: uid, texte: note });
        } catch (e) { erreurs.push(`Ligne ${i + 1} : ${(e as Error).message}`); }
      }
      await noter("import", `${ajoutes} ajoutés, ${completes} complétés`, { erreurs: erreurs.length });
      return json({ ok: true, ajoutes, completes, erreurs: erreurs.slice(0, 50) });
    }
    throw new Refus("Action inconnue.");
  } catch (e) {
    if (e instanceof Refus) return json({ erreur: e.message }, e.code);
    console.error(action, e);
    return json({ erreur: "Erreur du serveur." }, 500);
  }
});
