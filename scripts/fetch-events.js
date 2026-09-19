#!/usr/bin/env node
/**
 * fetch-events.js (v2) — Autonomous local event aggregator, Fontainebleau region.
 *
 * Pipeline:
 *   1. Several narrow Gemini + Google Search scans (sport / nature / culture / family)
 *   2. Strict validation & normalisation of every record (bad records are dropped, never fatal)
 *   3. Merge with data.json on a stable key (title + startDate + city), prune past events
 *   4. Geocode with the French BAN API (cached), bounding-box guard, flagged fallbacks
 *   5. Verify event URLs (dead links dropped, bot-blocked sites kept as "unverified")
 *   6. Write data.json (+ geocode-cache.json) only if something changed, and print a run report
 *
 * Zero dependencies. Requires Node >= 18 (global fetch); the workflow uses Node 22.
 *
 * Environment:
 *   GEMINI_API_KEY (required)        GEMINI_MODEL (default gemini-3.6-flash)
 *   GEMINI_MAX_OUTPUT_TOKENS (16384) MAX_EVENTS_PER_SCAN (20)
 *   DATA_PATH (data.json)            GEOCODE_CACHE_PATH (geocode-cache.json)
 *   DRY_RUN=1  -> run everything but write nothing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ───────────────────────────── Configuration ─────────────────────────────

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  maxOutputTokens: envInt('GEMINI_MAX_OUTPUT_TOKENS', 16384),
  maxEventsPerScan: envInt('MAX_EVENTS_PER_SCAN', 20),
  temperature: 0.2,
  windowMonths: 4,
  apiTimeoutMs: envInt('API_TIMEOUT_MS', 180_000),
  maxAttempts: 3,
  retryBaseDelayMs: envInt('RETRY_BASE_MS', 5_000),
  pauseBetweenScansMs: envInt('SCAN_PAUSE_MS', 3_000),
  urlCheckTimeoutMs: envInt('URL_TIMEOUT_MS', 10_000),
  urlCheckConcurrency: 6,
  urlRecheckAfterDays: 7,
  geocodeTimeoutMs: 8_000,
  banMinScore: 0.6,
  dataPath: path.resolve(process.env.DATA_PATH || 'data.json'),
  cachePath: path.resolve(process.env.GEOCODE_CACHE_PATH || 'geocode-cache.json'),
  dryRun: process.env.DRY_RUN === '1',
};

const CATEGORIES = ['Sport & Outdoor', 'Nature & Environnement', 'Culture & Ateliers'];

// Fontainebleau centre — used only as a last-resort fallback (flagged geoSource: "default").
const CENTER = { lat: 48.4020, lng: 2.7010 };
// Generous box around the ~15 km radius (Nemours … Vaux-le-Vicomte … Moret). Anything outside is rejected.
const BBOX = { latMin: 48.20, latMax: 48.65, lngMin: 2.45, lngMax: 3.00 };

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const USER_AGENT = 'Mozilla/5.0 (compatible; FontainebleauEventsBot/2.0)';
const FAR_FUTURE = '9999-12-31';

const SCANS = [
  {
    name: 'sport',
    label: 'Sport & Outdoor',
    focus:
      'Trails en forêt, courses à pied, randonnées et randos VTT, compétitions d\'escalade/bouldering, ' +
      'critériums cyclistes, triathlons, tournois et événements sportifs de clubs.',
  },
  {
    name: 'nature',
    label: 'Nature & Environnement',
    focus:
      'Sorties guidées en forêt, visites botaniques, observation (brame du cerf, oiseaux), ' +
      'animations nature, ateliers environnement, journées du patrimoine naturel.',
  },
  {
    name: 'culture',
    label: 'Culture & patrimoine',
    focus:
      'Expositions, concerts, spectacles, festivals, visites et événements aux châteaux ' +
      '(Fontainebleau, Vaux-le-Vicomte, Blandy-les-Tours), conférences, cinéma, musées.',
  },
  {
    name: 'famille',
    label: 'Famille & loisirs',
    focus:
      'Ateliers enfants, spectacles jeune public, brocantes, marchés du terroir, fêtes locales, ' +
      'animations d\'automne et de fin d\'année, activités à faire en famille.',
  },
];

// ───────────────────────────── Generic helpers ─────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bump = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Lowercase, accent-free, alphanumeric-only form used for keys and matching. */
function norm(s) {
  return stripAccents(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Strip HTML tags and citation markers like [1], collapse whitespace, cap length. */
function cleanText(v, max = 500) {
  if (v === null || v === undefined) return '';
  let s = String(v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
}

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function clampInt(n, min, max, dflt) {
  if (n === null) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in Europe/Paris as YYYY-MM-DD (the runner clock is UTC). */
function parisToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Add months without JS overflow (Oct 31 + 4 months → Feb 28, not Mar 3). */
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (m - 1) + n;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, daysInMonth);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function cleanUrl(v) {
  if (!v) return null;
  try {
    const u = new URL(String(v).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function isGroundingRedirect(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'vertexaisearch.cloud.google.com' || u.pathname.includes('grounding-api-redirect');
  } catch {
    return false;
  }
}

function inBbox(lat, lng) {
  return lat !== null && lng !== null &&
    lat >= BBOX.latMin && lat <= BBOX.latMax && lng >= BBOX.lngMin && lng <= BBOX.lngMax;
}

function isDefaultCoord(lat, lng) {
  return Math.abs(lat - CENTER.lat) < 1e-4 && Math.abs(lng - CENTER.lng) < 1e-4;
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return fallback;
  return JSON.parse(text); // a corrupted file must fail the run, never be silently overwritten
}

async function pool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try { await worker(item); } catch (err) { console.warn(`  ⚠️ worker error: ${err.message}`); }
    }
  });
  await Promise.all(runners);
}

// ───────────────────────────── Category / validation ─────────────────────────────

const CATEGORY_ALIASES = new Map([
  ['sport outdoor', 'Sport & Outdoor'],
  ['sport', 'Sport & Outdoor'],
  ['sports', 'Sport & Outdoor'],
  ['nature environnement', 'Nature & Environnement'],
  ['nature patrimoine', 'Nature & Environnement'],
  ['nature', 'Nature & Environnement'],
  ['culture ateliers', 'Culture & Ateliers'],
  ['culture', 'Culture & Ateliers'],
  ['culture famille loisirs', 'Culture & Ateliers'],
]);

function normalizeCategory(v) {
  return CATEGORY_ALIASES.get(norm(v)) || null;
}

/**
 * Validate and normalise one raw record (from Gemini or from the existing data.json).
 * Returns { ok: true, event, modelCoords } or { ok: false, reason }.
 * Only whitelisted fields survive — unexpected fields from the model are discarded.
 */
function validateEvent(raw, { today, maxDate }) {
  const fail = (reason) => ({ ok: false, reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not_an_object');

  const title = cleanText(raw.title, 200);
  if (!title) return fail('missing_title');

  const category = normalizeCategory(raw.category);
  if (!category) return fail('invalid_category');

  const startDate = String(raw.startDate ?? '').trim();
  if (!isValidIsoDate(startDate)) return fail('invalid_start_date');
  const endRaw = String(raw.endDate ?? '').trim();
  const endDate = endRaw || startDate;
  if (!isValidIsoDate(endDate)) return fail('invalid_end_date');
  if (endDate < startDate) return fail('end_before_start');
  if (endDate < today) return fail('past_event');
  if (startDate > maxDate) return fail('outside_window');

  const url = cleanUrl(raw.url);
  if (!url) return fail('invalid_url');

  const city = cleanText(raw.city, 80);
  const locationName = cleanText(raw.locationName, 160);
  if (!city && !locationName) return fail('missing_location');

  let ageMin = clampInt(toNum(raw.ageMin), 0, 99, 0);
  let ageMax = clampInt(toNum(raw.ageMax), 0, 99, 99);
  if (ageMin > ageMax) { ageMin = 0; ageMax = 99; }

  const mLat = toNum(raw.lat);
  const mLng = toNum(raw.lng);
  const modelCoords = inBbox(mLat, mLng) && !isDefaultCoord(mLat, mLng)
    ? { lat: mLat, lng: mLng }
    : null;

  return {
    ok: true,
    modelCoords,
    event: {
      title,
      category,
      ageMin,
      ageMax,
      city,
      locationName,
      lat: null,
      lng: null,
      dateType: 'event',
      startDate,
      endDate,
      schedule: cleanText(raw.schedule, 120),
      price: cleanText(raw.price, 80),
      organizer: cleanText(raw.organizer, 120),
      description: cleanText(raw.description, 400),
      url,
    },
  };
}

/** Re-validate an event already stored in data.json, keeping the fields our pipeline added. */
function fromExisting(old, ctx) {
  const v = validateEvent(old, { today: ctx.today, maxDate: FAR_FUTURE });
  if (!v.ok) return v;
  const e = v.event;

  if (typeof old.id === 'string' && old.id.trim()) e.id = old.id.trim();

  if (['ban', 'city', 'model', 'default'].includes(old.geoSource)) e.geoSource = old.geoSource;
  if (['ok', 'unverified'].includes(old.urlStatus)) e.urlStatus = old.urlStatus;
  if (isValidIsoDate(old.urlCheckedAt)) e.urlCheckedAt = old.urlCheckedAt;

  const oLat = toNum(old.lat);
  const oLng = toNum(old.lng);
  if (inBbox(oLat, oLng)) { e.lat = oLat; e.lng = oLng; }

  // Legacy coordinates (no geoSource) or model-sourced ones are unverified: keep them as a fallback only.
  const legacyCoords = (!e.geoSource || e.geoSource === 'model') && e.lat !== null && !isDefaultCoord(e.lat, e.lng);
  return { ok: true, event: e, modelCoords: legacyCoords ? { lat: e.lat, lng: e.lng } : null };
}

// ───────────────────────────── Keys & merging ─────────────────────────────

function eventKey(e) {
  return `${norm(e.title)}|${e.startDate}|${norm(e.city)}`;
}

function eventId(key) {
  return 'EVT_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}

/**
 * Re-sighting of a known event: refresh volatile facts, keep our existing text and geocoding.
 * (Text fields are kept to avoid a daily rewrite of descriptions by the LLM.)
 */
function mergeInto(target, incoming) {
  for (const f of ['endDate', 'schedule', 'price']) {
    if (incoming[f]) target[f] = incoming[f];
  }
  for (const f of ['description', 'organizer', 'locationName', 'city']) {
    if (!target[f] && incoming[f]) target[f] = incoming[f];
  }
  // Keep a URL that already verified fine (stable across runs); otherwise adopt the newly reported one,
  // unless it is a temporary Google grounding redirect.
  if (incoming.url && incoming.url !== target.url && target.urlStatus !== 'ok' && !isGroundingRedirect(incoming.url)) {
    target.url = incoming.url;
    delete target.urlStatus;
    delete target.urlCheckedAt;
  }
}

// ───────────────────────────── Gemini ─────────────────────────────

function buildPrompt(scan, { today, maxDate }) {
  return `
Effectue une recherche web approfondie sur les événements à venir dans la région de Fontainebleau.
Nous sommes aujourd'hui le ${today}.

FOCUS DE CETTE RECHERCHE : ${scan.label}
${scan.focus}

PÉRIODE DE RECHERCHE STRICTE :
- Conserve UNIQUEMENT les événements se déroulant entre le ${today} et le ${maxDate}.
- Exclus tous les événements passés (finis avant le ${today}).

PÉRIMÈTRE GÉOGRAPHIQUE :
- Ville principale : Fontainebleau.
- Communes voisines (< 15 km) : Avon, Barbizon, Samois-sur-Seine, Thomery, Bois-le-Roi, Bourron-Marlotte, Moret-Loing-et-Orvanne, Nemours, Vaux-le-Vicomte, Blandy-les-Tours.

SOURCES À EXPLORER EN PRIORITÉ :
1. Office de Tourisme du Pays de Fontainebleau (agenda).
2. Agendas municipaux des mairies : Fontainebleau, Avon, Barbizon, Moret-sur-Loing, Nemours.
3. Programmations des châteaux : Fontainebleau, Vaux-le-Vicomte, Blandy-les-Tours.
4. Plateformes d'inscriptions sportives & associatives : HelloAsso, KMS, Klikego, ProTiming.
5. Presse et magazines locaux : Le Bellifontain, La République de Seine-et-Marne.

RÈGLES DE QUALITÉ (très importantes) :
- N'invente rien. Si la date, le lieu ou l'URL d'un événement n'est pas confirmé par une source, ignore cet événement.
- "url" : adresse directe de la page de l'événement (ou de l'organisateur), jamais une page de résultats de recherche ni un lien de redirection.
- Dates au format YYYY-MM-DD ; pour un événement d'un seul jour, endDate = startDate.
- Aucun marqueur de citation ([1], [2]…) ni HTML dans les valeurs.
- "description" : une phrase, 200 caractères maximum.
- "lat" / "lng" : coordonnées GPS du lieu si tu les connais avec certitude, sinon null.
- "ageMin" / "ageMax" : âges conseillés (0 et 99 si tout public).
- "category" : UNIQUEMENT l'une de ces trois valeurs : "Sport & Outdoor", "Nature & Environnement", "Culture & Ateliers".
- Retourne au maximum ${CONFIG.maxEventsPerScan} événements, en priorisant les plus proches dans le temps.

Renvoie UNIQUEMENT un tableau JSON strict, sans texte avant ou après, au format exact suivant :
[
  {
    "title": "Titre explicite de l'événement",
    "category": "Sport & Outdoor",
    "ageMin": 0,
    "ageMax": 99,
    "city": "Nom de la ville",
    "locationName": "Lieu précis (ex: Grand Parquet, Parc du Château, Forêt domaniale)",
    "lat": 48.4020,
    "lng": 2.7010,
    "dateType": "event",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "schedule": "Horaires précis (ex: Samedi de 10h à 18h)",
    "price": "Gratuit ou tarif exact",
    "organizer": "Nom de l'association, mairie ou lieu",
    "description": "Courte description synthétique",
    "url": "URL directe de l'événement"
  }
]
`;
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY, // header, not query string: keeps the key out of URLs/logs
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      // No responseMimeType: it collides with the search tool (see design doc §3.A).
      generationConfig: { temperature: CONFIG.temperature, maxOutputTokens: CONFIG.maxOutputTokens },
    }),
    signal: AbortSignal.timeout(CONFIG.apiTimeoutMs),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(bodyText);
}

function extractText(response) {
  const candidate = response?.candidates?.[0];
  if (!candidate) {
    throw new Error(`No candidate returned (promptFeedback: ${JSON.stringify(response?.promptFeedback ?? null)})`);
  }
  const text = (candidate.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (!text.trim()) throw new Error(`No text generated (finishReason: ${candidate.finishReason})`);
  return {
    text,
    finishReason: candidate.finishReason ?? null,
    usage: response.usageMetadata ?? null,
    searchQueries: candidate.groundingMetadata?.webSearchQueries?.length ?? 0,
  };
}

/** Index of the ']' matching the '[' at `start` (string/escape aware), or -1 if the array is not closed. */
function findArrayEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Locate the JSON array in the model output. Tolerates code fences, prose around the array,
 * trailing citation markers, and output truncated at the token limit (salvages complete objects).
 */
function extractJsonArray(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/\[\s*\{/);
  if (start === -1) throw new Error('No JSON array found in model output');

  const end = findArrayEnd(cleaned, start);
  if (end !== -1) {
    try {
      const arr = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(arr)) return { events: arr, salvaged: false };
    } catch { /* fall through to salvage */ }
  }
  // Unclosed (truncated) array: keep every complete object up to the last closing brace.
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace > start) {
    try {
      const arr = JSON.parse(cleaned.slice(start, lastBrace + 1) + ']');
      if (Array.isArray(arr)) return { events: arr, salvaged: true };
    } catch { /* fall through */ }
  }
  throw new Error('JSON array could not be parsed (output likely truncated)');
}

async function runScan(scan, ctx) {
  const prompt = buildPrompt(scan, ctx);
  let lastError;
  for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
    try {
      const response = await callGemini(prompt);
      const info = extractText(response);
      const { events, salvaged } = extractJsonArray(info.text);
      return {
        events,
        meta: {
          attempts: attempt,
          finishReason: info.finishReason,
          salvaged,
          usage: info.usage,
          searchQueries: info.searchQueries,
        },
      };
    } catch (err) {
      lastError = err;
      // 400/401/403/404 = bad key, bad model name, bad request: retrying will not help.
      const retryable = err.status === undefined || RETRYABLE_STATUS.has(err.status);
      console.warn(`  ⚠️ [${scan.name}] attempt ${attempt}/${CONFIG.maxAttempts} failed: ${String(err.message).slice(0, 300)}`);
      if (!retryable || attempt === CONFIG.maxAttempts) break;
      await sleep(CONFIG.retryBaseDelayMs * 3 ** (attempt - 1));
    }
  }
  throw lastError;
}

// ───────────────────────────── Geocoding (BAN) ─────────────────────────────

async function banSearch(query, { municipality = false } = {}) {
  const u = new URL('https://api-adresse.data.gouv.fr/search/');
  u.searchParams.set('q', query.slice(0, 200));
  u.searchParams.set('limit', '1');
  u.searchParams.set('lat', String(CENTER.lat)); // bias results towards Fontainebleau
  u.searchParams.set('lon', String(CENTER.lng));
  if (municipality) u.searchParams.set('type', 'municipality');
  try {
    const res = await fetch(u, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CONFIG.geocodeTimeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const f = data?.features?.[0];
    if (!f?.geometry?.coordinates) return null;
    const [lng, lat] = f.geometry.coordinates;
    return { lat, lng, score: f.properties?.score ?? 0 };
  } catch {
    return null;
  }
}

function loadCache() {
  const raw = loadJson(CONFIG.cachePath, null);
  const entries = raw && typeof raw.entries === 'object' && raw.entries ? raw.entries : {};
  return { entries, dirty: false };
}

function saveCache(cache) {
  const sorted = Object.fromEntries(Object.entries(cache.entries).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(CONFIG.cachePath, JSON.stringify({ version: 1, entries: sorted }, null, 2) + '\n');
}

function setGeo(e, lat, lng, source) {
  e.lat = round5(lat);
  e.lng = round5(lng);
  e.geoSource = source;
}

/**
 * Preference order: BAN venue match (score + bbox checked) → model coordinates (bbox checked)
 * → BAN city centroid → Fontainebleau centre. Everything except "ban" is flagged approximate.
 */
async function geocodeRecord(rec, cache) {
  const e = rec.event;
  const venueQuery = [e.locationName, e.city].filter(Boolean).join(' ').trim();

  if (venueQuery.length >= 3) {
    const key = `venue:${norm(venueQuery)}`;
    let hit = cache.entries[key];
    if (!hit) {
      const r = await banSearch(venueQuery);
      if (r && r.score >= CONFIG.banMinScore && inBbox(r.lat, r.lng)) {
        hit = { lat: round5(r.lat), lng: round5(r.lng), source: 'ban' };
        cache.entries[key] = hit;
        cache.dirty = true;
      }
    }
    if (hit) return setGeo(e, hit.lat, hit.lng, 'ban');
  }

  if (rec.modelCoords) return setGeo(e, rec.modelCoords.lat, rec.modelCoords.lng, 'model');

  if (e.city && e.city.length >= 3) {
    const key = `city:${norm(e.city)}`;
    let hit = cache.entries[key];
    if (!hit) {
      const r = await banSearch(e.city, { municipality: true });
      if (r && inBbox(r.lat, r.lng)) {
        hit = { lat: round5(r.lat), lng: round5(r.lng), source: 'city' };
        cache.entries[key] = hit;
        cache.dirty = true;
      }
    }
    if (hit) return setGeo(e, hit.lat, hit.lng, 'city');
  }

  return setGeo(e, CENTER.lat, CENTER.lng, 'default');
}

// ───────────────────────────── URL verification ─────────────────────────────

/**
 * 404/410 or a non-existent domain → "dead" (dropped).
 * 2xx/3xx → "ok". Anything else (403 bot-blocking, 429, 5xx, timeout) → "unverified" (kept).
 */
async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(CONFIG.urlCheckTimeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
      },
    });
    try { await res.body?.cancel(); } catch { /* ignore */ }
    if (res.status === 404 || res.status === 410) return { status: 'dead', finalUrl: res.url };
    if (res.status >= 200 && res.status < 400) return { status: 'ok', finalUrl: res.url };
    return { status: 'unverified', finalUrl: res.url };
  } catch (err) {
    const code = err?.cause?.code;
    if (code === 'ENOTFOUND') return { status: 'dead' };
    return { status: 'unverified' };
  }
}

