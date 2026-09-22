'use strict';
/**
 * DATAtourisme — shared library.
 *
 * Downloads and interprets the DATAtourisme open dataset (national tourism platform fed by the
 * tourism offices, open licence, refreshed daily). Used by two callers:
 *   - scripts/datatourisme-coverage.js  → weekly observation report, writes nothing
 *   - scripts/fetch-events.js           → second source merged into data.json
 *
 * This module is deliberately pure: it requires nothing else in the project and takes the date
 * window as a parameter, so fetch-events.js can require it without a circular dependency.
 *
 * Schema verified against the real file on 2026-09-20. None of the field names are what the
 * documentation suggests, hence assertColumns(): a schema change must fail loudly.
 *
 * Zero dependencies. Requires Node >= 18 (global fetch).
 */

const fs = require('fs');

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  datasetSlug: 'datatourisme-la-base-nationale-des-donnees-du-tourisme-en-open-data',
  // Regional Île-de-France file: 9 MB and covers Seine-et-Marne. The national events file
  // (datatourisme-fma.csv) is 64 MB for the same local coverage.
  resourceName: 'datatourisme-reg-idf.csv',
  shortEventMaxDays: envInt('DT_SHORT_EVENT_MAX_DAYS', 14),
  // An event with many separate dates becomes one record per date; the cap stops a pathological
  // record from flooding the map.
  maxPeriodsPerEvent: envInt('DT_MAX_PERIODS', 12),
  localCsv: process.env.DT_CSV_PATH || '',
  apiTimeoutMs: envInt('DT_API_TIMEOUT_MS', 30_000),
  downloadTimeoutMs: envInt('DT_DOWNLOAD_TIMEOUT_MS', 180_000),
};

// Same box as the collection pipeline, so both sources are judged on equal ground.
const BBOX = { latMin: 48.20, latMax: 48.65, lngMin: 2.45, lngMax: 3.00 };

const USER_AGENT = 'Mozilla/5.0 (compatible; FontainebleauEventsBot/2.4; +datatourisme)';

const REQUIRED_COLUMNS = [
  'Nom_du_POI', 'Categories_de_POI', 'Latitude', 'Longitude', 'Adresse_postale',
  'Code_postal_et_commune', 'Periodes_regroupees', 'Createur_de_la_donnee',
  'Contacts_du_POI', 'Description', 'URI_ID_du_POI',
];

const EVENT_CLASS = 'core#EntertainmentAndEvent';
// Ontology classes that are almost always a weekly market or a permanent sale, not an outing.
const RECURRING_CLASSES = ['Market', 'SaleEvent'];
// Everything else maps to "Culture & Ateliers"; DATAtourisme has no reliable nature signal.
const SPORT_CLASSES = ['SportsEvent', 'SportsCompetition', 'SportsCompetitionEvent'];

// ───────────────────────────── Parsing ─────────────────────────────

/** RFC 4180 CSV parser: quoted fields, escaped quotes, newlines inside fields. */
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

/** "2026-10-22<->2026-10-25|2026-11-02<->2026-11-02" -> [{start,end}, …]; malformed parts skipped. */
function parsePeriods(raw) {
  return String(raw || '')
    .split('|')
    .map((chunk) => chunk.split('<->'))
    .filter((parts) => parts.length === 2)
    .map((parts) => ({ start: parts[0].trim(), end: parts[1].trim() }))
    .filter((p) =>
      /^\d{4}-\d{2}-\d{2}$/.test(p.start) && /^\d{4}-\d{2}-\d{2}$/.test(p.end) && p.start <= p.end);
}

/** "77300#Fontainebleau" -> { postcode: "77300", city: "Fontainebleau" } */
function parseCityField(raw) {
  const parts = String(raw || '').split('#');
  return { postcode: (parts[0] || '').trim(), city: (parts[1] || '').trim() };
}

/** Contacts_du_POI mixes labels, phones, e-mails and URLs behind '#'. Keep the first http(s) URL. */
function parseContactUrl(raw) {
  for (const part of String(raw || '').split('#')) {
    const s = part.trim();
    if (/^https?:\/\//i.test(s)) {
      try { return new URL(s).href; } catch { /* malformed, keep looking */ }
    }
  }
  return '';
}

/** Ontology URIs -> readable labels, dropping the classes every record carries. */
function parseClasses(raw) {
  const generic = new Set(['PointOfInterest', 'EntertainmentAndEvent', 'Event', 'PlaceOfInterest']);
  const out = [];
  for (const uri of String(raw || '').split('|')) {
    const label = uri.split('#')[1];
    if (label && !generic.has(label) && !out.includes(label)) out.push(label);
  }
  return out;
}

// ─────────────────── Matching (shared with the pipeline merge) ───────────────────

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
 * other for titles long enough that containment is not a coincidence) AND they are compatible in
 * space or time. Deliberately conservative: a missed match costs a visible duplicate, a wrong
 * match silently hides a real event.
 *
 * `dt` carries `periods`; a pipeline event carries `startDate` / `endDate`. Both are accepted.
 */
function isSameEvent(dt, other) {
  const a = normalizeTitle(dt.title);
  const b = normalizeTitle(other.title);
  if (!a || !b) return false;
  const titleMatch = a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)));
  if (!titleMatch) return false;

  const sameCity = normalizeTitle(dt.city) === normalizeTitle(other.city);
  const periods = dt.periods || [{ start: dt.startDate, end: dt.endDate || dt.startDate }];
  const window = { start: other.startDate || '', end: other.endDate || other.startDate || '' };
  const dateMatch = !window.start || periods.some((p) => periodsOverlap(p, window));
  return sameCity || dateMatch;
}

const findMatch = (dtEvent, list) => list.find((m) => isSameEvent(dtEvent, m)) || null;

