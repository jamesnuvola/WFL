const CACHE_NAME = 'wfl-sonar-lab-v3';
const STATIC_URLS = [
  './', 'index.html', 'manifest.json', 'wfl-sonar-theme.css',
  'wfl-sonar-dashboard.js', 'wfl-sonar-engine.js', 'wfl-sonar-app.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_URLS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/winforlife_draws.json') || event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, {cache:'no-store'}).then(response => {
      if (response.ok && event.request.mode === 'navigate') {
        const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put('index.html', copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then(r => r || caches.match('index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy)); }
    return response;
  })));
});