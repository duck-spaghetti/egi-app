/** Install the dedicated shell and acknowledge readiness only after activation and cache checks. */
let pending;
export function prepareOffline() {
  if (pending) return pending;
  pending = (async () => {
    if (!globalThis.isSecureContext || !navigator.serviceWorker || !globalThis.caches) {
      throw Error('offline-unavailable');
    }
    const registration = await navigator.serviceWorker.register('/preferiti/sw.js', {scope: '/preferiti'});
    // Registration may resolve with the previous active worker before its update check finishes.
    if (registration.active) {
      try { await registration.update(); }
      catch(error) {
        // Existing installed assets remain usable when an update cannot reach the network.
        // Collections require their own cached shell, not an older favorites-only worker.
        if (!(await caches.match('/preferiti/liste'))) throw error;
      }
    }
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) throw Error('offline-unavailable');
    if (worker.state !== 'activated') await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('offline-timeout')), 30000);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') { clearTimeout(timeout); resolve(); }
        if (worker.state === 'redundant') { clearTimeout(timeout); reject(Error('offline-unavailable')); }
      });
      if (worker.state === 'activated') { clearTimeout(timeout); resolve(); }
      if (worker.state === 'redundant') { clearTimeout(timeout); reject(Error('offline-unavailable')); }
    });
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(Error('offline-timeout')); }, 30000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout); channel.port1.close();
        if (event.data?.ready === true) resolve(); else reject(Error('offline-unavailable'));
      };
      worker.postMessage({type: 'prepare-favorites'}, [channel.port2]);
    });
  })().finally(() => { pending = undefined; });
  return pending;
}
