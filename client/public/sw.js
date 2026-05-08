// ═══════════════════════════════════════════════════════════════
// HUNTED BY THE OBSERVER - SERVICE WORKER
// Advanced caching strategies for offline support and performance
// ═══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'v4';
const CACHE_NAMES = {
  static: `hunted-static-${CACHE_VERSION}`,
  dynamic: `hunted-dynamic-${CACHE_VERSION}`,
  images: `hunted-images-${CACHE_VERSION}`,
  cdn: `hunted-cdn-${CACHE_VERSION}`,
};

// Core assets to cache on install
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/icon-maskable.png',
];

// CDN libraries to cache (none — Three.js is bundled by Vite)
const CDN_ASSETS = [];

// ═══════════════════════════════════════════════════════════════
// INSTALL EVENT - Cache core assets
// ═══════════════════════════════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(CACHE_NAMES.static).then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(CORE_ASSETS);
      }),
      
      ...(CDN_ASSETS.length
        ? [
            caches.open(CACHE_NAMES.cdn).then(cache => {
              console.log('[SW] Caching CDN assets');
              return cache.addAll(CDN_ASSETS).catch(err => {
                console.log('[SW] CDN cache failed (may be offline during install):', err);
              });
            }),
          ]
        : []),
    ]).then(() => {
      console.log('[SW] Installation complete');
      return self.skipWaiting();
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// ACTIVATE EVENT - Clean old cache versions
// ═══════════════════════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => !Object.values(CACHE_NAMES).includes(name))
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activation complete');
      return self.clients.claim();
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// FETCH EVENT - Intelligent caching strategies
// ═══════════════════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip WebSocket upgrades and API endpoints
  if (request.headers.get('upgrade') === 'websocket') {
    return;
  }

  // Skip specific paths that shouldn't be cached
  if (url.pathname === '/qr' || url.pathname === '/status') {
    return;
  }

  // ─── STRATEGY 1: CDN Assets (Cache-First) ───
  if (url.hostname !== location.hostname && url.protocol === 'https:') {
    event.respondWith(cacheFirstStrategy(request, CACHE_NAMES.cdn));
    return;
  }

  // ─── STRATEGY 2: Images (Cache-First with update) ───
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstStrategy(request, CACHE_NAMES.images, 30 * 24 * 60 * 60 * 1000)); // 30 days
    return;
  }

  // ─── STRATEGY 3: HTML Pages (Network-First) ───
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstStrategy(request, CACHE_NAMES.static));
    return;
  }

  // ─── STRATEGY 4: JavaScript/CSS (Stale-While-Revalidate) ───
  if (/\.(js|css)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidateStrategy(request, CACHE_NAMES.static));
    return;
  }

  // ─── STRATEGY 5: Other local assets (Network-First) ───
  event.respondWith(networkFirstStrategy(request, CACHE_NAMES.dynamic));
});

// ═══════════════════════════════════════════════════════════════
// CACHING STRATEGIES
// ═══════════════════════════════════════════════════════════════

/**
 * Cache-First Strategy: Return from cache, fall back to network
 * Best for: CDN assets, images, static resources
 */
function cacheFirstStrategy(request, cacheName, maxAge = null) {
  return caches.match(request).then(cached => {
    if (cached) {
      // Check if cache has expired
      if (maxAge) {
        const cacheTime = cached.headers.get('sw-cache-time');
        if (cacheTime && Date.now() - parseInt(cacheTime) < maxAge) {
          return cached;
        }
      } else {
        return cached;
      }
    }

    // Fetch from network
    return fetch(request)
      .then(response => {
        // Don't cache error responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // Clone and cache the response
        const responseClone = response.clone();
        const responseToCache = new Response(responseClone.body, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers: new Headers(responseClone.headers),
        });
        responseToCache.headers.set('sw-cache-time', Date.now().toString());

        caches.open(cacheName).then(cache => {
          cache.put(request, responseToCache);
        });

        return response;
      })
      .catch(() => {
        // Return cached version if available, otherwise offline response
        return caches.match(request) || createOfflineResponse(request);
      });
  });
}

/**
 * Network-First Strategy: Try network, fall back to cache
 * Best for: HTML pages, dynamic content
 */
function networkFirstStrategy(request, cacheName) {
  return fetch(request)
    .then(response => {
      // Don't cache error responses
      if (!response || response.status !== 200) {
        return response;
      }

      // Clone and cache successful response
      const responseClone = response.clone();
      caches.open(cacheName).then(cache => {
        cache.put(request, responseClone);
      });

      return response;
    })
    .catch(() => {
      // Fall back to cache
      return caches.match(request).then(cached => {
        if (cached) {
          return cached;
        }
        // Return offline page for document requests
        if (request.destination === 'document') {
          return createOfflineResponse(request);
        }
        // Return generic offline response
        return new Response('Offline - Resource not available', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain' }),
        });
      });
    });
}

/**
 * Stale-While-Revalidate Strategy: Return cache immediately, update in background
 * Best for: CSS, JS, non-critical resources
 */
function staleWhileRevalidateStrategy(request, cacheName) {
  return caches.match(request).then(cached => {
    const fetchPromise = fetch(request).then(response => {
      // Cache successful responses
      if (response && response.status === 200) {
        const responseClone = response.clone();
        caches.open(cacheName).then(cache => {
          cache.put(request, responseClone);
        });
      }
      return response;
    });

    // Return cached version immediately, or wait for network
    return cached || fetchPromise;
  });
}

/**
 * Create offline response for document requests
 */
function createOfflineResponse(request) {
  const offlineHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>HUNTED BY CLAUDE - Offline</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        body { 
          background: linear-gradient(135deg, #0a0515 0%, #1a0a2e 100%);
          color: #e0e0e0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          text-align: center;
          max-width: 500px;
        }
        h1 {
          font-size: 2.5rem;
          color: #00e5ff;
          margin-bottom: 20px;
          text-shadow: 0 0 20px rgba(0, 229, 255, 0.5);
        }
        p {
          font-size: 1.1rem;
          color: #aaa;
          line-height: 1.6;
          margin-bottom: 30px;
        }
        .status {
          background: rgba(0, 229, 255, 0.1);
          border: 1px solid rgba(0, 229, 255, 0.3);
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 30px;
        }
        .status-icon {
          font-size: 3rem;
          margin-bottom: 10px;
        }
        button {
          background: linear-gradient(135deg, #00e5ff 0%, #00cc88 100%);
          color: #000;
          border: none;
          padding: 15px 40px;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
        }
        .cached-info {
          margin-top: 40px;
          padding-top: 30px;
          border-top: 1px solid rgba(0, 229, 255, 0.2);
          font-size: 0.9rem;
          color: #667;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>HUNTED BY CLAUDE</h1>
        <div class="status">
          <div class="status-icon">📡</div>
          <p>You're currently offline</p>
        </div>
        <p>To play HUNTED BY CLAUDE, you need an internet connection to connect to the game server and face Claude.</p>
        <button onclick="location.reload()">Try Reconnecting</button>
        <div class="cached-info">
          <p>💾 Game assets have been cached for faster loading when you're back online.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return new Response(offlineHTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLER - Communicate with clients
// ═══════════════════════════════════════════════════════════════
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(cacheNames => {
      Promise.all(cacheNames.map(name => caches.delete(name)));
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// BACKGROUND SYNC - Queue interactions when offline
// ═══════════════════════════════════════════════════════════════
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-game-data') {
    event.waitUntil(
      // Retry sending any queued game data
      Promise.resolve()
    );
  }
});

console.log('[SW] Service Worker loaded');
