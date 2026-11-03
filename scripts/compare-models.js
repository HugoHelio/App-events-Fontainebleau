#!/usr/bin/env node
/**
 * Item 39 (03/11): can the calls WITHOUT search run on a cheaper model? A comparison, nothing
 * written or published. The same inputs go to two models, and the events they return are compared
 * — dates first, since a wrong date costs more than a missing event.
 *
 *   1. Formatting of the scans: the searched questions run ONCE (pipeline model), then their prose
 *      is formatted by both models.
 *   2. Organisers' sites (`page` readers): each site is read twice (once per model), the page cache
 *      bypassed.
 *   3. Tourist-office cards (enrich): a sample, enrichment cache bypassed; dates are not at stake
 *      there, only category, hours and venue.
 *
 * The duplicate judge and the translation stay on the pipeline model: together they cost under
 * 0.30 $ a month, and a wrong merge deletes an event.
 *
 * Cost: about 0.25 $ (searches within the free quota). ~10 minutes (polite reading of the sites).
 *
 * Usage:
 *   GEMINI_API_KEY=… node scripts/compare-models.js
 *   GEMINI_API_KEY=… node scripts/compare-models.js --b gemini-3.5-flash-lite --scans culture,famille
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Both caches bypassed, before the modules read their configuration: every reading asks the model.
process.env.SOURCES_PAGE_CACHE_DAYS = '0';
process.env.SOURCES_CACHE_PATH = path.join(os.tmpdir(), `compare-models-${process.pid}.json`);

const fe = require('./fetch-events');
const sources = require('./sources');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const MODEL_A = arg('a', fe.CONFIG.model);
const MODEL_B = arg('b', 'gemini-3.1-flash-lite');
const ONLY_SCANS = arg('scans', 'culture,famille').split(',').map((s) => s.trim()).filter(Boolean);
const ENRICH_SAMPLE = Number(arg('enrich', '24'));

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const out = [];
const say = (line = '') => {
  console.log(line);
  out.push(line);
  if (summaryPath) fs.appendFileSync(summaryPath, line + '\n');
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
/** Two titles name the same event when most of the shorter one's words are in the other. */
function sameTitle(x, y) {
  const a = words(x);
  const b = words(y);
  if (!a.size || !b.size) return norm(x) === norm(y);
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / Math.min(a.size, b.size) >= 0.6;
}

/**
 * Pairs A's events with B's by title. Same title, same dates: agreed. Same title, other dates:
 * the line that matters. The rest: found by one model only.
 */
function compare(label, evA, evB) {
  const left = [...evB];
  const agreed = [];
  const dates = [];
  const onlyA = [];
  for (const a of evA) {
    const i = left.findIndex((b) => sameTitle(a.title, b.title));
    if (i < 0) { onlyA.push(a); continue; }
    const [b] = left.splice(i, 1);
    if (a.startDate === b.startDate && (a.endDate || a.startDate) === (b.endDate || b.startDate)) agreed.push(a);
    else dates.push([a, b]);
  }
  const d = (e) => (e.endDate && e.endDate !== e.startDate ? `${e.startDate} → ${e.endDate}` : e.startDate);
  say(`### ${label}`);
  say(`- ${MODEL_A} : ${evA.length} · ${MODEL_B} : ${evB.length} · **mêmes dates : ${agreed.length}** · ` +
    `**dates différentes : ${dates.length}** · seulement ${MODEL_A} : ${onlyA.length} · seulement ${MODEL_B} : ${left.length}`);
  for (const [a, b] of dates) say(`  - ⚠️ « ${a.title} » : ${d(a)} (${MODEL_A}) / ${d(b)} (${MODEL_B})`);
  for (const a of onlyA) say(`  - seulement ${MODEL_A} : « ${a.title} » ${d(a)}`);
  for (const b of left) say(`  - seulement ${MODEL_B} : « ${b.title} » ${d(b)}`);
  say();
  return { agreed: agreed.length, dates: dates.length, onlyA: onlyA.length, onlyB: left.length };
}

const tokens = { [MODEL_A]: { in: 0, out: 0 }, [MODEL_B]: { in: 0, out: 0 } };
const count = (model, u) => {
  if (!u) return;
  tokens[model].in += u.promptTokenCount || 0;
  tokens[model].out += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
};

