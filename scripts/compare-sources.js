#!/usr/bin/env node
/**
 * Shadow comparison: how much of what the site publishes could legitimate sources carry alone?
 * (item 72, §3.Z). Publishes nothing, writes nothing the site serves.
 *
 * Legitimate = DATAtourisme and OpenAgenda (open data, already in the pipeline) + the organisers'
 * own pages read directly (sources.js). The question it answers is the decision of 24 September:
 * grounding is only demoted once legitimate sources find ≥ 90 % of the published events, over
 * several runs. The report lists every event they miss, so the project lead can judge whether a
 * missed one is a key event — the one thing a percentage cannot say.
 *
 * Output: reports/sources-comparison.md (+ the job summary in CI) and reports/sources-snapshot.json.
 *   REUSE_SNAPSHOT=1   compare again from the last snapshot, without fetching anything
 *   SOURCES_ONLY=a,b   read only these direct sources      DT=0 / OA=0   skip the open-data feeds
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sources = require('./sources');
const datatourisme = require('./datatourisme');
const openagenda = require('./openagenda');

const THRESHOLD = 0.9;
const REPORT_DIR = path.resolve(process.env.REPORT_DIR || 'reports');
const SNAPSHOT = path.join(REPORT_DIR, 'sources-snapshot.json');

const parisToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

// ───────────────────────────── Matching ─────────────────────────────

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim();

// Words that say what kind of event it is, not which one: two different exhibitions at the same
// château on overlapping dates must not look alike because both say "exposition".
const STOP = new Set(('le la les de des du un une et au aux en sur pour par avec dans chez ou a l d s '
  + 'exposition expo concert concerts spectacle spectacles visite visites guidee guidees sortie sorties '
  + 'atelier ateliers fete festival salon marche journee journees rencontre rencontres conference '
  + 'balade balades soiree edition eme annuel grand grande 2025 2026 2027').split(' '));
const PLACE = ['fontainebleau', 'foret', 'chateau', 'avon', 'parc', 'eglise', 'theatre', 'municipal', 'mediatheque', 'ville', 'pays', 'seine', 'marne'];
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+e?$/.test(w)));

const overlap = (a, b) => a.startDate <= (b.endDate || b.startDate) && b.startDate <= (a.endDate || a.startDate);

function sameTown(a, b) {
  const x = norm(a.city), y = norm(b.city);
  return !x || !y || x === y || x.includes(y) || y.includes(x);
}

/** 'strict' | 'probable' | null */
function matchLevel(pub, cand) {
  if (!overlap(pub, cand) || !sameTown(pub, cand)) return null;
  const a = norm(pub.title), b = norm(cand.title);
  if (a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)))) return 'strict';
  // A place is not an identity: "Le marché de Fontainebleau" (all year long) must not match
  // every "… en forêt de Fontainebleau". Town names and venue words are dropped here.
  const place = new Set([...norm(pub.city).split(' '), ...norm(cand.city).split(' '), ...PLACE]);
  const ta = new Set([...tokens(pub.title)].filter((w) => !place.has(w)));
  const tb = new Set([...tokens(cand.title)].filter((w) => !place.has(w)));
  if (!ta.size || !tb.size) return null;
  const common = [...ta].filter((w) => tb.has(w));
  const coef = common.length / Math.min(ta.size, tb.size);
  if (coef === 1 && common.length >= 2) return 'strict';
  if (coef >= 0.7 && (common.length >= 2 || common[0].length >= 6)) return 'probable';
  return null;
}

// ───────────────────────────── Pools ─────────────────────────────

