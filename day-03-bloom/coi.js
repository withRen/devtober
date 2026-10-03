/* Isole la page quand le serveur ne le fait pas (GitHub Pages) :
   on installe coi-sw.js, puis on recharge une fois pour qu'il prenne la main.
   En local, serve.py envoie déjà les en-têtes : rien à faire. */
(() => {
  if (self.crossOriginIsolated || !('serviceWorker' in navigator) || !self.isSecureContext) return;
  const KEY = 'bloom.coi-reload';
  let reloaded = false;
  try { reloaded = sessionStorage.getItem(KEY) === '1'; } catch { /* stockage indisponible */ }
  const reload = () => {
    // Un seul rechargement par session : si l'isolation échoue malgré tout, on n'insiste pas.
    if (reloaded) return;
    try { sessionStorage.setItem(KEY, '1'); } catch { /* stockage indisponible */ }
    location.reload();
  };
  navigator.serviceWorker.register('coi-sw.js').then((reg) => {
    if (reg.active && !navigator.serviceWorker.controller) { reload(); return; }
    const sw = reg.installing || reg.waiting;
    sw?.addEventListener('statechange', () => { if (sw.state === 'activated') reload(); });
  }, (err) => console.warn('Isolation impossible :', err));
})();
