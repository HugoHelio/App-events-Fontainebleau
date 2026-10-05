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
  // A scan question answered without any web search is discarded (03/10). ALLOW_UNGROUNDED=1 lifts that,
  // only for a run where the metadata is known to be missing while the search did happen.
  allowUngrounded: process.env.ALLOW_UNGROUNDED === '1',
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

// Every commune whose centre is within CONFIG.maxRadiusKm of CENTER (geo.api.gouv.fr, departments
// 77, 91, 89, 45; computed 05/10): [name, km from CENTER, population]. Ordered by distance.
// Until 05/10 the list was derived from the published data (22/09, 23 names), which went in a
// circle: a village where nothing had ever been published was never named, so never searched —
// Grez-sur-Loing (10.5 km) and its open studios of 2-4 October. Recompute if the radius changes.
const COMMUNE_TABLE = [
  ['Avon', 2.7, 13651], ['Thomery', 5.3, 3384], ['Samoreau', 5.8, 2384],
  ['Vulaines-sur-Seine', 6.5, 2730], ['Samois-sur-Seine', 6.9, 2126],
  ['Bourron-Marlotte', 7.3, 2774], ['Héricy', 7.8, 2507], ['Bois-le-Roi', 8.0, 6072],
  ['Champagne-sur-Seine', 8.1, 6497], ['Recloses', 8.2, 633], ['Montigny-sur-Loing', 8.2, 2669],
  ['Barbizon', 8.8, 1261], ['Saint-Mammès', 9.0, 3162], ['Fontaine-le-Port', 9.8, 1025],
  ['Ury', 10.0, 882], ['Saint-Martin-en-Bière', 10.2, 746], ['La Genevraye', 10.2, 840],
  ['Féricy', 10.2, 625], ['Chailly-en-Bière', 10.2, 2162], ['Chartrettes', 10.4, 2633],
  ['Moret-Loing-et-Orvanne', 10.5, 12810], ['Grez-sur-Loing', 10.5, 1432],
  ['Arbonne-la-Forêt', 10.7, 1021], ['Villiers-sous-Grez', 10.7, 706],
  ['Vernou-la-Celle-sur-Seine', 11.1, 2630], ['Livry-sur-Seine', 11.4, 2226],
  ['Moncourt-Fromonville', 11.6, 1891], ['Achères-la-Forêt', 11.7, 1191],
  ['La Rochette', 12.1, 3932], ['Machault', 12.3, 815], ['Villiers-en-Bière', 12.7, 242],
  ['Fleury-en-Bière', 12.9, 652], ['Le Châtelet-en-Brie', 13.3, 4207], ['Villecerf', 13.4, 724],
  ['Vaux-le-Pénil', 13.6, 11474], ['Nonville', 13.6, 591], ['La Chapelle-la-Reine', 13.8, 2170],
  ['Dammarie-les-Lys', 13.9, 23559], ['Pamfou', 14.0, 983], ['La Grande-Paroisse', 14.1, 2893],
  ['Darvault', 14.1, 987], ['Perthes', 14.2, 2073], ['Villemer', 14.3, 759],
  ['Noisy-sur-École', 14.4, 1797], ['Cély', 14.6, 1259], ['Sivry-Courtry', 14.7, 1124],
  ['Le Vaudoué', 14.8, 731], ['Boissettes', 14.9, 437], ['Larchant', 14.9, 730],
  ['Valence-en-Brie', 15.2, 1007], ['Saint-Pierre-lès-Nemours', 15.5, 5401],
  ['Nemours', 15.5, 12889], ['Boissise-le-Roi', 15.8, 3941], ['Melun', 15.9, 45995],
  ['Treuzy-Levelay', 16.0, 458], ['Ville-Saint-Jacques', 16.0, 815],
  ['Saint-Germain-sur-École', 16.1, 365], ['Le Mée-sur-Seine', 16.2, 19527],
  ['Les Écrennes', 16.4, 628], ['Saint-Sauveur-sur-École', 16.4, 1125],
  ['Milly-la-Forêt', 16.5, 4562], ['Courances', 16.6, 348], ['Boissise-la-Bertrand', 16.6, 1206],
  ['Maincy', 16.9, 1828], ['Pringy', 17.0, 3864], ['Dormelles', 17.2, 816],
  ['Varennes-sur-Seine', 17.4, 3748], ['Châtillon-la-Borde', 17.7, 226], ['Amponville', 17.8, 349],
  ['Ormesson', 17.9, 242], ['Dannemois', 18.2, 865], ['Moisenay', 18.2, 1362],
  ['Oncy-sur-École', 18.2, 1042], ['Rubelles', 18.2, 3537], ['Forges', 18.4, 443],
  ['Nanteau-sur-Lunain', 18.4, 702], ['La Chapelle-Gauthier', 18.4, 1400],
  ['Noisy-Rudignon', 18.6, 580], ['Échouboulains', 18.7, 555], ['Boissy-aux-Cailles', 18.7, 272],
  ['Soisy-sur-École', 18.8, 1174], ['Chevrainvilliers', 18.8, 255], ['Poligny', 18.8, 825],
  ['Voisenon', 18.8, 1170], ['Guercheville', 18.9, 268], ['Tousson', 18.9, 334],
  ['Vert-Saint-Denis', 19.0, 9291], ['Blandy-les-Tours', 19.1, 763], ['Flagy', 19.1, 584],
  ['Nainville-les-Roches', 19.1, 564], ['Montereau-Fault-Yonne', 19.3, 22279],
  ['Villemaréchal', 19.4, 1055], ['Moigny-sur-École', 19.6, 1294], ['Faÿ-lès-Nemours', 19.7, 524],
  ['Châtenoy', 19.8, 155], ['Seine-Port', 19.9, 1742], ['Saint-Fargeau-Ponthierry', 20.0, 15724],
  ['Bagneaux-sur-Loing', 20.2, 1570], ['Cesson', 20.3, 11222],
];

