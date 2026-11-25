// Service worker: permite abrir o app sem internet.
// Estratégia: tenta a rede primeiro (para receber atualizações) e cai no cache se estiver offline.
const CACHE = 'conferencia-v11';
const ARQUIVOS = [
  './', './index.html', './app.js', './comum.js', './config.js', './estilo.css',
  './painel.html', './painel.js', './aceite.html', './aceite.js',
  './lib/xlsx.full.min.js', './lib/zxing-reader.js', './lib/zxing_reader.wasm', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './fontes/barlow-latin-400-normal.woff2', './fontes/barlow-latin-500-normal.woff2',
  './fontes/barlow-latin-600-normal.woff2', './fontes/barlow-latin-700-normal.woff2',
  './fontes/barlow-semi-condensed-latin-600-normal.woff2', './fontes/barlow-semi-condensed-latin-700-normal.woff2'
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
  const url = new URL(ev.request.url);
  // a base publicada e chamadas externas nunca passam pelo cache
  if (url.origin !== self.location.origin || url.pathname.includes('/dados/')) return;
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
