/**
 * English descriptions — the one piece of event data that is translated (§3.O).
 *
 * Titles, schedules, prices and place names stay French on purpose: a visitor has to be able to
 * match what the site says against a poster, a ticket desk or the organiser's own page, and
 * "Mushroom Fair" matches nothing. A description is different — nobody searches by description,
 * it only answers "is this for me?", and that question is useless in a language you cannot read.
 *
 * Cost control is the whole design:
 *
 *   - The cache is keyed by a hash of the FRENCH text, exactly like geocode-cache.json. A
 *     description that has not changed is never re-translated, so only genuinely new events cost
 *     anything — a few dozen per scan, not the whole catalogue.
 *   - A description corrected through overrides.json changes its hash and is therefore
 *     re-translated automatically. The two can never drift apart.
 *   - The call carries NO google_search tool. That makes it cheap, and it also puts this call
 *     outside the grounding terms problem of §3.G — it is the only Gemini call in the project
 *     that is unambiguously fine. Without the search tool, structured JSON output is available,
 *     so there is no regex salvaging to do here either.
 *
 * Nothing here is ever fatal: any failure leaves `descriptionEn` unset and the card falls back to
 * French, which is exactly what the site did before this module existed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  enabled: process.env.TRANSLATE !== '0',
  model: process.env.TRANSLATE_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  cachePath: path.resolve(process.env.TRANSLATE_CACHE_PATH || 'translate-cache.json'),
  batchSize: envInt('TRANSLATE_BATCH_SIZE', 20),
  timeoutMs: envInt('TRANSLATE_TIMEOUT_MS', 120_000),
  maxAttempts: envInt('TRANSLATE_MAX_ATTEMPTS', 3),
  retryBaseDelayMs: envInt('TRANSLATE_RETRY_BASE_MS', 4_000),
  pauseBetweenBatchesMs: envInt('TRANSLATE_BATCH_PAUSE_MS', 1_000),
  maxChars: envInt('TRANSLATE_MAX_CHARS', 600),
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cache key: the French text itself. Change the text, get a new translation. */
const keyOf = (fr) => crypto.createHash('sha1').update(String(fr)).digest('hex').slice(0, 16);

function loadCache() {
  try {
    if (!fs.existsSync(CONFIG.cachePath)) return { map: {}, dirty: false };
    const text = fs.readFileSync(CONFIG.cachePath, 'utf8');
    const map = text.trim() ? JSON.parse(text) : {};
    return { map: (map && typeof map === 'object' && !Array.isArray(map)) ? map : {}, dirty: false };
  } catch {
    // A corrupt cache is not worth failing a run over: it only costs a re-translation.
    return { map: {}, dirty: false };
  }
}

function saveCache(cache) {
  fs.writeFileSync(CONFIG.cachePath, JSON.stringify(cache.map, null, 2) + '\n');
}

const PROMPT_HEADER = [
  'Translate each French event description into natural, concise English for a local "what\'s on" listing.',
  '',
  'Rules:',
  '- Keep proper nouns in French: place names, venue names, event names, organiser names.',
  '  Write "Château de Fontainebleau", never "Fontainebleau Castle".',
  '- Translate meaning, not words. Keep the same length and register; one or two sentences.',
  '- Add nothing that is not in the source. Invent no time, price, address or detail.',
  '- If an item is already English, or is too garbled to translate, copy it unchanged.',
  '',
  'Answer with JSON only: an array of {"i": <the item\'s i>, "en": "<translation>"}.',
  'Return exactly one entry per input item, with the same i.',
  '',
  'Items:',
].join('\n');

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY, // header, not query string: keeps the key out of logs
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // No google_search tool here: pure text transformation. That is what makes structured
      // output available (it collides with the search tool — see §3.A).
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { i: { type: 'INTEGER' }, en: { type: 'STRING' } },
            required: ['i', 'en'],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(CONFIG.timeoutMs),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(bodyText);
}