// The zone is two rings (05/10, project lead's decision). Up to 15 km, every commune. From 15 to
// 20 km, only towns and the great sites: the radius alone let in hamlets 19 km away (a basketry
// course in Guercheville, lotos in Villemaréchal) while a smaller radius would lose Vaux-le-Vicomte
// (Maincy, 18.4 km) and the château de Blandy (19.3 km). Montereau is a town, but outside our area.
const INNER_RING_KM = 15;
const OUTER_RING_MIN_POPULATION = 4000;
const OUTER_RING_SITES = new Set(['Maincy', 'Blandy-les-Tours']);
const EXCLUDED_COMMUNES = new Set(['Montereau-Fault-Yonne']);

const communeLetters = (s) => stripAccents(String(s ?? '')).toLowerCase().replace(/[^a-z]/g, '');
const COMMUNE_BY_LETTERS = new Map(COMMUNE_TABLE.map((c) => [communeLetters(c[0]), c]));
COMMUNE_BY_LETTERS.set(communeLetters('Fontainebleau'), ['Fontainebleau', 0, 15583]);

/**
 * A commune name as a source wrote it → its official spelling, whatever the accents, hyphens or
 * spaces ("Dammarie-lès-Lys" and "Dammarie-les-Lys" were two towns in the city filter on 05/10).
 * A name that is not a commune of the radius (a hamlet, "Vaux-le-Vicomte", a typo) is kept as is.
 */
function canonicalCommune(city) {
  const hit = COMMUNE_BY_LETTERS.get(communeLetters(city));
  return hit ? hit[0] : city;
}

/** False for a commune of the table that the two-ring rule leaves out. Unknown names pass: the radius check on coordinates still applies to them. */
function inZone(city) {
  const c = COMMUNE_BY_LETTERS.get(communeLetters(city));
  if (!c) return true;
  if (EXCLUDED_COMMUNES.has(c[0])) return false;
  return c[1] <= INNER_RING_KM || c[2] >= OUTER_RING_MIN_POPULATION || OUTER_RING_SITES.has(c[0]);
}

