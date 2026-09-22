/**
 * OpenAgenda — third source, via the Île-de-France open data portal (§3.S).
 *
 * WHY THIS SOURCE. The coverage gap the project lead spotted is local associations: the manga
 * festival at Bois-le-Roi, the jazz nights at Lorrez-le-Bocage, the guided walk at Larchant.
 * Gemini rarely finds them and DATAtourisme does not carry them — they are published by the
 * associations themselves on OpenAgenda, which Région Île-de-France republishes as open data.
 * Measured 22 September: 28 leisure events inside the project's bounding box, none of them
 * already in data.json.
 *
 * NO API KEY, AND NO BULK DOWNLOAD. The portal exposes an Opendatasoft query API, so the bounding
 * box and the date window are applied server-side: one small request per run instead of the 9 MB
 * DATAtourisme carries.
 *
 * THE FILTER THAT MATTERS. The raw feed is 158 records in this area, and 130 of them are France
 * Travail job-search workshops. They are public events, they are simply not outings, and shipping
 * them would bury the actual content. Everything is excluded by ORIGIN AGENDA rather than by
 * keyword: an agenda is a stable, declared publisher, where a title is whatever someone typed.
 */

'use strict';

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  enabled: process.env.OPENAGENDA !== '0',
  endpoint: process.env.OPENAGENDA_URL
    || 'https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets/evenements-publics-cibul/records',
  timeoutMs: envInt('OPENAGENDA_TIMEOUT_MS', 20_000),
  pageSize: 100,          // Opendatasoft's per-request maximum
  maxPages: envInt('OPENAGENDA_MAX_PAGES', 6),
  // An event with more occurrences than this is a long-running programme, not an outing: it is
  // published as one span instead of flooding the map with a card per day.
  maxOccurrences: envInt('OPENAGENDA_MAX_OCCURRENCES', 4),
  longRunDays: envInt('OPENAGENDA_LONG_RUN_DAYS', 14),
};

const BBOX = { latMin: 48.20, latMax: 48.65, lngMin: 2.45, lngMax: 3.00 };
const USER_AGENT = 'Mozilla/5.0 (compatible; FontainebleauLiveBot/2.6; +openagenda)';

/**
 * Publishers whose events are not outings. Excluded wholesale, by agenda rather than by keyword:
 * an agenda is declared by its owner and stable, a title is free text that changes every week.
 */
const EXCLUDED_AGENDAS = /france travail|p[oô]le emploi|mission locale|cap emploi|agenda de test/i;

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Paris-local calendar day of an ISO instant — the portal answers in UTC. */
function parisDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', dateStyle: 'short' }).format(d);
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

/** Tolerates both a JSON string and an already-parsed value: the portal returns either. */
function parseMaybeJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function isScheduled(record) {
  const st = parseMaybeJson(record.status);
  // No status at all is treated as scheduled; only an explicit cancellation is dropped.
  if (!st) return true;
  const label = norm(st?.label?.fr || st?.label?.en || '');
  return !/annul|cancel|report|postpon/.test(label);
}

// ───────────────────────────── Category ─────────────────────────────

const NATURE = /\b(nature|foret|forêt|biodiversit|champignon|arbre|plante|oiseau|ornitho|jardin|botani|faune|flore|environnement|ecolo|déchet|dechet|miel|abeille|rando)\w*/;
const SPORT = /\b(sport|course|trail|running|cyclis|velo|vélo|marche|tournoi|match|competition|compétition|escalade|natation|yoga|gymnas)\w*/;

/** data.json's category enum is fixed; anything unrecognised falls to Culture, the widest of the three. */
function mapCategory(record) {
  const hay = norm([...(record.keywords_fr || []), record.title_fr, record.originagenda_title].filter(Boolean).join(' '));
  if (NATURE.test(hay)) return 'Nature & Environnement';
  if (SPORT.test(hay)) return 'Sport & Outdoor';
  return 'Culture & Ateliers';
}

// ───────────────────────────── Occurrences ─────────────────────────────

/**
 * The dates an event actually runs, inside the window.
 *
 * `timings` lists every occurrence, and the feed keeps historical ones: one record here carries
 * dates from 2023 alongside this autumn's. Anything outside the window is dropped before counting,
 * so a long-dead series cannot be mistaken for a long run.
 */
