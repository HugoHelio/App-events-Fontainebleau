/**
 * Fnac Spectacles / France Billet — fifth source, through the Awin product feed (item 83e, §3.AA).
 *
 * The feed is the national ticketing catalogue (12/10: ~111 000 products, 524 MB uncompressed):
 * it is downloaded to a temporary file and read as a stream, keeping only the dates inside the
 * zone and the window. Inside the zone it covers the large venues of the Melun area (L'Escale,
 * La Cartonnerie, Nino Ferrer, Le Mas, La Ferme des Jeux), which the other sources barely see.
 *
 * Each record carries two links:
 *   - `url`: the show's page on fnacspectacles.com, plain — where the information comes from;
 *   - `ticketUrl`: the same page through Awin (our publisher id), which becomes the « Billets »
 *     button through affiliates.json (`feeds`). Switching the feed off there removes every button.
 *
 * The feed URL holds a personal API key: it is read from AWIN_FEED_URL (GitHub secret) and never
 * printed, not even in an error message. Without it the source is simply skipped.
 *
 * Feed facts that are not obvious (probe of 12/10, scripts/probe-francebillet.js):
 *   - `event_location_city` is empty on every row: the town is in `venue_address` (« MELUN »);
 *   - the ticket columns are prefixed `Tickets:`; one row per date;
 *   - titles carry the tour or the venue (« Mulan - Espace Nino Ferrer, Dammarie-lès-Lys »).
 *
 * Zero dependencies.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');

// Our Awin publisher id (public, it is in every affiliate link) and Fnac Spectacles' merchant id.
// A ticketUrl must be exactly an Awin click link for both: nothing else can become a button.
const TICKET_URL = /^https:\/\/www\.awin1\.com\/pclick\.php\?p=\d+&a=3117734&m=12494$/;
const isTicketUrl = (u) => typeof u === 'string' && TICKET_URL.test(u);

// Products that are not outings: gift cards, packages, theme parks far away anyway.
const EXCLUDED_CATEGORIES = /carte cadeau|tourisme et s[ée]jours|parc d.attraction/i;
// Everything the feed sells here is a show, except exhibitions and visits.
const CULTURE_CATEGORIES = /expo|mus[ée]e|visite|aquarium/i;

// ───────────────────────────── Feed ─────────────────────────────

/** Streams the feed to `dest`. The URL carries the API key: errors report the HTTP status only. */
async function download(dest, url = process.env.AWIN_FEED_URL) {
  url = String(url || '').trim();
  if (!/^https:\/\/productdata\.awin\.com\//.test(url)) {
    throw new Error('AWIN_FEED_URL absente ou inattendue (doit commencer par https://productdata.awin.com/).');
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error(`Téléchargement du flux Fnac refusé : HTTP ${res.status}.`);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(fs.createWriteStream(dest)).on('finish', resolve).on('error', reject);
  });
}

/**
 * Streaming RFC 4180 parser (same rules as datatourisme.parseCsv, which needs the whole text):
 * calls onRow(fields) for each record. A quote at the end of a chunk is resolved by the next one.
 */
function csvStream(onRow) {
  let row = [], field = '', quoted = false, quoteSeen = false;
  return {
    write(text) {
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoteSeen) {
          quoteSeen = false;
          if (c === '"') { field += '"'; continue; }
          quoted = false;
        }
        if (quoted) {
          if (c === '"') quoteSeen = true; else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); field = ''; onRow(row); row = []; }
        else if (c !== '\r') field += c;
      }
    },
    end() { if (field !== '' || row.length) { row.push(field); onRow(row); } },
  };
}

