// lecommis.ai est maintenant le site de vente : l'app vit sur app.lecommis.ai.
// Ce service worker remplace celui de l'ancienne app à cette adresse, vide ses caches et se retire.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
  })());
});