function occurrencesInWindow(record, today, windowEnd) {
  const timings = parseMaybeJson(record.timings);
  const days = new Set();

  if (Array.isArray(timings) && timings.length) {
    for (const t of timings) {
      const day = parisDay(t?.begin);
      if (day && day >= today && day <= windowEnd) days.add(day);
    }
  } else {
    const day = parisDay(record.firstdate_begin);
    if (day && day >= today && day <= windowEnd) days.add(day);
  }
  return [...days].sort();
}

// ───────────────────────────── Fetching ─────────────────────────────

function buildWhere(today, windowEnd) {
  return `in_bbox(location_coordinates, ${BBOX.latMin}, ${BBOX.lngMin}, ${BBOX.latMax}, ${BBOX.lngMax})`
    + ` and lastdate_begin >= date'${today}'`
    + ` and firstdate_begin <= date'${windowEnd}'`;
}

async function fetchPage(where, offset, timeoutMs) {
  const url = `${CONFIG.endpoint}?where=${encodeURIComponent(where)}`
    + `&limit=${CONFIG.pageSize}&offset=${offset}&order_by=firstdate_begin`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OpenAgenda -> HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  if (!Array.isArray(body?.results)) throw new Error('OpenAgenda: unexpected response shape');
  return body;
}

/** Every record in the window and the box, minus the excluded publishers and the cancellations. */
async function load({ today, windowEnd, timeoutMs = CONFIG.timeoutMs } = {}) {
  const where = buildWhere(today, windowEnd);
  const raw = [];
  let total = 0;

  for (let page = 0; page < CONFIG.maxPages; page++) {
    const body = await fetchPage(where, page * CONFIG.pageSize, timeoutMs);
    total = body.total_count ?? total;
    raw.push(...body.results);
    if (body.results.length < CONFIG.pageSize) break;
  }

  const excluded = raw.filter((r) => EXCLUDED_AGENDAS.test(r.originagenda_title || ''));
  const cancelled = raw.filter((r) => !EXCLUDED_AGENDAS.test(r.originagenda_title || '') && !isScheduled(r));
  const kept = raw.filter((r) => !EXCLUDED_AGENDAS.test(r.originagenda_title || '') && isScheduled(r));

  return {
    kept,
    meta: {
      total,
      fetched: raw.length,
      excludedAgendas: excluded.length,
      cancelled: cancelled.length,
      agendas: [...new Set(kept.map((r) => r.originagenda_title).filter(Boolean))],
    },
  };
}

// ───────────────────────────── Mapping ─────────────────────────────

/**
 * Records -> the shape validateEvent() expects. A short series becomes one record per date, the
 * same rule DATAtourisme follows (§3.I): an exact date is the useful fact. A long run becomes a
 * single span, because a card per day for a two-month exhibition would bury everything else.
 */
function toPipelineEvents(records, { today, maxDate }) {
  const out = [];

  for (const r of records) {
    const coords = parseMaybeJson(r.location_coordinates);
    const lat = Number(coords?.lat);
    const lng = Number(coords?.lon ?? coords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const days = occurrencesInWindow(r, today, maxDate);
    if (!days.length) continue;

    const title = String(r.title_fr || '').trim();
    if (!title) continue;

    const base = {
      title,
      category: mapCategory(r),
      ageMin: Number.isFinite(Number(r.age_min)) ? Number(r.age_min) : 0,
      ageMax: Number.isFinite(Number(r.age_max)) ? Number(r.age_max) : 99,
      city: String(r.location_city || '').trim(),
      locationName: String(r.location_name || r.location_address || r.location_city || '').trim(),
      lat,
      lng,
      dateType: 'event',
      schedule: '',
      price: '',
      organizer: '',
      description: String(r.description_fr || '').trim(),
      url: String(r.canonicalurl || '').trim(),
      image: String(r.image || '').trim() || undefined,
      source: 'openagenda',
    };

    const span = daysBetween(days[0], days[days.length - 1]);
    if (days.length > CONFIG.maxOccurrences || span > CONFIG.longRunDays) {
      out.push({ ...base, startDate: days[0], endDate: days[days.length - 1] });
    } else {
      for (const day of days) out.push({ ...base, startDate: day, endDate: day });
    }
  }

  return out;
}

module.exports = {
  CONFIG, BBOX, load, toPipelineEvents, mapCategory, occurrencesInWindow,
  isScheduled, buildWhere, parisDay, parseMaybeJson, EXCLUDED_AGENDAS,
};
