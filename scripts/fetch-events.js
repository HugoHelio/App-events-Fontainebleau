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
const openagenda = require('./openagenda');
const feedback = require('./feedback');
const translate = require('./translate');
const dedupeJudge = require('./dedupe-judge');
const sites = require('./sources');
const { matchLevel } = require('./compare-sources');
const pages = require('./generate-pages');

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
  venuesPath: path.resolve(process.env.VENUES_PATH || 'venues.json'),
  // Acceptance radius around Fontainebleau. The bounding box below stays as a cheap coarse
  // filter, but it is a rectangle: it reached 30 km into Sénart and Corbeil to the north-west
  // while cutting closer in other directions. A radius says what the project actually means.
  maxRadiusKm: envInt('MAX_RADIUS_KM', 20),
  // Days without any source confirming an event before it is reported for review. Three scans
  // at the ~3-day cadence, so one missed mention is never enough to raise it.
  staleAfterDays: envInt('STALE_EVENT_DAYS', 10),
  dryRun: process.env.DRY_RUN === '1',
  weekdayCheck: process.env.WEEKDAY_CHECK !== '0',
  // Cadence. The workflow triggers every day, but a real (billed) scan only runs when the stored
  // data is older than this. 60 h + a daily trigger gives one scan every ~3 days, and a failed or
  // skipped day is retried the next morning instead of waiting three more.
  minRunIntervalHours: envInt('MIN_RUN_INTERVAL_HOURS', 60),
  forceRun: process.env.FORCE_RUN === '1',
  // OpenAgenda, third source (open data, via the Île-de-France portal). OPENAGENDA=0 disables it.
  openagenda: process.env.OPENAGENDA !== '0',
  // DATAtourisme, second source (open data). Set DATATOURISME=0 to collect from Gemini only.
  datatourisme: process.env.DATATOURISME !== '0',
  // Organisers' own sites, read without grounding (sources.json, §3.Z2). SITES=0 disables them.
  sites: process.env.SITES !== '0',
};

const CATEGORIES = [
  'Sport & Outdoor',
  'Nature & Environnement',
  'Scène & Spectacles',   // ajoutée le 23/09 : Culture pesait 61 % des événements
  'Culture & Ateliers',
];

// Fontainebleau centre — used only as a last-resort fallback (flagged geoSource: "default").
const CENTER = { lat: 48.4020, lng: 2.7010 };
// Generous box around the ~15 km radius (Nemours … Vaux-le-Vicomte … Moret). Anything outside is rejected.
const BBOX = { latMin: 48.20, latMax: 48.65, lngMin: 2.45, lngMax: 3.00 };

// The communes actually inside CONFIG.maxRadiusKm, given to the model so it searches the area we
// keep rather than a smaller one. Derived from the published data on 22 September and ordered by
// distance; extend it if the radius changes. La Rochette (12.6 km) and Saint-Fargeau-Ponthierry
// (18.4 km) were added on 23 September: the feeds were already publishing them, but the model was
// never asked to look there, so coverage of those two depended on which source happened to find
// the event.
const COMMUNES = [
  'Avon', 'Thomery', 'Samois-sur-Seine', 'Bourron-Marlotte', 'Moret-Loing-et-Orvanne',
  'Bois-le-Roi', 'Barbizon', 'Ury', 'Le Châtelet-en-Brie', 'Villiers-en-Bière',
  'La Chapelle-la-Reine', 'Sivry-Courtry', 'Nemours', 'Larchant', 'Melun',
  'Saint-Pierre-lès-Nemours', 'Milly-la-Forêt', 'Maincy (Vaux-le-Vicomte)', 'Vert-Saint-Denis',
  'Blandy-les-Tours', 'Cesson', 'La Rochette', 'Saint-Fargeau-Ponthierry',
];

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const USER_AGENT = 'Mozilla/5.0 (compatible; FontainebleauEventsBot/2.0)';
const FAR_FUTURE = '9999-12-31';