/** Reads a gzipped feed file, calling onRow(record) with an object keyed by column name. */
function readFeed(file, onRow) {
  let header = null;
  const parser = csvStream((cols) => {
    if (!header) {
      header = cols.map((h, i) => (i === 0 ? h.replace(/^﻿/, '') : h).replace(/^Tickets:/, ''));
      return;
    }
    if (cols.length < 2) return;
    onRow(Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ''])), header);
  });
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    gunzip.setEncoding('utf8');
    gunzip.on('data', (chunk) => parser.write(chunk));
    gunzip.on('end', () => { parser.end(); resolve(header || []); });
    gunzip.on('error', () => reject(new Error('Le flux Fnac reçu n\'est pas en gzip : choisir « Compression Type : gzip » dans Create-a-Feed.')));
    fs.createReadStream(file).on('error', reject).pipe(gunzip);
  });
}

// ───────────────────────────── Fields ─────────────────────────────

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** "2026-10-24 20:00:00", "2026-10-24T20:00", "24/10/2026 20:00" → "2026-10-24"; else null. */
function isoDate(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** "2026-10-24 20:30:00" → "20h30"; a date alone (or midnight) → "". */
function timeOf(raw) {
  const m = String(raw || '').match(/[ T](\d{2}):(\d{2})/);
  return m && m[1] + m[2] !== '0000' ? `${m[1]}h${m[2]}` : '';
}

/** The town: `event_location_city` is empty in the feed (12/10), `venue_address` holds it. */
function rowCity(row) {
  const city = String(row.event_location_city || '').trim();
  if (city) return city;
  const address = String(row.venue_address || '').trim();
  return address === '.' ? '' : address;
}

/**
 * 'zone' — a commune of COMMUNE_TABLE that the two-ring rule keeps;
 * 'near' — a name we do not know (old commune, hamlet) but coordinates within the radius;
 * 'out'  — everything else. inZone() lets unknown names pass, so it is not enough on its own here:
 *          the feed is national.
 */
function zoneOf(row) {
  // Required here, not at the top: fetch-events requires this module.
  const { canonicalCommune, inZone, distanceKm, CONFIG, COMMUNE_TABLE } = require('./fetch-events');
  const known = new Set(['Fontainebleau', ...COMMUNE_TABLE.map((c) => c[0])]);
  const city = canonicalCommune(rowCity(row));
  if (known.has(city)) return inZone(city) ? 'zone' : 'out';
  const lat = num(row.latitude), lng = num(row.longitude);
  if (lat != null && lng != null && distanceKm(lat, lng) <= CONFIG.maxRadiusKm) return 'near';
  return 'out';
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * « Mulan - Espace Nino Ferrer, Dammarie-lès-Lys » → « Mulan »; « Malik Bentalha - Nouveau Monde -
 * Tournée » → « Malik Bentalha - Nouveau Monde ». The venue and the tour are said elsewhere on the
 * card, and a bare title is what matches the same show announced by another source.
 */
function cleanTitle(title, venue, city) {
  let t = String(title || '').trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(/\s*[-,–]\s*tourn[ée]e\s*$/i, '');
    const cut = t.lastIndexOf(' - ');
    if (cut > 0) {
      const tail = fold(t.slice(cut + 3));
      if ((venue && tail.includes(fold(venue))) || (city && tail.includes(fold(city)))) t = t.slice(0, cut);
    }
    if (t === before) break;
  }
  return t.trim();
}

const SMALL_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'a', 'au', 'aux', 'sur']);

