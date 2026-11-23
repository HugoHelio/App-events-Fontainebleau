/**
 * Service worker — offline fallback only (item 59).
 *
 * NETWORK-FIRST, on purpose. The usual PWA recipe caches the shell and serves it first, which on
 * this site would pin an old `index.html` or an old `data.json` on a visitor's phone — the exact
 * failure this project already spent a session chasing ("Ctrl+F5 et je ne vois pas l'update").
 * Here the network always wins when it answers; the cache only steps in when it does not.
 *
 * `skipWaiting` + `clients.claim` mean a new version takes over on the next load rather than
 * waiting for every tab to close. Bump CACHE_VERSION to force old caches out.
 */

const CACHE_VERSION = 'v4';
const CACHE = `bleau-events-${CACHE_VERSION}`;

// The minimum needed to render something useful with no network.
const SHELL = [
  './',
  './index.html',
  './data.json',
  './favicon.ico',
  // Same origin since 29/09, so they can be cached at all: before that the offline page had no
  // map and no calendar, because the fetch handler below leaves other origins alone.
  './vendor/leaflet-1.9.4/leaflet.css',
  './vendor/leaflet-1.9.4/leaflet.js',
  './vendor/fullcalendar-6.1.11/index.global.min.js',
  './vendor/fullcalendar-6.1.11/fr.global.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll() fails the whole install if any single request fails; these are our own files,
      // but a 404 during a deploy should not wedge the worker.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A page asks the server again each time (23/11): GitHub Pages lets a browser keep a page 10
// minutes, and network-first then served that copy: a player saw yesterday's game after an update.
// "no-cache" revalidates (a 304 when nothing changed, so it costs little). A navigation cannot be
// re-issued with options, hence the URL; if it was redirected, the original request goes instead
// (a redirected answer to a navigation is refused by the browser).
function network(request) {
  if (request.mode !== 'navigate') return fetch(request);
  return fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((r) => (r.redirected ? fetch(request) : r));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Leave other origins (map tiles, the analytics endpoint) alone: they manage their own
  // caching, and proxying them here would only add a way to serve something stale.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    network(request)
      .then((response) => {
        // Only cache a real, complete answer; an opaque or error response is not a fallback.
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => { /* full disk, etc. */ });
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
