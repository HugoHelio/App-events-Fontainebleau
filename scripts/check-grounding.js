#!/usr/bin/env node
/**
 * Does Google Search grounding actually run? A diagnostic, nothing written.
 *
 * History (04/10): the scans had stopped searching. The diagnostic showed the key, the billing
 * and the tool all work — a short question searches — but a structured scan prompt never does,
 * whatever the model, the system instruction or the thinking level. The scan now runs in two
 * steps (fetch-events.js, `runScan`): short grounded questions in prose, then an ungrounded call
 * that formats them. This script runs that real scan, without publishing anything:
 *
 *   1. Which models the key can see (free listing call).
 *   2. A short control question. If it does not search, the problem is the account or the API
 *      (billing tier in AI Studio), not our prompts.
 *   3. `runScan()` for each scan, exactly as the pipeline calls it: searches made, questions
 *      answered without a search (discarded), events produced, and how many of their links are
 *      mere home pages (a sign of memory rather than reading).
 *
 * Cost: about 0.05 $ per scan, 0.20 $ per model; searches within the free quota.
 *
 * Usage:
 *   GEMINI_API_KEY=… node scripts/check-grounding.js
 *   GEMINI_API_KEY=… node scripts/check-grounding.js --models gemini-3.6-flash,gemini-3.8-flash
 *   GEMINI_API_KEY=… node scripts/check-grounding.js --no-scan      # control question only
 */

'use strict';

const fs = require('fs');
const { runScan, searchRequestBody, callGemini, extractText, SCANS, CONFIG, addMonths, parisToday } = require('./fetch-events');

const SHORT_PROMPT = 'Cherche sur le web : quels événements sont annoncés à Fontainebleau (Seine-et-Marne) '
  + 'dans les sept prochains jours ? Réponds en trois lignes au plus, avec la date de chaque événement.';

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const models = (argValue('--models') || CONFIG.model).split(',').map((m) => m.trim()).filter(Boolean);
const withScan = !args.includes('--no-scan');

const out = [];
const log = (line = '') => { console.log(line); out.push(line); };
const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ');
const tokens = (u) => `${u?.promptTokenCount ?? '?'} / ${u?.candidatesTokenCount ?? '?'} / ${u?.thoughtsTokenCount ?? 0}`;
const isHome = (u) => { try { return new URL(u).pathname.replace(/\/$/, '') === ''; } catch { return false; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '—'; } };

async function listModels() {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return log(`- ❌ Liste des modèles : HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  const names = ((await res.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /gemini-3/.test(n));
  log(`- Modèles Gemini 3 visibles avec cette clé : ${names.length ? names.map((n) => `\`${n}\``).join(', ') : 'aucun'}`);
}

async function control(model) {
  try {
    const info = extractText(await callGemini(searchRequestBody(SHORT_PROMPT), model));
    const verdict = info.searchQueries > 0 ? '✅ recherche faite' : '❌ aucune recherche';
    log(`| \`${model}\` | question témoin | ${verdict} | ${info.searchQueries} / ${info.webSources} | — | ${tokens(info.usage)} |`);
  } catch (err) {
    // A quota or billing problem shows here, as an HTTP error, not as a silent answer.
    log(`| \`${model}\` | question témoin | ❌ ${cell(String(err.message).slice(0, 200))} | | | |`);
  }
}

async function scan(model, s, ctx) {
  try {
    const { events, meta } = await runScan(s, ctx);
    const urls = events.map((e) => e.url).filter(Boolean);
    const homes = urls.filter(isHome).length;
    const verdict = meta.searchQueries > 0 ? `✅ ${events.length} événement(s)` : '🚫 aucune recherche, rien gardé';
    log(`| \`${model}\` | scan « ${s.name} » | ${verdict} | ${meta.searchQueries} / ${meta.webSources} | `
      + `${meta.unsearched}/${meta.questions} | ${tokens(meta.usage)} |`);
    log(`|  | liens | ${urls.length}, dont ${homes} page(s) d'accueil | | | |`);
    for (const e of events.slice(0, 4)) {
      log(`|  |  | ${cell(`${e.startDate} · ${String(e.title).slice(0, 70)} · ${host(e.url)}`)} | | | |`);
    }
  } catch (err) {
    log(`| \`${model}\` | scan « ${s.name} » | ❌ ${cell(String(err.message).slice(0, 200))} | | | |`);
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY manquant.');
    process.exit(1);
  }
  log('## 🔬 Diagnostic de la recherche Google (grounding)', '');
  await listModels();
  log('');
  log('| Modèle | Test | Résultat | Requêtes / pages | Questions sans recherche | Tokens in / out / thoughts |');
  log('|---|---|---|---|---|---|');

  const today = parisToday();
  const ctx = { today, maxDate: addMonths(today, CONFIG.windowMonths) };
  for (const model of models) {
    CONFIG.model = model;   // runScan calls the model the pipeline is configured with
    await control(model);
    if (!withScan) continue;
    for (const s of SCANS) await scan(model, s, ctx);
  }
  log('');
  log('Lecture : question témoin sans recherche → compte ou API (palier de facturation dans AI Studio), '
    + 'HTTP 429 / 403 → quota ou facturation. Scans ✅ → la collecte cherche vraiment ; une question sans '
    + 'recherche est écartée, jamais publiée. Beaucoup de pages d\'accueil dans les liens → réponses de mémoire.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n'); } catch { /* non-fatal */ }
  }
}

main().catch((err) => {
  console.error('❌', err && err.message ? err.message : err);
  process.exit(1);
});
