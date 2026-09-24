/**
 * Direct sources — organisers' own pages, read without Google Search grounding (item 72, §3.Z, §3.Z2).
 *
 * Why: 7 organiser sites carry two thirds of what Gemini finds, 15 carry 83 %. Reading them
 * directly takes those events out of the grounding terms problem (§3.G, §8). It feeds both the
 * weekly shadow comparison (compare-sources.js) and, since 24 September, the pipeline itself as a
 * fourth published source (§3.Z2). Grounding stays on until legitimate sources cover ≥ 90 % of
 * the published events.
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
  // Sites are read in parallel (they are different hosts); each host still gets one request at
  // a time, one per second — the manners do not change, only the total time does.
  concurrency: envInt('SOURCES_CONCURRENCY', 4),
  timeoutMs: envInt('SOURCES_TIMEOUT_MS', 25_000),
  maxFichePages: envInt('SOURCES_MAX_FICHES', 250),
  maxTextChars: envInt('SOURCES_MAX_TEXT_CHARS', 90_000),
  model: process.env.SOURCES_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  llmTimeoutMs: envInt('SOURCES_LLM_TIMEOUT_MS', 180_000),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs fn over items with at most `limit` in flight; results keep the input order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ───────────────────────────── Polite fetching ─────────────────────────────

const lastHit = new Map();      // host -> timestamp of the last request
const hostChain = new Map();    // host -> promise of its last queued request (one at a time per host)
const robotsCache = new Map();  // origin -> Promise<{ allow: [], disallow: [] }>

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

function rawGet(url) {
  // Requests to one host are chained: with sites read in parallel, two readers must never hit
  // the same host at once, and the one-second spacing has to hold across them.
  const host = new URL(url).host;
  const run = (hostChain.get(host) || Promise.resolve()).then(() => rawGetNow(url, host));
  hostChain.set(host, run.catch(() => {}));
  return run;
}

async function rawGetNow(url, host) {
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
  // The pending promise is cached, not the result: sources read in parallel on one site must
  // share a single robots.txt request.
  if (!robotsCache.has(u.origin)) {
    robotsCache.set(u.origin, rawGet(`${u.origin}/robots.txt`)
      .then((r) => (r.ok ? parseRobots(r.text) : { allow: [], disallow: [] }))
      .catch(() => ({ allow: [], disallow: [] })));   // unreachable robots.txt: nothing is forbidden
  }
  if (!robotsAllows(await robotsCache.get(u.origin), u.pathname + u.search)) {
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
    const title = pickTitle(text, name) || name;
    // The event's own block — title to the site footer — for enrich(): description, venue,
    // address and hours are in there, the menus are not.
    const from = Math.max(0, flat.indexOf(title));
    const to = flat.indexOf('Découvrir la région', from);
    events.push({
      title,
      city: town,
      startDate: periods.reduce((a, q) => (q.start < a ? q.start : a), periods[0].start),
      endDate: periods.reduce((a, q) => (q.end > a ? q.end : a), periods[0].end),
      periods,
      price,
      url,
      detail: flat.slice(from, to > from ? to : from + 3000).slice(0, 3000),
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

async function extractWithGemini(prompt, schema = EVENT_SCHEMA) {
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
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema },
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

/**
 * The part of a page that is about the page: <main>, else the longest <article>, else the body
 * without its menus. On the château de Blandy's pages the menus were three quarters of the text
 * and pushed the events past the budget.
 */
function mainContent(html) {
  const main = /<main\b[\s\S]*?<\/main>/i.exec(html);
  if (main && main[0].length > 500) return main[0];
  const articles = String(html).match(/<article\b[\s\S]*?<\/article>/gi) || [];
  const longest = articles.sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length > 500) return longest;
  return String(html).replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
}

