/**
 * Visitor feedback ingestion — reads the Google Form response sheet, published as CSV.
 *
 * This is the INPUT half of the feedback loop; overrides.json (§3.K) is the output half.
 *
 * The form is open to anyone with the link, so every row here is an UNAUTHENTICATED write
 * attempt against published data. The whole design follows from that:
 *
 *   - Only one action is ever applied automatically: hiding an event. It is reversible, it is
 *     idempotent, and the project's own rule (§5) is that a missing event costs less than a wrong
 *     one. Everything that would WRITE attacker-controlled text into data.json — a date, a price,
 *     a title — is queued in the run report for a human instead.
 *   - A reported dead link is not a hide: it only clears the URL's verification stamp so the
 *     pipeline re-checks it on this run and drops it on its own evidence if it really is dead.
 *   - A burst of hide requests above MAX_AUTO_HIDE applies NOTHING and shouts in the report.
 *     Mass-hiding is the attack (empty the site); refusing to act on a burst is the safe answer.
 *   - Nothing is remembered between runs. Hiding is idempotent, so re-reading the whole sheet
 *     every time is correct and needs no state file.
 *
 * The sheet URL is never committed: responses can carry the optional contact field, and a public
 * repository would make that harvestable. It comes from FEEDBACK_CSV_URL (a GitHub secret).
 */

'use strict';

// Reuse the project's own RFC 4180 parser rather than carrying a second copy of it.
const { parseCsv } = require('./datatourisme');

const USER_AGENT = 'Mozilla/5.0 (compatible; FontainebleauEventsBot/2.5; +feedback)';

const CONFIG = {
  url: process.env.FEEDBACK_CSV_URL || '',
  timeoutMs: Number(process.env.FEEDBACK_TIMEOUT_MS) || 15_000,
  // A burst above this is treated as abuse, not as signal (see the header comment).
  maxAutoHide: Number(process.env.FEEDBACK_MAX_AUTO_HIDE) || 5,
};

const EVENT_ID = /^(?:EVT|ACT)_[A-Za-z0-9]+$/;

/** Accent- and case-insensitive, whitespace-collapsed — for matching form labels loosely. */
function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Problem type -> what we are allowed to do about it.
 *
 * Matched on keywords, not on exact labels, so rewording an option in the form does not silently
 * stop the mapping from working. Every distinct label seen is echoed in the run report with the
 * action it was mapped to, so a miscategorised option is visible on the very first run.
 */
const HIDE_KEYWORDS = [
  'existe pas', 'existe plus', 'annul', 'doublon', 'duplicat', 'na pas eu lieu',
  'cancelled', 'does not exist', 'duplicate',
];
// A broken link is two independent ideas ("lien" + "cassé") that the form may word in any order
// and with any filler between them ("le lien est mort"), so it is matched as a pair, not a phrase.
const LINK_WORD = /\b(lien|url|link|adresse)\b/;
const BROKEN_WORD = /\b(mort|cass\w*|invalide|hs|404|dead|broken)\b|ne (marche|fonctionne|repond)/;

function classifyProblem(rawType) {
  const t = norm(rawType);
  if (!t) return 'review';
  if (LINK_WORD.test(t) && BROKEN_WORD.test(t)) return 'recheck';
  if (HIDE_KEYWORDS.some((k) => t.includes(k))) return 'hide';
  return 'review';
}

/**
 * Locate a column by pattern, accent- and case-insensitively (the live sheet's headers carry
 * stray trailing spaces, and the form's wording may change). Patterns are tried in order, so the
 * most specific one wins.
 */
function findColumn(header, patterns) {
  const normed = header.map(norm);
  for (const pattern of patterns) {
    const test = pattern instanceof RegExp ? (h) => pattern.test(h) : (h) => h.includes(pattern);
    const i = normed.findIndex(test);
    if (i !== -1) return i;
  }
  return -1;
}

/** "9/21/2026 10:17:47" (the sheet's own format) -> epoch ms, or 0 when unparseable. */
function parseTimestamp(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(raw ?? '').trim());
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

async function downloadCsv(url, timeoutMs = CONFIG.timeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error('feedback CSV -> HTTP ' + res.status);
  const text = await res.text();
  // A sheet that stops being published answers 200 with an HTML error page, not CSV.
  if (/^\s*</.test(text)) throw new Error('feedback CSV -> got HTML, is the sheet still published?');
  return text;
}