const SCANS = [
  {
    name: 'sport',
    label: 'Sport & Outdoor',
    focus:
      'Trails et courses nature en forêt, courses sur route, cross, marche nordique, ' +
      'courses d\'orientation, randonnées pédestres et VTT organisées par des clubs, ' +
      'concours hippiques et de saut d\'obstacles (Grand Parquet), compétitions d\'escalade et ' +
      'de bloc, triathlons et duathlons, critériums cyclistes, tournois de clubs, ' +
      'courses caritatives et courses de Noël. ' +
      'Cherche nommément les clubs et organisateurs locaux : clubs d\'athlétisme de Nemours et ' +
      'de Fontainebleau, Stade Équestre du Grand Parquet, clubs de VTT et de cyclotourisme, ' +
      'comités départementaux de Seine-et-Marne, offices municipaux des sports.',
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
    label: 'Culture, patrimoine & spectacles',
    focus:
      'Deux familles à distinguer. D\'un côté « Culture & Ateliers » : expositions, visites ' +
      'guidées, patrimoine, musées, médiathèques, conférences, ateliers, brocantes et ' +
      'vide-greniers. De l\'autre « Scène & Spectacles » : concerts, théâtre, opéra, danse, ' +
      'cirque, humour, cinéma et festivals. Inclure les événements aux châteaux de ' +
      'Fontainebleau, Vaux-le-Vicomte et Blandy-les-Tours dans l\'une ou l\'autre selon leur nature.',
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

/** Great-circle distance in km. Used for the acceptance radius, not for display. */
function distanceKm(lat, lng, from = CENTER) {
  const R = 6371, rad = (d) => d * Math.PI / 180;
  const dLat = rad(lat - from.lat), dLng = rad(lng - from.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(from.lat)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
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
  ['scene spectacles', 'Scène & Spectacles'],
  ['scene', 'Scène & Spectacles'],
  ['spectacles', 'Scène & Spectacles'],
  ['spectacle', 'Scène & Spectacles'],
  ['scene spectacle', 'Scène & Spectacles'],
]);

// A word here has to name a PERFORMANCE, not an atmosphere. "Soirée aux Chandelles" is a
// candlelit visit to Vaux-le-Vicomte, not a show, so "soirée" is deliberately absent.
const SCENE_WORDS = /\b(spectacle|concert|theatre|theatral|opera|recital|chorale|orchestre|ballet|danse|cirque|humour|stand.?up|projection|cinema|cine|film|conte|marionnette|murder party|festival)\w*/;

// A title that announces itself as an exhibition or a visit is not a performance, whatever its
// description happens to mention. Without this, "Exposition d'art contemporain Wawapod" moved
// to the stage category because its description named a festival.
const NOT_SCENE_TITLE = /^(exposition|expo|visite|balade|parcours|atelier)\b/;

/**
 * One place decides the category, whatever the source proposed (item 21).
 *
 * Only ever promotes "Culture & Ateliers" to "Scène & Spectacles". Sport and Nature are left
 * alone: a source that says "Sport" knows something a regular expression does not, and the four
 * borderline cases found in 197 published events were all defensible.
 */
function refineCategory(event) {
  if (event.category !== 'Culture & Ateliers') return event.category;
  const title = norm(event.title);
  if (NOT_SCENE_TITLE.test(title)) return event.category;
  if (SCENE_WORDS.test(title) || SCENE_WORDS.test(norm(event.description))) return 'Scène & Spectacles';
  return event.category;
}

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
  // `precise` marks a coordinate that came from a structured feed (DATAtourisme, OpenAgenda),
  // where a place is a declared record. That is not the same thing as a coordinate the model
  // produced from a prompt, and filing both as "model" understated what we actually know.
  const modelCoords = inBbox(mLat, mLng) && !isDefaultCoord(mLat, mLng)
    ? { lat: mLat, lng: mLng, precise: raw.geoPrecise === true }
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
      source: ['datatourisme', 'openagenda', 'site'].includes(raw.source) ? raw.source : undefined,
      // Only OpenAgenda carries one today. Through cleanUrl() like any other link: it ends up in
      // an <img src> eventually, and the value comes from a third party.
      image: cleanUrl(raw.image) || undefined,
    },
  };
}