function needsUrlCheck(e, today) {
  if (!e.urlStatus || !e.urlCheckedAt) return true;
  return daysBetween(e.urlCheckedAt, today) >= CONFIG.urlRecheckAfterDays;
}

async function verifyUrls(records, today) {
  const todo = records.filter((r) => !r.drop && needsUrlCheck(r.event, today));
  await pool(todo, CONFIG.urlCheckConcurrency, async (rec) => {
    const e = rec.event;
    const res = await checkUrl(e.url);

    // Google grounding redirect links are temporary: resolve them to the real page or drop the event.
    if (isGroundingRedirect(e.url)) {
      const finalUrl = res.status === 'ok' ? cleanUrl(res.finalUrl) : null;
      if (finalUrl && !isGroundingRedirect(finalUrl)) e.url = finalUrl;
      else res.status = 'dead';
    }

    e.urlCheckedAt = today;
    if (res.status === 'dead') { rec.drop = 'dead_url'; return; }
    e.urlStatus = res.status;
  });
  return todo.length;
}

// ───────────────────────────── Output ─────────────────────────────

const FIELD_ORDER = [
  'id', 'title', 'category', 'ageMin', 'ageMax', 'city', 'locationName', 'lat', 'lng',
  'geoSource', 'geoApprox', 'dateType', 'startDate', 'endDate', 'schedule', 'price',
  'organizer', 'description', 'url', 'urlStatus', 'urlCheckedAt',
];