/**
 * Stricter variant used by the pipeline merge, where every record carries a single date.
 *
 * isSameEvent() accepts "same city OR overlapping dates", which suits the coverage report: there
 * a DATAtourisme entry still bundles all its dates. In the pipeline each date has become its own
 * record, so that disjunction would treat the second performance of a play as a duplicate of the
 * first and silently delete it. Here an occurrence is the same only when the dates actually
 * overlap, and the city does not contradict.
 */
function isSameOccurrence(a, b) {
  const ta = normalizeTitle(a.title);
  const tb = normalizeTitle(b.title);
  if (!ta || !tb) return false;
  const titleMatch = ta === tb || (Math.min(ta.length, tb.length) >= 12 && (ta.includes(tb) || tb.includes(ta)));
  if (!titleMatch) return false;

  const pa = { start: a.startDate, end: a.endDate || a.startDate };
  const pb = { start: b.startDate, end: b.endDate || b.startDate };
  if (!pa.start || !pb.start || !periodsOverlap(pa, pb)) return false;

  const ca = normalizeTitle(a.city);
  const cb = normalizeTitle(b.city);
  return !ca || !cb || ca === cb;
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

/** The published CSV URL embeds a timestamp and changes daily, so it is resolved every run. */
async function resolveResource() {
  const dataset = await getJson(
    'https://www.data.gouv.fr/api/1/datasets/' + CONFIG.datasetSlug + '/', CONFIG.apiTimeoutMs);
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
    address: (row[ix.Adresse_postale] || '').trim(),
    lat: Number(row[ix.Latitude]),
    lng: Number(row[ix.Longitude]),
    periods: parsePeriods(row[ix.Periodes_regroupees]),
    url: parseContactUrl(row[ix.Contacts_du_POI]),
    classes: parseClasses(row[ix.Categories_de_POI]),
    description: (row[ix.Description] || '').trim(),
    publisher: (row[ix.Createur_de_la_donnee] || '').trim(),
    uri: (row[ix.URI_ID_du_POI] || '').trim(),
  };
}

const inBox = (e) =>
  Number.isFinite(e.lat) && Number.isFinite(e.lng) &&
  e.lat >= BBOX.latMin && e.lat <= BBOX.latMax && e.lng >= BBOX.lngMin && e.lng <= BBOX.lngMax;

const periodsInWindow = (e, today, windowEnd) =>
  e.periods.filter((p) => p.end >= today && p.start <= windowEnd);

/**
 * A weekly market published as 2026-01-01<->2026-12-31 is not an outing to put on the map.
 * Recurring either by ontology class or by sheer duration.
 */
function isRecurring(e, today, windowEnd) {
  if (e.classes.some((c) => RECURRING_CLASSES.includes(c))) return true;
  const active = periodsInWindow(e, today, windowEnd);
  if (!active.length) return true;
  return Math.min.apply(null, active.map((p) => daysBetween(p.start, p.end))) > CONFIG.shortEventMaxDays;
}

const mapCategory = (classes) =>
  classes.some((c) => SPORT_CLASSES.includes(c)) ? 'Sport & Outdoor' : 'Culture & Ateliers';

/**
 * Map to the shape scripts/fetch-events.js validates, one record per date (decision of
 * September 20: an exact date is the useful information, a 13→20 December span would be a lie).
 *
 * `organizer` is left empty on purpose: the CSV only names the data publisher (a tourism agency),
 * never the actual organizer, and the card would misattribute the event. The frontend then shows
 * "Source: <domain>" alone. Records with no URL are dropped downstream by validateEvent.
 */
function toPipelineEvents(events, { today, maxDate }) {
  const out = [];
  for (const e of events) {
    const periods = periodsInWindow(e, today, maxDate).slice(0, CONFIG.maxPeriodsPerEvent);
    for (const p of periods) {
      out.push({
        title: e.title,
        category: mapCategory(e.classes),
        ageMin: 0,
        ageMax: 99,
        city: e.city,
        locationName: e.address || e.city,
        lat: e.lat,
        lng: e.lng,
        dateType: 'event',
        startDate: p.start,
        endDate: p.end,
        schedule: '',
        price: '',
        organizer: '',
        description: e.description,
        url: e.url,
        source: 'datatourisme',
        // Coordonnées déclarées par l'office de tourisme, pas devinées : voir geoPrecise dans validateEvent().
        geoPrecise: true,
      });
    }
  }
  return out;
}

// ───────────────────────────── Entry point ─────────────────────────────

/**
 * Download (or read locally) and classify. Returns every stage so the coverage report can show
 * the funnel and the pipeline can take just `short`.
 */
async function load({ today, windowEnd }) {
  let csvText, meta;
  if (CONFIG.localCsv) {
    csvText = fs.readFileSync(CONFIG.localCsv, 'utf8');
    meta = { resourceName: CONFIG.localCsv, lastModified: 'local', sizeMb: null };
  } else {
    const resource = await resolveResource();
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
  const recurring = inWindow.filter((e) => isRecurring(e, today, windowEnd));
  const short = inWindow.filter((e) => !isRecurring(e, today, windowEnd));

  return { meta, rowCount: dataRows.length, all, boxed, inWindow, short, recurring };
}

module.exports = {
  CONFIG, BBOX, EVENT_CLASS, RECURRING_CLASSES, SPORT_CLASSES,
  parseCsv, assertColumns, parsePeriods, parseCityField, parseContactUrl, parseClasses,
  normalizeTitle, isSameEvent, isSameOccurrence, findMatch,
  resolveResource, downloadCsv, toEvent, inBox, periodsInWindow, isRecurring, daysBetween,
  mapCategory, toPipelineEvents, load,
};
