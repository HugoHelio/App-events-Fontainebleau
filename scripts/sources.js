/**
 * Direct sources — organisers' own pages, read without Google Search grounding (item 72, §3.Z).
 *
 * Why: 7 organiser sites carry two thirds of what Gemini finds, 15 carry 83 %. Reading them
 * directly takes those events out of the grounding terms problem (§3.G, §8). For now this module
 * only feeds the SHADOW comparison (compare-sources.js): nothing it returns is published until
 * legitimate sources cover ≥ 90 % of the published events (decision of 24 September).
 *
 * Three readers, chosen per site in sources.json:
 *   ics        an iCalendar feed. Deterministic.
 *   apidae-ot  the tourist office: list pages + one page per event, parsed with regular
 *              expressions. Deterministic — no model reads a date.
 *   page       HTML or RSS turned into text, then extracted by Gemini WITHOUT the search tool
 *              (the same kind of call as translate.js, outside the grounding terms).
 *
 * Manners: one identified user agent, robots.txt honoured (a site that says Disallow is never
 * fetched), one request per second per host, a hard cap on pages. Zero dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  registryPath: path.resolve(process.env.SOURCES_PATH || 'sources.json'),
  userAgent: 'Mozilla/5.0 (compatible; FontainebleauLive/1.0; +https://fontainebleaulive.fr)',
  robotsToken: 'fontainebleaulive',
  hostDelayMs: envInt('SOURCES_HOST_DELAY_MS', 1000),
  timeoutMs: envInt('SOURCES_TIMEOUT_MS', 25_000),
  maxFichePages: envInt('SOURCES_MAX_FICHES', 250),
  maxTextChars: envInt('SOURCES_MAX_TEXT_CHARS', 60_000),
  model: process.env.SOURCES_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  llmTimeoutMs: envInt('SOURCES_LLM_TIMEOUT_MS', 180_000),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────────── Polite fetching ─────────────────────────────

const lastHit = new Map();      // host -> timestamp of the last request
const robotsCache = new Map();  // origin -> { allow: [], disallow: [] }

/** Rules that apply to us: our own group if the site has one, else the "*" group. */
function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'disallow' && val) cur.disallow.push(val);
    if (key === 'allow' && val) cur.allow.push(val);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && CONFIG.robotsToken.includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const g = mine || star || { allow: [], disallow: [] };
  return { allow: g.allow, disallow: g.disallow };
}

/** Longest matching rule wins; Allow wins a tie. Supports the `*` and `$` wildcards. */
function robotsAllows(rules, pathAndQuery) {
  const toRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === '$' ? '$' : '\\' + c)).replace(/\*/g, '.*'));
  let best = { len: -1, allow: true };
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]]) {
    for (const p of list) {
      if (toRe(p).test(pathAndQuery) && (p.length > best.len || (p.length === best.len && allow))) best = { len: p.length, allow };
    }
  }
  return best.allow;
}

