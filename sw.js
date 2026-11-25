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

// Map tiles of the game (25/11, /jeu/ in the forest, where the network drops). Only the CORS
// requests the game makes (Leaflet `crossOrigin`): the home page's map asks without CORS, gets
// opaque answers, and stays untouched. CACHE-FIRST here, unlike the rest: a tile is a picture of
// streets and paths, not our data, and a week-old one is still right; one older than TILE_MAX_DAYS
// is fetched again when the network answers. The cache survives CACHE_VERSION bumps, is capped at
// TILE_MAX tiles (oldest first out), and is also filled by the game's « Garder la carte » button.
const TILE_CACHE = 'fl-tiles';
const TILE_MAX = 2500;
const TILE_MAX_DAYS = 14;
const TILE_HOST = /(^|\.)tile\.openstreetmap\.org$/;
let tilePuts = 0;

function trimTiles(cache) {
  return cache.keys().then((keys) => {
    if (keys.length <= TILE_MAX) return;
    return Promise.all(keys.slice(0, keys.length - TILE_MAX + 200).map((k) => cache.delete(k)));
  });
}

function tile(request) {
  return caches.open(TILE_CACHE).then((cache) => cache.match(request).then((hit) => {
    const age = hit ? Date.now() - Number(hit.headers.get('x-saved') || 0) : Infinity;
    if (hit && age < TILE_MAX_DAYS * 86400000) return hit;
    return fetch(request).then((response) => {
      if (response.ok && response.type === 'cors') {
        // Kept with our own date: a CORS answer does not let the Date header be read
        response.clone().blob()
          .then((b) => cache.put(request, new Response(b, { headers: { 'content-type': 'image/png', 'x-saved': String(Date.now()) } })))
          .then(() => (++tilePuts % 50 ? null : trimTiles(cache))).catch(() => {});
      }
      return response;
    }).catch(() => hit || Response.error());
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
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

  // Leave other origins (the home page's map tiles, the analytics endpoint) alone: they manage
  // their own caching, and proxying them here would only add a way to serve something stale.
  // The game's tiles are the one exception (tile() above).
  const url = new URL(request.url);
  if (request.mode === 'cors' && TILE_HOST.test(url.hostname)) { event.respondWith(tile(request)); return; }
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
      // Offline, a link with a query (an invitation ?partie=…) gets the same page without it
      .catch(() => caches.match(request)
        .then((hit) => hit || caches.match(request, { ignoreSearch: true }))
        .then((hit) => hit || caches.match('./index.html')))
  );
});