// The communes named to the model: the zone, nothing outside it.
const COMMUNES = COMMUNE_TABLE.filter((c) => inZone(c[0]))
  .map((c) => (c[0] === 'Maincy' ? 'Maincy (Vaux-le-Vicomte)' : c[0]));

// The villages the "villages" scan names in its searches, by sector. The theme scans ask about
// "Fontainebleau (20 km)" and the search engine answers with Fontainebleau, Melun and Nemours:
// a village fête or open studios in Grez is never in those results. Since the two-step scan
// (04/10) the COMMUNES list above only reaches the formatting step, which does not search.
// Communes of the inner ring (≤ 15 km) plus Milly-la-Forêt, without the towns the feeds and theme
// scans already cover.
const VILLAGE_AREAS = [
  // Vallée du Loing
  ['Bourron-Marlotte', 'Recloses', 'Montigny-sur-Loing', 'Grez-sur-Loing', 'Villiers-sous-Grez',
    'La Genevraye', 'Moncourt-Fromonville', 'Nonville', 'Darvault', 'Larchant'],
  // Moret et la confluence
  ['Thomery', 'Champagne-sur-Seine', 'Saint-Mammès', 'Moret-Loing-et-Orvanne',
    'Vernou-la-Celle-sur-Seine', 'Villecerf', 'Villemer', 'La Grande-Paroisse', 'Pamfou', 'Machault'],
  // Bords de Seine
  ['Samoreau', 'Vulaines-sur-Seine', 'Samois-sur-Seine', 'Héricy', 'Fontaine-le-Port', 'Féricy',
    'Chartrettes', 'Bois-le-Roi', 'Livry-sur-Seine', 'La Rochette', 'Le Châtelet-en-Brie', 'Sivry-Courtry'],
  // Plaine de Bière
  ['Barbizon', 'Chailly-en-Bière', 'Saint-Martin-en-Bière', 'Arbonne-la-Forêt', 'Fleury-en-Bière',
    'Villiers-en-Bière', 'Cély', 'Perthes'],
  // Gâtinais et vallée de l'École (Tousson, Courances, the two École villages beyond 15 km: out
  // of the zone since 05/10)
  ['Ury', 'Achères-la-Forêt', 'La Chapelle-la-Reine', 'Noisy-sur-École', 'Le Vaudoué', 'Milly-la-Forêt'],
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
    // Step 1 of the scan (§7, 04/10): the short question asked with the search tool.
    ask: 'trails, courses, randonnées organisées et concours sportifs (dont le Grand Parquet)',
  },
  {
    name: 'nature',
    label: 'Nature & Environnement',
    focus:
      'Sorties guidées en forêt, visites botaniques, observation (brame du cerf, oiseaux), ' +
      'animations nature, ateliers environnement, journées du patrimoine naturel.',
    ask: 'sorties nature guidées, observations de la faune, visites botaniques et animations nature',
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
    ask: 'expositions, concerts, spectacles, visites guidées et conférences (dont les châteaux)',
  },
  {
    name: 'famille',
    label: 'Famille & loisirs',
    focus:
      'Ateliers enfants, spectacles jeune public, brocantes, marchés du terroir, fêtes locales, ' +
      'animations d\'automne et de fin d\'année, activités à faire en famille.',
    ask: 'ateliers pour enfants, spectacles jeune public, fêtes locales, marchés et brocantes',
  },
  {
    // 05/10: one search per sector of villages, every theme at once (VILLAGE_AREAS).
    name: 'villages',
    label: 'Tous thèmes, dans les villages autour de la forêt',
    focus:
      'Événements publics des petites communes, de toute nature : fêtes de village, portes ' +
      'ouvertes d\'ateliers d\'artistes, expositions, salons, concerts, théâtre, brocantes et ' +
      'vide-greniers, marchés de Noël, courses et randonnées, sorties nature, animations des ' +
      'bibliothèques. Classe chacun dans la catégorie qui lui correspond.',
    ask: 'événements publics (fêtes, expositions, portes ouvertes d\'ateliers d\'artistes, concerts, ' +
      'spectacles, brocantes, courses, sorties nature)',
    areas: VILLAGE_AREAS,
    // Never adds an event (05/10): the second diagnostic gave the Briardises festival in Vulaines
    // and Fontaine-le-Port, where it does not play — town sites relay the whole festival's poster
    // and the model made one date per village. Its records only confirm (lastSeen) an event a
    // legitimate source or an earlier scan already holds; their fields are never copied.
    confirmOnly: true,
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

  const city = canonicalCommune(cleanText(raw.city, 80));
  const locationName = cleanText(raw.locationName, 160);
  if (!city && !locationName) return fail('missing_location');
  // Also prunes a stored event of a commune that left the zone (fromExisting comes through here).
  if (city && !inZone(city)) return fail('outside_zone');

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
const isHome = (u) => { try { return ['', '/'].includes(new URL(u).pathname.replace(/\/(fr|en)\/?$/, '/')); } catch { return false; } };

/**
 * Item 79b: dates that may have been copied from last year. Gemini alone carries the record and
 * its link is only a home page (or missing), so nothing we read shows this year's dates. The
 * Fontainebleau Christmas market once went online with its 2025 dates this way. Same rule as
 * `datesUnconfirmed()` in generate-pages.js, which tells the visitor.
 */
const datesAtRisk = (e) => !e.source && (!e.url || isHome(e.url));

function enrichFrom(target, incoming) {
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

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « octobre 2026 », « novembre 2026 »… for every month the window touches. */
function frenchMonths(fromIso, toIso) {
  const out = [];
  let [y, m] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${MONTHS_FR[m - 1]} ${y}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// A scan runs in two steps (04/10). Asked for a structured list after a page of instructions,
// the model never searched: not with dated example queries, nor a system instruction, a low
// thinking level or gemini-3.8-flash. It answered from memory (home-page links, last year's
// dates). A short question in plain words searches every time (sport: 8 queries, 18 pages). So:
//   1. short questions WITH the search tool, answered in prose;
//   2. one call WITHOUT the tool turning that prose into our JSON. It sees nothing but the text
//      of step 1 and is told it is its only source: it can drop or format an event, not add one.
// A question answered without any search never reaches step 2.

/**
 * The short, grounded questions of one scan: one per pair of months in the window. A scan with
 * `areas` asks once per sector instead, about the next two months only: a village announces its
 * fête two or three weeks ahead (Grez's open studios: posted 17/09 for 2/10), and the window
 * slides with every scan, so later months are asked about when they come close.
 */
function buildQuestions(scan, { today, maxDate }) {
  const months = frenchMonths(today, maxDate);
  const tail = 'Pour chacun : titre, dates exactes, horaires et tarif si indiqués, commune, lieu et lien de la page.';
  if (scan.areas) {
    // The first villages diagnostic (05/10) searched well — 52 queries, 141 pages — but 28 of its
    // 40 links were a town hall's home page: the model keeps the site, not the page. Asked for
    // here only; the theme questions are left exactly as the 04/10 diagnostic validated them.
    const villageTail = 'Pour chacun : titre, dates exactes, horaires et tarif si indiqués, commune, lieu, '
      + 'et l\'adresse exacte de la page qui annonce cet événement (pas la page d\'accueil du site).';
    return scan.areas.map((area) => `Cherche sur le web : quels ${scan.ask} sont annoncés à `
      + `${area.join(', ')} (Seine-et-Marne) en ${months.slice(0, 2).join(' et ')} ? ${villageTail}`);
  }
  const out = [];
  for (let i = 0; i < months.length; i += 2) {
    out.push(`Cherche sur le web : quels ${scan.ask} sont annoncés autour de Fontainebleau `
      + `(${CONFIG.maxRadiusKm} km) en ${months.slice(i, i + 2).join(' et ')} ? ${tail}`);
  }
  return out;
}

/** Step 1 — grounded. Exactly the shape the 04/10 diagnostic saw search; keep it bare. */
function searchRequestBody(question) {
  return {
    contents: [{ parts: [{ text: question }] }],
    tools: [{ google_search: {} }],
    // No responseMimeType: it collides with the search tool (see design doc §3.A).
    generationConfig: { temperature: CONFIG.temperature, maxOutputTokens: CONFIG.maxOutputTokens },
  };
}

/** Step 2 — no tool, so strict JSON output is allowed. */
function formatRequestBody(prompt) {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: CONFIG.temperature, maxOutputTokens: CONFIG.maxOutputTokens, responseMimeType: 'application/json' },
  };
}

/** Step 2's prompt: the prose found in step 1, to be turned into records. */
function buildPrompt(scan, { today, maxDate }, findings) {
  return `
Nous sommes aujourd'hui le ${today}. Voici le résultat de recherches web sur les événements à venir autour de Fontainebleau.

TEXTE DES RECHERCHES :
"""
${findings}
"""

Convertis ce texte en tableau JSON. Ce texte est ta SEULE source : n'ajoute aucun événement qui n'y figure pas, et ne complète jamais une date, un lien, un horaire ou un tarif de mémoire. Une information absente du texte reste vide ("" ou null).

THÈME : ${scan.label}
${scan.focus}

PÉRIODE DE RECHERCHE STRICTE :
- Conserve UNIQUEMENT les événements se déroulant entre le ${today} et le ${maxDate}.
- Exclus tous les événements passés (finis avant le ${today}).

PÉRIMÈTRE GÉOGRAPHIQUE :
- Ville principale : Fontainebleau.
- Rayon accepté : ${CONFIG.maxRadiusKm} km autour de Fontainebleau. Un événement au-delà sera écarté.
- Communes concernées : ${COMMUNES.join(', ')}.
- Cette liste n'est pas limitative : toute commune dans le rayon convient.

RÈGLES DE QUALITÉ (très importantes) :
- Ignore un événement dont le texte ne donne pas une date précise ou un lien.
- "url" : le lien donné par le texte pour cet événement, recopié tel quel ; jamais une page de résultats de recherche ni un lien de redirection.
- Dates au format YYYY-MM-DD ; pour un événement d'un seul jour, endDate = startDate.
- Aucun marqueur de citation ([1], [2]…) ni HTML dans les valeurs.
- "schedule" : uniquement les horaires (ex: "10h–18h"), sans répéter la date ; s'ils diffèrent selon les jours, précise-les jour par jour avec la date (ex: "sam. 12 : 10h–18h ; dim. 13 : 10h–17h"). Ne mets JAMAIS un jour de la semaine sans la date correspondante.
- "description" : une phrase, 200 caractères maximum.
- "lat" / "lng" : null (la position est calculée ensuite à partir du lieu et de la commune).
- "ageMin" / "ageMax" : âges conseillés (0 et 99 si tout public).
- "category" : UNIQUEMENT l'une de ces quatre valeurs : "Sport & Outdoor", "Nature & Environnement", "Scène & Spectacles" (concerts, théâtre, opéra, cinéma, festivals), "Culture & Ateliers" (expositions, visites, patrimoine, ateliers, brocantes).
- Retourne au maximum ${CONFIG.maxEventsPerScan * 2} événements, en priorisant les plus proches dans le temps.

Renvoie UNIQUEMENT un tableau JSON strict ([] si le texte ne contient aucun événement utilisable), au format exact suivant :
[
  {
    "title": "Titre explicite de l'événement",
    "category": "Sport & Outdoor",
    "ageMin": 0,
    "ageMax": 99,
    "city": "Nom de la ville",
    "locationName": "Lieu précis (ex: Grand Parquet, Parc du Château, Forêt domaniale)",
    "lat": null,
    "lng": null,
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

async function callGemini(requestBody, model = CONFIG.model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY, // header, not query string: keeps the key out of URLs/logs
    },
    body: JSON.stringify(requestBody),
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
    // Three separate signals, because the 27/09 report showed 0 queries on every scan: did the
    // answer carry grounding metadata at all, how many queries, how many web pages it cites.
    grounded: Boolean(candidate.groundingMetadata),
    searchQueries: candidate.groundingMetadata?.webSearchQueries?.length ?? 0,
    webSources: candidate.groundingMetadata?.groundingChunks?.length ?? 0,
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

/** One Gemini call with retries; `parse` runs inside the loop, so a garbled answer is retried too. */
async function withRetry(label, requestBody, meta, parse = (info) => info) {
  let lastError;
  for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
    try {
      const result = parse(extractText(await callGemini(requestBody)));
      meta.attempts = Math.max(meta.attempts, attempt);
      return result;
    } catch (err) {
      lastError = err;
      // 400/401/403/404 = bad key, bad model name, bad request: retrying will not help.
      const retryable = err.status === undefined || RETRYABLE_STATUS.has(err.status);
      console.warn(`  ⚠️ [${label}] attempt ${attempt}/${CONFIG.maxAttempts} failed: ${String(err.message).slice(0, 300)}`);
      if (!retryable || attempt === CONFIG.maxAttempts) break;
      await sleep(CONFIG.retryBaseDelayMs * 3 ** (attempt - 1));
    }
  }
  throw lastError;
}

function addUsage(total, usage) {
  for (const k of ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount']) total[k] += usage?.[k] ?? 0;
}

async function runScan(scan, ctx) {
  const meta = {
    attempts: 0, grounded: false, searchQueries: 0, webSources: 0, questions: 0, unsearched: 0,
    usage: { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0 },
  };
  // Step 1 — short questions with the search tool, prose answers.
  const findings = [];
  for (const question of buildQuestions(scan, ctx)) {
    const info = await withRetry(`${scan.name} · recherche`, searchRequestBody(question), meta);
    meta.questions++;
    addUsage(meta.usage, info.usage);
    meta.grounded ||= info.grounded;
    meta.searchQueries += info.searchQueries;
    meta.webSources += info.webSources;
    if (info.searchQueries > 0 || info.webSources > 0 || CONFIG.allowUngrounded) findings.push(info.text);
    else meta.unsearched++;   // memory, not the web: never formatted, never published
  }
  if (!findings.length) return { events: [], meta: { ...meta, salvaged: false } };

  // Step 2 — no tool: the prose becomes records.
  const prompt = buildPrompt(scan, ctx, findings.join('\n\n---\n\n'));
  const { events, salvaged, finishReason, usage } = await withRetry(`${scan.name} · mise en forme`, formatRequestBody(prompt), meta,
    (info) => (/^\s*\[\s*\]\s*$/.test(info.text)
      ? { events: [], salvaged: false, finishReason: info.finishReason, usage: info.usage }
      : { ...extractJsonArray(info.text), finishReason: info.finishReason, usage: info.usage }));
  addUsage(meta.usage, usage);
  return { events, meta: { ...meta, salvaged, finishReason } };
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
    // exact position — the one thing this file must never do. Unless it says so: `outside: true`
    // marks a place a source wrongly files under a local town, and the radius filter then drops
    // its events (the Carreau Franc reserve, 24.6 km away, published "à Fontainebleau").
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!inBbox(lat, lng) && v.outside !== true) continue;
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
      // A commune just outside the box is still placed where it is, so the radius filter drops
      // the event. Otherwise the Fontainebleau-centre fallback published it at 0 km: Marolles-sur-
      // Seine, 24.6 km, on 04/10. Farther away, a namesake elsewhere in France is likelier (Avon
      // also exists in Deux-Sèvres): the fallback stays.
      if (r && (inBbox(r.lat, r.lng) || distanceKm(r.lat, r.lng) <= 2 * CONFIG.maxRadiusKm)) {
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
  L.push('| Scan | Status | Raw events | Attempts | Search queries / web sources | Tokens in / out / thoughts |');
  L.push('|---|---|---|---|---|---|');
  for (const s of stats.scans) {
    const u = s.usage || {};
    const tokens = s.usage ? `${u.promptTokenCount ?? '?'} / ${u.candidatesTokenCount ?? '?'} / ${u.thoughtsTokenCount ?? 0}` : '–';
    const status = s.error ? `❌ ${String(s.error).slice(0, 80)}`
      : s.discarded ? '🚫 écarté : aucune recherche'
      : s.unsearched ? `⚠️ ${s.unsearched}/${s.questions} question(s) sans recherche, écartée(s)`
      : (s.salvaged ? '⚠️ truncated, salvaged' : '✅');
    L.push(`| ${s.name} | ${status} | ${s.raw ?? 0} | ${s.attempts ?? '–'} | ${s.grounded === false ? '⚠️ no grounding metadata' : `${s.searchQueries ?? '–'} / ${s.webSources ?? '–'}`} | ${tokens} |`);
  }
  L.push('');
  const discarded = stats.scans.filter((s) => s.discarded);
  if (discarded.length) {
    L.push(`- 🚫 **${discarded.length} scan(s) Gemini sans aucune recherche web**, rien ajouté ni rafraîchi. `
      + 'Le modèle a répondu de mémoire. Diagnostic : workflow « Diagnostic de la recherche Google ».', '');
  }
  if (stats.dt) {
    if (stats.dt.error) {
      L.push(`- 📖 DATAtourisme: ❌ ${String(stats.dt.error).slice(0, 160)} (Gemini results kept)`);
    } else {
      L.push(`- 📖 DATAtourisme (CSV du ${stats.dt.updated}): ${stats.dt.inWindow} in window → ${stats.dt.short} short kept, ${stats.dt.recurring} recurring/markets skipped → **${stats.dt.records}** record(s), ${stats.dtDeduped} duplicate(s) of a Gemini event`);
      const dtRej = Object.entries(stats.dtRejected);
      if (dtRej.length) L.push(`  - rejected at validation: ${dtRej.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }
  if (stats.villagesConfirmed || stats.villagesUnconfirmed) {
    L.push(`- 🏘️ Scan villages (jamais publié seul) : **${stats.villagesConfirmed}** événement(s) reconfirmé(s) · ${stats.villagesUnconfirmed} sans source légitime, non publié(s)`);
    // Listed so a person can judge them (05/10): good finds here mean either a source to add to
    // sources.json or a case for letting the scan publish again, flagged « Dates à confirmer ».
    const list = [...stats.villagesUnconfirmedList].sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (list.length) L.push('  - Non publiés (à juger : bonne trouvaille ? date juste ?) :');
    for (const e of list.slice(0, 40)) {
      let link = '';
      try { const u = new URL(e.url); link = u.hostname.replace(/^www\./, '') + (u.pathname.replace(/\/$/, '') === '' ? ' (accueil)' : ''); } catch { /* no link */ }
      const when = e.endDate && e.endDate !== e.startDate ? `${e.startDate} → ${e.endDate}` : e.startDate;
      L.push(`    - ${when} · ${e.city} · ${e.title} · ${link}`);
    }
    if (list.length > 40) L.push(`    - … et ${list.length - 40} autre(s)`);
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
      if (stats.siteCategoryGuessed) L.push(`  - catégorie déduite du titre (fiche non complétée par Gemini) : ${stats.siteCategoryGuessed}`);
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
  if (stats.datesAtRisk.length) {
    L.push(`- 📅 **Dates à vérifier (79b) : ${stats.datesAtRisk.length}** — Gemini seul, et le lien ne mène qu’à une page d’accueil : rien ne montre les dates de cette année. Les plus proches :`);
    for (const v of stats.datesAtRisk.slice(0, 10)) L.push(`  - ${v}`);
    if (stats.datesAtRisk.length > 10) L.push(`  - … et ${stats.datesAtRisk.length - 10} autre(s)`);
    L.push(`  La fiche le dit déjà au visiteur. Si les dates sont fausses : overrides.json (dates ou masquage).`);
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
  // A short signature is too weak to merge across cities ("Exposition" in Nemours is not
  // "Exposition" in Barbizon), so a title of one or two significant words only groups with its
  // own commune. Two words used to be enough: on 05/10, with the villages covered, the Christmas
  // market of Ville-Saint-Jacques was folded into Flagy's (« Marché de Noël », same Sunday). A
  // duplicate costs less than a deleted event; the judged dedupe (§3.W2) still sees same-city pairs.
  // A title left with no significant word at all never merges.
  function signature(event, uniqueFallback) {
    const words = [...wordSet(event.title)].sort();
    if (!words.length) return `__unique__${uniqueFallback}`;
    return words.length >= 3 ? words.join(' ') : `${words.join(' ')}|${norm(event.city)}`;
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
    sites: null, siteRejected: {}, siteCategoryGuessed: 0, siteConfirmed: 0, siteLongSkipped: 0, siteInsideSpan: 0,
    villagesConfirmed: 0, villagesUnconfirmed: 0, villagesUnconfirmedList: [],
    unconfirmed: [], vanishedFromFeed: [], datesAtRisk: [], recategorised: 0,
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
      // An answer without a single search is the model writing from memory: last year's dates,
      // invented editions (03/10: ten events added that way). Nothing from it is added or
      // refreshed. The other sources still run, so the scan costs a little and publishes nothing.
      const searched = meta.searchQueries > 0 || meta.webSources > 0;
      if (!searched && !CONFIG.allowUngrounded) {
        stats.scans.push({ name: scan.name, raw: events.length, discarded: true, ...meta });
        console.warn(`   🚫 ${events.length} raw events discarded: no web search in the answer`);
        continue;
      }
      okScans++;
      rawNew.push(...(scan.confirmOnly ? events.map((e) => ({ ...e, _confirmOnly: true })) : events));
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
  const validConfirmOnly = [];
  for (const raw of rawNew) {
    const v = validateEvent(raw, ctx);
    if (!v.ok) bump(stats.rejected, v.reason);
    else if (raw && raw._confirmOnly === true) validConfirmOnly.push(v);
    else validNew.push(v);
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
    // A tourist-office page the enrichment call skipped has no category, yet its dates come from
    // the tested parser. Rejecting it lost 22 good records on the 27/09 scan: the title goes
    // through the same keyword classifier as OpenAgenda instead, and the next run re-asks Gemini.
    if (!normalizeCategory(raw.category)) {
      raw.category = openagenda.mapCategory({ title_fr: raw.title });
      stats.siteCategoryGuessed++;
    }
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
  // After every source that may add: a villages record (confirmOnly scan) only refreshes lastSeen
  // of an event already held — never its dates or fields, never a new event (§7, 05/10).
  for (const v of validConfirmOnly) {
    const rec = records.get(eventKey(v.event))
      || [...records.values()].find((r) => datatourisme.isSameOccurrence(v.event, r.event));
    if (!rec) { stats.villagesUnconfirmed++; stats.villagesUnconfirmedList.push(v.event); continue; }
    rec.refreshed = true;
    rec.event.lastSeen = today;
    stats.villagesConfirmed++;
  }

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
  // 6a'. Item 79b. `kept` is sorted by date: soonest first, where a wrong date costs the most.
  for (const e of kept) {
    if (datesAtRisk(e)) stats.datesAtRisk.push(`${e.id} — ${e.title} (${e.startDate}, ${e.url || 'sans lien'})`);
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
  applyOverrides, coerceOverride, datesAtRisk, matchVenue, loadVenues, distanceKm, buildPrompt, buildQuestions, searchRequestBody, formatRequestBody, runScan, callGemini, frenchMonths, SCANS, COMMUNES,
  COMMUNE_TABLE, canonicalCommune, inZone, VILLAGE_AREAS,
  refineCategory, CATEGORIES,
  renderSummary,
  addMonths, parisToday, isValidIsoDate, cleanText, cleanUrl, normalizeCategory, checkUrl, geocodeRecord,
  weekdayContradictsDates,
  CONFIG,
};