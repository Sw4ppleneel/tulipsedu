import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Take control immediately on install/activate.
self.skipWaiting()
clientsClaim()

// Precache all versioned build assets (JS, CSS, fonts).
// __WB_MANIFEST is injected by vite-plugin-pwa at build time.
precacheAndRoute(self.__WB_MANIFEST || [])
cleanupOutdatedCaches()

// SPA navigation: always serve index.html from cache (offline shell works).
registerRoute(
  new NavigationRoute(
    new CacheFirst({
      cacheName: 'tulipsedu-shell',
    })
  )
)

// API routes: network-first, 5 s timeout, fall back to cache for 1 h.
// Keeps data fresh on good connections; stale data beats blank screen on 3G.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'tulipsedu-api',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60,      // 1 hour
        purgeOnQuotaError: true,
      }),
    ],
  })
)

// Brand fonts and CDN assets: cache-first, long TTL.
registerRoute(
  ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'tulipsedu-fonts',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,  // 1 year
      }),
    ],
  })
)

// Images / icons served from origin: stale-while-revalidate.
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'tulipsedu-images',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
)
