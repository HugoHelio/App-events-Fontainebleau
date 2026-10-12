#!/usr/bin/env node
/**
 * Probe of the Fnac Spectacles / France Billet product feed (Awin), item 83d. Observation only:
 * publishes nothing, writes nothing the site serves.
 *
 * The question: how many dates does the national ticketing sell inside our zone, and how many of
 * them are already on the site? The answer decides 83e (booking buttons + a fifth legitimate
 * source). The report also shows the feed's shape (which columns are filled, date format), since
 * the integration will depend on it.
 *
 * The feed is the whole national catalogue (12/10: ~200 000 lines, 524 MB uncompressed), so it is
 * read as a stream: only the rows inside the zone are kept, the rest feeds counters.
 *
 * The feed URL holds a personal API key: it is read from AWIN_FEED_URL (GitHub secret of the same
 * name) and never printed, not even in an error message.
 *
 *   AWIN_FEED_URL=… node scripts/probe-francebillet.js
 *   REUSE_SNAPSHOT=1 node scripts/probe-francebillet.js     reread reports/francebillet-feed.csv.gz
 *
 * Output: reports/francebillet-probe.md (gitignored, like the sources comparison).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { canonicalCommune, inZone, distanceKm, CONFIG, parisToday, addMonths, COMMUNE_TABLE } = require('./fetch-events');
const { matchLevel } = require('./compare-sources');

// canonicalCommune() returns an unknown name unchanged: the table tells a known commune apart.
const KNOWN = new Set(['Fontainebleau', ...COMMUNE_TABLE.map((c) => c[0])]);

const REPORT_DIR = path.resolve(process.env.REPORT_DIR || 'reports');
const SNAPSHOT = path.join(REPORT_DIR, 'francebillet-feed.csv.gz');
const REPORT = path.join(REPORT_DIR, 'francebillet-probe.md');

// ───────────────────────────── Feed ─────────────────────────────

/** Downloads the feed to SNAPSHOT (streamed, never held in memory), unless REUSE_SNAPSHOT=1. */
async function fetchSnapshot() {
  if (process.env.REUSE_SNAPSHOT === '1') {
    if (!fs.existsSync(SNAPSHOT)) throw new Error(`REUSE_SNAPSHOT=1 mais ${SNAPSHOT} n'existe pas : lancer une fois avec AWIN_FEED_URL.`);
    return;
  }
  const url = (process.env.AWIN_FEED_URL || '').trim();
  if (!/^https:\/\/productdata\.awin\.com\//.test(url)) {
    throw new Error('AWIN_FEED_URL absente ou inattendue (doit commencer par https://productdata.awin.com/).');
  }
  // The URL carries the API key: errors report the HTTP status only.
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error(`Téléchargement du flux refusé : HTTP ${res.status}.`);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(fs.createWriteStream(SNAPSHOT)).on('finish', resolve).on('error', reject);
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

function readFeed(onRow) {
  const parser = csvStream(onRow);
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    gunzip.setEncoding('utf8');
    gunzip.on('data', (chunk) => parser.write(chunk));
    gunzip.on('end', () => { parser.end(); resolve(); });
    gunzip.on('error', () => reject(new Error('Le flux reçu n\'est pas en gzip : choisir « Compression Type : gzip » dans Create-a-Feed.')));
    fs.createReadStream(SNAPSHOT).on('error', reject).pipe(gunzip);
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

/**
 * 'zone' — a commune of COMMUNE_TABLE that the two-ring rule keeps;
 * 'near' — a name we do not know (old commune, hamlet) but coordinates within the radius;
 * 'out'  — everything else. inZone() lets unknown names pass, so it is not enough on its own here:
 *          the feed is national.
 */
function zoneOf(row) {
  const city = canonicalCommune(row.event_location_city || '');
  if (KNOWN.has(city)) return inZone(city) ? 'zone' : 'out';
  const lat = num(row.latitude), lng = num(row.longitude);
  if (lat != null && lng != null && distanceKm(lat, lng) <= CONFIG.maxRadiusKm) return 'near';
  return 'out';
}

// ───────────────────────────── Report ─────────────────────────────

const cut = (s, n = 80) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const cell = (s, n) => cut(s, n).replace(/\|/g, '/');

function render({ header, stats, zone, today, windowEnd, published }) {
  const out = [];
  out.push('# Sonde du flux Fnac Spectacles / France Billet (83d)', '');
  out.push(`Relevé du ${today}. Fenêtre : ${today} → ${windowEnd}. Observation seule, rien n'est publié.`, '');

  // 1. Shape of the feed.
  out.push('## 1. Forme du flux', '');
  out.push(`${stats.rows} lignes, ${header.length} colonnes (préfixe \`Tickets:\` retiré).`, '');
  out.push('| Colonne | Remplie | Exemple |', '|---|---|---|');
  header.forEach((col, i) => {
    if (!stats.filled[i]) return;
    out.push(`| \`${col}\` | ${Math.round((100 * stats.filled[i]) / stats.rows)} % | ${cell(stats.example[i], 70)} |`);
  });
  const empty = header.filter((_, i) => !stats.filled[i]);
  if (empty.length) out.push('', `Colonnes toujours vides : ${empty.map((c) => `\`${c}\``).join(', ')}.`);
  out.push('', `Dates lues dans \`event_date\` : ${stats.rows - stats.undated} / ${stats.rows}.`);
  if (stats.undated) out.push(`Illisibles ou absentes : ${stats.undated}${stats.undatedSamples.length ? ` (exemples : ${stats.undatedSamples.map((s) => `« ${cut(s, 30)} »`).join(', ')})` : ''}.`);
  const top = (m, n = 15) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${cut(k, 40)} ${v}`).join(', ');
  out.push(`Villes les plus fréquentes (tout le flux) : ${top(stats.cities)}.`);
  out.push(`Catégories (\`merchant_category\`) : ${top(stats.categories)}.`);

  // 2. The zone.
  const inWindow = zone.filter((r) => r.date && r.date >= today && r.date <= windowEnd);
  const count = (key) => { const m = new Map(); for (const r of zone) m.set(r[key] || '(vide)', (m.get(r[key] || '(vide)') || 0) + 1); return m; };
  out.push('', '## 2. Dans la zone', '');
  out.push(`- **${zone.length}** lignes dans la zone (${zone.filter((r) => r.zone === 'near').length} par les coordonnées seules, commune inconnue de la table)`);
  out.push(`- **${inWindow.length}** dans la fenêtre de publication, ${zone.filter((r) => r.date && r.date < today).length} déjà passées, ${zone.filter((r) => r.date && r.date > windowEnd).length} au-delà de la fenêtre`);
  out.push(`- Par commune : ${top(count('event_location_city'), 40) || 'aucune'}`);
  out.push(`- Par salle : ${top(count('venue_name'), 40) || 'aucune'}`);

  // 3. Against the site.
  let strict = 0, probable = 0;
  const gemini = new Set();
  const lines = inWindow.sort((a, b) => a.date.localeCompare(b.date)).map((r) => {
    // Both names: event_name can be as short as « Le Legs », too short for matchLevel alone.
    const cands = [...new Set([r.event_name, r.product_name].filter(Boolean))]
      .map((title) => ({ title, city: canonicalCommune(r.event_location_city || ''), startDate: r.date, endDate: r.date }));
    let best = null, level = null;
    for (const e of published) {
      const levels = cands.map((c) => matchLevel(e, c));
      const l = levels.includes('strict') ? 'strict' : levels.find(Boolean);
      if (l === 'strict') { best = e; level = l; break; }
      if (l === 'probable' && !best) { best = e; level = l; }
    }
    if (level === 'strict') strict++; else if (level === 'probable') probable++;
    // A Gemini-only fiche that the feed confirms is the item-72 gain: count them apart.
    if (best && !best.source) gemini.add(best.id);
    const price = r.min_price || r.search_price || r.display_price || '';
    return `| ${r.date} | ${cell(r.title, 60)} | ${cell(r.venue_name, 35)} | ${cell(r.event_location_city, 25)} | ${cell(price, 12)} | ${best ? `${level === 'strict' ? '✅' : '❔'} \`${best.id}\` (${best.source || 'gemini'})` : '🆕'} |`;
  });
  out.push('', '## 3. Face au site', '');
  out.push(`Sur ${inWindow.length} dates : **${strict}** déjà publiées (✅), **${probable}** probables (❔), **${inWindow.length - strict - probable}** absentes du site (🆕).`);
  out.push(`Fiches Gemini seules que le flux confirmerait : **${gemini.size}**.`);
  if (lines.length) out.push('', '| Date | Spectacle | Salle | Commune | Prix | Sur le site |', '|---|---|---|---|---|---|', ...lines);

  const later = zone.filter((r) => !inWindow.includes(r)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (later.length) {
    out.push('', `Hors fenêtre (${later.length}) :`, '');
    for (const r of later) out.push(`- ${r.date || '?'} · ${cut(r.title, 70)} · ${cut(r.venue_name, 40)} (${r.event_location_city || '?'}) · ${r.min_price || r.search_price || ''}`);
  }

  // 4. Raw samples, to read the format by eye.
  const sample = (inWindow.length ? inWindow : zone.length ? zone : stats.firstRows).slice(0, 3);
  out.push('', '## 4. Échantillon brut', '');
  for (const r of sample) {
    out.push('```');
    for (const col of header) if (String(r[col] || '').trim()) out.push(`${col}: ${cut(r[col], 160)}`);
    out.push('```');
  }
  return out.join('\n');
}