async function readPage(src, ctx) {
  if (!process.env.GEMINI_API_KEY) return { fetched: 0, events: [], skipped: 'no GEMINI_API_KEY' };
  const pages = [];
  const follow = src.follow ? new RegExp(src.follow) : null;
  const detailUrls = new Set();
  for (const u of src.urls) {
    const r = await politeGet(u);
    pages.push({ url: r.url, text: htmlToText(mainContent(r.text), r.url) });
    // A list that only names its events: follow the links to their own pages, where the dates are.
    if (follow) {
      for (const m of r.text.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
        let abs;
        try { abs = new URL(decodeEntities(m[1]), r.url).href; } catch { continue; }
        if (new URL(abs).host === new URL(r.url).host && follow.test(new URL(abs).pathname)) detailUrls.add(abs);
      }
    }
  }
  for (const u of [...detailUrls].slice(0, src.maxFollow || 25)) {
    try {
      const r = await politeGet(u);
      pages.push({ url: r.url, text: htmlToText(mainContent(r.text), r.url) });
    } catch { /* one missing event page is not a reason to lose the others */ }
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
  const srcs = loadRegistry().filter((src) => !only || only.includes(src.id));
  return mapLimit(srcs, CONFIG.concurrency, async (src) => {
    const base = { id: src.id, name: src.name, type: src.type };
    if (src.enabled === false) return { ...base, status: 'disabled', note: src.note || '', events: [] };
    const reader = READERS[src.type];
    if (!reader) return { ...base, status: 'error', error: `unknown type ${src.type}`, events: [] };
    const t0 = Date.now();
    try {
      const r = await reader(src, ctx);
      // A site-wide default fills what the reader cannot know (an .ics has no category).
      const events = r.events.map((e) => ({ ...e, sourceId: src.id, category: e.category || src.category, city: e.city || src.city || '' }));
      return { ...base, status: r.skipped ? 'skipped' : 'ok', skipped: r.skipped, fetched: r.fetched, usage: r.usage, ms: Date.now() - t0, events };
    } catch (err) {
      return { ...base, status: err.robots ? 'robots' : 'error', error: String(err.message || err).slice(0, 200), ms: Date.now() - t0, events: [] };
    }
  });
}

// ───────────────────────────── For the pipeline ─────────────────────────────
//
// Until 24 September this module only fed the shadow comparison. It now also feeds the
// pipeline (fetch-events.js) as a fourth source. What follows is only used there.

const crypto = require('crypto');
const CATEGORIES = ['Sport & Outdoor', 'Nature & Environnement', 'Scène & Spectacles', 'Culture & Ateliers'];
const ENRICH_CACHE = path.resolve(process.env.SOURCES_CACHE_PATH || 'sources-cache.json');
const ENRICH_CACHE_DAYS = envInt('SOURCES_CACHE_DAYS', 150);

const ENRICH_PROMPT = (items) => `
Voici des fiches d'événements de l'office de tourisme du Pays de Fontainebleau (texte brut).
Les dates sont déjà connues. Pour chaque fiche, donne UNIQUEMENT ce que le texte affirme :
- "category" : "Sport & Outdoor", "Nature & Environnement", "Scène & Spectacles" (concerts, théâtre, cinéma, festivals) ou "Culture & Ateliers" (expositions, visites, patrimoine, ateliers, brocantes).
- "description" : une phrase en français, 200 caractères maximum, reformulée (pas un copier-coller).
- "schedule" : les horaires seulement, sans les dates ; vide si absents.
- "locationName" : le nom du lieu, suivi de l'adresse postale si elle est écrite (ex. « Muse Galerie, 82 bis Grande Rue »). Jamais l'adresse de l'office de tourisme.
- "organizer" : l'organisateur s'il est nommé, sinon vide.
- "ageMin" / "ageMax" : 0 et 99 si rien n'est précisé.
N'invente rien.

${items.map((it, i) => `=== FICHE ${i} : ${it.title} (${it.city}) ===\n${it.detail}`).join('\n\n')}
`.trim();

const ENRICH_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      i: { type: 'INTEGER' }, category: { type: 'STRING' }, description: { type: 'STRING' }, schedule: { type: 'STRING' },
      locationName: { type: 'STRING' }, organizer: { type: 'STRING' }, ageMin: { type: 'INTEGER' }, ageMax: { type: 'INTEGER' },
    },
    required: ['i', 'category'],
  },
};

/**
 * Fills category, description, hours, venue and age for readers that only hold dates and raw
 * text (the tourist office). Gemini WITHOUT grounding, cached by page URL + text hash like the
 * translations: an unchanged page is never asked twice. Dates are never touched here — they
 * were read by the tested parser, and a model does not get to change them.
 */
