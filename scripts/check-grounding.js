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
 *   3. The real sport scan, with the exact request body the pipeline sends (geminiRequestBody),
 *      and the same with a low thinking level. If (2) searches and (3) does not, the model
 *      chooses not to search on our prompt. That was the 04/10 finding: even the short question
 *      stops searching once it must answer in JSON.
 *   4. A short, natural question on the sport scan's subject, in prose: the first step of a
 *      two-step scan (grounded prose, then an ungrounded call turning it into JSON).
 *
 * Cost: about 0.10 $ per model (0.25 $ with --all-scans); searches within the free quota.
 *
 * Usage:
 *   GEMINI_API_KEY=… node scripts/check-grounding.js
 *   GEMINI_API_KEY=… node scripts/check-grounding.js --models gemini-3.6-flash,gemini-3.8-flash
 *   GEMINI_API_KEY=… node scripts/check-grounding.js --no-scan      # skip the real-prompt call
 *   GEMINI_API_KEY=… node scripts/check-grounding.js --all-scans    # the four real scans, not only sport
 */

'use strict';

const fs = require('fs');
const { buildPrompt, geminiRequestBody, SCANS, CONFIG, addMonths, parisToday, frenchMonths } = require('./fetch-events');

const API = 'https://generativelanguage.googleapis.com/v1beta';
const SHORT_PROMPT = 'Cherche sur le web : quels événements sont annoncés à Fontainebleau (Seine-et-Marne) '
  + 'dans les sept prochains jours ? Réponds en trois lignes au plus, avec la date de chaque événement.';

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const models = (argValue('--models') || CONFIG.model).split(',').map((m) => m.trim()).filter(Boolean);
const withScan = !args.includes('--no-scan');
const allScans = args.includes('--all-scans');

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

// A short, natural question on one scan's subject, answered in prose: what a two-step scan
// would ask first.
const scanQuestionBody = (ctx, months) => ({
  ...shortBody('google_search'),
  contents: [{ parts: [{ text: `Cherche sur le web : quels trails, courses, randonnées organisées et concours `
    + `sportifs sont annoncés autour de Fontainebleau (20 km) en ${months.slice(0, 2).join(' et ')} ? `
    + 'Pour chacun : titre, date, commune et lien de la page.' }] }],
});

// The real request with a low thinking level: the 04/10 calls thought 3 000 to 10 000 tokens and
// concluded they knew enough. An unknown field comes back as an HTTP 400, shown in the table.
const lowThinking = (request) => ({
  ...request,
  generationConfig: { ...request.generationConfig, thinkingConfig: { thinkingLevel: 'low' } },
});

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
    await probe(model, 'question « sport » en texte', scanQuestionBody(ctx, frenchMonths(ctx.today, ctx.maxDate)), 'google_search');
    if (!withScan) continue;
    const sport = SCANS.find((s) => s.name === 'sport') || SCANS[0];
    const sportBody = geminiRequestBody(buildPrompt(sport, ctx));
    await probe(model, 'vrai scan « sport »', sportBody, 'google_search');
    await probe(model, 'vrai scan « sport », réflexion basse', lowThinking(sportBody), 'google_search');
    if (!allScans) continue;
    for (const scan of SCANS.filter((s) => s !== sport)) {
      await probe(model, `vrai scan « ${scan.name} »`, geminiRequestBody(buildPrompt(scan, ctx)), 'google_search');
    }
  }
  log('');
  log('Lecture : aucune recherche nulle part → compte, modèle ou API (voir le palier de facturation dans AI Studio). '
    + 'Recherche sur la question courte mais pas sur le vrai scan → le modèle choisit de ne pas chercher : prompt à revoir. '
    + '« question en texte » avec recherche mais vrai scan sans → un scan en deux temps (texte cherché, puis mise en JSON) répare. '
    + '« réflexion basse » avec recherche → un réglage suffit. '
    + 'HTTP 429 / 403 → quota ou facturation.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n'); } catch { /* non-fatal */ }
  }
}

main().catch((err) => {
  console.error('❌', err && err.message ? err.message : err);
  process.exit(1);
});
