// « Continuer avec HoldingAI » : le compte unique de toutes les apps HoldingAI (compte.holdingai.app).
// Même fichier dans chaque app; seuls clientId et app changent (voir config.js : HOLDINGAI).
//   HoldingAI.connecter()     → part vers compte.holdingai.app (Albert), revient avec un code
//   await HoldingAI.retour()  → au retour, échange le code contre les jetons (à appeler au démarrage)
//   await HoldingAI.jeton()   → jeton d'accès valide (renouvelé au besoin) ou null
//   HoldingAI.session()       → { uid, phone, email, nom } ou null
//   HoldingAI.deconnexion()   → oublie les jetons sur cet appareil
//   await HoldingAI.demarrer({ obligatoire }) → LA façon commune de démarrer (même comportement dans toutes les apps) :
//        retour de compte.holdingai.app, puis « le compte suit » : sans session, on passe chez Albert, qui reconnaît
//        la personne et la ramène. obligatoire: true (app qui exige un compte) → toujours; false (compte facultatif)
//        → seulement si la personne s'est déjà connectée dans cette app. Une seule fois par visite (jamais de boucle).
//        Renvoie { session, erreur, redirection }.
// Version 2 — garder ce fichier IDENTIQUE dans toutes les apps HoldingAI.
//   HoldingAI.compteUrl       → page « Mon compte » HoldingAI
(function () {
  "use strict";
  const C = (window.CARNET_CONFIG || window.EPICERIE_CONFIG || window.APP_CONFIG || {}).HOLDINGAI || {};
  const BASE = C.url || "https://wwakxuzuhmdmweluafiz.supabase.co";
  const CLE_PUBLIQUE = C.cle || "sb_publishable_OyU2dc38EwE-kS8qdbkqpg_w2g-rTYd";
  const CLIENT = C.clientId || "";
  const APP = C.app || "";
  const RETOUR = C.retour || location.origin + "/";
  const K = { jetons: "hai.jetons", attente: "hai.attente", connu: "hai.connu" };
  const SESSION_AUTO = "hai.auto";
  const auto = { deja() { try { return sessionStorage.getItem(SESSION_AUTO) === "1"; } catch (e) { return true; } },
    marquer() { try { sessionStorage.setItem(SESSION_AUTO, "1"); } catch (e) { /* rien */ } } };

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hasard = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const lire = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const ecrire = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* rien */ } };
  function claims(jwt) {
    try { return JSON.parse(decodeURIComponent(escape(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) { return null; }
  }

  async function demanderJetons(params) {
    const r = await fetch(BASE + "/auth/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: CLE_PUBLIQUE },
      body: new URLSearchParams({ client_id: CLIENT, ...params }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || "La connexion HoldingAI n'a pas fonctionné.");
    const c = claims(d.access_token) || {};
    const j = { access: d.access_token, refresh: d.refresh_token || (lire(K.jetons) || {}).refresh, exp: (c.exp || 0) * 1000 };
    ecrire(K.jetons, j);
    return j;
  }

  let enCours = null;
  async function jeton() {
    const j = lire(K.jetons);
    if (!j || !j.access) return null;
    if (j.exp - Date.now() > 60000) return j.access;
    if (!j.refresh) { ecrire(K.jetons, null); return null; }
    if (!enCours) enCours = demanderJetons({ grant_type: "refresh_token", refresh_token: j.refresh })
      .then((n) => n.access)
      .catch((e) => { if (navigator.onLine !== false) ecrire(K.jetons, null); return null; })
      .finally(() => { enCours = null; });
    return enCours;
  }

  // Note la visite dans le compte HoldingAI (liste « Mes apps »). Sans effet si ça échoue.
  async function noterVisite() {
    if (!APP) return;
    try {
      const t = await jeton(); if (!t) return;
      await fetch(BASE + "/rest/v1/rpc/enregistrer_visite", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CLE_PUBLIQUE, Authorization: "Bearer " + t },
        body: JSON.stringify({ p_app_slug: APP }),
      });
    } catch (e) { /* rien */ }
  }

  window.HoldingAI = {
    compteUrl: "https://compte.holdingai.app/compte",
    estRetour() { const p = new URLSearchParams(location.search); return p.has("state") && (p.has("code") || p.has("error")); },
    async connecter() {
      const verif = hasard(48), etat = hasard(16);
      const defi = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verif)));
      ecrire(K.attente, { verif, etat, t: Date.now() });
      const u = new URL(BASE + "/auth/v1/oauth/authorize");
      Object.entries({ response_type: "code", client_id: CLIENT, redirect_uri: RETOUR, scope: "openid phone profile",
        state: etat, code_challenge: defi, code_challenge_method: "S256" }).forEach(([k, v]) => u.searchParams.set(k, v));
      location.href = u.toString();
    },
    async retour() {
      if (!this.estRetour()) return false;
      const p = new URLSearchParams(location.search);
      const a = lire(K.attente);
      ecrire(K.attente, null);
      history.replaceState(null, "", location.pathname + location.hash);
      if (p.get("error")) throw new Error(p.get("error") === "access_denied" ? "Connexion annulée." : (p.get("error_description") || "La connexion HoldingAI n'a pas fonctionné."));
      if (!a || a.etat !== p.get("state")) throw new Error("Cette connexion a expiré. Touchez de nouveau « Continuer avec HoldingAI ».");
      await demanderJetons({ grant_type: "authorization_code", code: p.get("code"), redirect_uri: RETOUR, code_verifier: a.verif });
      ecrire(K.connu, 1);
      noterVisite();
      return true;
    },
    jeton,
    async session() {
      const t = await jeton(); if (!t) return null;
      const c = claims(t) || {};
      const meta = c.user_metadata || {};
      return { uid: c.sub, phone: c.phone || "", email: c.email || "", nom: meta.nom || "" };
    },
    noterVisite,
    // Se déconnecter de l'app : pas de reconnexion automatique pendant cette visite, ni plus tard (compte facultatif).
    deconnexion() { ecrire(K.jetons, null); ecrire(K.connu, null); auto.marquer(); },
    async demarrer(o) {
      o = o || {};
      let erreur = null;
      if (this.estRetour()) { auto.marquer(); try { await this.retour(); } catch (e) { erreur = e; } }
      const session = await this.session();
      if (session) { if (!erreur) noterVisite(); return { session, erreur: null, redirection: false }; }
      const connu = !!lire(K.connu);
      if (!erreur && !auto.deja() && (o.obligatoire || connu) && navigator.onLine !== false) {
        auto.marquer();
        try { await this.connecter(); return { session: null, erreur: null, redirection: true }; } catch (e) { erreur = e; }
      }
      return { session: null, erreur, redirection: false };
    },
  };
})();
