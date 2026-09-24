/**
 * Duplicates that no word rule can settle, judged by Gemini WITHOUT grounding (item 51c, §3.W2).
 *
 * dedupeFuzzy() merges identical and nested titles and stops at "sibling" titles — each carries a
 * word the other lacks — because structure alone cannot tell them apart:
 *
 *   « Meeting d'Automne TDA Poneys » / « … TDA Équitation »   two competitions  -> keep both
 *   « Meeting d'Automne TDA CREIF » / « … TDA (Tournée des As) » one competition  -> merge
 *
 * Same shape, opposite answers. What separates them is meaning, so this step:
 *
 *   1. finds candidate pairs mechanically: same occasion (same day, or overlapping runs), compatible
 *      towns, and shared DISTINCTIVE words — kind-of-event words (concert, visite, sortie…) and
 *      place words (Fontainebleau, forêt, château…) do not count;
 *   2. asks Gemini, with both full records, whether they are the same event. No search tool: the
 *      call only compares two records we already hold, outside the grounding terms (§3.G);
 *   3. remembers every verdict in dedupe-cache.json (keyed by the two ids), so a pair is judged
 *      once, and a duplicate re-reported by a later scan — which gets back the same id — is merged
 *      again for free.
 *
 * Escape hatch: `"keepSeparate": ["EVT_…"]` on an id in overrides.json forbids the merge of that
 * pair, whatever the verdict. Hidden records are never merged (a hidden winner would take its
 * duplicate down with it). Without GEMINI_API_KEY only cached verdicts apply.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  enabled: process.env.DEDUPE_JUDGE !== '0',
  cachePath: path.resolve(process.env.DEDUPE_CACHE_PATH || 'dedupe-cache.json'),
  model: process.env.DEDUPE_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  maxPairsPerRun: envInt('DEDUPE_MAX_PAIRS', 120),
  batchSize: envInt('DEDUPE_BATCH_SIZE', 15),
  timeoutMs: envInt('DEDUPE_TIMEOUT_MS', 120_000),
  // Verdicts outlive the 3-month window a little, then go: the pair cannot come back after that.
  cacheDays: envInt('DEDUPE_CACHE_DAYS', 150),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────────── Candidates ─────────────────────────────

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ').trim();

// Say what KIND of event it is, not which one.
const KIND = new Set(('exposition expo concert spectacle visite sortie guidee guide atelier fete festival salon '
  + 'marche journee rencontre conference balade promenade soiree edition annuel grand grande '
  + 'decouverte observation initiation exploration seance representation piece theatre opera '
  + 'evenement special stage course cours animation animations ciel').split(' '));
// Say WHERE, which two records of the same town share anyway.
const PLACE = new Set(['fontainebleau', 'foret', 'chateau', 'avon', 'parc', 'eglise', 'municipal',
  'mediatheque', 'ville', 'pays', 'seine', 'marne', 'salle', 'domaine']);
const CONNECTOR = new Set(['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'au', 'aux', 'en',
  'sur', 'pour', 'par', 'avec', 'dans', 'chez', 'ou', 'son', 'sa', 'ses', 'nos', 'vos', 'leur']);
const singular = (w) => (w.length >= 5 && /[sx]$/.test(w) ? w.slice(0, -1) : w);

function distinctive(title, towns) {
  const townWords = new Set(towns.flatMap((t) => norm(t).split(' ')));
  return new Set(norm(title).split(' ')
    .filter((w) => w.length > 2 && !/^\d+(?:e|er|eme)?$/.test(w))
    .map(singular)
    .filter((w) => !KIND.has(w) && !PLACE.has(w) && !CONNECTOR.has(w) && !townWords.has(w)));
}

const isSpan = (e) => Boolean(e.endDate) && e.endDate > e.startDate;
const overlaps = (a, b) => a.startDate <= (b.endDate || b.startDate) && b.startDate <= (a.endDate || a.startDate);
// Same rule as dedupeFuzzy(): two single days must be the SAME day — two evenings of a show are two events.
const sameOccasion = (a, b) => a.startDate === b.startDate || (isSpan(a) && isSpan(b) && overlaps(a, b));

function townsCompatible(a, b) {
  const x = norm(a.city), y = norm(b.city);
  return !x || !y || x === y || x.includes(y) || y.includes(x);
}

/** Pairs worth a question, most similar first. */
function candidatePairs(recs, { skip = () => false } = {}) {
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i].event, b = recs[j].event;
      if (!sameOccasion(a, b) || !townsCompatible(a, b) || skip(a.id, b.id)) continue;
      const towns = [a.city, b.city];
      const wa = distinctive(a.title, towns), wb = distinctive(b.title, towns);
      if (!wa.size || !wb.size) continue;
      const common = [...wa].filter((w) => wb.has(w));
      if (!common.length) continue;
      const coef = common.length / Math.min(wa.size, wb.size);
      // One shared word only counts when it is a long one ("collectionnistes", "hengelbrock");
      // "noel" alone would pair every Christmas event of a town.
      if (coef < 0.5 || (common.length < 2 && common[0].length < 6)) continue;
      out.push({ a: recs[i], b: recs[j], score: coef + common.length / 100 });
    }
  }
  return out.sort((p, q) => q.score - p.score);
}

