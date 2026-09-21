#!/usr/bin/env node
/**
 * Translate the descriptions already in data.json, out of band.
 *
 * The pipeline translates during a scan (§3.O), which only runs every ~3 days and costs four
 * grounded Gemini calls. This utility does the translation *alone*: no scan, no grounding, no
 * search queries — just the descriptions. Two uses:
 *
 *   1. `--sample` — read a handful of translations before any of them go live. The pipeline
 *      publishes straight to main with no human review, so checking the wording once, cheaply,
 *      is worth more than checking it after 171 cards are already online.
 *   2. `--write` — fill data.json now instead of waiting for the next scan.
 *
 * It shares `translate-cache.json` with the pipeline, so nothing is ever paid for twice: commit
 * the cache and the next scan finds every description already translated.
 *
 * `generatedAt` is left untouched — no new events were collected, and bumping it would push the
 * next scheduled scan 60 h further out.
 *
 * Usage:
 *   node scripts/translate-data.js                 # preview 5, writes nothing
 *   node scripts/translate-data.js --sample 12     # preview 12
 *   node scripts/translate-data.js --write         # translate everything, update data.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const translate = require('./translate');
const { serializeEvent } = require('./fetch-events');

const DATA_PATH = path.resolve(process.env.DATA_PATH || 'data.json');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');

  const write = process.argv.includes('--write');
  const sampleSize = write ? 0 : Math.max(1, parseInt(arg('--sample', '5'), 10) || 5);

  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const payload = JSON.parse(raw);
  const legacy = Array.isArray(payload);
  const events = legacy ? payload : payload.events;
  if (!Array.isArray(events)) throw new Error('data.json holds no events array');

  // In preview mode the sample is detached from data.json, so nothing can be written by accident.
  const targets = write
    ? events
    : events.filter((e) => e.description).slice(0, sampleSize).map((e) => ({ description: e.description }));

  console.log(write
    ? `🌍 Traduction de ${events.length} événement(s) — appel non grounded, cache partagé avec le pipeline…`
    : `👀 Aperçu de ${targets.length} traduction(s) — rien ne sera écrit.\n`);

  const stats = await translate.translateDescriptions(targets, { dryRun: !write });

  if (stats.skipped) { console.log(`Traduction désactivée (${stats.skipped}).`); return; }

  for (const e of targets.filter((t) => t.descriptionEn).slice(0, write ? 3 : targets.length)) {
    console.log('FR : ' + e.description);
    console.log('EN : ' + e.descriptionEn + '\n');
  }

  console.log(`${stats.fromCache} en cache · ${stats.translated} traduite(s) en ${stats.batches} lot(s) · ${stats.failed} échec(s)`);
  if (stats.translated) console.log(`tokens : ${stats.tokensIn} in / ${stats.tokensOut} out`);
  for (const e of stats.errors) console.error('⚠️  ' + e);

  if (!write) {
    console.log('\n(aperçu — relancer avec --write pour remplir data.json)');
    return;
  }

  // serializeEvent() enforces the canonical field order. Without it descriptionEn would be
  // appended at the end of every record, and the next scan would reorder all 171 of them at once
  // for nothing.
  const ordered = events.map(serializeEvent);
  const output = JSON.stringify(legacy ? ordered : { ...payload, events: ordered }, null, 2) + '\n';
  fs.writeFileSync(DATA_PATH, output);
  const done = ordered.filter((e) => e.descriptionEn).length;
  console.log(`\n✍️  data.json mis à jour — ${done}/${events.length} description(s) en anglais.`);
  console.log('generatedAt inchangé. Commite data.json ET translate-cache.json.');
}

main().catch((err) => {
  console.error('❌ ' + (err && err.message ? err.message : err));
  process.exit(1);
});