async function enrich(events, { dryRun = false, today, batchSize = 12 } = {}) {
  const stats = { cached: 0, asked: 0, failed: 0, tokensIn: 0, tokensOut: 0, error: null };
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(ENRICH_CACHE, 'utf8')).entries || {}; } catch { cache = {}; }
  const todo = [];
  for (const e of events) {
    if (!e.detail) continue;
    const h = crypto.createHash('sha1').update(e.title + '\n' + e.detail).digest('hex').slice(0, 12);
    const hit = cache[e.url];
    if (hit && hit.h === h) { Object.assign(e, hit.f); hit.at = today; stats.cached++; continue; }
    todo.push({ e, h });
  }
  if (todo.length && process.env.GEMINI_API_KEY) {
    const batches = [];
    for (let s = 0; s < todo.length; s += batchSize) batches.push(todo.slice(s, s + batchSize));
    // Three batches in flight: a batch is one model call of ~20 s, done one by one it was minutes.
    await mapLimit(batches, 3, async (batch) => {
      try {
        const { items, usage } = await extractWithGemini(ENRICH_PROMPT(batch.map((b) => b.e)), ENRICH_SCHEMA);
        if (usage) { stats.tokensIn += usage.promptTokenCount || 0; stats.tokensOut += usage.candidatesTokenCount || 0; }
        for (const it of items) {
          const b = batch[Number(it && it.i)];
          if (!b || !CATEGORIES.includes(it.category)) continue;
          const f = {
            category: it.category,
            description: String(it.description || '').slice(0, 220),
            schedule: String(it.schedule || '').slice(0, 120),
            locationName: String(it.locationName || '').slice(0, 160),
            organizer: String(it.organizer || '').slice(0, 120),
            ageMin: Number.isInteger(it.ageMin) ? it.ageMin : 0,
            ageMax: Number.isInteger(it.ageMax) ? it.ageMax : 99,
          };
          Object.assign(b.e, f);
          cache[b.e.url] = { h: b.h, f, at: today };
          stats.asked++;
        }
      } catch (err) {
        stats.failed += batch.length;
        stats.error = String(err.message || err).slice(0, 200);
      }
    });
  }
  if (!dryRun) {
    const cutoff = new Date(Date.parse(today) - ENRICH_CACHE_DAYS * 86400000).toISOString().slice(0, 10);
    const kept = {};
    for (const k of Object.keys(cache).sort()) if ((cache[k].at || today) >= cutoff) kept[k] = cache[k];
    try { fs.writeFileSync(ENRICH_CACHE, JSON.stringify({ version: 1, entries: kept }, null, 2) + '\n'); } catch (err) { stats.error = stats.error || err.message; }
  }
  return stats;
}

/** Same threshold as DATAtourisme's "recurring" (§3.H): beyond it, a standing offer, not an outing. */
const LONG_EVENT_DAYS = envInt('SOURCES_LONG_EVENT_DAYS', 14);
const spanDays = (s, e) => Math.round((Date.parse(e) - Date.parse(s)) / 86400000);

/**
 * Reader output → the shape fetch-events.js validates. One record per dated period (the
 * DATAtourisme rule: an exact date is the useful information). A period longer than
 * LONG_EVENT_DAYS is flagged `long`: the pipeline uses it to confirm and enrich an event it
 * already has, never to add a new one — a museum's standing offer is not an outing to announce.
 */
function toPipelineEvents(events, { today, maxDate }) {
  const out = [];
  for (const e of events) {
    const periods = (e.periods && e.periods.length ? e.periods : [{ start: e.startDate, end: e.endDate || e.startDate }])
      .filter((p) => p.end >= today && p.start <= maxDate).slice(0, 12);
    for (const p of periods) {
      out.push({
        title: e.title,
        category: e.category,
        ageMin: e.ageMin ?? 0,
        ageMax: e.ageMax ?? 99,
        city: e.city,
        locationName: e.locationName || '',
        dateType: 'event',
        startDate: p.start,
        endDate: p.end,
        schedule: e.schedule || '',
        price: e.price || '',
        organizer: e.organizer || '',
        description: e.description || '',
        url: e.url,
        source: 'site',
        sourceId: e.sourceId,
        long: spanDays(p.start, p.end) > LONG_EVENT_DAYS,
      });
    }
  }
  return out;
}

module.exports = {
  CONFIG, load, loadRegistry, parseRobots, robotsAllows, htmlToText, parseFrenchPeriods, parseIcs, decodeEntities, pickTitle,
  mainContent, enrich, toPipelineEvents, LONG_EVENT_DAYS,
};