/** « LA GRANGE DE LA FERME DES JEUX » → « La Grange de la Ferme des Jeux ». Mixed case is kept. */
function venueCase(name) {
  const s = String(name || '').trim();
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(' ').map((w, i) => {
    if (i > 0 && SMALL_WORDS.has(w)) return w;
    // « l'escale » → « L'Escale »: the letter after an apostrophe is capitalised too.
    return w.replace(/(^|['’-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
  }).join(' ');
}

/** 29 → « 29 € », 36.1 → « 36,10 € ». */
const euros = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} €`;

function priceOf(row) {
  const min = num(row.min_price) ?? num(row.search_price);
  const max = num(row.max_price);
  if (min == null || min <= 0) return '';
  return max != null && max > min ? `De ${euros(min)} à ${euros(max)}` : euros(min);
}

/**
 * « Présenté par la Mairie de Dammarie-les-Lys (L-PLATESV-D-2024-002430).Un récit… » →
 * organizer « La Mairie de Dammarie-les-Lys », description « Un récit… ». The licence number is
 * for the authorities, not for the visitor.
 *
 * The preamble is irregular (12/10): « … (licence) et AKS. », « … (licence) & Philgood Prod.Avec »,
 * « … Productions (licence)   Christelle Chollet fête… » with no full stop, or no licence at all.
 * The organiser is taken only when a licence in brackets closes it; without one, the preamble is
 * dropped up to its first full stop and nobody is named.
 */
function splitPresenter(description) {
  const text = String(description || '').trim();
  if (!/^Présenté\s+par\s/.test(text)) return { organizer: '', description: text };
  const withLicence = text.match(/^Présenté\s+par\s+([^.()]{3,100}?)\s*\([^)]*\)\s*(?:(?:et|&)\s[^.]{1,60}\.)?\s*\.?\s*/);
  if (withLicence) {
    const who = withLicence[1].trim();
    return { organizer: who.charAt(0).toUpperCase() + who.slice(1), description: text.slice(withLicence[0].length).trim() };
  }
  const stop = text.indexOf('.');
  return { organizer: '', description: stop > 0 ? text.slice(stop + 1).trim() : text };
}

// ───────────────────────────── Load ─────────────────────────────

/**
 * Downloads and filters the feed. Returns { rows, meta } — rows are the feed rows inside the zone
 * and the window, ready for toPipelineEvents(). `skipped` when AWIN_FEED_URL is not set.
 * `file` reads a feed already on disk (the probe's snapshot) instead of downloading.
 */
async function load({ today, windowEnd, file } = {}) {
  if (!file && !process.env.AWIN_FEED_URL) return { skipped: true, rows: [], meta: {} };
  let tmp = null;
  if (!file) {
    tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'francebillet-')), 'feed.csv.gz');
    await download(tmp);
    file = tmp;
  }
  const meta = { total: 0, inZone: 0, excluded: 0 };
  const rows = [];
  try {
    await readFeed(file, (row) => {
      meta.total++;
      if (zoneOf(row) === 'out') return;
      meta.inZone++;
      const date = isoDate(row.event_date);
      if (!date || date < today || date > windowEnd) return;
      if (EXCLUDED_CATEGORIES.test(row.merchant_category) || !String(row.venue_name || '').replace('.', '').trim()) { meta.excluded++; return; }
      rows.push(row);
    });
  } finally {
    if (tmp) fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
  if (meta.total === 0) throw new Error('Flux Fnac vide.');
  return { rows, meta };
}

/** Feed rows → the raw shape validateEvent() checks. One row is one dated performance. */
function toPipelineEvents(rows) {
  return rows.map((row) => {
    const city = rowCity(row);
    const venue = venueCase(row.venue_name);
    const { organizer, description } = splitPresenter(row.description);
    const date = isoDate(row.event_date);
    return {
      title: cleanTitle(row.event_name || row.product_name, row.venue_name, city),
      category: CULTURE_CATEGORIES.test(row.merchant_category) ? 'Culture & Ateliers' : 'Scène & Spectacles',
      ageMin: 0,
      ageMax: 99,
      city,
      locationName: venue,
      lat: num(row.latitude),
      lng: num(row.longitude),
      dateType: 'event',
      startDate: date,
      endDate: date,
      schedule: timeOf(row.event_date),
      price: priceOf(row),
      organizer,
      description,
      url: row.merchant_deep_link,
      ticketUrl: isTicketUrl(row.aw_deep_link) ? row.aw_deep_link : undefined,
      source: 'francebillet',
      // The ticketing system's own venue coordinates, not a guess: see geoPrecise in validateEvent().
      geoPrecise: true,
    };
  });
}

module.exports = {
  download, readFeed, csvStream, load, toPipelineEvents,
  isoDate, timeOf, rowCity, zoneOf, cleanTitle, venueCase, priceOf, splitPresenter, isTicketUrl,
};
