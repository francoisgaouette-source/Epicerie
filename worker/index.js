// Le Commis sur Cloudflare : sert web/ selon l'adresse (app, site, console).
// Chaque adresse reçoit son dossier, ses en-têtes et son cache.

const SITES = {
  "lecommis.ai": "/site",
  "console.holdingai.app": "/console",
};
// Pour tester sur l'adresse workers.dev : ?hote=lecommis.ai ou ?hote=console.holdingai.app (mémorisé dans un témoin)
const TEST = /\.workers\.dev$|^localhost$/;

const CSP_CONSOLE = "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src https://gandliltstmtfsmsjaew.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// ---------- Courriels ----------
// Tout ce qui est écrit à une adresse @holdingai.app, @lecommis.ai ou @fanion.ai passe ici (Email Routing, règle « catch-all » de chaque domaine) :
//   1. une copie part vers la boîte personnelle (secret COPIE_COURRIEL, une adresse vérifiée dans Email Routing) ;
//   2. le message est noté dans la console (fonction Supabase « courriel-recu », protégée par le secret COURRIEL_SECRET).
// Les réponses écrites dans la console repartent par /api/envoyer (liaison EMAIL, Cloudflare Email Sending).
const SUPABASE = "https://gandliltstmtfsmsjaew.supabase.co";
const DOMAINES = ["holdingai.app", "lecommis.ai", "fanion.ai"];
const MAX_BRUT = 6 * 1024 * 1024; // au-delà, seul le début du message est noté (la copie Gmail reste complète)

async function memeSecret(a, b) {
  if (!a || !b) return false;
  const h = async (x) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function lireBrut(flux, max) {
  const lecteur = flux.getReader(), morceaux = [];
  let n = 0, tronque = false;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    if (n + value.length > max) { morceaux.push(value.subarray(0, max - n)); n = max; tronque = true; await lecteur.cancel().catch(() => {}); break; }
    morceaux.push(value); n += value.length;
  }
  const tout = new Uint8Array(n); let o = 0;
  for (const m of morceaux) { tout.set(m, o); o += m.length; }
  return { tout, tronque };
}
async function recevoir(message, env) {
  const { tout, tronque } = await lireBrut(message.raw, MAX_BRUT);
  let copie = false, erreurCopie = "";
  if (env.COPIE_COURRIEL) {
    try { await message.forward(env.COPIE_COURRIEL); copie = true; } catch (e) { erreurCopie = String(e && e.message || e); console.error("Copie non transmise :", erreurCopie); }
  }
  let note = false;
  if (env.COURRIEL_SECRET) {
    try {
      const r = await fetch(`${SUPABASE}/functions/v1/courriel-recu`, {
        method: "POST", body: tout,
        headers: { "Content-Type": "message/rfc822", "X-Courriel-Secret": env.COURRIEL_SECRET, "X-Enveloppe-De": encodeURIComponent(message.from || ""), "X-Enveloppe-A": encodeURIComponent(message.to || ""), "X-Tronque": tronque ? "1" : "0", "X-Copie": copie ? "1" : "0" },
      });
      note = r.ok;
      if (!r.ok) console.error("Console :", r.status, (await r.text()).slice(0, 300));
    } catch (e) { console.error("Console injoignable :", String(e && e.message || e)); }
  } else console.error("COURRIEL_SECRET absent : le message n'est pas noté dans la console.");
  // Ni copie ni console : on refuse, pour que l'expéditeur sache que son message n'est pas arrivé
  if (!copie && !note) throw new Error(`Message non remis (${erreurCopie || "console injoignable"})`);
}
async function envoyer(request, env) {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);
  if (!env.COURRIEL_SECRET) return json({ erreur: "Secret absent", code: "SECRET_ABSENT" }, 503);
  if (!(await memeSecret(request.headers.get("X-Courriel-Secret"), env.COURRIEL_SECRET))) return json({ erreur: "Refusé" }, 403);
  if (!env.EMAIL) return json({ erreur: "L'envoi de courriels n'est pas activé dans Cloudflare.", code: "ENVOI_INACTIF" }, 501);
  let b; try { b = await request.json(); } catch { return json({ erreur: "Requête invalide" }, 400); }
  const de = String(b.de || "").toLowerCase(), a = String(b.a || "").toLowerCase();
  const ADR = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
  if (!ADR.test(de) || !DOMAINES.includes(de.split("@")[1])) return json({ erreur: "Expéditeur invalide" }, 400);
  if (!ADR.test(a)) return json({ erreur: "Destinataire invalide" }, 400);
  const msg = { from: { email: de, name: String(b.nom || "").slice(0, 80) }, to: a, subject: String(b.sujet || "").slice(0, 300), text: String(b.texte || "") };
  const entetes = {};
  for (const k of ["In-Reply-To", "References"]) if (b.entetes && b.entetes[k]) entetes[k] = String(b.entetes[k]).slice(0, 2000);
  try {
    let r;
    try { r = await env.EMAIL.send(Object.keys(entetes).length ? { ...msg, headers: entetes } : msg); }
    catch (e) {
      // Si Cloudflare refuse les en-têtes de fil, on envoie quand même la réponse
      if (!/^E_HEADER/.test(String(e && e.code))) throw e;
      r = await env.EMAIL.send(msg);
    }
    return json({ ok: true, id: (r && r.messageId) || "" });
  } catch (e) {
    console.error("Envoi :", e && e.code, e && e.message);
    return json({ erreur: String(e && e.message || "Envoi refusé"), code: String(e && e.code || "") }, 502);
  }
}

