// Le Commis sur Cloudflare : reprend les règles de netlify.toml.
// Chaque adresse reçoit son dossier, ses en-têtes et son cache.

const SITES = {
  "lecommis.ai": "/site",
  "console.holdingai.app": "/console",
};
// Pour tester sur l'adresse workers.dev : ?hote=lecommis.ai ou ?hote=console.holdingai.app (mémorisé dans un témoin)
const TEST = /\.workers\.dev$|^localhost$/;

const CSP_CONSOLE = "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src https://gandliltstmtfsmsjaew.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let host = url.hostname;

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
    let file = prefix + path;
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