async function gather(ctx) {
  const pools = [];
  if (process.env.DT !== '0') {
    try {
      const loaded = await datatourisme.load({ today: ctx.today, windowEnd: ctx.maxDate });
      // Every event in the window, long and recurring ones included: coverage is the question
      // here, not what the pipeline chooses to publish.
      const events = loaded.inWindow.map((e) => {
        const ps = e.periods.filter((p) => p.end >= ctx.today && p.start <= ctx.maxDate);
        return { title: e.title, city: e.city, url: e.url, startDate: ps.reduce((a, p) => (p.start < a ? p.start : a), ps[0].start), endDate: ps.reduce((a, p) => (p.end > a ? p.end : a), ps[0].end) };
      });
      pools.push({ id: 'datatourisme', name: 'DATAtourisme (flux ouvert)', status: 'ok', events });
    } catch (err) { pools.push({ id: 'datatourisme', name: 'DATAtourisme (flux ouvert)', status: 'error', error: err.message, events: [] }); }
  }
  if (process.env.OA !== '0') {
    try {
      const loaded = await openagenda.load({ today: ctx.today, windowEnd: ctx.maxDate });
      pools.push({ id: 'openagenda', name: 'OpenAgenda (flux ouvert)', status: 'ok', events: openagenda.toPipelineEvents(loaded.kept, ctx) });
    } catch (err) { pools.push({ id: 'openagenda', name: 'OpenAgenda (flux ouvert)', status: 'error', error: err.message, events: [] }); }
  }
  const only = process.env.SOURCES_ONLY ? process.env.SOURCES_ONLY.split(',') : undefined;
  for (const r of await sources.load(ctx, { only })) pools.push(r);
  return pools;
}

// ───────────────────────────── Report ─────────────────────────────

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '—'; } };
const pct = (n, d) => (d ? `${Math.round((1000 * n) / d) / 10} %` : '—');
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

function compare(published, pools) {
  const rows = published.map((e) => {
    const openSource = ['datatourisme', 'openagenda', 'site'].includes(e.source);
    let best = openSource ? { level: 'strict', pool: e.source, title: e.title } : null;
    for (const pool of pools) {
      for (const c of pool.events) {
        const level = matchLevel(e, c);
        if (level === 'strict' || (level === 'probable' && !best)) {
          if (!best || best.level !== 'strict') best = { level, pool: pool.id, title: c.title };
          if (level === 'strict') break;
        }
      }
    }
    return { e, best, gemini: !e.source };
  });

  // Per pool: how many published events it finds, and how many of its events are not published.
  for (const pool of pools) {
    pool.matched = published.filter((e) => pool.events.some((c) => matchLevel(e, c))).length;
    pool.extra = pool.events.filter((c) => !published.some((e) => matchLevel(e, c)));
  }
  return rows;
}

