/** Dedicated, versioned offline shell: no API, private page, map or transport caching. */
const CACHE = 'egi-favorites-shell-v13';
const ASSETS = [
  "/preferiti",
  "/preferiti/liste",
  "/static/js/pages/lists.js",
  "/static/js/features/favorites/collections.js",
  "/static/js/features/favorites/collection-picker.js",
  "/static/css/pages/lists.css",
  "/static/assets/icons/ui/lists.svg",
  "/static/css/foundations/tokens.css",
  "/static/css/components/services.css",
  "/static/css/pages/favorites.css",
  "/static/css/components/text-zoom.css",
  "/static/js/text-zoom.js",
  "/static/js/pages/favorites.js",
  "/static/js/features/favorites/store.js",
  "/static/js/features/favorites/controls.js",
  "/static/assets/icons/ui/bookmark.svg",
  "/static/js/features/favorites/offline.js",
  "/static/js/features/services/presentation.js",
  "/static/js/format.js",
  "/static/js/i18n.js",
  "/static/js/lifecycle.js",
  "/translations/it.json",
  "/translations/en.json",
  "/translations/fr.json",
  "/translations/ar.json",
  "/static/assets/icons/default/bed.svg",
  "/static/assets/icons/default/building.svg",
  "/static/assets/icons/default/direction.svg",
  "/static/assets/icons/default/drink-burger.svg",
  "/static/assets/icons/default/eat.svg",
  "/static/assets/icons/default/email.svg",
  "/static/assets/icons/default/hospital.svg",
  "/static/assets/icons/default/house.svg",
  "/static/assets/icons/default/law.svg",
  "/static/assets/icons/default/listen.svg",
  "/static/assets/icons/default/office.svg",
  "/static/assets/icons/default/report.svg",
  "/static/assets/icons/default/search.svg",
  "/static/assets/icons/default/setting.svg",
  "/static/assets/icons/default/shirt.svg",
  "/static/assets/icons/default/shopping bag.svg",
  "/static/assets/icons/default/shower.svg",
  "/static/assets/icons/default/web.svg",
  "/static/assets/icons/ui/phone.svg",
  "/static/assets/icons/brands/whatsapp.svg"
];
const ALLOWED = new Set(ASSETS.map(path => new URL(path, self.location.origin).pathname));

/** Fill and verify the whole allowlist before acknowledging offline readiness. */
async function prepare() {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const path of ASSETS) if (!(await cache.match(path))) missing.push(path);
  // addAll commits this batch atomically; a failed response cannot create a false ready state.
  if (missing.length) await cache.addAll(missing.map(path => new Request(path, {cache:'reload', credentials:'omit'})));
  for (const path of ASSETS) if (!(await cache.match(path))) throw Error('incomplete-shell');
  const shell = await cache.match('/preferiti');
  if (shell.headers.get('X-EGI-Data-Status') !== 'approved-canonical-local') throw Error('canonical-shell-required');
}

self.addEventListener('install', event => event.waitUntil(prepare().then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith('egi-favorites-shell-') && name !== CACHE) await caches.delete(name);
  }
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'prepare-favorites' || !event.ports[0]) return;
  event.waitUntil(prepare().then(() => event.ports[0].postMessage({ready:true}),
    () => event.ports[0].postMessage({ready:false})));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const shell = event.request.mode === 'navigate' && ['/preferiti', '/preferiti/liste'].includes(url.pathname);
  if (!shell && (!ALLOWED.has(url.pathname) || url.search)) return;
  const path = url.pathname;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(path);
    return cached || fetch(event.request);
  })());
});