async function formatting(ctx) {
  say('## 1. Mise en forme des scans');
  say(`Questions cherchées une fois (${fe.CONFIG.model}), réponses mises en forme par les deux modèles.`);
  say();
  const totals = [];
  for (const scan of fe.SCANS.filter((s) => ONLY_SCANS.includes(s.name))) {
    const findings = [];
    for (const q of fe.buildQuestions(scan, ctx)) {
      const info = fe.extractText(await fe.callGemini(fe.searchRequestBody(q)));
      if (info.searchQueries > 0 || info.webSources > 0) findings.push(info.text);
    }
    if (!findings.length) { say(`### Scan ${scan.name} : aucune question n'a cherché, rien à comparer`); continue; }
    const body = fe.formatRequestBody(fe.buildPrompt(scan, ctx, findings.join('\n\n---\n\n')));
    const res = {};
    for (const model of [MODEL_A, MODEL_B]) {
      try {
        const info = fe.extractText(await fe.callGemini(body, model));
        count(model, info.usage);
        res[model] = fe.extractJsonArray(info.text).events;
      } catch (err) {
        say(`- ❌ ${model}, scan ${scan.name} : ${String(err.message).slice(0, 200)}`);
        res[model] = [];
      }
    }
    totals.push(compare(`Scan ${scan.name}`, res[MODEL_A], res[MODEL_B]));
  }
  return totals;
}

async function sites(ctx) {
  say('## 2. Sites des organisateurs (lecteurs `page`)');
  say();
  const ids = sources.loadRegistry().filter((s) => s.type === 'page' && s.enabled !== false).map((s) => s.id);
  const res = {};
  for (const model of [MODEL_A, MODEL_B]) {
    sources.CONFIG.model = model;
    res[model] = await sources.load(ctx, { only: ids });
    for (const r of res[model]) count(model, r.usage);
  }
  const totals = [];
  for (const id of ids) {
    const a = res[MODEL_A].find((r) => r.id === id);
    const b = res[MODEL_B].find((r) => r.id === id);
    if (a.status !== 'ok' || b.status !== 'ok') {
      say(`### ${id} : ${a.status} / ${b.status} ${a.error || b.error || ''}`);
      continue;
    }
    if (!a.events.length && !b.events.length) continue;
    totals.push(compare(`Site ${id}`, a.events, b.events));
  }
  return totals;
}

async function enrichment(ctx) {
  say(`## 3. Fiches de l'office complétées (échantillon de ${ENRICH_SAMPLE})`);
  say();
  const [ot] = await sources.load(ctx, { only: ['ot-pays-fontainebleau'] });
  const sample = (ot && ot.events || []).filter((e) => e.detail).slice(0, ENRICH_SAMPLE);
  if (!sample.length) { say('- aucune fiche lue'); return; }
  const res = {};
  for (const model of [MODEL_A, MODEL_B]) {
    sources.CONFIG.enrichModel = model;
    // The URL keys the enrichment cache, kept in memory for the run: one key per model, or the
    // second model would be served the first one's answers.
    const copies = sample.map((e) => ({ ...e, url: `${e.url}#${model}` }));
    const st = await sources.enrich(copies, { dryRun: true, today: ctx.today });
    tokens[model].in += st.tokensIn;
    tokens[model].out += st.tokensOut;
    res[model] = copies;
  }
  let cat = 0;
  let sched = 0;
  for (let i = 0; i < sample.length; i++) {
    const a = res[MODEL_A][i];
    const b = res[MODEL_B][i];
    if (a.category !== b.category) { cat++; say(`- catégorie, « ${a.title} » : ${a.category} / ${b.category}`); }
    if (norm(a.schedule) !== norm(b.schedule)) { sched++; say(`- horaires, « ${a.title} » : « ${a.schedule} » / « ${b.schedule} »`); }
  }
  say(`- **${sample.length} fiches : ${cat} catégorie(s) et ${sched} horaire(s) différents**`);
  say();
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY manquante');
  const today = fe.parisToday();
  const ctx = { today, maxDate: fe.addMonths(today, fe.CONFIG.windowMonths) };
  say(`# Comparatif des modèles sans recherche — ${today}`);
  say(`A = \`${MODEL_A}\` (actuel) · B = \`${MODEL_B}\` (candidat). Rien n'est écrit ni publié.`);
  say();
  const all = [...await formatting(ctx), ...await sites(ctx)];
  await enrichment(ctx);
  const sum = (k) => all.reduce((a, t) => a + t[k], 0);
  say('## Bilan');
  say(`- événements datés : **mêmes dates ${sum('agreed')}**, **dates différentes ${sum('dates')}**, ` +
    `seulement A ${sum('onlyA')}, seulement B ${sum('onlyB')}`);
  for (const m of [MODEL_A, MODEL_B]) say(`- tokens ${m} : ${tokens[m].in} en entrée, ${tokens[m].out} en sortie (réflexion comprise)`);
  say('- Critère proposé : aucune date différente que B aurait fausse, et pas plus de fiches perdues que A n\'en perd lui-même.');
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'models-comparison.md'), out.join('\n') + '\n');
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