async function rawGet(url) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + CONFIG.hostDelayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  const res = await fetch(url, {
    headers: { 'user-agent': CONFIG.userAgent, accept: 'text/html,application/xhtml+xml,application/xml,text/calendar;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(CONFIG.timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, url: res.url, text };
}

/** GET that refuses anything robots.txt forbids. Throws on refusal or HTTP error. */
async function politeGet(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = { allow: [], disallow: [] };
    try {
      const r = await rawGet(`${u.origin}/robots.txt`);
      if (r.ok) rules = parseRobots(r.text);
    } catch { /* no robots.txt reachable: nothing is forbidden */ }
    robotsCache.set(u.origin, rules);
  }
  if (!robotsAllows(robotsCache.get(u.origin), u.pathname + u.search)) {
    const err = new Error(`robots.txt disallows ${u.pathname}`);
    err.robots = true;
    throw err;
  }
  const r = await rawGet(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return r;
}

// ───────────────────────────── Text helpers ─────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Page → readable text for the model. Links are kept as "text (url)" — not <url>, which the tag stripper below would eat — so the model can give each
 * event its own page instead of the site's home page — the weakness of the grounded scans.
 */
function htmlToText(html, baseUrl) {
  let s = String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, inner) => inner)
    .replace(/<(script|style|noscript|svg|iframe|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // RSS bodies arrive entity-encoded (&lt;p&gt;…): decode once so their tags can be stripped too.
  if (/&lt;\/?[a-z]/i.test(s)) s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  s = s.replace(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    let abs = '';
    try { abs = new URL(decodeEntities(href), baseUrl).href; } catch { /* ignore */ }
    const label = inner.replace(/<[^>]+>/g, ' ').trim();
    return /^https?:/.test(abs) && label ? ` ${label} (${abs}) ` : ` ${label} `;
  });
  s = s.replace(/<\/?(p|div|li|ul|ol|h[1-6]|br|tr|td|th|section|article|item|entry|title|dt|dd|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s)
    .split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean)
    .join('\n');
}

// ───────────────────────────── French dates ─────────────────────────────

const MONTHS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const WEEKDAYS = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?\b/g;
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * Every date or date range in a French sentence, as { start, end } ISO periods. Formats seen on
 * the tourist office pages: "Du 05/06 au 02/11/2026", "Du 19/09/2026 au 25/01/2027",
 * "Vendredi 25 septembre 2026", "Du vendredi 2 au dimanche 4 octobre 2026", several periods
 * in a row. A start without a year takes the end's year, or the year before if it would
 * otherwise come after the end.
 */
function parseFrenchPeriods(text) {
  let s = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(WEEKDAYS, ' ').replace(/(\d)(er)\b/g, '$1').replace(/\s+/g, ' ');
  const M = Object.keys(MONTHS).join('|');
  const out = [];
  const push = (y1, m1, d1, y2, m2, d2) => {
    if (!y1) y1 = (m1 > m2 || (m1 === m2 && d1 > d2)) ? y2 - 1 : y2;
    if (validDate(y1, m1, d1) && validDate(y2, m2, d2)) {
      const a = iso(y1, m1, d1), b = iso(y2, m2, d2);
      if (a <= b) out.push({ start: a, end: b });
    }
    return ' ';
  };
  const n = (x) => (x === undefined ? undefined : Number(x));
  // Most specific first; each match is blanked so a shorter pattern cannot read it again.
  s = s.replace(/\bdu (\d{1,2})\/(\d{1,2})(?:\/(\d{4}))? au (\d{1,2})\/(\d{1,2})\/(\d{4})/g,
    (m, d1, m1, y1, d2, m2, y2) => push(n(y1), n(m1), n(d1), n(y2), n(m2), n(d2)));
  s = s.replace(new RegExp(`\\bdu (\\d{1,2})(?: (${M}))?(?: (\\d{4}))? au (\\d{1,2}) (${M}) (\\d{4})`, 'g'),
    (m, d1, mo1, y1, d2, mo2, y2) => push(n(y1), MONTHS[mo1 || mo2], n(d1), n(y2), MONTHS[mo2], n(d2)));
  s = s.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d, mo, y) => push(n(y), n(mo), n(d), n(y), n(mo), n(d)));
  s.replace(new RegExp(`\\b(\\d{1,2}) (${M}) (\\d{4})\\b`, 'g'), (m, d, mo, y) => push(n(y), MONTHS[mo], n(d), n(y), MONTHS[mo], n(d)));
  return out;
}

// ───────────────────────────── iCalendar ─────────────────────────────

const icsUnescape = (v) => String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** YYYY-MM-DD in Paris for a DTSTART/DTEND value. */
function icsDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  if (m[7] === 'Z') {
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return t.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  }
  return `${m[1]}-${m[2]}-${m[3]}`;  // floating or TZID time: the local date is the date
}

function parseIcs(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const [, name, params, value] = m;
    if (name === 'DTSTART' || name === 'DTEND') {
      cur[name] = icsDate(value, params);
      cur[name + '_isDate'] = /VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(value.trim());
    } else if (['SUMMARY', 'LOCATION', 'URL', 'DESCRIPTION'].includes(name)) {
      cur[name] = icsUnescape(value);
    }
  }
  return events.map((e) => {
    let end = e.DTEND || e.DTSTART;
    // All-day DTEND is exclusive.
    if (e.DTEND && e.DTEND_isDate && e.DTEND > e.DTSTART) {
      const [y, mo, d] = e.DTEND.split('-').map(Number);
      end = new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10);
    }
    return { title: (e.SUMMARY || '').trim(), startDate: e.DTSTART, endDate: end, locationName: (e.LOCATION || '').trim(), url: e.URL || '', description: e.DESCRIPTION || '' };
  }).filter((e) => e.title && e.startDate);
}