/** Re-validate an event already stored in data.json, keeping the fields our pipeline added. */
function fromExisting(old, ctx) {
  const v = validateEvent(old, { today: ctx.today, maxDate: FAR_FUTURE });
  if (!v.ok) return v;
  const e = v.event;

  if (typeof old.id === 'string' && old.id.trim()) e.id = old.id.trim();

  if (['ban', 'city', 'model', 'default', 'manual', 'venue', 'feed'].includes(old.geoSource)) e.geoSource = old.geoSource;
  if (['ok', 'unverified'].includes(old.urlStatus)) e.urlStatus = old.urlStatus;
  if (isValidIsoDate(old.urlCheckedAt)) e.urlCheckedAt = old.urlCheckedAt;
  // When a source last confirmed this event. Absent on records stored before 23 September; those
  // are dated on first sight rather than reported as stale on day one.
  e.lastSeen = isValidIsoDate(old.lastSeen) ? old.lastSeen : ctx.today;
  // Carry the English description over; translateDescriptions() re-checks it against the French
  // text and replaces it if that text has changed.
  if (typeof old.descriptionEn === 'string' && old.descriptionEn.trim()) e.descriptionEn = cleanText(old.descriptionEn, 600);
  if (old.image) e.image = cleanUrl(old.image) || undefined;
  if (['datatourisme', 'openagenda', 'site'].includes(old.source)) e.source = old.source;

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
/** True when `next` points at the same site as `current` but at a more specific page. */
function deeperOnSameHost(current, next) {
  try {
    const a = new URL(current), b = new URL(next);
    if (a.hostname.replace(/^www\./, '') !== b.hostname.replace(/^www\./, '')) return false;
    const depth = (u) => u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
    return depth(b) > depth(a);
  } catch {
    return false;
  }
}

function mergeInto(target, incoming) {
  for (const f of ['endDate', 'schedule', 'price']) {
    if (incoming[f]) target[f] = incoming[f];
  }
  for (const f of ['description', 'organizer', 'locationName', 'city']) {
    if (!target[f] && incoming[f]) target[f] = incoming[f];
  }
  // Keep a URL that already verified fine (stable across runs); otherwise adopt the newly reported one,
  // unless it is a temporary Google grounding redirect.
  //
  // The one exception is a deeper path on the same host: merging "Le panache des Lumieres" kept
  // the chateau home page and threw away the page of the exhibition itself, because the home
  // page happened to be the one already verified. Same host means no new trust decision, and a
  // longer path is strictly more precise, so it is adopted and re-verified on the next run.
  if (incoming.url && incoming.url !== target.url && !isGroundingRedirect(incoming.url)
      && (target.urlStatus !== 'ok' || deeperOnSameHost(target.url, incoming.url))) {
    target.url = incoming.url;
    delete target.urlStatus;
    delete target.urlCheckedAt;
  }
}

/**
 * An organiser's own site confirms an event we already hold (§3.Z2). Unlike mergeInto(), used
 * when a source re-reports its own record, this NEVER touches the dates: one dated performance
 * read on the site must not shorten a multi-day record it matched. It takes what the site knows
 * better:
 *   - a link to the event's own page when ours is a home page, or a deeper page on the same site;
 *   - a postal address when our position is only approximate (the next step re-geocodes it);
 *   - whatever we left blank.
 * And it marks the record as confirmed by a legitimate source (`source: 'site'`), which is what
 * the grounding exit criterion counts (decision of 24 September).
 */
function enrichFrom(target, incoming) {
  const isHome = (u) => { try { return ['', '/'].includes(new URL(u).pathname.replace(/\/(fr|en)\/?$/, '/')); } catch { return false; } };
  if (incoming.url && incoming.url !== target.url && !isGroundingRedirect(incoming.url)
      && (target.urlStatus !== 'ok' || isHome(target.url) || deeperOnSameHost(target.url, incoming.url))) {
    target.url = incoming.url;
    delete target.urlStatus;
    delete target.urlCheckedAt;
  }
  const precise = ['ban', 'manual', 'venue', 'feed'].includes(target.geoSource);
  if (!precise && incoming.locationName && /\d/.test(incoming.locationName) && incoming.locationName !== target.locationName) {
    target.locationName = incoming.locationName;
    target.geoSource = undefined;   // re-resolved by step 4 from the new address
  }
  for (const f of ['schedule', 'price', 'organizer', 'description', 'locationName']) {
    if (!target[f] && incoming[f]) target[f] = incoming[f];
  }
  if (!target.source) target.source = 'site';
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
- Rayon accepté : ${CONFIG.maxRadiusKm} km autour de Fontainebleau. Un événement au-delà sera écarté.
- Communes concernées : ${COMMUNES.join(', ')}.
- Cette liste n'est pas limitative : toute commune dans le rayon convient.

SOURCES À EXPLORER EN PRIORITÉ :
1. Office de Tourisme du Pays de Fontainebleau (agenda).
2. Agendas municipaux des mairies : Fontainebleau, Avon, Barbizon, Moret-sur-Loing, Nemours.
3. Programmations des châteaux : Fontainebleau, Vaux-le-Vicomte, Blandy-les-Tours.
4. Plateformes d'inscriptions sportives & associatives : HelloAsso, KMS, Klikego, ProTiming, Sporkrono, Adeorun.
5. Calendriers fédéraux et de clubs : Fédération Française d'Athlétisme (calendrier Seine-et-Marne), FFRandonnée 77, FFCT/FFVélo 77, sites des clubs locaux.
6. Presse et magazines locaux : Le Bellifontain, La République de Seine-et-Marne.

RÈGLES DE QUALITÉ (très importantes) :
- N'invente rien. Si la date, le lieu ou l'URL d'un événement n'est pas confirmé par une source, ignore cet événement.
- "url" : adresse directe de la page de l'événement (ou de l'organisateur), jamais une page de résultats de recherche ni un lien de redirection.
- Dates au format YYYY-MM-DD ; pour un événement d'un seul jour, endDate = startDate.
- Aucun marqueur de citation ([1], [2]…) ni HTML dans les valeurs.
- "schedule" : uniquement les horaires (ex: "10h–18h"), sans répéter la date ; s'ils diffèrent selon les jours, précise-les jour par jour avec la date (ex: "sam. 12 : 10h–18h ; dim. 13 : 10h–17h"). Ne mets JAMAIS un jour de la semaine sans la date correspondante.
- "description" : une phrase, 200 caractères maximum.
- "lat" / "lng" : coordonnées GPS du lieu si tu les connais avec certitude, sinon null.
- "ageMin" / "ageMax" : âges conseillés (0 et 99 si tout public).
- "category" : UNIQUEMENT l'une de ces quatre valeurs : "Sport & Outdoor", "Nature & Environnement", "Scène & Spectacles" (concerts, théâtre, opéra, cinéma, festivals), "Culture & Ateliers" (expositions, visites, patrimoine, ateliers, brocantes).
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

// ───────────────────────────── Venue gazetteer ─────────────────────────────

/**
 * A hand-written list of the places that come back scan after scan (§3.R).
 *
 * The BAN is an ADDRESS base. Asked for "Théâtre municipal de Fontainebleau" it finds nothing,
 * because that is a name, not an address — which is why 80% of positions were approximate while
 * a handful of venues carried most of the events. Resolved once, by hand, they stay resolved.
 */
let venueIndex = null;

function loadVenues() {
  if (venueIndex) return venueIndex;
  const raw = loadJson(CONFIG.venuesPath, null);
  const list = Array.isArray(raw?.venues) ? raw.venues : [];
  venueIndex = [];
  for (const v of list) {
    const lat = toNum(v.lat), lng = toNum(v.lng);
    // A gazetteer entry outside the region is a typo, and a typo here would be published as an
    // exact position — the one thing this file must never do.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBbox(lat, lng)) continue;
    const words = Array.isArray(v.match) ? v.match.map((w) => norm(w)).filter(Boolean) : [];
    if (!words.length || !v.city) continue;
    venueIndex.push({ label: v.label || words.join(" "), city: norm(v.city), words, lat: round5(lat), lng: round5(lng) });
  }
  return venueIndex;
}

/**
 * The most specific entry whose city matches and whose every word appears in the venue name.
 * Most words wins, so a precise entry beats a looser one that also matches.
 */
function matchVenue(event) {
  const name = norm(event.locationName);
  const city = norm(event.city);
  if (!name || !city) return null;
  let best = null;
  for (const v of loadVenues()) {
    if (v.city !== city) continue;
    if (!v.words.every((w) => name.includes(w))) continue;
    if (!best || v.words.length > best.words.length) best = v;
  }
  return best;
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

  // The gazetteer comes first: it is hand-checked, so it outranks anything a lookup can guess,
  // and it costs no request at all.
  const venue = matchVenue(e);
  if (venue) return setGeo(e, venue.lat, venue.lng, 'venue');

  // Then a coordinate the source itself declared: more reliable than a fuzzy name lookup, and
  // it costs no request.
  if (rec.modelCoords?.precise) return setGeo(e, rec.modelCoords.lat, rec.modelCoords.lng, 'feed');

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
  'organizer', 'description', 'descriptionEn', 'url', 'urlStatus', 'urlCheckedAt', 'image', 'source', 'lastSeen', 'pageUrl',
];

function serializeEvent(e) {
  const out = { ...e, geoApprox: !['ban', 'manual', 'venue', 'feed'].includes(e.geoSource) };
  // Derived, never carried over: the static page's address follows the current title (§3.X).
  out.pageUrl = pages.pagePath(out) || undefined;
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
  if (stats.sites) {
    const st = stats.sites;
    if (st.error) {
      L.push(`- 🏛️ Sites des organisateurs : ❌ ${String(st.error).slice(0, 160)} (les autres sources sont conservées)`);
    } else {
      const ok = st.perSource.filter((r) => r.status === 'ok');
      L.push(`- 🏛️ Sites des organisateurs (sans grounding) : ${ok.length} lu(s) → **${st.records}** fiche(s) · **${stats.siteConfirmed}** événement(s) confirmé(s) et enrichi(s) · ${st.long} offre(s) permanente(s) jamais ajoutée(s)${stats.siteInsideSpan ? ` · ${stats.siteInsideSpan} date(s) d'un événement déjà publié sur plusieurs jours` : ''}`);
      L.push(`  - ${st.perSource.map((r) => `${r.id} ${r.status === 'ok' ? r.events : r.status === 'disabled' ? '⏸' : '❌'}`).join(' · ')}`);
      for (const r of st.perSource.filter((x) => x.status === 'error' || x.status === 'robots')) L.push(`  - ⚠️ ${r.id} : ${String(r.error).slice(0, 140)}`);
      const siteRej = Object.entries(stats.siteRejected);
      if (siteRej.length) L.push(`  - rejetées : ${siteRej.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      const en = st.enrich || {};
      if (en.asked || en.error) L.push(`  - fiches de l'office complétées : ${en.asked} nouvelle(s), ${en.cached} en cache${en.error ? ` — ⚠️ ${String(en.error).slice(0, 120)}` : ''} · tokens ${en.tokensIn} in / ${en.tokensOut} out (non grounded)`);
    }
  }
  if (stats.oa) {
    if (stats.oa.error) {
      L.push(`- 📅 OpenAgenda: ❌ ${String(stats.oa.error).slice(0, 160)} (les autres sources sont conservées)`);
    } else {
      L.push(`- 📅 OpenAgenda (${stats.oa.agendas} agenda(s)) : ${stats.oa.total} bruts → ${stats.oa.excludedAgendas} agenda(s) emploi écarté(s)${stats.oa.cancelled ? `, ${stats.oa.cancelled} annulé(s)` : ''} → **${stats.oa.records}** fiche(s), ${stats.oaDeduped} doublon(s) d'une autre source`);
      const oaRej = Object.entries(stats.oaRejected);
      if (oaRej.length) L.push(`  - rejected at validation: ${oaRej.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }
  if (stats.crossCityDeduped) {
    L.push(`- 🧹 Doublons fusionnés (même titre, même date, ville différente) : **${stats.crossCityDeduped}**`);
  }
  const jd = stats.judged;
  if (jd && !jd.skipped) {
    if (jd.error && !jd.candidates) L.push(`- 🧩 Doublons jugés : ⚠️ ${String(jd.error).slice(0, 160)}`);
    else {
      L.push(`- 🧩 Doublons jugés (titres « frères », §3.W2) : **${jd.merged.length}** fusionné(s) · ${jd.distinct} jugé(s) distinct(s) · ${jd.candidates} paire(s) examinée(s) · ${jd.asked} nouveau(x) verdict(s)${jd.pending ? ` · ${jd.pending} en attente` : ''}${jd.error ? ` · ⚠️ ${String(jd.error).slice(0, 120)}` : ''}`);
      for (const m of jd.merged.slice(0, 12)) L.push(`  - ${m}`);
      if (jd.merged.length > 12) L.push(`  - … et ${jd.merged.length - 12} autre(s)`);
      if (jd.merged.length) L.push('  Une fusion à défaire : `"keepSeparate": ["EVT_…"]` sur l’un des deux ids dans overrides.json.');
      if (jd.asked) L.push(`  - tokens : ${jd.tokensIn} in / ${jd.tokensOut} out (appel non grounded)`);
    }
  }
  if (stats.umbrellas && stats.umbrellas.length) {
    L.push(`- ☂️ Titres emboîtés dans PLUSIEURS sur-titres (parapluie : jamais fusionné, à trancher à la main) : ${stats.umbrellas.length}`);
    for (const u of stats.umbrellas.slice(0, 8)) L.push(`  - ${u}`);
    if (stats.umbrellas.length > 8) L.push(`  - … et ${stats.umbrellas.length - 8} autre(s)`);
  }
  if (stats.similarSameDay.length) {
    L.push(`- 🔎 Titres proches le même jour, non fusionnés : ${stats.similarSameDay.length}`);
    L.push('  Chaque paire porte un mot que l\'autre n\'a pas — impossible de distinguer une');
    L.push('  reformulation d\'un vrai sous-événement. Pour en masquer un : copier son id dans');
    L.push('  overrides.json avec `"hidden": true`.');
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
    if (ov.unmatched.length) {
      L.push(`  - ℹ️ sans correspondance ce run : ${ov.unmatched.slice(0, 10).join(', ')}${ov.unmatched.length > 10 ? '…' : ''}`);
      L.push("    Normal pour un masquage déjà appliqué : la fiche a disparu, mais l'entrée doit");
      L.push('    rester, sinon une source la re-signalerait au prochain scan. À supprimer seulement');
      L.push("    si l'événement est définitivement sorti de la fenêtre de 3 mois.");
    }
    if (ov.badFields.length) L.push(`  - ⚠️ ignorées, valeur ou champ invalide : ${ov.badFields.slice(0, 10).join(', ')}${ov.badFields.length > 10 ? '…' : ''}`);
  }
  L.push(`- New events added: **${stats.added}** · refreshed: **${stats.refreshed}** · past events pruned: **${stats.pruned}**`);
  if (stats.vanishedFromFeed.length) {
    L.push(`- 🔎 **Disparu(s) d’un flux qui a pourtant bien répondu : ${stats.vanishedFromFeed.length}** — candidat(s) sérieux à une annulation`);
    for (const v of stats.vanishedFromFeed.slice(0, 8)) L.push(`  - ${v}`);
    if (stats.vanishedFromFeed.length > 8) L.push(`  - … et ${stats.vanishedFromFeed.length - 8} autre(s)`);
    L.push(`  Vérifier auprès de l’organisateur, puis masquer via overrides.json si confirmé.`);
  }
  if (stats.unconfirmed.length) {
    L.push(`- 🕰️ Sans confirmation depuis plus de ${CONFIG.staleAfterDays} jours : ${stats.unconfirmed.length} (information, pas alerte : la recall du modèle varie)`);
    for (const v of stats.unconfirmed.slice(0, 5)) L.push(`  - ${v}`);
    if (stats.unconfirmed.length > 5) L.push(`  - … et ${stats.unconfirmed.length - 5} autre(s)`);
  }
  if (stats.tooFar) {
    const villes = Object.entries(stats.tooFarCities).sort((a, b) => b[1] - a[1]).slice(0, 8);
    L.push(`- 📍 Hors rayon (> ${CONFIG.maxRadiusKm} km) : **${stats.tooFar}** écarté(s) — ${villes.map(([c, n]) => `${c} (${n})`).join(", ")}`);
  }
  if (stats.recategorised) {
    L.push(`- 🏷️ Reclassé(s) en « Scène & Spectacles » : **${stats.recategorised}**`);
  }
  L.push(`- Total published: **${stats.total}**`);
  const tr = stats.translation;
  if (tr) {
    if (tr.error) L.push(`- 🌍 Descriptions anglaises : ⚠️ ${String(tr.error).slice(0, 160)} (cartes en français)`);
    else if (tr.skipped) L.push(`- 🌍 Descriptions anglaises : désactivées (${tr.skipped})`);
    else {
      L.push(`- 🌍 Descriptions anglaises : **${tr.fromCache}** en cache · **${tr.translated}** traduite(s) en ${tr.batches} lot(s) · ${tr.failed} échec(s)${tr.pruned ? ` · ${tr.pruned} entrée(s) de cache purgée(s)` : ''}`);
      if (tr.translated) L.push(`  - tokens : ${tr.tokensIn} in / ${tr.tokensOut} out (appel non grounded, hors problème §3.G)`);
      for (const e of tr.errors) L.push(`  - ⚠️ ${e}`);
    }
  }
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
 * every source) every time — self-healing, not a one-off cleanup: a duplicate introduced by a
 * future scan is removed by the run after it, automatically.
 *
 * Two rules, in order:
 *
 *   1. IDENTICAL word sets, same date. Ignores city, because the same venue is routinely filed
 *      under two communes (Vaux-le-Vicomte sits in Maincy).
 *   2. NESTED titles, same date AND same city. "La Thomeryonne" inside "Course à pied La
 *      Thomeryonne" is one race named at two lengths.
 *
 * The discriminator between rule 2 and a genuinely distinct sub-event is how MANY longer titles
 * a short title sits inside:
 *
 *   - exactly one  -> the same event, named short and long          -> merge
 *   - two or more  -> an umbrella over distinct sub-events          -> never merge, report
 *
 * That is what keeps "Meeting d'Automne TDA" from swallowing its "Poneys" and "Équitation"
 * variants: it sits inside both, so it is left alone. It is the same trap §3.J was written
 * around, now caught by structure rather than by refusing to look at nesting at all.
 */
function dedupeFuzzy(records, stats) {
  const CONNECTOR_WORDS = new Set([
    'le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'au', 'aux', 'a', 'en', 'et',
    'un', 'une', 'ou', 'par', 'pour', 'sur', 'avec', 'chateau',
  ]);

  // Words that name an *instance* of a recurring event rather than the event itself. Two scans
  // reporting "Trail du Mont Sarrazin", "… 2026" and "… (14e édition)" are reporting one race.
  const isInstanceNoise = (w) => /^(?:19|20)\d{2}$/.test(w)      // a year
    || /^\d+(?:er|ere|eme|emes|e|es)$/.test(w)                    // 1er, 5e, 14e, 2eme
    || /^editions?$/.test(w);

  // French plural, trimmed only on words long enough that dropping the letter cannot collapse
  // two genuinely different ones. "Soirées" and "Soirée" were failing to match on this alone.
  const singular = (w) => (w.length >= 5 && /[sx]$/.test(w) ? w.slice(0, -1) : w);

  function significantWords(title) {
    return norm(title).split(' ')
      .filter((w) => w.length > 1 && !CONNECTOR_WORDS.has(w) && !isInstanceNoise(w))
      .map(singular);
  }
  const wordSet = (title) => new Set(significantWords(title));
  const nestedIn = (a, b) => a.size < b.size && [...a].every((w) => b.has(w));

  /** The tie-break that decides which record of a duplicate pair survives (its id is kept). */
  function preferred(a, b) {
    // An already-stored record beats a brand-new one: stable id, URL already verified.
    if (a.isNew !== b.isNew) return a.isNew ? b : a;
    const aOk = a.event.urlStatus === 'ok', bOk = b.event.urlStatus === 'ok';
    if (aOk !== bOk) return aOk ? a : b;
    // Among ties, the legacy ACT_ id is the older record, more likely to be linked to.
    const aLegacy = /^ACT_/.test(a.event.id || ''), bLegacy = /^ACT_/.test(b.event.id || '');
    if (aLegacy !== bLegacy) return aLegacy ? a : b;
    return a; // insertion order, which is deterministic
  }

  /**
   * Fold `loser` into `winner`. The winner keeps its id — overrides.json is keyed by id, and a
   * correction must not be orphaned by a merge — but the two titles are judged on their own:
   *
   *   - one title carries MORE content words -> keep it. "Course à pied La Thomeryonne" tells a
   *     visitor (especially one reading the English interface) what the event is; "La
   *     Thomeryonne" alone only works if you already know.
   *   - both say the same thing -> keep the SHORTER one, which is the one without the "(14e
   *     édition)" or "2026" clutter that made them look like different events in the first place.
   */
  function absorb(winner, loser) {
    const wWin = wordSet(winner.event.title), wLose = wordSet(loser.event.title);
    const sameContent = wWin.size === wLose.size && [...wWin].every((w) => wLose.has(w));
    const takeLoser = nestedIn(wWin, wLose)
      || (sameContent && loser.event.title.length < winner.event.title.length);
    const title = takeLoser ? loser.event.title : winner.event.title;
    mergeInto(winner.event, loser.event);
    winner.event.title = title;
    if (!winner.modelCoords && loser.modelCoords) winner.modelCoords = loser.modelCoords;
    winner.refreshed = true;
    stats.crossCityDeduped++;
  }

  // ── Rule 1: identical word sets on the same date ────────────────────────────
  // A signature of a single word is too weak to merge across cities ("Exposition" in Nemours is
  // not "Exposition" in Barbizon), so a one-word title only groups with its own commune.
  // A title left with no significant word at all never merges.
  function signature(event, uniqueFallback) {
    const words = [...wordSet(event.title)].sort();
    if (!words.length) return `__unique__${uniqueFallback}`;
    return words.length >= 2 ? words.join(' ') : `${words[0]}|${norm(event.city)}`;
  }

  // Grouped by word set alone; the date rule is applied inside the group, because two records
  // of the same exhibition can disagree on its first day while agreeing on its last.
  const byWordSet = new Map();
  for (const [key, rec] of records) {
    const k = signature(rec.event, key);
    if (!byWordSet.has(k)) byWordSet.set(k, []);
    byWordSet.get(k).push(rec);
  }

  const isSpan = (e) => Boolean(e.endDate) && e.endDate > e.startDate;
  const overlaps = (a, b) => a.startDate <= (b.endDate || b.startDate)
    && b.startDate <= (a.endDate || a.startDate);

  /**
   * Same day, or two multi-day runs that overlap.
   *
   * The span condition is what allows "Exposition Le panache des Lumières" (19 September →
   * 25 January) and "Exposition « Le panache des Lumières »" (20 September → 25 January) to
   * meet. It is deliberately refused for single-day records: two performances of the same show
   * on two different evenings are two events, and merging them would delete one (§3.I).
   */
  const sameOccasion = (a, b) => a.startDate === b.startDate
    || (isSpan(a) && isSpan(b) && overlaps(a, b));

  for (const group of byWordSet.values()) {
    if (group.length < 2) continue;
    // Within a word-set group, gather the records that share an occasion.
    const pending = [...group];
    while (pending.length > 1) {
      const head = pending.shift();
      const together = pending.filter((rec) => sameOccasion(head.event, rec.event));
      if (!together.length) continue;
      const cluster = [head, ...together];
      const winner = cluster.reduce(preferred);
      for (const rec of cluster) {
        if (rec === winner) continue;
        absorb(winner, rec);
        records.delete(eventKey(rec.event));
        const at = pending.indexOf(rec);
        if (at !== -1) pending.splice(at, 1);
      }
      // The winner is either the head, whose partners are now all absorbed, or a record still
      // in the queue that will get its own turn. Either way it is not re-queued here.
    }
  }

  // ── Rule 2: nested titles, same date and same city ──────────────────────────
  // Iterative, because absorbing a middle-length title can leave the shortest one with a single
  // superset where it previously had two ("Concours de saut d'obstacles" sits inside both the
  // "Militaire" and the "Équestre Militaire" variants, and those two are themselves nested).
  stats.umbrellas = [];
  const reported = new Set();
  let live = [...records.values()].map((rec) => ({ rec, w: wordSet(rec.event.title), city: norm(rec.event.city) }))
    .filter((n) => n.w.size);

  for (let pass = 0; pass < live.length + 1; pass++) {
    live.sort((a, b) => a.w.size - b.w.size);
    let merged = false;
    for (const node of live) {
      const supersets = live.filter((o) => o !== node
        && o.city === node.city
        && o.rec.event.startDate === node.rec.event.startDate
        && nestedIn(node.w, o.w));
      if (!supersets.length) continue;
      // Only the MINIMAL supersets count: a chain A ⊂ B ⊂ C is one nesting, not two.
      const minimal = supersets.filter((b) => !supersets.some((c) => c !== b && nestedIn(c.w, b.w)));
      if (minimal.length !== 1) {
        const id = node.rec.event.id;
        if (!reported.has(id)) {
          reported.add(id);
          stats.umbrellas.push(
            `${node.rec.event.title} ⊂ ${minimal.map((m) => m.rec.event.title).join(' + ')} (${node.rec.event.startDate})`
          );
        }
        continue;
      }
      const winner = preferred(node.rec, minimal[0].rec);
      const loser = winner === node.rec ? minimal[0].rec : node.rec;
      absorb(winner, loser);
      records.delete(eventKey(loser.event));
      live = live.filter((n) => n.rec !== loser);
      // The winner may have adopted a longer title, so its word set has to be recomputed.
      const w = live.find((n) => n.rec === winner);
      if (w) w.w = wordSet(winner.event.title);
      merged = true;
      break;
    }
    if (!merged) break;
  }

  // absorb() rewrites titles, and the title is one third of eventKey(). Re-key so the map never
  // holds a record under a key that no longer describes it.
  const rekeyed = new Map();
  for (const rec of records.values()) {
    const key = eventKey(rec.event);
    const known = rekeyed.get(key);
    if (!known) { rekeyed.set(key, rec); continue; }
    absorb(known, rec);
  }
  records.clear();
  for (const [key, rec] of rekeyed) records.set(key, rec);

  // ── Report only: same day, similar but neither identical nor nested ─────────
  // Jaccard over the same word sets. Rules 1 and 2 have already removed everything they are
  // willing to touch, so what is left here is genuinely ambiguous and belongs to a human.
  function jaccard(a, b) {
    const wa = wordSet(a), wb = wordSet(b);
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
          // With the ids, deciding on a pair is one paste into overrides.json rather than a
          // hunt through data.json.
          stats.similarSameDay.push(
            `${list[i].event.startDate} — \`${list[i].event.id}\` « ${list[i].event.title} »`
            + ` ↔ \`${list[j].event.id}\` « ${list[j].event.title} »`
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
    oa: null, oaRejected: {}, oaDeduped: 0, tooFar: 0, tooFarCities: {},
    sites: null, siteRejected: {}, siteConfirmed: 0, siteLongSkipped: 0, siteInsideSpan: 0,
    unconfirmed: [], vanishedFromFeed: [], recategorised: 0,
    umbrellas: [],
    overrides: { applied: 0, hidden: 0, merged: 0, details: [], unmatched: [], badFields: [] },
    feedback: null, translation: null,
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

  // 1c. OpenAgenda — local associations, the gap Gemini and DATAtourisme both miss ─────
  let oaRaw = [];
  if (CONFIG.openagenda) {
    console.log('📅 OpenAgenda…');
    try {
      const loaded = await openagenda.load({ today, windowEnd: maxDate });
      oaRaw = openagenda.toPipelineEvents(loaded.kept, ctx);
      stats.oa = {
        total: loaded.meta.total,
        excludedAgendas: loaded.meta.excludedAgendas,
        cancelled: loaded.meta.cancelled,
        kept: loaded.kept.length,
        records: oaRaw.length,
        agendas: loaded.meta.agendas.length,
      };
      console.log(`   → ${loaded.meta.total} bruts, ${loaded.meta.excludedAgendas} agenda(s) emploi écarté(s) → ${oaRaw.length} fiche(s)`);
    } catch (err) {
      stats.oa = { error: err.message };
      console.error(`   ❌ OpenAgenda failed: ${String(err.message).slice(0, 300)}`);
    }
  }

  // 1d. Organisers' own sites — read without grounding (§3.Z2) ──────────
  // A site that fails is reported and skipped, like a feed: never fatal.
  let siteRaw = [];
  if (CONFIG.sites) {
    console.log('🏛️ Sites des organisateurs…');
    try {
      const results = await sites.load(ctx);
      const read = results.flatMap((r) => r.events);
      const enriched = await sites.enrich(read, { dryRun: CONFIG.dryRun, today });
      siteRaw = sites.toPipelineEvents(read, ctx);
      stats.sites = {
        perSource: results.map((r) => ({ id: r.id, status: r.status, events: r.events.length, error: r.error || r.skipped || r.note || '' })),
        records: siteRaw.length,
        long: siteRaw.filter((e) => e.long).length,
        enrich: enriched,
      };
      console.log(`   → ${read.length} événement(s) lus sur ${results.filter((r) => r.status === 'ok').length} site(s) → ${siteRaw.length} fiche(s)`);
    } catch (err) {
      stats.sites = { error: err.message };
      console.error(`   ❌ Sites: ${String(err.message).slice(0, 300)}`);
    }
  }

  // A source failing is survivable as long as one of them produced something: events are pruned
  // by date only, never by absence, so a partial failure deletes nothing.
  if (okScans === 0 && dtRaw.length === 0 && oaRaw.length === 0 && siteRaw.length === 0) {
    throw new Error('Every source failed (Gemini, DATAtourisme, OpenAgenda) — data.json left untouched');
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

  const validOa = [];
  for (const raw of oaRaw) {
    const v = validateEvent(raw, ctx);
    if (v.ok) validOa.push(v);
    else bump(stats.oaRejected, v.reason);
  }
  if (oaRaw.length) console.log(`🧹 ${validOa.length}/${oaRaw.length} OpenAgenda records valid`);

  const validSite = [];
  for (const raw of siteRaw) {
    const v = validateEvent(raw, ctx);
    if (v.ok) { v.long = raw.long === true; validSite.push(v); } else bump(stats.siteRejected, v.reason);
  }
  if (siteRaw.length) console.log(`🧹 ${validSite.length}/${siteRaw.length} site records valid`);

  if (validNew.length === 0 && validDt.length === 0 && validOa.length === 0 && validSite.length === 0) {
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
  const addRecord = (v, { fuzzy = false, counter = 'dtDeduped', confirm = false, addNew = true } = {}) => {
    const key = eventKey(v.event);
    const known = records.get(key);
    if (known && confirm) {
      enrichFrom(known.event, v.event);
      known.refreshed = true;
      known.event.lastSeen = today;
      stats[counter]++;
      return;
    }
    if (known) {
      mergeInto(known.event, v.event);
      if (!known.modelCoords && v.modelCoords) known.modelCoords = v.modelCoords;
      known.refreshed = true;
      known.event.lastSeen = today;   // a source confirmed it again
      known.seenBy = v.event.source || known.seenBy;
      return;
    }
    // Two sources phrase the same event differently ("Concert de musique classique" vs "Concert
    // classique à Nemours"), and the exact key would miss it. Only the second source pays the
    // cost of this scan, and the incumbent record wins: it has already passed URL verification.
    if (fuzzy) {
      for (const rec of records.values()) {
        if (!datatourisme.isSameOccurrence(v.event, rec.event)) continue;
        stats[counter]++;
        if (confirm) {
          enrichFrom(rec.event, v.event);
          rec.refreshed = true;
          rec.event.lastSeen = today;
        }
        return;
      }
    }
    // A standing offer read on a site (a museum's six-month opening, the château's little train)
    // may confirm an event we hold, but is never announced as a new one.
    if (!addNew) { stats.siteLongSkipped++; return; }
    v.event.id = eventId(key);
    v.event.lastSeen = today;
    records.set(key, { event: v.event, modelCoords: v.modelCoords, isNew: true });
  };

  for (const v of validNew) addRecord(v);
  for (const v of validDt) addRecord(v, { fuzzy: true });
  // Last in, so an event already reported by Gemini or DATAtourisme keeps its verified URL;
  // only the newcomer pays the cost of the fuzzy comparison.
  for (const v of validOa) addRecord(v, { fuzzy: true, counter: 'oaDeduped' });
  // Last of all: a site record first tries to confirm and enrich what is already there; only
  // what nothing matches becomes a new event. Wording that differs more than isSameOccurrence()
  // tolerates is caught by the judged dedupe below, which keeps the stored record as winner.
  for (const v of validSite) addRecord(v, { fuzzy: true, counter: 'siteConfirmed', confirm: true, addNew: !v.long });

  // A site that lists, date by date, an event we already hold as one span: the tourist office
  // gave "Sauvages !" on 10-11 October while we had the festival 9-11 October, and the judged
  // dedupe (rightly cautious: "a programme and one of its dates are two things") kept both.
  // A NEW site record whose dates sit inside an existing span, with a matching title and town,
  // confirms that span instead. Only new site records: an event a site merely confirmed is
  // never folded into a larger one here.
  const contains = (outer, inner) => outer.endDate > outer.startDate
    && outer.startDate <= inner.startDate && (inner.endDate || inner.startDate) <= outer.endDate;
  for (const [key, rec] of [...records]) {
    if (!rec.isNew || rec.event.source !== 'site') continue;
    const host = [...records.values()].find((o) => o !== rec && !o.isNew
      && contains(o.event, rec.event) && matchLevel(o.event, rec.event));
    if (!host) continue;
    enrichFrom(host.event, rec.event);
    host.refreshed = true;
    host.event.lastSeen = today;
    records.delete(key);
    stats.siteInsideSpan++;
  }

  // One classifier over the whole merged set: DATAtourisme maps almost everything to Culture
  // (its ontology has no stage class), OpenAgenda guesses from keywords, Gemini is told the enum.
  // Left as is, the three would drift apart.
  for (const rec of records.values()) {
    const refined = refineCategory(rec.event);
    if (refined !== rec.event.category) {
      rec.event.category = refined;
      stats.recategorised++;
    }
  }

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

  // Sibling titles that no word rule can settle (§3.W2): judged by Gemini without grounding,
  // verdicts cached. After the feedback merge so a record hidden today is never merged into.
  try {
    stats.judged = await dedupeJudge.run(records, { overrides: effective, eventKey, mergeInto, enrichFrom, today, dryRun: CONFIG.dryRun });
    const j = stats.judged;
    if (!j.skipped) console.log(`🧩 Doublons jugés : ${j.candidates} paire(s) candidate(s), ${j.merged.length} fusion(s), ${j.asked} nouveau(x) verdict(s)${j.error ? ` — ⚠️ ${j.error}` : ''}`);
  } catch (err) {
    stats.judged = { error: err.message, merged: [] };
    console.error(`   ⚠️ dedupe-judge: ${String(err.message).slice(0, 200)} (run continues)`);
  }

  applyOverrides(records, effective, stats);

  const all = [...records.values()];

  // 4. Geocode (anything not yet resolved by BAN) ───────────────────────
  // Anything not already exact is re-resolved: that is how a venue added to venues.json today
  // fixes every stored event at that address on the next run, with no manual pass.
  const toGeocode = all.filter((r) => !['ban', 'venue', 'manual', 'feed'].includes(r.event.geoSource)
    || r.event.lat === null);
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
    // Applied here, after geocoding: an event is judged on where it actually is, not on the
    // coordinates a source claimed before we resolved them.
    const km = distanceKm(rec.event.lat, rec.event.lng);
    if (Number.isFinite(km) && km > CONFIG.maxRadiusKm) {
      stats.tooFar++;
      bump(stats.tooFarCities, rec.event.city || "?");
      continue;
    }
    if (rec.isNew) stats.added++; else if (rec.refreshed) stats.refreshed++;
    if (rec.event.urlStatus === 'unverified') stats.unverified++;
    bump(stats.geo, rec.event.geoSource);
    kept.push(rec.event);
  }
  kept.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'fr'));
  stats.total = kept.length;

  // 6a. Events no source has confirmed for a while ────────────────────────
  // Reported, never deleted: absence is not evidence (decision of 19 September). A feed that
  // loaded fine and dropped an event is a stronger signal than the model not mentioning it, so
  // the two are listed apart.
  const feedsHealthy = {
    datatourisme: Boolean(stats.dt && !stats.dt.error),
    openagenda: Boolean(stats.oa && !stats.oa.error),
  };
  for (const e of kept) {
    const age = daysBetween(e.lastSeen || today, today);
    if (age < CONFIG.staleAfterDays) continue;
    const entry = `${e.id} — ${e.title} (${e.startDate}, vu le ${e.lastSeen || "?"})`;
    if (e.source && feedsHealthy[e.source]) stats.vanishedFromFeed.push(entry);
    else stats.unconfirmed.push(entry);
  }

  // 6b. English descriptions ─────────────────────────────────────────────
  // Last, on the set that is actually going to be published: nothing is paid for on a record
  // that was about to be dropped as a duplicate, a dead link or a past event.
  try {
    stats.translation = await translate.translateDescriptions(kept, { dryRun: CONFIG.dryRun });
    const t = stats.translation;
    if (!t.skipped) console.log(`🌍 Traductions : ${t.fromCache} en cache, ${t.translated} nouvelle(s), ${t.failed} échec(s)`);
  } catch (err) {
    stats.translation = { error: err.message };
    console.error(`   ⚠️ traduction: ${String(err.message).slice(0, 200)} (run poursuivi, cartes en français)`);
  }

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
  main, validateEvent, fromExisting, extractJsonArray, extractText, eventKey, eventId, mergeInto, enrichFrom, dedupeFuzzy, serializeEvent,
  applyOverrides, coerceOverride, matchVenue, loadVenues, distanceKm, buildPrompt, SCANS, COMMUNES,
  refineCategory, CATEGORIES,
  renderSummary,
  addMonths, parisToday, isValidIsoDate, cleanText, cleanUrl, normalizeCategory, checkUrl, geocodeRecord,
  weekdayContradictsDates,
  CONFIG,
};