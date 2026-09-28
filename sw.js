// Offline support. App files: network-first (so updates land), falling back to cache.
// CDN libraries, fonts and satellite tiles: cache-first. Supabase API calls: never cached.
const VERSION = 'gp2-v18';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/store.js', './js/sync.js', './js/config.js', './js/ui.js',
  './js/plants.js', './js/season.js', './js/geo.js', './js/importer.js', './js/sprites.js', './js/advisor.js',
  './js/views/yard.js', './js/views/bed.js', './js/views/almanac.js', './js/views/library.js',
  './js/views/log.js', './js/views/settings.js', './js/views/auth.js', './js/views/common.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-32.png',
];
const CACHE_FIRST_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'server.arcgisonline.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co')) return;

  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    })));
    return;
  }

  if (url.origin === self.location.origin) {
    // cache: 'no-cache' revalidates with the server instead of trusting GitHub Pages' 10-minute max-age.
    event.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
  }
});
