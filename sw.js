const VERSION = 'lyrics-studio-v4';
const SHELL = ['./', 'index.html', 'css/style.css', 'manifest.json', 'icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(cache => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
