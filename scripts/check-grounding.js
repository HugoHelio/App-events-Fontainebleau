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

// Same short question, but the answer must be bare JSON like a scan's: does the format alone
// make the grounding metadata disappear?
const shortJsonBody = () => ({
  ...shortBody('google_search'),
  contents: [{ parts: [{ text: `${SHORT_PROMPT}\nRéponds UNIQUEMENT par un tableau JSON strict, sans texte avant ou après : `
    + '[{"title": "…", "startDate": "YYYY-MM-DD", "url": "…"}]' }] }],
});

// The real sport scan, with the JSON format block replaced by a plain text list: the reverse test.
const scanAsTextBody = (prompt) => geminiRequestBody(
  prompt.split('Renvoie UNIQUEMENT un tableau JSON')[0]
  + 'Réponds par une liste en texte : une ligne par événement, avec titre, date, lieu et URL.\n',
);

// countTokens is free: what the request alone weighs. A promptTokenCount well above it means
// content was added to the context during the call — search results the answer does not declare.
async function countTokens(model, request) {
  const { status, body } = await call(`models/${model}:countTokens`, {
    method: 'POST',
    body: JSON.stringify({ generateContentRequest: { model: `models/${model}`, ...request } }),
  });
  return status === 200 ? body?.totalTokens : null;
}

async function probe(model, label, request, toolKey) {
  const counted = await countTokens(model, request);
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
    + `${u.promptTokenCount ?? '?'} (requête seule : ${counted ?? '?'}) / ${u.candidatesTokenCount ?? '?'} / ${u.thoughtsTokenCount ?? 0} / ${u.toolUsePromptTokenCount ?? 0} |`);
  if (queries.length) log(`|  |  |  | requêtes : ${queries.slice(0, 4).map((q) => `« ${q} »`).join(', ')} | | |`);
  // What came back: deep links to event pages suggest pages were read; home pages, memory.
  const answer = (c.content?.parts || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  const urls = answer.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  const homes = urls.filter((x) => { try { return new URL(x).pathname.replace(/\/$/, '') === ''; } catch { return false; } });
  log(`|  |  |  | réponse : ${urls.length} lien(s), dont ${homes.length} page(s) d'accueil · `
    + `${answer.replace(/\s+/g, ' ').slice(0, 160).replace(/\|/g, '/')} | | |`);
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
    await probe(model, 'question courte → JSON', shortJsonBody(), 'google_search');
    if (!withScan) continue;
    const sport = SCANS.find((s) => s.name === 'sport') || SCANS[0];
    await probe(model, 'scan « sport » → texte', scanAsTextBody(buildPrompt(sport, ctx)), 'google_search');
    for (const scan of SCANS) {
      await probe(model, `vrai scan « ${scan.name} »`, geminiRequestBody(buildPrompt(scan, ctx)), 'google_search');
    }
  }
  log('');
  log('Lecture : aucune recherche nulle part → compte, modèle ou API (voir le palier de facturation dans AI Studio). '
    + 'Recherche sur la question courte mais pas sur le vrai scan → le modèle choisit de ne pas chercher : prompt à revoir. '
    + '« → JSON » sans recherche mais « → texte » avec → c\'est la réponse en JSON pur qui fait perdre la recherche. '
    + 'Tokens in nettement au-dessus de « requête seule » sans métadonnées → du contenu a été ajouté pendant l\'appel. '
    + 'HTTP 429 / 403 → quota ou facturation.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n'); } catch { /* non-fatal */ }
  }
}

main().catch((err) => {
  console.error('❌', err && err.message ? err.message : err);
  process.exit(1);
});
