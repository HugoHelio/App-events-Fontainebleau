#!/usr/bin/env node
/**
 * DATAtourisme coverage probe — OBSERVATION MODE.
 *
 * Measures how much the DATAtourisme open dataset would add to the events collected by
 * scripts/fetch-events.js. It reads data.json but NEVER writes it: the only outputs are a
 * report (stdout + GitHub job summary) and two JSON files under reports/.
 *
 * Pipeline:
 *   1. Resolve the Ile-de-France CSV URL through the data.gouv.fr API (the published URL embeds
 *      a timestamp and changes every day, the API one does not)
 *   2. Download and parse it (9 MB; the national events file is 64 MB for the same local coverage)
 *   3. Keep EntertainmentAndEvent records inside the project bounding box and the 3-month window
 *   4. Split short events from year-round recurring ones (weekly markets would saturate the map)
 *   5. Match against data.json and report overlap, additions and misses
 *
 * The matching helpers are exported so the future two-source merge reuses exactly the same rule.
 *
 * Zero dependencies. Requires Node >= 18 (global fetch); the workflow uses Node 22.
 *
 * Environment:
 *   DATA_PATH (data.json)              WINDOW_MONTHS (3)
 *   DT_MAX_EXAMPLES (20)               Examples listed per section in the report
 *   DT_SHORT_EVENT_MAX_DAYS (14)       Above this an event counts as recurring / long-running
 *   DT_REPORT_DIR (reports)            Where the two JSON files are written
 *   DT_CSV_PATH                        Use a local CSV instead of downloading (tests)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parisToday, addMonths } = require('./fetch-events');

// ───────────────────────────── Configuration ─────────────────────────────

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  // data.gouv.fr dataset slug and the resource we want inside it.
  datasetSlug: 'datatourisme-la-base-nationale-des-donnees-du-tourisme-en-open-data',
  resourceName: 'datatourisme-reg-idf.csv',
  windowMonths: envInt('WINDOW_MONTHS', 3),
  shortEventMaxDays: envInt('DT_SHORT_EVENT_MAX_DAYS', 14),
  maxExamples: envInt('DT_MAX_EXAMPLES', 20),
  dataPath: path.resolve(process.env.DATA_PATH || 'data.json'),
  reportDir: path.resolve(process.env.DT_REPORT_DIR || 'reports'),
  localCsv: process.env.DT_CSV_PATH || '',
  apiTimeoutMs: envInt('DT_API_TIMEOUT_MS', 30_000),
  downloadTimeoutMs: envInt('DT_DOWNLOAD_TIMEOUT_MS', 180_000),
};

// Same box as the collection pipeline, so the two sources are compared on equal ground.
const BBOX = { latMin: 48.20, latMax: 48.65, lngMin: 2.45, lngMax: 3.00 };

const USER_AGENT = 'Mozilla/5.0 (compatible; FontainebleauEventsBot/2.3; +coverage-probe)';

// Verified against the real file on 2026-09-20. A change here must fail loudly rather than
// silently produce an empty report.
const REQUIRED_COLUMNS = [
  'Nom_du_POI', 'Categories_de_POI', 'Latitude', 'Longitude',
  'Code_postal_et_commune', 'Periodes_regroupees', 'Contacts_du_POI',
  'Description', 'URI_ID_du_POI',
];

// DATAtourisme tags every event with this ontology class.
const EVENT_CLASS = 'core#EntertainmentAndEvent';
// Ontology classes that are almost always a weekly market or a permanent sale, not an outing.
const RECURRING_CLASSES = ['Market', 'SaleEvent'];

// ───────────────────────────── Small helpers ─────────────────────────────

/** RFC 4180 CSV parser: handles quoted fields, escaped quotes and newlines inside fields. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function assertColumns(header) {
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new Error(
      'DATAtourisme CSV schema changed. Missing column(s): ' + missing.join(', ') + '.\n' +
      'Columns found: ' + header.join(', ')
    );
  }
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

/**
 * Periods look like "2026-10-22<->2026-10-25|2026-11-02<->2026-11-02".
 * Malformed or open-ended periods are skipped rather than guessed.
 */
function parsePeriods(raw) {
  return String(raw || '')
    .split('|')
    .map((chunk) => chunk.split('<->'))
    .filter((parts) => parts.length === 2)
    .map((parts) => ({ start: parts[0].trim(), end: parts[1].trim() }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.start) && /^\d{4}-\d{2}-\d{2}$/.test(p.end) && p.start <= p.end);
}

