// Cache de l'interface pour le hors-ligne. Toujours la dernière version quand le réseau est là.
const CACHE = "tribu-v17";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "vendor/supabase.js", "vendor/simplewebauthn.min.js", "fonts/figtree.woff2", "fonts/bricolage.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Réseau d'abord en contournant le cache HTTP (sinon jusqu'à 10 min de retard sur GitHub Pages)
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});

// ---------- Notifications ----------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Tribu", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || undefined,
    data: { url: d.url || "#/accueil" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || "#/accueil";
  const target = new URL("./" + hash, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) { c.postMessage({ nav: hash }); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