// ───────────────────────────── Main ─────────────────────────────

async function main() {
  await fetchSnapshot();

  let header = null;
  const zone = [];
  const stats = { rows: 0, filled: [], example: [], undated: 0, undatedSamples: [], cities: new Map(), categories: new Map(), firstRows: [] };
  await readFeed((cols) => {
    if (!header) {
      header = cols.map((h, i) => (i === 0 ? h.replace(/^﻿/, '') : h).replace(/^Tickets:/, ''));
      stats.filled = header.map(() => 0);
      stats.example = header.map(() => '');
      return;
    }
    if (cols.length < 2) return;
    stats.rows++;
    cols.forEach((v, i) => { if (v.trim()) { stats.filled[i]++; if (!stats.example[i]) stats.example[i] = v; } });
    const r = Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
    // 12/10: event_location_city is empty on every row; the town is in venue_address (« MELUN »).
    if (!r.event_location_city.trim()) r.event_location_city = r.venue_address.trim() === '.' ? '' : r.venue_address.trim();
    r.title = r.event_name || r.product_name || '';
    r.date = isoDate(r.event_date) || isoDate(r.valid_from);
    if (!r.date) { stats.undated++; if (r.event_date && stats.undatedSamples.length < 5) stats.undatedSamples.push(r.event_date); }
    const city = r.event_location_city || '(vide)';
    stats.cities.set(city, (stats.cities.get(city) || 0) + 1);
    stats.categories.set(r.merchant_category || '(vide)', (stats.categories.get(r.merchant_category || '(vide)') || 0) + 1);
    if (stats.firstRows.length < 3) stats.firstRows.push(r);
    r.zone = zoneOf(r);
    if (r.zone !== 'out') zone.push(r);
  });
  if (!header) throw new Error('Flux vide.');

  const today = parisToday();
  const data = JSON.parse(fs.readFileSync(CONFIG.dataPath, 'utf8'));
  const published = Array.isArray(data) ? data : data.events;
  const windowEnd = (!Array.isArray(data) && data.windowEnd) || addMonths(today, 3);

  const md = render({ header, stats, zone, today, windowEnd, published });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT, md + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
  console.log(`\n📄 ${path.relative(process.cwd(), REPORT)}`);
}

if (require.main === module) {
  main().catch((err) => { console.error('❌ probe-francebillet:', err && err.message ? err.message : err); process.exit(1); });
}

module.exports = { isoDate, zoneOf, csvStream };
