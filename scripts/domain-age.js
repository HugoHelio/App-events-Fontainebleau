/**
 * Age of the domain behind an event link (item 92b, October 28, 2026).
 *
 * On 12/10 the culture scan published « Les Feux de Courances », a medieval festival that did not
 * exist: its link led to feuxdecourances.com, a ticketing page registered three months earlier,
 * selling seats in the name of the Domaine de Courances. Nothing caught it. Rule 79b only flags
 * links to a home page, and a site made for the event looks MORE reliable than a town hall's.
 *
 * The rule: an event that only Gemini found (no `source`) whose link sits on a domain registered
 * less than `youngDays` ago is not published. It is listed in the run report instead, and comes
 * back by itself the day another source confirms it (that source sets `source`).
 *
 * Registration dates come from RDAP, the registries' public protocol: no key, no scraping. The
 * IANA bootstrap file says which registry answers for each TLD (.fr → AFNIC, .com → Verisign…).
 *
 * Cache (domain-age-cache.json, committed): a registration date never changes, so a known date is
 * kept forever and each domain costs one request in its lifetime. A failed lookup is retried
 * after `retryDays`. Nothing here is ever fatal: an unknown age publishes the event as before.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const CONFIG = {
  enabled: process.env.DOMAIN_AGE !== '0',
  // 4 months, project lead's choice (28/10). feuxdecourances.com was 94 days old when published.
  youngDays: envInt('YOUNG_DOMAIN_DAYS', 120),
  retryDays: 7,
  cachePath: path.resolve(process.env.DOMAIN_AGE_CACHE_PATH || 'domain-age-cache.json'),
  bootstrapUrl: 'https://data.iana.org/rdap/dns.json',
  timeoutMs: 10_000,
  concurrency: 2,
};

// Second-level suffixes under which the registrable domain has three labels. Not the full Public
// Suffix List (zero dependencies): the ones a French event link actually uses.
const SECOND_LEVEL = new Set([
  'gouv.fr', 'asso.fr', 'com.fr', 'nom.fr', 'tm.fr',
  'co.uk', 'org.uk', 'com.au', 'co.jp',
]);

/** "www.billets.example.fr" → "example.fr". Null for an IP address or an unparsable link. */
function registrableDomain(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  const labels = host.replace(/\.$/, '').split('.');
  const n = SECOND_LEVEL.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.length >= n ? labels.slice(-n).join('.') : null;
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG.cachePath, 'utf8'));
    return raw && typeof raw.entries === 'object' ? raw.entries : {};
  } catch {
    return {};
  }
}

function saveCache(entries) {
  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(CONFIG.cachePath, JSON.stringify({ version: 1, entries: sorted }, null, 2) + '\n');
}

async function getJson(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(CONFIG.timeoutMs),
    headers: { Accept: 'application/rdap+json, application/json' },
  });
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { status: res.status };
  }
  return { status: res.status, json: await res.json() };
}

/** TLD → RDAP base URL, from the IANA bootstrap file. Empty map if it cannot be read. */
async function loadBootstrap() {
  const map = new Map();
  try {
    const { json } = await getJson(CONFIG.bootstrapUrl);
    for (const [tlds, urls] of json?.services || []) {
      const base = (urls || []).find((u) => u.startsWith('https://')) || (urls || [])[0];
      if (base) for (const tld of tlds) map.set(tld.toLowerCase(), base.endsWith('/') ? base : `${base}/`);
    }
  } catch { /* no bootstrap: every lookup is "unknown" this run */ }
  return map;
}

/** Registration date (YYYY-MM-DD) of a domain, or null when the registry does not say. */
async function lookup(domain, bootstrap) {
  const base = bootstrap.get(domain.split('.').pop());
  if (!base) return null;
  const { json } = await getJson(`${base}domain/${encodeURIComponent(domain)}`);
  const ev = (json?.events || []).find((e) => e.eventAction === 'registration');
  const date = String(ev?.eventDate || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

async function pool(items, limit, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

/**
 * Marks `rec.drop = 'young_domain'` on Gemini-only records whose link is on a young domain.
 * `records` are the pipeline's { event, drop? } wrappers. Returns the report data.
 */
async function check(records, { today, dryRun = false }) {
  const out = { enabled: CONFIG.enabled, youngDays: CONFIG.youngDays, looked: 0, failed: 0, young: [] };
  if (!CONFIG.enabled) return out;

  const candidates = records.filter((r) => !r.drop && !r.event.source && r.event.url);
  const cache = loadCache();
  let dirty = false;

  const domains = new Set();
  for (const r of candidates) {
    const d = registrableDomain(r.event.url);
    if (!d) continue;
    const c = cache[d];
    if (c?.registered) continue;
    if (c?.checkedAt && daysBetween(c.checkedAt, today) < CONFIG.retryDays) continue;
    domains.add(d);
  }

  if (domains.size) {
    const bootstrap = await loadBootstrap();
    await pool([...domains], CONFIG.concurrency, async (d) => {
      out.looked++;
      let registered = null;
      try { registered = await lookup(d, bootstrap); } catch { /* unknown */ }
      if (registered) cache[d] = { registered };
      else { cache[d] = { checkedAt: today }; out.failed++; }
      dirty = true;
    });
  }

  for (const r of candidates) {
    const d = registrableDomain(r.event.url);
    const registered = d && cache[d]?.registered;
    if (!registered) continue;
    const age = daysBetween(registered, today);
    if (age >= CONFIG.youngDays) continue;
    r.drop = 'young_domain';
    out.young.push({ id: r.event.id, title: r.event.title, startDate: r.event.startDate, domain: d, registered, age });
  }

  if (dirty && !dryRun) saveCache(cache);
  return out;
}

module.exports = { check, registrableDomain, CONFIG };