// ───────────────────────────── Cache ─────────────────────────────

const pairKey = (x, y) => [x, y].sort().join('|');

function loadCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG.cachePath, 'utf8'));
    return j && typeof j === 'object' && j.pairs && typeof j.pairs === 'object' ? j.pairs : {};
  } catch { return {}; }
}

function saveCache(pairs, today) {
  const cutoff = new Date(Date.parse(today) - CONFIG.cacheDays * 86400000).toISOString().slice(0, 10);
  const kept = {};
  for (const k of Object.keys(pairs).sort()) if ((pairs[k].at || today) >= cutoff) kept[k] = pairs[k];
  fs.writeFileSync(CONFIG.cachePath, JSON.stringify({ version: 1, pairs: kept }, null, 2) + '\n');
}

// ───────────────────────────── Judge ─────────────────────────────

const describe = (e) => ({
  titre: e.title,
  dates: e.endDate && e.endDate !== e.startDate ? `${e.startDate} → ${e.endDate}` : e.startDate,
  commune: e.city || '',
  lieu: e.locationName || '',
  organisateur: e.organizer || '',
  horaires: e.schedule || '',
  tarif: e.price || '',
  description: String(e.description || '').slice(0, 220),
  lien: e.url || '',
});

const PROMPT = (pairs) => `
Tu compares des fiches d'un agenda local d'événements autour de Fontainebleau. Plusieurs sources
ont pu publier le même événement sous des titres différents.

Pour chaque paire, réponds "same": true seulement si les deux fiches décrivent LE MÊME événement :
même activité, même lieu, même moment — publiée deux fois.

Réponds false quand :
- ce sont deux épreuves, catégories, séances, sorties ou visites distinctes d'un même programme
  (ex. « Meeting TDA Poneys » et « Meeting TDA Équitation » : deux compétitions) ;
- l'une est le programme ou le festival, l'autre un de ses rendez-vous ;
- elles partagent seulement un thème, un lieu ou un organisateur ;
- tu as un doute.

Une différence de formulation, un titre plus long ou plus court, une année ou un numéro d'édition
en plus ne sont PAS des différences.

"reason" : une courte phrase en français.

${pairs.map((p, i) => `PAIRE ${i}\nA : ${JSON.stringify(describe(p.a.event))}\nB : ${JSON.stringify(describe(p.b.event))}`).join('\n\n')}
`.trim();

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { i: { type: 'INTEGER' }, same: { type: 'BOOLEAN' }, reason: { type: 'STRING' } },
                required: ['i', 'same'],
              },
            },
          },
        }),
        signal: AbortSignal.timeout(CONFIG.timeoutMs),
      });
      const body = await res.text();
      if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`); e.status = res.status; throw e; }
      const json = JSON.parse(body);
      const cand = json.candidates && json.candidates[0];
      const text = ((cand && cand.content && cand.content.parts) || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
      const items = JSON.parse(text || '[]');
      return { items: Array.isArray(items) ? items : [], usage: json.usageMetadata || null };
    } catch (err) {
      lastErr = err;
      if (err.status && ![408, 429, 500, 502, 503, 504].includes(err.status)) break;
      await sleep(4000 * attempt);
    }
  }
  throw lastErr;
}

// ───────────────────────────── Merge ─────────────────────────────

const PRECISE_GEO = ['ban', 'manual', 'venue', 'feed'];

/** Which record survives (its id is kept, so overrides.json stays attached). Same order as dedupeFuzzy(). */
function preferred(a, b) {
  if (a.isNew !== b.isNew) return a.isNew ? b : a;
  const aOk = a.event.urlStatus === 'ok', bOk = b.event.urlStatus === 'ok';
  if (aOk !== bOk) return aOk ? a : b;
  const aLegacy = /^ACT_/.test(a.event.id || ''), bLegacy = /^ACT_/.test(b.event.id || '');
  if (aLegacy !== bLegacy) return aLegacy ? a : b;
  return a;
}

/**
 * Folds the loser in. The winner keeps its title — the one already published — and gains what
 * the loser knew better: a more precise page on the same site (mergeInto), an exact position
 * where the winner only had an approximate one.
 */
function absorb(winner, loser, mergeInto, enrichFrom) {
  const title = winner.event.title;
  // A record read on the organiser's own site brings its page and address, never its dates
  // (one dated performance must not shorten the record it matched): enrichFrom(), §3.Z2.
  if (enrichFrom && loser.event.source === 'site') enrichFrom(winner.event, loser.event);
  else mergeInto(winner.event, loser.event);
  winner.event.title = title;
  const w = winner.event, l = loser.event;
  if (!PRECISE_GEO.includes(w.geoSource) && PRECISE_GEO.includes(l.geoSource) && Number.isFinite(l.lat)) {
    w.lat = l.lat; w.lng = l.lng; w.geoSource = l.geoSource;
  }
  if (!winner.modelCoords && loser.modelCoords) winner.modelCoords = loser.modelCoords;
  if (!w.image && l.image) w.image = l.image;
  if (!w.source && l.source) w.source = l.source;   // confirmed by a legitimate source
  winner.refreshed = true;
}

/**
 * Runs over the merged record map (Map key -> { event, isNew, … }). Mutates it. Never throws:
 * a failure leaves the set exactly as dedupeFuzzy() left it.
 */
async function run(records, { overrides = {}, eventKey, mergeInto, enrichFrom, today, dryRun = false }) {
  const stats = { candidates: 0, cached: 0, asked: 0, merged: [], distinct: 0, pending: 0, tokensIn: 0, tokensOut: 0, error: null };
  if (!CONFIG.enabled) return { ...stats, skipped: 'DEDUPE_JUDGE=0' };

  const hidden = (id) => Boolean(overrides[id] && overrides[id].hidden === true);
  const apart = (x, y) => [[x, y], [y, x]].some(([p, q]) => Array.isArray(overrides[p] && overrides[p].keepSeparate)
    && overrides[p].keepSeparate.includes(q));
  const pairs = candidatePairs([...records.values()], { skip: (x, y) => hidden(x) || hidden(y) || apart(x, y) });
  stats.candidates = pairs.length;

  const cache = loadCache();
  const unknown = pairs.filter((p) => !cache[pairKey(p.a.event.id, p.b.event.id)]);
  stats.cached = pairs.length - unknown.length;
  const toAsk = unknown.slice(0, CONFIG.maxPairsPerRun);
  stats.pending = unknown.length - toAsk.length;

  if (toAsk.length && process.env.GEMINI_API_KEY) {
    try {
      for (let s = 0; s < toAsk.length; s += CONFIG.batchSize) {
        const batch = toAsk.slice(s, s + CONFIG.batchSize);
        const { items, usage } = await callGemini(PROMPT(batch));
        if (usage) { stats.tokensIn += usage.promptTokenCount || 0; stats.tokensOut += usage.candidatesTokenCount || 0; }
        for (const it of items) {
          const p = batch[Number(it && it.i)];
          if (!p || typeof it.same !== 'boolean') continue;
          cache[pairKey(p.a.event.id, p.b.event.id)] = { same: it.same, reason: String(it.reason || '').slice(0, 160), at: today };
          stats.asked++;
        }
      }
    } catch (err) {
      stats.error = String(err.message || err).slice(0, 200);
    }
  } else if (toAsk.length) {
    stats.pending += toAsk.length;
  }

  // Apply every "same" verdict. A record already absorbed is followed to its winner, so three
  // variants of one event collapse into one record whatever order the pairs come in.
  const absorbedInto = new Map();
  const resolve = (rec) => { while (absorbedInto.has(rec)) rec = absorbedInto.get(rec); return rec; };
  for (const p of pairs) {
    const v = cache[pairKey(p.a.event.id, p.b.event.id)];
    if (!v) continue;
    if (!v.same) { stats.distinct++; continue; }
    const a = resolve(p.a), b = resolve(p.b);
    if (a === b) continue;
    const winner = preferred(a, b);
    const loser = winner === a ? b : a;
    const line = `« ${loser.event.title} » → « ${winner.event.title} » (${winner.event.startDate}, \`${loser.event.id}\` → \`${winner.event.id}\`)`;
    records.delete(eventKey(loser.event));
    absorb(winner, loser, mergeInto, enrichFrom);
    absorbedInto.set(loser, winner);
    stats.merged.push(line);
  }

  if (!dryRun) {
    try { saveCache(cache, today); } catch (err) { stats.error = stats.error || `cache: ${err.message}`; }
  }
  return stats;
}

module.exports = { CONFIG, run, candidatePairs, distinctive, preferred, absorb, pairKey, PROMPT };