/** "77300#Fontainebleau" -> { postcode: "77300", city: "Fontainebleau" } */
function parseCityField(raw) {
  const parts = String(raw || '').split('#');
  return { postcode: (parts[0] || '').trim(), city: (parts[1] || '').trim() };
}

/**
 * Contacts_du_POI mixes labels, phone numbers, e-mails and URLs, separated by '#'.
 * We only want the first http(s) URL; anything else is ignored.
 */
function parseContactUrl(raw) {
  for (const part of String(raw || '').split('#')) {
    const s = part.trim();
    if (/^https?:\/\//i.test(s)) {
      try { return new URL(s).href; } catch { /* malformed, keep looking */ }
    }
  }
  return '';
}

/** Readable labels out of the ontology URI list, e.g. ".../core#TheaterEvent" -> "TheaterEvent". */
function parseClasses(raw) {
  const generic = new Set(['PointOfInterest', 'EntertainmentAndEvent', 'Event', 'PlaceOfInterest']);
  const out = [];
  for (const uri of String(raw || '').split('|')) {
    const label = uri.split('#')[1];
    if (label && !generic.has(label) && !out.includes(label)) out.push(label);
  }
  return out;
}

// ─────────────────── Matching (shared with the future merge) ───────────────────

/** Accent-insensitive, punctuation-insensitive form used for all title comparisons. */
function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const periodsOverlap = (a, b) => a.start <= b.end && b.start <= a.end;

/**
 * Two records describe the same event when their titles match (equal, or one contained in the
 * other for titles long enough that containment is not a coincidence) AND they are compatible
 * in space or time. Deliberately conservative: a missed match costs a duplicate, a wrong match
 * silently hides a real event.
 */
function isSameEvent(dt, mine) {
  const a = normalizeTitle(dt.title);
  const b = normalizeTitle(mine.title);
  if (!a || !b) return false;
  const titleMatch = a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)));
  if (!titleMatch) return false;

  const sameCity = normalizeTitle(dt.city) === normalizeTitle(mine.city);
  const minePeriod = { start: mine.startDate || '', end: mine.endDate || mine.startDate || '' };
  const dateMatch = !minePeriod.start || dt.periods.some((p) => periodsOverlap(p, minePeriod));
  return sameCity || dateMatch;
}

function findMatch(dtEvent, mine) {
  return mine.find((m) => isSameEvent(dtEvent, m)) || null;
}

// ───────────────────────────── Fetching ─────────────────────────────

async function getJson(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  return res.json();
}

/** The published CSV URL embeds a timestamp, so it is resolved through the API every run. */
async function resolveResource() {
  const api = 'https://www.data.gouv.fr/api/1/datasets/' + CONFIG.datasetSlug + '/';
  const dataset = await getJson(api, CONFIG.apiTimeoutMs);
  const resource = (dataset.resources || []).find((r) => (r.title || '') === CONFIG.resourceName);
  if (!resource) {
    const csvs = (dataset.resources || []).filter((r) => r.format === 'csv').map((r) => r.title);
    throw new Error('Resource "' + CONFIG.resourceName + '" not found. CSV resources: ' + csvs.join(', '));
  }
  return {
    url: resource.url,
    lastModified: String(resource.last_modified || '').slice(0, 10),
    sizeMb: resource.filesize ? Math.round(resource.filesize / 1e6) : null,
  };
}

async function downloadCsv(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(CONFIG.downloadTimeoutMs),
  });
  if (!res.ok) throw new Error('CSV download -> HTTP ' + res.status);
  return res.text();
}

// ───────────────────────────── Extraction ─────────────────────────────

function toEvent(row, ix) {
  const place = parseCityField(row[ix.Code_postal_et_commune]);
  return {
    title: (row[ix.Nom_du_POI] || '').trim(),
    city: place.city,
    postcode: place.postcode,
    lat: Number(row[ix.Latitude]),
    lng: Number(row[ix.Longitude]),
    periods: parsePeriods(row[ix.Periodes_regroupees]),
    url: parseContactUrl(row[ix.Contacts_du_POI]),
    classes: parseClasses(row[ix.Categories_de_POI]),
    description: (row[ix.Description] || '').trim(),
    source: (row[ix.SIT_diffuseur] || row[ix.Createur_de_la_donnee] || '').trim(),
    uri: (row[ix.URI_ID_du_POI] || '').trim(),
  };
}

