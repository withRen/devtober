/* =========================================================
   Service worker d'isolation (COOP / COEP).
   Le décodeur RAW tourne sur plusieurs threads, ce qui demande
   SharedArrayBuffer, donc une page « isolée ». GitHub Pages ne
   permet pas d'ajouter ces en-têtes : ce service worker les ajoute
   lui-même à chaque réponse. Même principe que coi-serviceworker
   (Guido Zuidhof, MIT). Sa portée est le dossier du jour 03.
   ========================================================= */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Requête que le navigateur refuserait de toute façon hors du cache.
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  e.respondWith(
    fetch(req).then((res) => {
      // Réponse opaque (sans CORS) : on ne peut pas la modifier, on la rend telle quelle.
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      if (!headers.has('Cross-Origin-Resource-Policy')) headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }),
  );
});
