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
 *   6. Write data.json ({ schemaVersion, generatedAt, windowEnd, events }) + geocode-cache.json only if something changed,
 *      and print a run report
 *
 * Zero dependencies. Requires Node >= 18 (global fetch); the workflow uses Node 22.
 *
 * Environment:
 *   GEMINI_API_KEY (required)        GEMINI_MODEL (default gemini-3.6-flash)
 *   GEMINI_MAX_OUTPUT_TOKENS (16384) MAX_EVENTS_PER_SCAN (20)
 *   DATA_PATH (data.json)            GEOCODE_CACHE_PATH (geocode-cache.json)
 *   WINDOW_MONTHS (3)                How far ahead events are collected and displayed
 *   WEEKDAY_CHECK=0 -> disable the weekday-vs-date consistency check
 *   DRY_RUN=1  -> run everything but write nothing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const datatourisme = require('./datatourisme');
const feedback = require('./feedback');

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
  windowMonths: envInt('WINDOW_MONTHS', 3),
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
  overridesPath: path.resolve(process.env.OVERRIDES_PATH || 'overrides.json'),
  dryRun: process.env.DRY_RUN === '1',
  weekdayCheck: process.env.WEEKDAY_CHECK !== '0',
  // Cadence. The workflow triggers every day, but a real (billed) scan only runs when the stored
  // data is older than this. 60 h + a daily trigger gives one scan every ~3 days, and a failed or
  // skipped day is retried the next morning instead of waiting three more.
  minRunIntervalHours: envInt('MIN_RUN_INTERVAL_HOURS', 60),
  forceRun: process.env.FORCE_RUN === '1',
  // DATAtourisme, second source (open data). Set DATATOURISME=0 to collect from Gemini only.
  datatourisme: process.env.DATATOURISME !== '0',
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

const WEEKDAYS = new Map([
  ['dimanche', 0], ['lundi', 1], ['mardi', 2], ['mercredi', 3], ['jeudi', 4], ['vendredi', 5], ['samedi', 6],
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6],
]);

/** Set of weekday numbers (0 = Sunday) named in a free-text schedule, French or English. */
function weekdaysMentioned(text) {
  const found = new Set();
  for (const word of norm(text).split(' ')) if (WEEKDAYS.has(word)) found.add(WEEKDAYS.get(word));
  return found;
}

/**
 * True when the schedule names weekday(s) but none of them falls inside a short event (< 7 days).
 * Example: startDate is a Saturday but the schedule says "Dimanche 9h" → one of the two is wrong.
 */
function weekdayContradictsDates(schedule, startDate, endDate) {
  const mentioned = weekdaysMentioned(schedule);
  if (mentioned.size === 0) return false;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const spanDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - start) / 86_400_000) + 1;
  if (spanDays >= 7) return false; // every weekday occurs: nothing to contradict
  for (let i = 0; i < spanDays; i++) {
    if (mentioned.has(new Date(start + i * 86_400_000).getUTCDay())) return false;
  }
  return true;
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

  const schedule = cleanText(raw.schedule, 120);
  if (CONFIG.weekdayCheck && weekdayContradictsDates(schedule, startDate, endDate)) return fail('weekday_mismatch');

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
      schedule,
      price: cleanText(raw.price, 80),
      organizer: cleanText(raw.organizer, 120),
      description: cleanText(raw.description, 400),
      url,
      // Provenance. Absent (undefined) on Gemini records, so serializeEvent omits the field and
      // the existing data.json entries stay byte-identical.
      source: raw.source === 'datatourisme' ? 'datatourisme' : undefined,
    },
  };
}