function render(ctx, published, pools, rows) {
  const L = [];
  const strict = rows.filter((r) => r.best && r.best.level === 'strict').length;
  const probable = rows.filter((r) => r.best && r.best.level === 'probable').length;
  const gem = rows.filter((r) => r.gemini);
  const gemStrict = gem.filter((r) => r.best && r.best.level === 'strict').length;
  const gemProb = gem.filter((r) => r.best && r.best.level === 'probable').length;
  const total = published.length;
  const reached = (strict + probable) / total >= THRESHOLD;

  L.push('## 🧭 Comparatif des sources légitimes (mode observation)', '');
  L.push(`Fenêtre **${ctx.today} → ${ctx.maxDate}** · ${total} événements publiés · seuil de bascule **${Math.round(THRESHOLD * 100)} %**`, '');
  L.push('| | Retrouvés (certain) | + probables | Couverture |');
  L.push('|---|---|---|---|');
  L.push(`| **Tous les événements publiés** | ${strict} | ${probable} | **${pct(strict + probable, total)}** (certain seul : ${pct(strict, total)}) |`);
  L.push(`| dont trouvés aujourd'hui par Gemini | ${gemStrict} | ${gemProb} | ${pct(gemStrict + gemProb, gem.length)} sur ${gem.length} |`);
  L.push('');
  L.push(reached
    ? `✅ **Seuil atteint sur ce run.** Le critère demande plusieurs runs consécutifs, et une relecture des « probables » et des manqués ci-dessous.`
    : `⏳ **Seuil non atteint.** Il manque ${Math.ceil(THRESHOLD * total) - (strict + probable)} événement(s) pour ${Math.round(THRESHOLD * 100)} %.`);
  L.push('');

  L.push('### Par source', '');
  L.push('| Source | État | Pages lues | Événements lus | Publiés retrouvés | Hors site (nouveaux ?) |');
  L.push('|---|---|---|---|---|---|');
  for (const p of pools) {
    const state = p.status === 'ok' ? '✅' : p.status === 'disabled' ? `⏸ ${cell(p.note)}` : p.status === 'skipped' ? `⏭ ${cell(p.skipped)}` : p.status === 'robots' ? '🚫 robots.txt' : `❌ ${cell(p.error)}`;
    L.push(`| ${cell(p.name || p.id)} | ${state} | ${p.fetched ?? '—'} | ${p.events.length} | ${p.matched ?? 0} | ${p.extra ? p.extra.length : 0} |`);
  }
  const tokensIn = pools.reduce((a, p) => a + ((p.usage && p.usage.promptTokenCount) || 0), 0);
  const tokensOut = pools.reduce((a, p) => a + ((p.usage && p.usage.candidatesTokenCount) || 0), 0);
  if (tokensIn) L.push('', `Gemini sans grounding : ${tokensIn} tokens en entrée, ${tokensOut} en sortie.`);
  L.push('');

  const missed = rows.filter((r) => !r.best).sort((a, b) => host(a.e.url).localeCompare(host(b.e.url)) || a.e.startDate.localeCompare(b.e.startDate));
  L.push(`### ❓ Non retrouvés par une source légitime (${missed.length}) — lesquels sont des événements clés ?`, '');
  if (missed.length) {
    L.push('| Date | Événement | Commune | Site d\'origine |', '|---|---|---|---|');
    for (const { e } of missed) L.push(`| ${e.startDate} | ${cell(e.title)} | ${cell(e.city)} | ${host(e.url)} |`);
  }
  L.push('');

  const prob = rows.filter((r) => r.best && r.best.level === 'probable');
  L.push(`### 🔎 Correspondances probables à vérifier (${prob.length})`, '');
  if (prob.length) {
    L.push('| Publié | Trouvé | Source |', '|---|---|---|');
    for (const { e, best } of prob) L.push(`| ${cell(e.title)} (${e.startDate}) | ${cell(best.title)} | ${best.pool} |`);
  }
  L.push('');

  const direct = pools.filter((p) => !['datatourisme', 'openagenda'].includes(p.id));
  const extras = direct.flatMap((p) => (p.extra || []).map((c) => ({ ...c, pool: p.id })));
  L.push(`### ➕ Lus sur les sites mais absents du site (${extras.length}) — gain possible, à trier`, '');
  L.push('Pas encore filtrés (rayon, doublons, récurrences) : un indicateur, pas une liste à publier.', '');
  if (extras.length) {
    L.push('| Date | Événement | Commune | Source |', '|---|---|---|---|');
    for (const c of extras.sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 40)) {
      L.push(`| ${c.startDate} | ${cell(c.title)} | ${cell(c.city)} | ${c.pool} |`);
    }
    if (extras.length > 40) L.push(`| … | ${extras.length - 40} de plus | | |`);
  }
  L.push('');
  return L.join('\n');
}

async function main() {
  const today = process.env.TODAY || parisToday();
  const ctx = { today, maxDate: addMonths(today, 3) };
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const payload = JSON.parse(fs.readFileSync(path.resolve('data.json'), 'utf8'));
  const all = Array.isArray(payload) ? payload : payload.events;
  const published = all.filter((e) => e && e.startDate && (e.endDate || e.startDate) >= ctx.today && e.startDate <= ctx.maxDate);

  let pools;
  if (process.env.REUSE_SNAPSHOT === '1' && fs.existsSync(SNAPSHOT)) {
    pools = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).pools;
  } else {
    pools = await gather(ctx);
    // Page text is for enrichment only; it would triple the snapshot for nothing.
    for (const p of pools) for (const e of p.events) delete e.detail;
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ ctx, pools }, null, 1));
  }

  const rows = compare(published, pools);
  const md = render(ctx, published, pools, rows);
  fs.writeFileSync(path.join(REPORT_DIR, 'sources-comparison.md'), md + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
}

if (require.main === module) {
  main().catch((err) => { console.error('❌ compare-sources:', err && err.stack ? err.stack : err); process.exit(1); });
}

module.exports = { matchLevel, tokens, norm, compare, render };
