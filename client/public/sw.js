// NOMI service worker.
//
// Scope is intentionally narrow: this exists so the app is installable and
// so the shell (not live data) survives a flaky connection — it must never
// cache anything from /api/, or a signed-in user could see stale chats,
// stale auth state, or someone else's cached response after a device is
// shared. Bump CACHE_NAME whenever the app shell changes so old entries
// are dropped instead of served stale.
const CACHE_NAME = 'nomi-shell-v1';
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept the API — always hit the network so auth/chat data is
  // never served from cache.
  if (url.pathname.startsWith('/api/')) return;
  // Only handle same-origin requests; let cross-origin (Firebase, fonts,
  // Cloudinary, etc.) pass straight through untouched.
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network first so users always get the latest
  // build when online, falling back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((cached) => cached || Response.error()))
    );
    return;
  }

  // Static assets: cache-first, then fill the cache from the network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