/** Re-validate an event already stored in data.json, keeping the fields our pipeline added. */
function fromExisting(old, ctx) {
  const v = validateEvent(old, { today: ctx.today, maxDate: FAR_FUTURE });
  if (!v.ok) return v;
  const e = v.event;

  if (typeof old.id === 'string' && old.id.trim()) e.id = old.id.trim();

  if (['ban', 'city', 'model', 'default', 'manual'].includes(old.geoSource)) e.geoSource = old.geoSource;
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
- "schedule" : uniquement les horaires (ex: "10h–18h"), sans répéter la date ; s'ils diffèrent selon les jours, précise-les jour par jour avec la date (ex: "sam. 12 : 10h–18h ; dim. 13 : 10h–17h"). Ne mets JAMAIS un jour de la semaine sans la date correspondante.
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
    "schedule": "Horaires uniquement (ex: 10h–18h)",
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

// ───────────────────────────── Manual overrides ─────────────────────────────

/**
 * overrides.json is the ONLY hand-edited data file in the repo, and the one place a human
 * correction survives a re-scan. Everything else under data.json is regenerated from scratch
 * every run, so a fix applied there would be silently undone on the next scan — which is what
 * made the "report an error" link (item 15) a loop with no output until now.
 *
 * Shape: { "<event id>": { hidden?, note?, fields?: { <field>: <value> } } }
 *
 * Keyed by event id, which is a hash of the ORIGINAL title|startDate|city (eventId/eventKey).
 * That matters: a fresh scan re-reports the same event with the same wrong date, derives the
 * same id, and therefore picks the same override up again. The correction is durable by
 * construction, with no "locked" flag to maintain.
 */
const OVERRIDABLE_FIELDS = new Set([
  'title', 'category', 'city', 'locationName', 'lat', 'lng', 'startDate', 'endDate',
  'schedule', 'price', 'organizer', 'description', 'url', 'ageMin', 'ageMax',
]);

/** Coerce and sanity-check one override value; returns undefined when the value is unusable. */
function coerceOverride(field, value) {
  if (value === null || value === undefined) return undefined;
  // title and city are two thirds of eventKey(): blanking either would produce a garbage key,
  // so an empty result is a rejection there, while elsewhere it is a deliberate "remove this".
  const required = field === 'title' || field === 'city';
  const text = (max) => {
    const out = cleanText(value, max);
    return required && !out ? undefined : out;
  };
  switch (field) {
    case 'startDate':
    case 'endDate':
      return isValidIsoDate(value) ? value : undefined;
    case 'lat':
    case 'lng':
      return Number.isFinite(toNum(value)) ? round5(toNum(value)) : undefined;
    case 'ageMin':
    case 'ageMax': {
      // clampInt() only falls back to its default on null, so filter NaN out here.
      const n = toNum(value);
      return Number.isFinite(n) ? clampInt(n, 0, 99, undefined) : undefined;
    }
    // normalizeCategory() and cleanUrl() both answer null on a value they refuse. Returning that
    // null would BLANK the field instead of leaving it alone, so map it to undefined.
    case 'category':
      return normalizeCategory(value) ?? undefined;
    case 'url':
      return cleanUrl(value) ?? undefined;
    case 'description':
      return text(500);
    default:
      return text(200);
  }
}

/**
 * Applies overrides.json over the merged record set, then re-keys the map: an override may
 * change the title, startDate or city, which are exactly the three parts of eventKey(). Without
 * the re-key, the corrected record and the next scan's uncorrected sighting of the same event
 * would sit under two different keys and both get published — the correction would create the
 * duplicate it was meant to fix.
 */
function applyOverrides(records, overrides, stats) {
  const seen = new Set();

  for (const rec of records.values()) {
    const rule = overrides[rec.event.id];
    if (!rule || typeof rule !== 'object') continue;
    seen.add(rec.event.id);

    if (rule.hidden === true) {
      rec.drop = 'override_hidden';
      stats.overrides.hidden++;
      continue;
    }

    const fields = rule.fields && typeof rule.fields === 'object' ? rule.fields : {};
    const applied = [];
    for (const [field, raw] of Object.entries(fields)) {
      if (!OVERRIDABLE_FIELDS.has(field)) { stats.overrides.badFields.push(`${rec.event.id}.${field} (unknown field)`); continue; }
      const value = coerceOverride(field, raw);
      if (value === undefined) { stats.overrides.badFields.push(`${rec.event.id}.${field} (invalid value)`); continue; }
      if (rec.event[field] === value) continue;
      rec.event[field] = value;
      applied.push(field);
    }
    if (!applied.length) continue;

    // Hand-set coordinates are authoritative: skip geocoding entirely for this record.
    if (applied.includes('lat') || applied.includes('lng')) {
      rec.event.geoSource = 'manual';
      rec.modelCoords = null;
    } else if (applied.includes('city') || applied.includes('locationName')) {
      // The address changed, so the cached position no longer describes it — re-geocode.
      rec.event.geoSource = undefined;
      rec.event.lat = null;
      rec.event.lng = null;
    }
    // A hand-corrected URL has never been checked: let step 5 verify it like any other.
    if (applied.includes('url')) {
      delete rec.event.urlStatus;
      delete rec.event.urlCheckedAt;
    }

    stats.overrides.applied++;
    stats.overrides.details.push(`${rec.event.id}: ${applied.join(', ')}`);
  }

  // An override that matches nothing is reported, never silently ignored: it usually means the
  // event has aged out of the window and the entry can be deleted from overrides.json.
  for (const id of Object.keys(overrides)) {
    if (id.startsWith('_')) continue; // "_comment" and friends
    if (!seen.has(id)) stats.overrides.unmatched.push(id);
  }

  // Re-key: title / startDate / city may have moved (see the doc comment above).
  const rekeyed = new Map();
  for (const rec of records.values()) {
    const key = eventKey(rec.event);
    const known = rekeyed.get(key);
    if (!known) { rekeyed.set(key, rec); continue; }
    // A correction made two records identical: keep the one the override touched, fold in the other.
    mergeInto(known.event, rec.event);
    if (!known.modelCoords && rec.modelCoords) known.modelCoords = rec.modelCoords;
    known.refreshed = true;
    stats.overrides.merged++;
  }
  records.clear();
  for (const [key, rec] of rekeyed) records.set(key, rec);
}

// ───────────────────────────── Output ─────────────────────────────

const FIELD_ORDER = [
  'id', 'title', 'category', 'ageMin', 'ageMax', 'city', 'locationName', 'lat', 'lng',
  'geoSource', 'geoApprox', 'dateType', 'startDate', 'endDate', 'schedule', 'price',
  'organizer', 'description', 'url', 'urlStatus', 'urlCheckedAt', 'source',
];

function serializeEvent(e) {
  const out = { ...e, geoApprox: !(e.geoSource === 'ban' || e.geoSource === 'manual') };
  const ordered = {};
  for (const f of FIELD_ORDER) if (out[f] !== undefined) ordered[f] = out[f];
  return ordered;
}

/** Append a Markdown block to the GitHub Actions job summary; a no-op outside CI. */
function writeStepSummary(text) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text); } catch { /* non-fatal */ }
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
  if (stats.dt) {
    if (stats.dt.error) {
      L.push(`- 📖 DATAtourisme: ❌ ${String(stats.dt.error).slice(0, 160)} (Gemini results kept)`);
    } else {
      L.push(`- 📖 DATAtourisme (CSV du ${stats.dt.updated}): ${stats.dt.inWindow} in window → ${stats.dt.short} short kept, ${stats.dt.recurring} recurring/markets skipped → **${stats.dt.records}** record(s), ${stats.dtDeduped} duplicate(s) of a Gemini event`);
      const dtRej = Object.entries(stats.dtRejected);
      if (dtRej.length) L.push(`  - rejected at validation: ${dtRej.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }
  if (stats.crossCityDeduped) {
    L.push(`- 🧹 Doublons fusionnés (même titre, même date, ville différente) : **${stats.crossCityDeduped}**`);
  }
  if (stats.similarSameDay.length) {
    L.push(`- 🔎 Titres proches le même jour, à vérifier manuellement (non fusionnés) : ${stats.similarSameDay.length}`);
    for (const s of stats.similarSameDay.slice(0, 8)) L.push(`  - ${s}`);
    if (stats.similarSameDay.length > 8) L.push(`  - … et ${stats.similarSameDay.length - 8} autre(s)`);
  }
  const fb = stats.feedback;
  if (fb) {
    if (fb.error) {
      L.push(`- 📨 Formulaire de signalement : ⚠️ ${String(fb.error).slice(0, 160)} (run poursuivi)`);
    } else {
      L.push(`- 📨 Formulaire de signalement : **${fb.total}** réponse(s) → **${fb.autoHidden}** masquage(s) automatique(s), ${fb.recheck} lien(s) à revérifier, **${fb.review}** à relire${fb.alreadyHandled ? `, ${fb.alreadyHandled} déjà traité(s)` : ''}`);
      if (fb.capped) L.push('  - 🚨 **Trop de demandes de masquage d\'un coup : aucune appliquée.** Vérifie le formulaire avant d\'agir.');
      const labels = Object.entries(fb.labels).map(([k, v]) => `${k} → ${v.action} (${v.count})`);
      if (labels.length) L.push(`  - types de problème vus : ${labels.join(' · ')}`);
      if (fb.badId.length) L.push(`  - ⚠️ identifiant absent ou invalide : ${fb.badId.slice(0, 5).join(', ')}${fb.badId.length > 5 ? '…' : ''}`);
      const queue = stats.feedbackReview || [];
      if (queue.length) {
        L.push('  - **À relire et, si c\'est juste, à reporter dans `overrides.json` :**');
        for (const r of queue.slice(0, 10)) {
          L.push(`    - \`${r.id}\` — *${r.type}* — ${r.title}${r.details ? ` → « ${r.details} »` : ''}`);
        }
        if (queue.length > 10) L.push(`    - … et ${queue.length - 10} autre(s)`);
      }
    }
  }
  const ov = stats.overrides;
  if (ov && (ov.applied || ov.hidden || ov.unmatched.length || ov.badFields.length)) {
    L.push(`- ✍️ Corrections manuelles (overrides.json) : **${ov.applied}** appliquée(s) · **${ov.hidden}** masquée(s)${ov.merged ? ` · ${ov.merged} fusionnée(s) après correction` : ''}`);
    for (const d of ov.details.slice(0, 10)) L.push(`  - ${d}`);
    if (ov.details.length > 10) L.push(`  - … et ${ov.details.length - 10} autre(s)`);
    if (ov.unmatched.length) L.push(`  - ⚠️ sans événement correspondant (à supprimer du fichier) : ${ov.unmatched.slice(0, 10).join(', ')}${ov.unmatched.length > 10 ? '…' : ''}`);
    if (ov.badFields.length) L.push(`  - ⚠️ ignorées, valeur ou champ invalide : ${ov.badFields.slice(0, 10).join(', ')}${ov.badFields.length > 10 ? '…' : ''}`);
  }
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