export default {
  async email(message, env, ctx) {
    await recevoir(message, env);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    let host = url.hostname;
    if (host === "console.holdingai.app" && url.pathname === "/api/envoyer") return envoyer(request, env);

    if (host === "www.lecommis.ai") {
      url.hostname = "lecommis.ai";
      return Response.redirect(url.toString(), 301);
    }

    let testCookie = null;
    if (TEST.test(host)) {
      const q = url.searchParams.get("hote");
      if (q !== null) testCookie = q;
      const c = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)hote=([^;]*)/);
      host = q !== null ? q : (c ? decodeURIComponent(c[1]) : host);
    }

    const prefix = SITES[host] || "";
    let path = url.pathname;
    if (prefix && (path === prefix || path.startsWith(prefix + "/"))) path = path.slice(prefix.length) || "/";
    // Un site ne doit pas exposer les fichiers d'un autre : l'app n'a pas accès à /site ni à /console par son adresse.
    if (!prefix && (path.startsWith("/site/") || path === "/site" || path.startsWith("/console/") || path === "/console")) {
      return new Response("Introuvable", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    // Fichiers communs (ex. l'avatar du Commis) : servis tels quels sur toutes les adresses
    let file = path.startsWith("/commun/") ? path : prefix + path;
    if (file.endsWith("/")) file += "index.html";

    const assetUrl = new URL(file, url.origin);
    let res = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (res.status === 404) {
      // Page manquante : renvoie l'accueil du site concerné, avec le code 404
      const home = await env.ASSETS.fetch(new Request(new URL(prefix + "/index.html", url.origin), request));
      res = new Response(home.body, { status: 404, headers: home.headers });
    }

    const h = new Headers(res.headers);
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (path === "/sw.js") h.set("Cache-Control", "no-cache");
    if (prefix === "/console") {
      h.set("X-Robots-Tag", "noindex, nofollow");
      h.set("X-Frame-Options", "DENY");
      h.set("Cache-Control", "no-cache");
      h.set("Content-Security-Policy", CSP_CONSOLE);
    }
    if (testCookie !== null) h.append("Set-Cookie", `hote=${encodeURIComponent(testCookie)}; Path=/; Secure; SameSite=Lax`);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};
