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
 * The feed is the whole national catalogue (12/10: ~111 000 products, 524 MB uncompressed), so it is
 * read as a stream (scripts/francebillet.js, shared with the pipeline): only the rows inside the
 * zone are kept, the rest feeds counters.
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
const fb = require('./francebillet');
const { canonicalCommune, CONFIG, parisToday, addMonths } = require('./fetch-events');
const { matchLevel } = require('./compare-sources');

const REPORT_DIR = path.resolve(process.env.REPORT_DIR || 'reports');
const SNAPSHOT = path.join(REPORT_DIR, 'francebillet-feed.csv.gz');
const REPORT = path.join(REPORT_DIR, 'francebillet-probe.md');

/** Downloads the feed to SNAPSHOT (streamed, never held in memory), unless REUSE_SNAPSHOT=1. */
async function fetchSnapshot() {
  if (process.env.REUSE_SNAPSHOT === '1') {
    if (!fs.existsSync(SNAPSHOT)) throw new Error(`REUSE_SNAPSHOT=1 mais ${SNAPSHOT} n'existe pas : lancer une fois avec AWIN_FEED_URL.`);
    return;
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  await fb.download(SNAPSHOT);
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
  await fb.readFeed(SNAPSHOT, (r, cols) => {
    if (!header) {
      header = cols;
      stats.filled = header.map(() => 0);
      stats.example = header.map(() => '');
    }
    stats.rows++;
    header.forEach((h, i) => { const v = r[h]; if (v.trim()) { stats.filled[i]++; if (!stats.example[i]) stats.example[i] = v; } });
    r.event_location_city = fb.rowCity(r);
    r.title = r.event_name || r.product_name || '';
    r.date = fb.isoDate(r.event_date) || fb.isoDate(r.valid_from);
    if (!r.date) { stats.undated++; if (r.event_date && stats.undatedSamples.length < 5) stats.undatedSamples.push(r.event_date); }
    const city = r.event_location_city || '(vide)';
    stats.cities.set(city, (stats.cities.get(city) || 0) + 1);
    stats.categories.set(r.merchant_category || '(vide)', (stats.categories.get(r.merchant_category || '(vide)') || 0) + 1);
    if (stats.firstRows.length < 3) stats.firstRows.push(r);
    r.zone = fb.zoneOf(r);
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

