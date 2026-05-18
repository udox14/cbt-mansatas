// ── CBT PMB Service Worker ────────────────────────────────────
// Strategy:
//   - App shell (HTML/JS/CSS/fonts) → Cache First
//   - API calls (/api/*) → Network Only (tidak boleh di-cache, data harus fresh)
//   - Images/icons → Cache First dengan fallback
// ─────────────────────────────────────────────────────────────

const CACHE_NAME = 'cbt-pmb-v1';
const SHELL_URLS = [
  '/',
  '/student/',
  '/login/',
  '/manifest.json',
  '/kemenag.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: cache app shell ──────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll tidak gagal total jika satu URL error (pakai individual add)
      return Promise.allSettled(SHELL_URLS.map(url => cache.add(url).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: hapus cache lama ────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls → Network Only (jangan cache data ujian/auth)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // GET requests only
  if (event.request.method !== 'GET') return;

  // Navigation requests (HTML pages) → Network First, fallback cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful navigation responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
    );
    return;
  }

  // Static assets (JS/CSS/images/fonts) → Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Untuk gambar yang gagal, kembalikan icon default jika ada
        if (event.request.destination === 'image') {
          return caches.match('/icons/icon-192.png').then(r => r || new Response('', { status: 404 }));
        }
        return new Response('', { status: 504 });
      });
    })
  );
});
