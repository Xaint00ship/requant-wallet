// CACHE and FILES are injected by package-web.mjs. Only public application assets are cached.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});
function clientReady(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.safe === true);
    };
    client.postMessage({ type: "QUERY_SAFE_UPDATE" }, [channel.port2]);
  });
}
self.addEventListener("message", (event) => {
  if (event.data?.type !== "REQUEST_ACTIVATE") return;
  event.waitUntil(
    (async () => {
      const clients = (
        await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        })
      ).filter((client) => client.url.startsWith(self.registration.scope));
      const safe = await Promise.all(clients.map(clientReady));
      if (safe.every(Boolean)) await self.skipWaiting();
      else event.source?.postMessage({ type: "UPDATE_DEFERRED" });
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Retain one previous bundle for tabs finishing their controller-change reload.
      const keys = (await caches.keys()).filter((k) =>
        k.startsWith("requant-wallet-"),
      );
      const keep = new Set([
        CACHE,
        ...keys.filter((k) => k !== CACHE).slice(-1),
      ]);
      await Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const key =
    event.request.mode === "navigate" ? "/wallet/index.html" : url.pathname;
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith("/wallet/") ||
    !FILES.includes(key)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(key);
      if (saved) return saved;
      return fetch(event.request);
    })(),
  );
});