const inBox = (e) =>
  Number.isFinite(e.lat) && Number.isFinite(e.lng) &&
  e.lat >= BBOX.latMin && e.lat <= BBOX.latMax && e.lng >= BBOX.lngMin && e.lng <= BBOX.lngMax;

/** Periods that are still running (or start) inside [today, windowEnd]. */
const periodsInWindow = (e, today, windowEnd) =>
  e.periods.filter((p) => p.end >= today && p.start <= windowEnd);

/**
 * A weekly market published as 2026-01-01<->2026-12-31 is not an outing to put on the map.
 * Classified as recurring either by ontology class or by sheer duration.
 */
function isRecurring(e, today, windowEnd) {
  if (e.classes.some((c) => RECURRING_CLASSES.includes(c))) return true;
  const active = periodsInWindow(e, today, windowEnd);
  if (!active.length) return true;
  return Math.min.apply(null, active.map((p) => daysBetween(p.start, p.end))) > CONFIG.shortEventMaxDays;
}

function loadMyEvents() {
  if (!fs.existsSync(CONFIG.dataPath)) return [];
  const payload = JSON.parse(fs.readFileSync(CONFIG.dataPath, 'utf8'));
  const events = Array.isArray(payload) ? payload : (payload && payload.events);
  if (!Array.isArray(events)) throw new Error('data.json must be an array or { events: [...] }');
  return events;
}

// ───────────────────────────── Reporting ─────────────────────────────

const pct = (n, total) => (total ? Math.round((n / total) * 100) + ' %' : 'n/a');

function formatPeriod(e, today, windowEnd) {
  const p = periodsInWindow(e, today, windowEnd)[0];
  if (!p) return '—';
  return p.start === p.end ? p.start : p.start + ' → ' + p.end;
}

function exampleTable(events, today, windowEnd, limit) {
  if (!events.length) return '_Aucun._\n';
  const rows = events.slice(0, limit).map((e) => {
    const title = e.title.replace(/\|/g, '/').slice(0, 60);
    const kind = e.classes.slice(0, 2).join(', ') || '—';
    return '| ' + title + ' | ' + (e.city || '—') + ' | ' + formatPeriod(e, today, windowEnd) + ' | ' + kind + ' |';
  });
  const more = events.length > limit
    ? '\n_… et ' + (events.length - limit) + ' autres (voir les fichiers téléchargeables)._\n'
    : '';
  return ['| Événement | Commune | Dates | Type |', '|---|---|---|---|'].concat(rows).join('\n') + '\n' + more;
}

function renderReport(r) {
  const c = r.counts;
  const matchedList = r.matched.length
    ? r.matched.slice(0, CONFIG.maxExamples)
        .map((m) => '- `' + m.mine.id + '` — ' + m.mine.title + ' ↔ ' + m.dt.title).join('\n')
    : '_Aucun._';

  return [
    '## Couverture DATAtourisme — ' + r.today,
    '',
    "Mode observation : **`data.json` n'est pas modifié**.",
    '',
    '**Source :** `' + r.meta.resourceName + '` (' + (r.meta.sizeMb == null ? '?' : r.meta.sizeMb) +
      ' Mo, mis à jour le ' + r.meta.lastModified + ')',
    '**Fenêtre :** ' + r.today + ' → ' + r.windowEnd +
      ' · **Zone :** lat ' + BBOX.latMin + '–' + BBOX.latMax + ', lng ' + BBOX.lngMin + '–' + BBOX.lngMax,
    '',
    '### Volumes',
    '',
    '| Mesure | Valeur |',
    '|---|---|',
    '| Lignes dans le CSV régional | ' + c.rows + ' |',
    '| Événements (EntertainmentAndEvent) | ' + c.events + ' |',
    '| … dans la zone du projet | ' + c.inBox + ' |',
    '| … et dans la fenêtre de ' + CONFIG.windowMonths + ' mois | **' + c.inWindow + '** |',
    '| dont ponctuels (≤ ' + CONFIG.shortEventMaxDays + ' j) | ' + c.short + ' |',
    '| dont récurrents / longue durée | ' + c.recurring + ' |',
    '',
    '### Recoupement avec `data.json`',
    '',
    '| Mesure | Valeur |',
    '|---|---|',
    '| Événements dans `data.json` | ' + c.mine + ' |',
    '| Déjà présents (doublons à fusionner) | ' + c.matched + ' (' + pct(c.matched, c.inWindow) + ') |',
    '| **Absents — ponctuels** | **' + c.missingShort + '** |',
    '| Absents — récurrents / longue durée | ' + c.missingRecurring + ' |',
    '',
    '> Le recoupement est calculé sur les titres normalisés : il est **minoré**, deux formulations',
    "> différentes du même événement comptent comme deux événements.",
    '',
    '### Ponctuels absents de data.json — le gain réel',
    '',
    exampleTable(r.missingShort, r.today, r.windowEnd, CONFIG.maxExamples),
    '',
    '### Récurrents / longue durée absents',
    '',
    exampleTable(r.missingRecurring, r.today, r.windowEnd, CONFIG.maxExamples),
    '',
    '### Doublons détectés',
    '',
    matchedList,
    '',
  ].join('\n');
}

