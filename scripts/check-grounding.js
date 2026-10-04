#!/usr/bin/env node
/**
 * Does Google Search grounding actually run? A diagnostic, nothing written.
 *
 * The 03/10 report showed "no grounding metadata" on all four scans: the model answered from
 * memory. The calls succeeded and tokens were billed, so the key and the billing work at least
 * for plain generation. This script separates the remaining causes with a handful of small calls:
 *
 *   1. Which models the key can see (free listing call).
 *   2. A short question that cannot be answered without the web, with the tool spelled
 *      `google_search` (what the pipeline sends) and `googleSearch`. If neither searches, the
 *      tool itself is unavailable to this key or model: billing tier, model, or API change.
 *   3. The four real scans, with the exact request body the pipeline sends (geminiRequestBody).
 *      If (2) searches and (3) does not, the model chooses not to search on our prompt: a prompt
 *      problem, not an account problem. That was the 04/10 finding.
 *
 * Cost: two short calls plus four real scans per model, about 0.25 $ per model; searches within
 * the free quota.
 *
 * Usage:
 *   GEMINI_API_KEY=… node scripts/check-grounding.js
 *   GEMINI_API_KEY=… node scripts/check-grounding.js --models gemini-3.6-flash,gemini-3.8-flash
 *   GEMINI_API_KEY=… node scripts/check-grounding.js --no-scan      # skip the real-prompt call
 */

'use strict';

const fs = require('fs');
const { buildPrompt, geminiRequestBody, SCANS, CONFIG, addMonths, parisToday } = require('./fetch-events');

const API = 'https://generativelanguage.googleapis.com/v1beta';
const SHORT_PROMPT = 'Cherche sur le web : quels événements sont annoncés à Fontainebleau (Seine-et-Marne) '
  + 'dans les sept prochains jours ? Réponds en trois lignes au plus, avec la date de chaque événement.';

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const models = (argValue('--models') || CONFIG.model).split(',').map((m) => m.trim()).filter(Boolean);
const withScan = !args.includes('--no-scan');

const out = [];
const log = (line = '') => { console.log(line); out.push(line); };

async function call(path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY, ...(init.headers || {}) },
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* error pages are not always JSON */ }
  return { status: res.status, body, text };
}

async function listModels() {
  const { status, body, text } = await call('models?pageSize=1000');
  if (status !== 200) return log(`- ❌ Liste des modèles : HTTP ${status} — ${text.slice(0, 300)}`);
  const names = (body.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /gemini-3/.test(n));
  log(`- Modèles Gemini 3 visibles avec cette clé : ${names.length ? names.map((n) => `\`${n}\``).join(', ') : 'aucun'}`);
}

const shortBody = (toolKey) => ({
  contents: [{ parts: [{ text: SHORT_PROMPT }] }],
  tools: [{ [toolKey]: {} }],
  generationConfig: { temperature: CONFIG.temperature, maxOutputTokens: CONFIG.maxOutputTokens },
});

async function probe(model, label, request, toolKey) {
  const { status, body, text } = await call(`models/${model}:generateContent`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  if (status !== 200) {
    // A quota or billing problem shows here, as an HTTP error, not as a silent answer.
    log(`| \`${model}\` | ${label} | \`${toolKey}\` | ❌ HTTP ${status} : ${text.replace(/\s+/g, ' ').slice(0, 200)} | | |`);
    return;
  }
  const c = body?.candidates?.[0] || {};
  const gm = c.groundingMetadata;
  const u = body.usageMetadata || {};
  const queries = gm?.webSearchQueries || [];
  const verdict = gm ? (queries.length ? '✅ recherche faite' : '⚠️ métadonnées sans requête') : '❌ aucune recherche';
  log(`| \`${model}\` | ${label} | \`${toolKey}\` | ${verdict} | ${queries.length} / ${gm?.groundingChunks?.length ?? 0} | `
    + `${u.promptTokenCount ?? '?'} / ${u.candidatesTokenCount ?? '?'} / ${u.thoughtsTokenCount ?? 0} / ${u.toolUsePromptTokenCount ?? 0} |`);
  if (queries.length) log(`|  |  |  | requêtes : ${queries.slice(0, 4).map((q) => `« ${q} »`).join(', ')} | | |`);
  // Keys of the candidate: if Google renamed or moved the metadata, it shows here.
  log(`|  |  |  | champs : ${Object.keys(c).join(', ')} · fin : ${c.finishReason ?? '?'} · version : ${body.modelVersion ?? '?'} | | |`);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY manquant.');
    process.exit(1);
  }
  log('## 🔬 Diagnostic de la recherche Google (grounding)', '');
  await listModels();
  log('');
  log('| Modèle | Prompt | Outil | Résultat | Requêtes / pages | Tokens in / out / thoughts / outil |');
  log('|---|---|---|---|---|---|');

  const today = parisToday();
  const ctx = { today, maxDate: addMonths(today, CONFIG.windowMonths) };
  for (const model of models) {
    await probe(model, 'question courte', shortBody('google_search'), 'google_search');
    await probe(model, 'question courte', shortBody('googleSearch'), 'googleSearch');
    if (!withScan) continue;
    for (const scan of SCANS) {
      await probe(model, `vrai scan « ${scan.name} »`, geminiRequestBody(buildPrompt(scan, ctx)), 'google_search');
    }
  }
  log('');
  log('Lecture : aucune recherche nulle part → compte, modèle ou API (voir le palier de facturation dans AI Studio). '
    + 'Recherche sur la question courte mais pas sur le vrai scan → le modèle choisit de ne pas chercher : prompt à revoir. '
    + 'HTTP 429 / 403 → quota ou facturation.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n'); } catch { /* non-fatal */ }
  }
}

main().catch((err) => {
  console.error('❌', err && err.message ? err.message : err);
  process.exit(1);
});
