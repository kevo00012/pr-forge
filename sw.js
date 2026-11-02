/* PR Forge — offline cache. Bump CACHE when you change any file so phones pick up the update. */
var CACHE = 'pr-forge-web-1.1.0';
var FONTS = 'pr-forge-fonts-1'; // Barlow from Google Fonts; kept across releases
var SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/units.js',
  'js/exercises.js',
  'js/metrics.js',
  'js/store.js',
  'js/app.js',
  'manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== FONTS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Fonts: cache first, so the design still looks right in a gym with no signal.
function fontResponse(req) {
  return caches.open(FONTS).then(function (c) {
    return c.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
        return res;
      });
    });
  });
}

// Network first (so updates arrive when online), cache as the offline fallback.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (req.method === 'GET' && (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com')) {
    event.respondWith(fontResponse(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
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