/**
 * Turn the raw CSV into actions. Pure — no network, no I/O — so it is testable against a fixture.
 * `knownOverrides` lets an entry already handled in overrides.json drop out of the review queue,
 * which is what makes the queue self-clearing instead of nagging forever.
 */
function classify(csvText, { knownOverrides = {}, maxAutoHide = CONFIG.maxAutoHide } = {}) {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!rows.length) throw new Error('feedback CSV is empty');

  const header = rows[0];
  const ix = {
    time: findColumn(header, ['timestamp', 'horodat']),
    // \bid\b so "ID de l'événement" matches while "Lien de l'événement" cannot.
    id: findColumn(header, ['identifiant', /\bid\b/, /\bevent id\b/]),
    title: findColumn(header, ['titre', 'title']),
    type: findColumn(header, ['type de probleme', 'probleme', 'problem']),
    details: findColumn(header, ['detail', 'precision', 'message']),
  };
  if (ix.id === -1 || ix.type === -1) {
    throw new Error(
      'feedback CSV schema changed: no event-id and/or problem-type column.\n'
      + 'Columns found: ' + header.join(' | ')
    );
  }

  const stats = {
    total: rows.length - 1,
    labels: {},        // raw problem label -> { action, count }
    badId: [],         // rows whose event id is missing or malformed
    alreadyHandled: 0, // already present in overrides.json
    capped: false,
  };
  const hide = new Map();   // id -> { reason, when, title }
  const recheck = new Map();
  const review = [];

  const seen = new Set();
  const entries = rows.slice(1)
    .map((r) => ({ row: r, when: parseTimestamp(r[ix.time]) }))
    .sort((a, b) => a.when - b.when); // oldest first, so a cap keeps the earliest reports

  for (const { row, when } of entries) {
    const id = String(row[ix.id] ?? '').trim();
    const rawType = String(row[ix.type] ?? '').trim();
    const action = classifyProblem(rawType);

    const label = rawType || '(vide)';
    stats.labels[label] ||= { action, count: 0 };
    stats.labels[label].count++;

    if (!EVENT_ID.test(id)) { stats.badId.push(id ? id.slice(0, 40) : '(vide)'); continue; }

    const dedupeKey = id + '|' + action;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // A human has already ruled on this event: their decision stands, and the queue stops nagging.
    if (Object.prototype.hasOwnProperty.call(knownOverrides, id)) { stats.alreadyHandled++; continue; }

    const item = {
      id,
      when,
      type: rawType,
      title: String(row[ix.title] ?? '').trim().slice(0, 80),
      details: String(row[ix.details] ?? '').trim().slice(0, 200),
    };
    if (action === 'hide') hide.set(id, item);
    else if (action === 'recheck') recheck.set(id, item);
    else review.push(item);
  }

  // A burst above the cap is abuse, not signal: apply nothing and let a human look.
  let autoHide = hide;
  if (hide.size > maxAutoHide) {
    stats.capped = true;
    review.push(...hide.values());
    autoHide = new Map();
  }

  stats.autoHidden = autoHide.size;
  stats.recheck = recheck.size;
  stats.review = review.length;
  return { autoHide, recheck, review, stats, header };
}

/**
 * Overrides to apply this run = auto-hides from the form, with overrides.json laid on top.
 * The hand-written file always wins: if a visitor says "cancelled" and the project lead has
 * written a correction for that event, the human decision is the one that survives.
 */
function mergeAutoHides(fileOverrides, autoHide) {
  const merged = {};
  for (const [id, item] of autoHide) {
    merged[id] = { hidden: true, note: `auto — signalé « ${item.type} »` };
  }
  return Object.assign(merged, fileOverrides);
}

async function collect({ url = CONFIG.url, knownOverrides = {}, maxAutoHide = CONFIG.maxAutoHide } = {}) {
  if (!url) return null; // not configured: the feature is simply off
  const csv = await downloadCsv(url);
  return classify(csv, { knownOverrides, maxAutoHide });
}

module.exports = {
  CONFIG, collect, classify, classifyProblem, mergeAutoHides,
  findColumn, parseTimestamp, norm, downloadCsv,
};
