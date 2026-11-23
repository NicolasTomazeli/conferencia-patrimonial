// Service worker: permite abrir o app sem internet.
// Estratégia: tenta a rede primeiro (para receber atualizações) e cai no cache se estiver offline.
const CACHE = 'conferencia-v1';
const ARQUIVOS = [
  './', './index.html', './app.js', './comum.js', './estilo.css',
  './painel.html', './painel.js',
  './lib/xlsx.full.min.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    fetch(ev.request)
      .then(resp => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(ev.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true }))
  );
});
