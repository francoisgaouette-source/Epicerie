// L'Établi : letabli.ai est l'adresse officielle. Les anciennes adresses (holdingai.app, www.*) redirigent ici.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== "letabli.ai" && !url.hostname.endsWith(".workers.dev")) {
      url.hostname = "letabli.ai";
      url.protocol = "https:";
      url.port = "";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
