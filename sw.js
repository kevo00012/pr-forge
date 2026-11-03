/* PR Forge — offline cache. Bump CACHE when you change any file so phones pick up the update. */
var CACHE = 'pr-forge-web-1.6.0';
var SHELL = [
  './',
  'index.html',
  'css/app.css',
  'icons/logo.png',
  'icons/splash-logo.png',
  'icons/wordmark.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/barlow-latin-400-normal.woff2',
  'fonts/barlow-latin-500-normal.woff2',
  'fonts/barlow-latin-600-normal.woff2',
  'fonts/barlow-latin-700-normal.woff2',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
  'fonts/barlow-condensed-latin-800-normal.woff2',
  'js/units.js',
  'js/exercise-library.js',
  'js/exercises.js',
  'js/metrics.js',
  'js/store.js',
  'js/plates.js',
  'js/importers.js',
  'js/vendor/supabase.js',
  'js/sync.js',
  'js/cloud.js',
  'js/app.js',
  'manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Network first (so updates arrive when online), cache as the offline fallback.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined);
      });
    })
  );
});