/**
 * Finds and merges duplicate occurrences that eventKey() (title + startDate + city) misses,
 * and reports the rest for human review. Runs over the full merged set (existing + new, from
 * every source) every time — self-healing, not a one-off cleanup: the two live duplicates that
 * prompted this (§7, September 20) are fixed by the very first run after deployment, and any
 * future re-occurrence is fixed the same way, automatically.
 */
function dedupeFuzzy(records, stats) {
  // Fuzzy, same-day duplicate cleanup — mutates records in place.
  // eventKey() (title + startDate + city) only merges duplicates that agree on BOTH the exact
  // title string and the city. Two scans routinely report the same real event with the city
  // spelled differently (a venue that straddles a border, or one scan naming the administrative
  // commune and another the landmark's common name — Vaux-le-Vicomte château sits in the commune
  // of Maincy) and/or the title reworded around the same content words ("Le Grand Noël de
  // Vaux-le-Vicomte" vs "Le Grand Noël DU CHÂTEAU DE Vaux-le-Vicomte" vs "...AU CHÂTEAU DE...").
  //
  // The auto-merge rule here is: same date, and the titles reduce to the exact same SET of
  // significant words once grammatical connectors (le/la/de/du/au…) are stripped. Word order and
  // connectors are ignored; the words that actually carry meaning must match exactly — nothing
  // is dropped for merely *overlapping*. Two unrelated real events sharing every content word in
  // their name, on the same day, within a 15 km radius, would be an extraordinary coincidence, so
  // this is treated as certain — the "same event, same date" rule the project lead asked for
  // after spotting live duplicates (September 20).
  //
  // Titles that are merely *similar* (not an exact word-set match) are deliberately left alone
  // here and only reported below (stats.similarSameDay): auto-merging on a looser match risks
  // conflating two genuinely distinct sub-events (e.g. two disciplines of the same meeting,
  // "Poneys" vs "Équitation") with a real duplicate, and a wrong merge silently deletes a real
  // event — worse than leaving an extra card visible.
  const CONNECTOR_WORDS = new Set([
    'le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'au', 'aux', 'a', 'en', 'et',
    'un', 'une', 'ou', 'par', 'pour', 'sur', 'avec', 'chateau',
  ]);
  function significantWords(title) {
    return norm(title).split(' ').filter((w) => w.length > 1 && !CONNECTOR_WORDS.has(w));
  }
  // Canonical signature: sorted, deduplicated significant words. Two titles collide here iff
  // they carry the exact same set of meaningful words — order and connectors do not matter.
  // Titles left with fewer than 2 significant words (e.g. a single generic noun) are excluded
  // from auto-merge entirely (unique per-record suffix) rather than risk matching on one word.
  function wordSetSignature(title, uniqueFallback) {
    const words = [...new Set(significantWords(title))].sort();
    return words.length >= 2 ? words.join(' ') : `__unique__${uniqueFallback}`;
  }

  const byWordSetDate = new Map();
  for (const [key, rec] of records) {
    const k = rec.event.startDate + '|' + wordSetSignature(rec.event.title, key);
    if (!byWordSetDate.has(k)) byWordSetDate.set(k, []);
    byWordSetDate.get(k).push(key);
  }
  for (const keys of byWordSetDate.values()) {
    if (keys.length < 2) continue;
    const group = keys.map((k) => records.get(k));
    // Keep an already-stored record over a brand-new one (stable id, any URL already verified);
    // among ties, keep whichever already has a verified URL; among further ties, prefer a
    // legacy ACT_ id over a hash EVT_ id (the older, more likely to be linked-to record); the
    // remaining tie-break is insertion order, which is deterministic (existing records are
    // loaded in the order stored in data.json; new ones in scan order).
    group.sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
      const aOk = a.event.urlStatus === 'ok', bOk = b.event.urlStatus === 'ok';
      if (aOk !== bOk) return aOk ? -1 : 1;
      const aLegacy = /^ACT_/.test(a.event.id || ''), bLegacy = /^ACT_/.test(b.event.id || '');
      if (aLegacy !== bLegacy) return aLegacy ? -1 : 1;
      return 0;
    });
    const [winner, ...losers] = group;
    for (const loser of losers) {
      mergeInto(winner.event, loser.event);
      if (!winner.modelCoords && loser.modelCoords) winner.modelCoords = loser.modelCoords;
      winner.refreshed = true;
      records.delete(eventKey(loser.event));
      stats.crossCityDeduped++;
    }
  }

  // Same-day, similar-but-not-identical titles: visibility only, never auto-merged (see above).
  // Jaccard similarity over the same significant-word sets used for the merge above; the merge
  // already removed every pair at 1.0 (exact set match), so nothing here duplicates that report.
  function jaccard(a, b) {
    const wa = new Set(significantWords(a)), wb = new Set(significantWords(b));
    if (!wa.size || !wb.size) return 0;
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter++;
    return inter / new Set([...wa, ...wb]).size;
  }
  const SIMILARITY_REVIEW_THRESHOLD = 0.6;
  const byDate = new Map();
  for (const rec of records.values()) {
    const list = byDate.get(rec.event.startDate) || [];
    list.push(rec);
    byDate.set(rec.event.startDate, list);
  }
  for (const list of byDate.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (jaccard(list[i].event.title, list[j].event.title) >= SIMILARITY_REVIEW_THRESHOLD) {
          stats.similarSameDay.push(
            `${list[i].event.title} ↔ ${list[j].event.title} (${list[i].event.startDate})`
          );
        }
      }
    }
  }
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
    dt: null, dtRejected: {}, dtDeduped: 0, crossCityDeduped: 0, similarSameDay: [],
    overrides: { applied: 0, hidden: 0, merged: 0, details: [], unmatched: [], badFields: [] },
    feedback: null,
  };

  const existingText = fs.existsSync(CONFIG.dataPath) ? fs.readFileSync(CONFIG.dataPath, 'utf8') : '';
  const existingPayload = existingText.trim() ? JSON.parse(existingText) : [];
  // v1 files are a bare array; v2.1 files are { schemaVersion, generatedAt, events }
  const legacyShape = Array.isArray(existingPayload);
  const existingRaw = legacyShape ? existingPayload : existingPayload?.events;
  if (!Array.isArray(existingRaw)) throw new Error('data.json must be a JSON array or an object with an "events" array');
  const existingGeneratedAt = legacyShape ? null : existingPayload.generatedAt;

  // Cadence guard — no Gemini call, no cost, data.json untouched. A manual workflow_dispatch sets
  // FORCE_RUN=1 and a local DRY_RUN always executes, so the pipeline stays testable on demand.
  const hoursSinceUpdate = existingGeneratedAt && !Number.isNaN(Date.parse(existingGeneratedAt))
    ? (Date.now() - Date.parse(existingGeneratedAt)) / 3_600_000
    : Infinity;
  if (!CONFIG.forceRun && !CONFIG.dryRun && hoursSinceUpdate < CONFIG.minRunIntervalHours) {
    const remaining = (CONFIG.minRunIntervalHours - hoursSinceUpdate).toFixed(1);
    const note = 'Données mises à jour il y a ' + hoursSinceUpdate.toFixed(1) + ' h '
      + '(cadence : ' + CONFIG.minRunIntervalHours + ' h). Prochain scan dans ~' + remaining + ' h. '
      + 'Aucun appel Gemini, aucun coût, data.json inchangé.';
    console.log('⏭️  ' + note);
    writeStepSummary('## Run ignoré — cadence\n\n' + note + '\n');
    return;
  }

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
  // 1b. DATAtourisme — open data, second source ────────────────────────
  // Recurring events and weekly markets are excluded (decision of September 20): they would
  // saturate the map. Short events become one record per date, because an exact date is the
  // useful information and a 13→20 December span would be a lie.
  let dtRaw = [];
  if (CONFIG.datatourisme) {
    console.log('📖 DATAtourisme…');
    try {
      const loaded = await datatourisme.load({ today, windowEnd: maxDate });
      dtRaw = datatourisme.toPipelineEvents(loaded.short, ctx);
      stats.dt = {
        updated: loaded.meta.lastModified,
        inWindow: loaded.inWindow.length,
        short: loaded.short.length,
        recurring: loaded.recurring.length,
        records: dtRaw.length,
      };
      console.log(`   → ${loaded.short.length} short event(s), ${loaded.recurring.length} recurring skipped, ${dtRaw.length} record(s)`);
    } catch (err) {
      stats.dt = { error: err.message };
      console.error(`   ❌ DATAtourisme failed: ${String(err.message).slice(0, 300)}`);
    }
  }

  // A source failing is survivable as long as one of them produced something: events are pruned
  // by date only, never by absence, so a partial failure deletes nothing.
  if (okScans === 0 && dtRaw.length === 0) {
    throw new Error('Every source failed (Gemini scans and DATAtourisme) — data.json left untouched');
  }

  // 2. Validate new records ─────────────────────────────────────────────
  const validNew = [];
  for (const raw of rawNew) {
    const v = validateEvent(raw, ctx);
    if (v.ok) validNew.push(v);
    else bump(stats.rejected, v.reason);
  }
  console.log(`🧹 ${validNew.length}/${rawNew.length} new records valid`);

  // DATAtourisme records go through exactly the same validation — including the URL requirement,
  // which drops the handful of entries the tourism offices publish without a link.
  const validDt = [];
  for (const raw of dtRaw) {
    const v = validateEvent(raw, ctx);
    if (v.ok) validDt.push(v);
    else bump(stats.dtRejected, v.reason);
  }
  if (dtRaw.length) console.log(`🧹 ${validDt.length}/${dtRaw.length} DATAtourisme records valid`);

  if (validNew.length === 0 && validDt.length === 0) {
    throw new Error('Sources returned no valid event — data.json left untouched');
  }

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
  const addRecord = (v, { fuzzy = false } = {}) => {
    const key = eventKey(v.event);
    const known = records.get(key);
    if (known) {
      mergeInto(known.event, v.event);
      if (!known.modelCoords && v.modelCoords) known.modelCoords = v.modelCoords;
      known.refreshed = true;
      return;
    }
    // Two sources phrase the same event differently ("Concert de musique classique" vs "Concert
    // classique à Nemours"), and the exact key would miss it. Only the second source pays the
    // cost of this scan, and the incumbent record wins: it has already passed URL verification.
    if (fuzzy) {
      for (const rec of records.values()) {
        if (datatourisme.isSameOccurrence(v.event, rec.event)) { stats.dtDeduped++; return; }
      }
    }
    v.event.id = eventId(key);
    records.set(key, { event: v.event, modelCoords: v.modelCoords, isNew: true });
  };

  for (const v of validNew) addRecord(v);
  for (const v of validDt) addRecord(v, { fuzzy: true });

  dedupeFuzzy(records, stats);

  // Manual corrections last: they must win over anything the sources reported, and they run
  // before geocoding and URL verification so a corrected address or link is actually checked.
  const overrides = loadJson(CONFIG.overridesPath, {});
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('overrides.json must be a JSON object keyed by event id');
  }

  // Visitor feedback (§3.N). Read-only for everything except hiding an event, and never fatal:
  // the form is a nice-to-have, a sheet that is down must not cost us a whole scan.
  let effective = overrides;
  if (feedback.CONFIG.url) {
    try {
      const fb = await feedback.collect({ knownOverrides: overrides });
      stats.feedback = fb.stats;
      stats.feedbackReview = fb.review;
      effective = feedback.mergeAutoHides(overrides, fb.autoHide);
      // A reported dead link is not grounds for hiding anything: just drop the verification
      // stamp so step 5 re-checks the URL and drops it on its own evidence if it is truly dead.
      for (const rec of records.values()) {
        if (!fb.recheck.has(rec.event.id)) continue;
        delete rec.event.urlStatus;
        delete rec.event.urlCheckedAt;
      }
      console.log(`📨 Feedback : ${fb.stats.total} réponse(s) → ${fb.stats.autoHidden} masquage(s), ${fb.stats.recheck} lien(s) à revérifier, ${fb.stats.review} à relire`);
    } catch (err) {
      stats.feedback = { error: err.message };
      console.error(`   ⚠️ feedback CSV: ${String(err.message).slice(0, 200)} (run continues)`);
    }
  }

  applyOverrides(records, effective, stats);

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
    if (rec.drop === 'override_hidden') continue;
    if (rec.isNew) stats.added++; else if (rec.refreshed) stats.refreshed++;
    if (rec.event.urlStatus === 'unverified') stats.unverified++;
    bump(stats.geo, rec.event.geoSource);
    kept.push(rec.event);
  }
  kept.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'fr'));
  stats.total = kept.length;

  const newEvents = kept.map(serializeEvent);
  const eventsChanged = JSON.stringify(newEvents) !== JSON.stringify(existingRaw);
  // generatedAt = time of the last run that changed something, refreshed once per Paris day even if nothing
  // changed (so the site can say "checked today" while committing at most once a day).
  const previousDate = existingGeneratedAt && !Number.isNaN(Date.parse(existingGeneratedAt))
    ? parisToday(new Date(existingGeneratedAt))
    : null;
  const keepStamp = !legacyShape && !eventsChanged && previousDate === today;
  const generatedAt = keepStamp ? existingGeneratedAt : new Date().toISOString();
  const output = JSON.stringify({ schemaVersion: 2, generatedAt, windowEnd: maxDate, events: newEvents }, null, 2) + '\n';
  const changed = output !== existingText;
  stats.written = changed && !CONFIG.dryRun;

  if (!CONFIG.dryRun) {
    if (changed) fs.writeFileSync(CONFIG.dataPath, output);
    if (cache.dirty) saveCache(cache);
  }

  const summary = renderSummary(stats, ctx);
  console.log('\n' + summary);
  writeStepSummary(summary);
  console.log(`💾 ${CONFIG.dryRun ? 'Dry run — nothing written.' : (changed ? `data.json updated (${kept.length} events).` : 'No change.')}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Fatal:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  main, validateEvent, fromExisting, extractJsonArray, extractText, eventKey, eventId, mergeInto, dedupeFuzzy, serializeEvent,
  applyOverrides, coerceOverride,
  renderSummary,
  addMonths, parisToday, isValidIsoDate, cleanText, cleanUrl, normalizeCategory, checkUrl, geocodeRecord,
  weekdayContradictsDates,
  CONFIG,
};