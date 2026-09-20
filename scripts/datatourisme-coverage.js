#!/usr/bin/env node
/**
 * DATAtourisme coverage probe — OBSERVATION MODE.
 *
 * Reports what the DATAtourisme source adds to data.json. It reads data.json but NEVER writes it:
 * the only outputs are a report (stdout + GitHub job summary) and two JSON files under reports/.
 *
 * All the downloading and interpreting lives in scripts/datatourisme.js, the same module the
 * pipeline uses — so this report describes exactly what the pipeline would import, not an
 * approximation of it.
 *
 * Environment:
 *   DATA_PATH (data.json)              WINDOW_MONTHS (3)
 *   DT_MAX_EXAMPLES (20)               Examples listed per section
 *   DT_SHORT_EVENT_MAX_DAYS (14)       Above this an event counts as recurring / long-running
 *   DT_REPORT_DIR (reports)            Where the two JSON files are written
 *   DT_CSV_PATH                        Use a local CSV instead of downloading (tests)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parisToday, addMonths } = require('./fetch-events');
const dt = require('./datatourisme');

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  windowMonths: envInt('WINDOW_MONTHS', 3),
  maxExamples: envInt('DT_MAX_EXAMPLES', 20),
  dataPath: path.resolve(process.env.DATA_PATH || 'data.json'),
  reportDir: path.resolve(process.env.DT_REPORT_DIR || 'reports'),
};

function loadMyEvents() {
  if (!fs.existsSync(CONFIG.dataPath)) return [];
  const payload = JSON.parse(fs.readFileSync(CONFIG.dataPath, 'utf8'));
  const events = Array.isArray(payload) ? payload : (payload && payload.events);
  if (!Array.isArray(events)) throw new Error('data.json must be an array or { events: [...] }');
  return events;
}

const pct = (n, total) => (total ? Math.round((n / total) * 100) + ' %' : 'n/a');

function formatPeriod(e, today, windowEnd) {
  const p = dt.periodsInWindow(e, today, windowEnd)[0];
  if (!p) return '—';
  return p.start === p.end ? p.start : p.start + ' → ' + p.end;
}

function exampleTable(events, today, windowEnd, limit) {
  if (!events.length) return '_Aucun._\n';
  const rows = events.slice(0, limit).map((e) => {
    const title = e.title.replace(/\|/g, '/').slice(0, 60);
    const kind = e.classes.slice(0, 2).join(', ') || '—';
    const link = e.url ? 'oui' : '**non**';
    return '| ' + title + ' | ' + (e.city || '—') + ' | ' +
      formatPeriod(e, today, windowEnd) + ' | ' + kind + ' | ' + link + ' |';
  });
  const more = events.length > limit
    ? '\n_… et ' + (events.length - limit) + ' autres (voir les fichiers téléchargeables)._\n'
    : '';
  return ['| Événement | Commune | Dates | Type | Lien |', '|---|---|---|---|---|']
    .concat(rows).join('\n') + '\n' + more;
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
    "Mode observation : **`data.json` n'est pas modifié par ce workflow**.",
    '',
    '**Source :** `' + r.meta.resourceName + '` (' + (r.meta.sizeMb == null ? '?' : r.meta.sizeMb) +
      ' Mo, mis à jour le ' + r.meta.lastModified + ')',
    '**Fenêtre :** ' + r.today + ' → ' + r.windowEnd + ' · **Zone :** lat ' +
      dt.BBOX.latMin + '–' + dt.BBOX.latMax + ', lng ' + dt.BBOX.lngMin + '–' + dt.BBOX.lngMax,
    '',
    '### Volumes',
    '',
    '| Mesure | Valeur |',
    '|---|---|',
    '| Lignes dans le CSV régional | ' + c.rows + ' |',
    '| Événements (EntertainmentAndEvent) | ' + c.events + ' |',
    '| … dans la zone du projet | ' + c.inBox + ' |',
    '| … et dans la fenêtre de ' + CONFIG.windowMonths + ' mois | **' + c.inWindow + '** |',
    '| dont ponctuels — **importés** | ' + c.short + ' |',
    '| dont récurrents / marchés — **exclus** | ' + c.recurring + ' |',
    '',
    '### Recoupement avec `data.json`',
    '',
    '| Mesure | Valeur |',
    '|---|---|',
    '| Événements dans `data.json` | ' + c.mine + ' |',
    '| Ponctuels déjà présents (doublons évités) | ' + c.matched + ' (' + pct(c.matched, c.short) + ') |',
    '| **Ponctuels absents** | **' + c.missingShort + '** |',
    '| … dont sans lien, donc écartés à la validation | ' + c.missingNoUrl + ' |',
    '| Enregistrements produits (une entrée par date) | **' + c.pipelineRecords + '** |',
    '',
    '> Le recoupement est calculé sur les titres normalisés : il est **minoré**, deux formulations',
    "> différentes du même événement comptent comme deux événements.",
    '',
    '### Ponctuels absents de data.json',
    '',
    exampleTable(r.missingShort, r.today, r.windowEnd, CONFIG.maxExamples),
    '',
    '### Récurrents et marchés (exclus de l\'import)',
    '',
    exampleTable(r.recurring, r.today, r.windowEnd, CONFIG.maxExamples),
    '',
    '### Doublons détectés',
    '',
    matchedList,
    '',
  ].join('\n');
}

async function main() {
  const today = parisToday();
  const windowEnd = addMonths(today, CONFIG.windowMonths);
  console.log('🔍 DATAtourisme coverage ' + today + ' → ' + windowEnd);

  const loaded = await dt.load({ today, windowEnd });
  console.log('⬇️  ' + loaded.meta.resourceName + ' (' +
    (loaded.meta.sizeMb == null ? '?' : loaded.meta.sizeMb) + ' MB, ' + loaded.meta.lastModified + ')');

  const mine = loadMyEvents();
  const matched = [];
  const missingShort = [];
  for (const e of loaded.short) {
    const m = dt.findMatch(e, mine);
    if (m) matched.push({ dt: e, mine: m });
    else missingShort.push(e);
  }

  const counts = {
    rows: loaded.rowCount,
    events: loaded.all.length,
    inBox: loaded.boxed.length,
    inWindow: loaded.inWindow.length,
    short: loaded.short.length,
    recurring: loaded.recurring.length,
    mine: mine.length,
    matched: matched.length,
    missingShort: missingShort.length,
    missingNoUrl: missingShort.filter((e) => !e.url).length,
    pipelineRecords: dt.toPipelineEvents(missingShort.filter((e) => e.url), { today, maxDate: windowEnd }).length,
  };

  const report = renderReport({
    meta: loaded.meta, counts, missingShort, recurring: loaded.recurring, matched, today, windowEnd,
  });
  console.log('\n' + report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report); } catch { /* non-fatal */ }
  }

  fs.mkdirSync(CONFIG.reportDir, { recursive: true });
  const stamp = { generatedAt: new Date().toISOString(), today, windowEnd, source: loaded.meta, counts };
  fs.writeFileSync(path.join(CONFIG.reportDir, 'datatourisme-coverage.json'),
    JSON.stringify(stamp, null, 2) + '\n');
  fs.writeFileSync(path.join(CONFIG.reportDir, 'datatourisme-candidates.json'),
    JSON.stringify(Object.assign({}, stamp, { missingShort, recurring: loaded.recurring }), null, 2) + '\n');
  console.log('💾 Rapport écrit dans ' + CONFIG.reportDir + '/ (data.json intact).');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Fatal:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { main };
