// Panini Album Tracker — Service Worker
// Cache automático: HTML/JS/CSS van primero a red para recibir updates.
const CACHE = 'panini-auto-cache-v10-danger-fullwidth';
// cache bump: 2026-05-11-danger-fullwidth
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './app.js',
  './manifest.json',
  './images/wc-logo.png',
  './images/whatsapp-logo.png',
  './images/apple-touch-icon.png',
  './images/favicon.ico',
  './images/icon-192.png',
  './images/icon-512.png',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE && (key.startsWith('panini-') || key.startsWith('workbox-')))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }

  if(event.data && event.data.type === 'CLEAR_CACHES'){
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
    );
  }
});

function sameOrigin(request){
  try{
    return new URL(request.url).origin === self.location.origin;
  }catch(_){
    return false;
  }
}

function shouldUseNetworkFirst(request){
  if(request.mode === 'navigate') return true;
  const dest = request.destination;
  return dest === 'document' || dest === 'script' || dest === 'style' || dest === 'manifest';
}

async function networkFirst(request){
  const cache = await caches.open(CACHE);
  try{
    const response = await fetch(request, { cache: 'no-store' });
    if(response && response.ok && sameOrigin(request)){
      cache.put(request, response.clone()).catch(()=>{});
    }
    return response;
  }catch(err){
    const cached = await cache.match(request);
    if(cached) return cached;
    if(request.mode === 'navigate'){
      return cache.match('./index.html');
    }
    throw err;
  }
}

async function cacheFirst(request){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if(cached) return cached;

  const response = await fetch(request);
  if(response && response.ok && sameOrigin(request)){
    cache.put(request, response.clone()).catch(()=>{});
  }
  return response;
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  if(!sameOrigin(event.request)) return;

  // HTML/JS/CSS/manifest: primero red, para que GitHub Pages entre con cambios nuevos.
  if(shouldUseNetworkFirst(event.request)){
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Imágenes y otros assets: primero cache para abrir rápido/offline.
  event.respondWith(cacheFirst(event.request));
});