// ───────────────────────────── Readers ─────────────────────────────

const inWindow = (e, { today, maxDate }) => (e.endDate || e.startDate) >= today && e.startDate <= maxDate;

async function readIcs(src, ctx) {
  const r = await politeGet(src.url);
  const all = parseIcs(r.text);
  return {
    fetched: 1,
    events: all.filter((e) => inWindow(e, ctx)).map((e) => ({ ...e, city: src.city || '', url: e.url || src.url })),
  };
}

/** The tourist office (Apidae list pages, then one page per event). No model involved. */
async function readApidaeOt(src, ctx) {
  const fiches = new Map();   // url -> town from the list
  let fetched = 0;
  for (let p = 1; p <= (src.maxPages || 10); p++) {
    const listUrl = p === 1 ? src.url : `${src.url.replace(/\/$/, '')}?_page=${p}`;
    const r = await politeGet(listUrl);
    fetched++;
    const before = fiches.size;
    // One <article> per event, carrying its town as an attribute and the link to its page.
    for (const chunk of r.text.split(/<article\b/).slice(1)) {
      const href = /href="(https?:\/\/[^"]*\/fiche\/[^"]+)"/.exec(chunk);
      const town = /data-apidae-commune="([^"]*)"/.exec(chunk);
      if (href && !fiches.has(href[1])) fiches.set(href[1], town ? decodeEntities(town[1]).trim() : '');
    }
    if (fiches.size === before) break;   // past the last page
  }

  const events = [];
  for (const [url, town] of [...fiches].slice(0, CONFIG.maxFichePages)) {
    let text;
    try { text = htmlToText((await politeGet(url)).text, url); fetched++; } catch { continue; }
    const flat = text.replace(/\n/g, ' ');
    const when = (flat.match(/Périodes d'ouverture\s*(.*?)(Découvrir la région|Prolonger l|Ajouter à ma sélection|$)/) || [])[1] || '';
    const periods = parseFrenchPeriods(when).filter((q) => q.end >= ctx.today && q.start <= ctx.maxDate);
    if (!periods.length) continue;
    const price = ((flat.match(/Tarifs\s*(.*?)(Périodes d'ouverture|Prestations|$)/) || [])[1] || '').slice(0, 120).trim();
    const name = decodeEntities((url.match(/\/fiche\/\d+\/([^/]+)/) || [])[1] || '').replace(/-/g, ' ');
    events.push({
      title: pickTitle(text, name) || name,
      city: town,
      startDate: periods.reduce((a, q) => (q.start < a ? q.start : a), periods[0].start),
      endDate: periods.reduce((a, q) => (q.end > a ? q.end : a), periods[0].end),
      periods,
      price,
      url,
    });
  }
  return { fetched, events };
}

/** The page title is the line that best matches the URL slug. */
function pickTitle(text, slugWords) {
  const want = new Set(slugWords.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter((w) => w.length > 2));
  let best = null, bestScore = 0;
  for (const line of text.split('\n').slice(0, 200)) {
    if (line.length < 4 || line.length > 200) continue;
    const words = line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (!words.length) continue;
    const hit = words.filter((w) => want.has(w)).length;
    const score = hit / Math.max(want.size, words.length);
    if (score > bestScore) { best = line; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

const EXTRACT_PROMPT = ({ today, maxDate }, src, pages) => `
Tu lis le contenu brut de pages web d'un organisateur d'événements (« ${src.name} »).
Extrais UNIQUEMENT les événements publics qui y sont annoncés et qui ont lieu entre le ${today} et le ${maxDate}.
Nous sommes le ${today}.

Règles :
- N'invente rien. Uniquement ce que le texte ci-dessous affirme. Pas de date déduite ou devinée.
- Si l'année n'est pas écrite, prends la prochaine occurrence après le ${today}.
- Un événement récurrent (chaque samedi, tous les jours…) : ignore-le, sauf s'il a des dates précises.
- Une actualité, un appel à bénévoles, une offre d'emploi ou un bilan ne sont pas des événements.
- "url" : le lien (https://…) le plus spécifique à l'événement présent dans le texte ; à défaut, ${src.urls[0]}.
- Dates YYYY-MM-DD ; un seul jour : endDate = startDate.
- "schedule" : les horaires seulement, sans la date. "description" : une phrase, 200 caractères maximum.
- "city" : la commune ; à défaut ${src.city || 'la commune du lieu si elle est écrite'}.
- "category" : UNIQUEMENT "Sport & Outdoor", "Nature & Environnement", "Scène & Spectacles" (concerts, théâtre, cinéma, festivals) ou "Culture & Ateliers" (expositions, visites, patrimoine, ateliers, brocantes).
- "ageMin" / "ageMax" : 0 et 99 si rien n'est précisé.

${pages.map((p, i) => `=== PAGE ${i + 1} : ${p.url} ===\n${p.text}`).join('\n\n')}
`.trim();

const EVENT_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' }, category: { type: 'STRING' }, startDate: { type: 'STRING' }, endDate: { type: 'STRING' },
      city: { type: 'STRING' }, locationName: { type: 'STRING' }, schedule: { type: 'STRING' }, price: { type: 'STRING' },
      organizer: { type: 'STRING' }, description: { type: 'STRING' }, url: { type: 'STRING' },
      ageMin: { type: 'INTEGER' }, ageMax: { type: 'INTEGER' },
    },
    required: ['title', 'startDate', 'endDate', 'url', 'category'],
  },
};

async function extractWithGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        // No google_search tool: extraction from text we fetched ourselves. Structured output is
        // available precisely because the search tool is absent (§3.A).
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: EVENT_SCHEMA },
        }),
        signal: AbortSignal.timeout(CONFIG.llmTimeoutMs),
      });
      const body = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
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