// ───────────────────────────── Main ─────────────────────────────

async function main() {
  const today = parisToday();
  const windowEnd = addMonths(today, CONFIG.windowMonths);
  console.log('🔍 DATAtourisme coverage ' + today + ' → ' + windowEnd);

  let csvText, meta;
  if (CONFIG.localCsv) {
    console.log('📄 Local CSV: ' + CONFIG.localCsv);
    csvText = fs.readFileSync(CONFIG.localCsv, 'utf8');
    meta = { resourceName: path.basename(CONFIG.localCsv), lastModified: 'local', sizeMb: null };
  } else {
    const resource = await resolveResource();
    console.log('⬇️  ' + CONFIG.resourceName + ' (' + (resource.sizeMb == null ? '?' : resource.sizeMb) +
      ' MB, updated ' + resource.lastModified + ')');
    csvText = await downloadCsv(resource.url);
    meta = Object.assign({ resourceName: CONFIG.resourceName }, resource);
  }

  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('Empty CSV');
  const header = rows[0];
  assertColumns(header);
  const ix = Object.fromEntries(header.map((h, i) => [h, i]));
  // Tolerate a trailing short row (some exports end with a partial line).
  const dataRows = rows.slice(1).filter((r) => r.length >= header.length - 1);

  const all = dataRows
    .filter((r) => (r[ix.Categories_de_POI] || '').includes(EVENT_CLASS))
    .map((r) => toEvent(r, ix));
  const boxed = all.filter(inBox);
  const inWindow = boxed.filter((e) => periodsInWindow(e, today, windowEnd).length > 0);

  const mine = loadMyEvents();
  const matched = [];
  const missing = [];
  for (const e of inWindow) {
    const m = findMatch(e, mine);
    if (m) matched.push({ dt: e, mine: m });
    else missing.push(e);
  }
  const recurring = (e) => isRecurring(e, today, windowEnd);
  const missingShort = missing.filter((e) => !recurring(e));
  const missingRecurring = missing.filter(recurring);

  const counts = {
    rows: dataRows.length,
    events: all.length,
    inBox: boxed.length,
    inWindow: inWindow.length,
    short: inWindow.filter((e) => !recurring(e)).length,
    recurring: inWindow.filter(recurring).length,
    mine: mine.length,
    matched: matched.length,
    missingShort: missingShort.length,
    missingRecurring: missingRecurring.length,
  };

  const report = renderReport({ meta, counts, missingShort, missingRecurring, matched, today, windowEnd });
  console.log('\n' + report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report); } catch { /* non-fatal */ }
  }

  fs.mkdirSync(CONFIG.reportDir, { recursive: true });
  const stamp = { generatedAt: new Date().toISOString(), today, windowEnd, source: meta, counts };
  fs.writeFileSync(
    path.join(CONFIG.reportDir, 'datatourisme-coverage.json'),
    JSON.stringify(stamp, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(CONFIG.reportDir, 'datatourisme-candidates.json'),
    JSON.stringify(Object.assign({}, stamp, { missingShort, missingRecurring }), null, 2) + '\n'
  );
  console.log('💾 Rapport écrit dans ' + CONFIG.reportDir + '/ (data.json intact).');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Fatal:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  main, parseCsv, parsePeriods, parseCityField, parseContactUrl, parseClasses,
  normalizeTitle, isSameEvent, findMatch, isRecurring, inBox, toEvent, CONFIG, BBOX,
};