function serializeEvent(e) {
  const out = { ...e, geoApprox: e.geoSource !== 'ban' };
  const ordered = {};
  for (const f of FIELD_ORDER) if (out[f] !== undefined) ordered[f] = out[f];
  return ordered;
}

function renderSummary(stats, ctx) {
  const L = [];
  L.push('## 🗓️ Daily events update', '');
  L.push(`Window **${ctx.today} → ${ctx.maxDate}** · model \`${CONFIG.model}\`${CONFIG.dryRun ? ' · **DRY RUN**' : ''}`, '');
  L.push('| Scan | Status | Raw events | Attempts | Search queries | Tokens in / out / thoughts |');
  L.push('|---|---|---|---|---|---|');
  for (const s of stats.scans) {
    const u = s.usage || {};
    const tokens = s.usage ? `${u.promptTokenCount ?? '?'} / ${u.candidatesTokenCount ?? '?'} / ${u.thoughtsTokenCount ?? 0}` : '–';
    const status = s.error ? `❌ ${String(s.error).slice(0, 80)}` : (s.salvaged ? '⚠️ truncated, salvaged' : '✅');
    L.push(`| ${s.name} | ${status} | ${s.raw ?? 0} | ${s.attempts ?? '–'} | ${s.searchQueries ?? '–'} | ${tokens} |`);
  }
  L.push('');
  L.push(`- New events added: **${stats.added}** · refreshed: **${stats.refreshed}** · past events pruned: **${stats.pruned}**`);
  L.push(`- Total published: **${stats.total}**`);
  L.push(`- Dead URLs dropped: **${stats.deadUrls}** · URLs checked this run: ${stats.urlsChecked} · unverified (kept): ${stats.unverified}`);
  L.push(`- Geocoding sources: ${Object.entries(stats.geo).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}`);
  const rej = Object.entries(stats.rejected);
  L.push(`- Rejected new records: ${rej.length ? rej.map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}`);
  const rejOld = Object.entries(stats.legacyRejected);
  if (rejOld.length) L.push(`- Rejected stored records: ${rejOld.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  L.push(`- data.json ${stats.written ? 'updated' : 'unchanged'}`);
  return L.join('\n') + '\n';
}

// ───────────────────────────── Main ─────────────────────────────

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');

  const today = parisToday();
  const maxDate = addMonths(today, CONFIG.windowMonths);
  const ctx = { today, maxDate };
  console.log(`🚀 Scan ${today} → ${maxDate} (model ${CONFIG.model}${CONFIG.dryRun ? ', DRY RUN' : ''})`);

  const stats = {
    scans: [], rejected: {}, legacyRejected: {}, added: 0, refreshed: 0, pruned: 0,
    deadUrls: 0, urlsChecked: 0, unverified: 0, geo: {}, total: 0, written: false,
  };

  const existingText = fs.existsSync(CONFIG.dataPath) ? fs.readFileSync(CONFIG.dataPath, 'utf8') : '';
  const existingRaw = existingText.trim() ? JSON.parse(existingText) : [];
  if (!Array.isArray(existingRaw)) throw new Error('data.json must contain a JSON array');
  const cache = loadCache();

  // 1. Scans ────────────────────────────────────────────────────────────
  const rawNew = [];
  let okScans = 0;
  for (const [i, scan] of SCANS.entries()) {
    if (i > 0) await sleep(CONFIG.pauseBetweenScansMs);
    console.log(`🔎 Scan "${scan.name}"…`);
    try {
      const { events, meta } = await runScan(scan, ctx);
      okScans++;
      rawNew.push(...events);
      stats.scans.push({ name: scan.name, raw: events.length, ...meta });
      console.log(`   → ${events.length} raw events${meta.salvaged ? ' (truncated output, salvaged)' : ''}`);
    } catch (err) {
      stats.scans.push({ name: scan.name, error: err.message });
      console.error(`   ❌ scan "${scan.name}" failed: ${String(err.message).slice(0, 300)}`);
    }
  }
  if (okScans === 0) throw new Error('All Gemini scans failed — data.json left untouched');

  // 2. Validate new records ─────────────────────────────────────────────
  const validNew = [];
  for (const raw of rawNew) {
    const v = validateEvent(raw, ctx);
    if (v.ok) validNew.push(v);
    else bump(stats.rejected, v.reason);
  }
  console.log(`🧹 ${validNew.length}/${rawNew.length} new records valid`);
  if (validNew.length === 0) throw new Error('Scans succeeded but returned no valid events — data.json left untouched');

  // 3. Merge with existing data ─────────────────────────────────────────
  const records = new Map(); // key -> { event, modelCoords, isNew, refreshed, drop }
  for (const old of existingRaw) {
    const v = fromExisting(old, ctx);
    if (!v.ok) {
      if (v.reason === 'past_event') stats.pruned++;
      else bump(stats.legacyRejected, v.reason);
      continue;
    }
    const key = eventKey(v.event);
    if (!records.has(key)) records.set(key, { event: v.event, modelCoords: v.modelCoords, isNew: false });
  }
  for (const v of validNew) {
    const key = eventKey(v.event);
    const known = records.get(key);
    if (known) {
      mergeInto(known.event, v.event);
      if (!known.modelCoords && v.modelCoords) known.modelCoords = v.modelCoords;
      known.refreshed = true;
    } else {
      v.event.id = eventId(key);
      records.set(key, { event: v.event, modelCoords: v.modelCoords, isNew: true });
    }
  }
  const all = [...records.values()];

  // 4. Geocode (anything not yet resolved by BAN) ───────────────────────
  const toGeocode = all.filter((r) => r.event.geoSource !== 'ban' || r.event.lat === null);
  console.log(`📍 Geocoding ${toGeocode.length} event(s)…`);
  for (const rec of toGeocode) await geocodeRecord(rec, cache);

  // 5. Verify URLs ──────────────────────────────────────────────────────
  console.log('🔗 Verifying URLs…');
  stats.urlsChecked = await verifyUrls(all, today);

  // 6. Finalise ─────────────────────────────────────────────────────────
  const kept = [];
  for (const rec of all) {
    if (rec.drop === 'dead_url') { stats.deadUrls++; continue; }
    if (rec.isNew) stats.added++; else if (rec.refreshed) stats.refreshed++;
    if (rec.event.urlStatus === 'unverified') stats.unverified++;
    bump(stats.geo, rec.event.geoSource);
    kept.push(rec.event);
  }
  kept.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'fr'));
  stats.total = kept.length;

  const output = JSON.stringify(kept.map(serializeEvent), null, 2) + '\n';
  const changed = output !== existingText;
  stats.written = changed && !CONFIG.dryRun;

  if (!CONFIG.dryRun) {
    if (changed) fs.writeFileSync(CONFIG.dataPath, output);
    if (cache.dirty) saveCache(cache);
  }

  const summary = renderSummary(stats, ctx);
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary); } catch { /* non-fatal */ }
  }
  console.log(`💾 ${CONFIG.dryRun ? 'Dry run — nothing written.' : (changed ? `data.json updated (${kept.length} events).` : 'No change.')}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Fatal:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  main, validateEvent, fromExisting, extractJsonArray, extractText, eventKey, eventId, mergeInto,
  addMonths, parisToday, isValidIsoDate, cleanText, cleanUrl, normalizeCategory, checkUrl, geocodeRecord,
  CONFIG,
};