async function readPage(src, ctx) {
  if (!process.env.GEMINI_API_KEY) return { fetched: 0, events: [], skipped: 'no GEMINI_API_KEY' };
  const pages = [];
  for (const u of src.urls) {
    const r = await politeGet(u);
    pages.push({ url: r.url, text: htmlToText(r.text, r.url) });
  }
  // Share the budget between the pages so a long feed cannot crowd out the agenda page.
  const per = Math.floor(CONFIG.maxTextChars / pages.length);
  for (const p of pages) p.text = p.text.slice(0, per);
  const { items, usage } = await extractWithGemini(EXTRACT_PROMPT(ctx, src, pages));
  const events = items
    .filter((e) => e && typeof e.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.startDate || ''))
    .map((e) => ({ ...e, endDate: /^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') ? e.endDate : e.startDate, city: e.city || src.city || '' }))
    .filter((e) => inWindow(e, ctx));
  return { fetched: pages.length, events, usage };
}

const READERS = { ics: readIcs, 'apidae-ot': readApidaeOt, page: readPage };

function loadRegistry() {
  const json = JSON.parse(fs.readFileSync(CONFIG.registryPath, 'utf8'));
  if (!json || !Array.isArray(json.sources)) throw new Error('sources.json: no "sources" array');
  return json.sources;
}

/**
 * Reads every enabled source. Never throws for one site: a site that fails is reported and the
 * others carry on — the same rule as the pipeline's sources.
 */
async function load(ctx, { only } = {}) {
  const results = [];
  for (const src of loadRegistry()) {
    if (only && !only.includes(src.id)) continue;
    const base = { id: src.id, name: src.name, type: src.type };
    if (src.enabled === false) { results.push({ ...base, status: 'disabled', note: src.note || '', events: [] }); continue; }
    const reader = READERS[src.type];
    if (!reader) { results.push({ ...base, status: 'error', error: `unknown type ${src.type}`, events: [] }); continue; }
    const t0 = Date.now();
    try {
      const r = await reader(src, ctx);
      const events = r.events.map((e) => ({ ...e, sourceId: src.id }));
      results.push({ ...base, status: r.skipped ? 'skipped' : 'ok', skipped: r.skipped, fetched: r.fetched, usage: r.usage, ms: Date.now() - t0, events });
    } catch (err) {
      results.push({ ...base, status: err.robots ? 'robots' : 'error', error: String(err.message || err).slice(0, 200), ms: Date.now() - t0, events: [] });
    }
  }
  return results;
}

module.exports = { CONFIG, load, loadRegistry, parseRobots, robotsAllows, htmlToText, parseFrenchPeriods, parseIcs, decodeEntities, pickTitle };