function extractJson(response) {
  const candidate = response?.candidates?.[0];
  if (!candidate) throw new Error('no candidate returned');
  const text = (candidate.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text).join('');
  if (!text.trim()) throw new Error(`no text generated (finishReason: ${candidate.finishReason})`);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
  return { items: parsed, usage: response.usageMetadata ?? null };
}

/** One batch, with retry/backoff. Returns Map<index, englishText>. */
async function translateBatch(batch, stats) {
  const prompt = PROMPT_HEADER + '\n'
    + JSON.stringify(batch.map((b, i) => ({ i, fr: b.fr })), null, 0);

  let lastErr = null;
  for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
    try {
      const { items, usage } = extractJson(await callGemini(prompt));
      if (usage) {
        stats.tokensIn += usage.promptTokenCount ?? 0;
        stats.tokensOut += usage.candidatesTokenCount ?? 0;
      }
      const out = new Map();
      for (const item of items) {
        const i = Number(item?.i);
        const en = typeof item?.en === 'string' ? item.en.replace(/\s+/g, ' ').trim() : '';
        if (!Number.isInteger(i) || i < 0 || i >= batch.length || !en) continue;
        out.set(i, en.length > CONFIG.maxChars ? en.slice(0, CONFIG.maxChars - 1).trimEnd() + '…' : en);
      }
      return out;
    } catch (err) {
      lastErr = err;
      const retryable = err.status === undefined || RETRYABLE_STATUS.has(err.status);
      if (!retryable || attempt === CONFIG.maxAttempts) break;
      await sleep(CONFIG.retryBaseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastErr || new Error('translation failed');
}

/**
 * Fills `descriptionEn` on every event that has a description, from cache where possible.
 * `events` is mutated in place. Returns stats for the run report; never throws.
 */
async function translateDescriptions(events, { dryRun = false } = {}) {
  const stats = {
    total: 0, fromCache: 0, translated: 0, batches: 0, failed: 0,
    tokensIn: 0, tokensOut: 0, errors: [], pruned: 0, skipped: null,
  };
  if (!CONFIG.enabled) { stats.skipped = 'TRANSLATE=0'; return stats; }
  if (!process.env.GEMINI_API_KEY) { stats.skipped = 'no API key'; return stats; }

  const cache = loadCache();
  const pending = new Map(); // french text -> [events sharing it]

  for (const e of events) {
    const fr = typeof e.description === 'string' ? e.description.trim() : '';
    if (!fr) continue;
    stats.total++;
    const hit = cache.map[keyOf(fr)];
    if (typeof hit === 'string' && hit) { e.descriptionEn = hit; stats.fromCache++; continue; }
    if (!pending.has(fr)) pending.set(fr, []);
    pending.get(fr).push(e);
  }

  const todo = [...pending.keys()].map((fr) => ({ fr }));
  for (let i = 0; i < todo.length; i += CONFIG.batchSize) {
    const batch = todo.slice(i, i + CONFIG.batchSize);
    if (i > 0) await sleep(CONFIG.pauseBetweenBatchesMs);
    stats.batches++;
    try {
      const result = await translateBatch(batch, stats);
      for (const [ix, en] of result) {
        const fr = batch[ix].fr;
        cache.map[keyOf(fr)] = en;
        cache.dirty = true;
        for (const e of pending.get(fr)) e.descriptionEn = en;
        stats.translated++;
      }
      stats.failed += batch.length - result.size;
    } catch (err) {
      // A failed batch simply leaves those cards in French. Never fatal.
      stats.failed += batch.length;
      if (stats.errors.length < 3) stats.errors.push(String(err.message).slice(0, 160));
    }
  }

  // Keep the cache bounded: drop translations for descriptions no longer published.
  const live = new Set();
  for (const e of events) {
    const fr = typeof e.description === 'string' ? e.description.trim() : '';
    if (fr) live.add(keyOf(fr));
  }
  for (const k of Object.keys(cache.map)) {
    if (!live.has(k)) { delete cache.map[k]; cache.dirty = true; stats.pruned++; }
  }

  if (cache.dirty && !dryRun) saveCache(cache);
  return stats;
}

module.exports = { CONFIG, translateDescriptions, translateBatch, keyOf, loadCache, saveCache, extractJson };
