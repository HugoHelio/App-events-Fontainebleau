#!/usr/bin/env node
/**
 * Static, indexable pages built from data.json (item 68, §3.X).
 *
 * The site itself is one page that loads data.json with JavaScript: a crawler sees almost none
 * of the events. This script writes plain HTML that needs no script at all:
 *   /evenements/<slug>-<hash>/   one page per event, with schema.org Event markup
 *   /que-faire/<commune>/        "Que faire à … ?", one page per commune
 *   /que-faire/                  the index of communes
 *   /sitemap.xml                 every URL above, plus the home page and its English variant
 *
 * Rules that are not obvious from the code:
 *   - It NEVER writes data.json. The pipeline is the only writer; it stores `pageUrl` using
 *     pagePath() below, so the two can never disagree.
 *   - The URL ends with a token of the event id, which is stable for the life of a record (the id
 *     is kept even when an override changes the title). If the readable part changes, the old
 *     folder becomes a noindex redirect to the new one instead of a 404.
 *   - Pages of events that are over, or gone from data.json, are deleted. 404.html (hand-written)
 *     catches a visitor who arrives from an old search result.
 *   - schema.org Event markup is only emitted when the event link was verified: a rich result
 *     with a wrong date is worse than no rich result.
 *   - Output is deterministic and a file is only rewritten when its content changes, so a run
 *     with nothing new produces no commit.
 *
 * Zero dependencies. Usage: node scripts/generate-pages.js   (SITE_DIR=… to change the root)
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://fontainebleaulive.fr';
const ROOT = process.env.SITE_DIR || path.join(__dirname, '..');
const EVENTS_DIR = 'evenements';
const CITIES_DIR = 'que-faire';
const OG_IMAGE = `${SITE_URL}/og-image.png`;
const ICON = '/public/assets/img/brand/Icon-FL-pwa-vS.png';

// ───────────────────────────── Helpers ─────────────────────────────

function slugify(s, max = 60) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/, '');
}

/**
 * The id as a URL token — the only part of the address that never changes. EVT_<hash> gives
 * the hash; the v1 records still in data.json (ACT_014…) keep their id for life too, and give
 * "act014". No hyphen inside, so the token is always the last segment of the folder name.
 */
function idToken(e) {
  const id = String(e && e.id || '');
  let m = /^EVT_([0-9a-f]{10})$/.exec(id);
  if (m) return m[1];
  m = /^([A-Z]{3})_([0-9A-Za-z]{1,20})$/.exec(id);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

const tokenOfDir = (dir) => (/(?:^|-)([a-z0-9]+)$/.exec(dir) || [])[1] || null;

/** Site-relative URL of an event page, or null when the record has no usable id. */
function pagePath(e) {
  const token = idToken(e);
  if (!token || !e.title || !e.city) return null;
  const title = slugify(e.title);
  const city = slugify(e.city, 30);
  // "Marché de Noël d'Avon" does not need "-avon" twice.
  const words = (city && !`-${title}-`.includes(`-${city}-`)) ? [title, city].filter(Boolean).join('-') : title;
  return `/${EVENTS_DIR}/${words ? `${words}-` : ''}${token}/`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// JSON inside <script>: `<` escaped so a title containing "</script>" cannot close the block.
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function safeUrl(u) {
  try {
    const url = new URL(String(u || ''));
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
  } catch { return null; }
}

function truncate(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function parisToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

function frDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

const dateLabel = (e) => (!e.endDate || e.endDate === e.startDate)
  ? `Le ${frDate(e.startDate)}`
  : `Du ${frDate(e.startDate)} au ${frDate(e.endDate)}`;

// Same wording as formatAge() in index.html, without the emoji.
function ageLabel(e) {
  const min = Number(e.ageMin ?? 0);
  const max = Number(e.ageMax ?? 99);
  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max < 99;
  const ans = (n) => `${n} ${n === 1 ? 'an' : 'ans'}`;
  if (!hasMin && !hasMax) return 'Tout public';
  if (hasMin && !hasMax) return `Dès ${ans(min)}`;
  if (!hasMin && hasMax) return `Jusqu’à ${ans(max)}`;
  if (min === max) return ans(min);
  return `${min}–${max} ans`;
}

/**
 * schema.org Offer, only when the price text is unambiguous. "Gratuit pour les adhérents" or
 * "10 € (plein), 8 € (réduit), gratuit -12 ans" would become a false price in a search result;
 * the page still shows the full text.
 */
function offers(e, url) {
  const p = String(e.price || '').trim();
  if (/^(gratuit|entr[ée]e libre|acc[èe]s libre)( sur (r[ée]servation|inscription))?$/i.test(p)) {
    return { '@type': 'Offer', price: 0, priceCurrency: 'EUR', url };
  }
  const m = /^(\d+(?:[.,]\d{1,2})?)\s*€$/.exec(p);
  return m ? { '@type': 'Offer', price: Number(m[1].replace(',', '.')), priceCurrency: 'EUR', url } : undefined;
}

// ───────────────────────────── Templates ─────────────────────────────

const STYLE = `
:root{--ink:#1d3b29;--text:#2b322d;--muted:#4a544e;--line:#e6e2da;--bg:#f4f3ef;--paper:#fff;--accent-ink:#8f6a25;--accent:#afe14f}
*{box-sizing:border-box}
body{margin:0;font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--text);background:var(--bg)}
header{background:linear-gradient(155deg,#2d543c 0%,var(--ink) 55%,#142a1d 100%);padding:12px 16px}
header a{display:inline-flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:700}
header img{border-radius:8px}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
nav.crumbs{font-size:14px;color:var(--muted);margin-bottom:12px}
nav.crumbs a{color:var(--muted)}
h1{font-size:1.8rem;line-height:1.2;margin:0 0 8px;color:var(--ink);overflow-wrap:anywhere}
h2{font-size:1.2rem;margin:32px 0 8px;color:var(--ink)}
.when{font-size:1.1rem;font-weight:600;margin:0 0 20px}
.sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:16px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}
dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
.note{font-size:14px;color:var(--muted)}
.note a{color:var(--ink)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}
.btn{display:inline-block;padding:10px 16px;border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600}
.btn.alt{background:transparent;color:var(--ink);border:1.5px solid var(--ink)}
a:focus-visible,.btn:focus-visible{outline:3px solid var(--accent-ink);outline-offset:2px}
ul.list{list-style:none;padding:0;margin:0}
ul.list li{padding:12px 0;border-bottom:1px solid var(--line)}
ul.list a{color:var(--ink);font-weight:600}
ul.list small{display:block;color:var(--muted)}
footer{max-width:720px;margin:0 auto;padding:0 16px 32px;font-size:14px;color:var(--muted)}
footer a{color:var(--muted)}
@media (max-width:480px){dl{grid-template-columns:1fr}dt{margin-top:6px}}
`.trim();

function layout({ title, description, canonical, body, ld, noindex, refresh }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}${refresh ? `<meta http-equiv="refresh" content="0; url=${esc(refresh)}">\n` : ''}<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="192x192" href="${ICON}">
<meta name="theme-color" content="#1d3b29">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fontainebleau Live">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>\n` : ''}<style>${STYLE}</style>
</head>
<body>
<header><a href="/"><img src="${ICON}" alt="" width="32" height="32">Fontainebleau Live</a></header>
<main>
${body}
</main>
<footer>Agenda collecté automatiquement. Vérifiez les informations auprès de l’organisateur avant de vous déplacer. · <a href="/${CITIES_DIR}/">Toutes les communes</a> · <a href="https://helioso.com" rel="noopener">Un projet Helioso</a></footer>
</body>
</html>
`;
}

const eventItem = (e) =>
  `<li><a href="${esc(e.pagePath)}">${esc(e.title)}</a><small>${esc(dateLabel(e))} · ${esc(e.locationName || e.city)}</small></li>`;

function eventLd(e, canonical) {
  const link = safeUrl(e.url);
  const place = {
    '@type': 'Place',
    name: e.locationName || e.city,
    address: { '@type': 'PostalAddress', addressLocality: e.city, addressCountry: 'FR' },
  };
  // An approximate position (town centre, default point) is not sent as the venue's location.
  if (!e.geoApprox && Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lng))) {
    place.geo = { '@type': 'GeoCoordinates', latitude: Number(e.lat), longitude: Number(e.lng) };
  }
  const min = Number.isFinite(Number(e.ageMin)) ? Number(e.ageMin) : 0;
  const max = Number.isFinite(Number(e.ageMax)) && Number(e.ageMax) > 0 ? Number(e.ageMax) : 99;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    startDate: e.startDate,
    endDate: e.endDate || e.startDate,
    description: truncate(e.description, 500) || undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: place,
    image: [safeUrl(e.image) || OG_IMAGE],
    url: canonical,
    organizer: e.organizer ? { '@type': 'Organization', name: e.organizer } : undefined,
    offers: offers(e, link || undefined),
    typicalAgeRange: (min > 0 || max < 99) ? `${min}-${max < 99 ? max : ''}` : undefined,
  };
}

function eventPage(e, sameCity) {
  const canonical = SITE_URL + e.pagePath;
  const link = safeUrl(e.url);
  const rows = [
    ['Horaires', e.schedule],
    ['Lieu', [e.locationName, e.city].filter(Boolean).join(', ')],
    ['Tarif', e.price],
    ['Public', ageLabel(e)],
    ['Organisateur', e.organizer],
    ['Catégorie', e.category],
  ].filter(([, v]) => v);
  const others = sameCity.filter((o) => o.id !== e.id).slice(0, 5);

  const body = `<nav class="crumbs"><a href="/">Accueil</a> › <a href="/${CITIES_DIR}/${e.citySlug}/">${esc(e.city)}</a></nav>
<h1>${esc(e.title)}</h1>
<p class="when">${esc(dateLabel(e))}</p>
<div class="sheet"><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
${e.description ? `<p>${esc(e.description)}</p>` : ''}
<div class="actions">
${link ? `<a class="btn" href="${esc(link)}" rel="nofollow noopener" target="_blank">Site de l’organisateur</a>\n` : ''}<a class="btn alt" href="/?event=${encodeURIComponent(e.id)}">Voir sur la carte</a>
</div>
<p class="note">Informations collectées automatiquement${link ? ` depuis ${esc(new URL(link).hostname.replace(/^www\./, ''))}` : ''} : vérifiez-les auprès de l’organisateur avant de vous déplacer.</p>
${others.length ? `<h2>Aussi à ${esc(e.city)}</h2>\n<ul class="list">${others.map(eventItem).join('')}</ul>\n<p><a href="/${CITIES_DIR}/${e.citySlug}/">Tout le programme à ${esc(e.city)}</a></p>` : ''}`;

  return layout({
    title: `${e.title} · ${e.city} | Fontainebleau Live`,
    description: truncate(`${dateLabel(e)} à ${e.city}. ${e.description || ''}`, 155),
    canonical,
    body,
    ld: e.urlStatus === 'ok' ? eventLd(e, canonical) : null,
  });
}

function redirectPage(e) {
  const target = SITE_URL + e.pagePath;
  return layout({
    title: `${e.title} | Fontainebleau Live`,
    description: 'Cette page a changé d’adresse.',
    canonical: target,
    noindex: true,
    refresh: e.pagePath,
    body: `<h1>Cette page a changé d’adresse</h1>\n<p><a href="${esc(e.pagePath)}">${esc(e.title)}</a></p>`,
  });
}

function cityPage(c) {
  const n = c.events.length;
  const body = `<nav class="crumbs"><a href="/">Accueil</a> › <a href="/${CITIES_DIR}/">Communes</a></nav>
<h1>Que faire à ${esc(c.name)} ?</h1>
<p>${n} activité${n > 1 ? 's' : ''} à venir à ${esc(c.name)} : sport, nature, culture et sorties en famille.</p>
<ul class="list">${c.events.map(eventItem).join('')}</ul>
<div class="actions"><a class="btn alt" href="/?ville=${encodeURIComponent(c.name)}">Voir sur la carte</a></div>
<h2>Recevoir le programme de ${esc(c.name)} dans votre agenda</h2>
<p class="note">Un abonnement : les activités s’ajoutent à votre agenda et se mettent à jour toutes seules. Les expositions de plus d’une semaine n’y figurent pas, elles restent ici.</p>
<div class="actions">${subscribeLinks(`/${AGENDA_DIR}/commune/${c.slug}.ics`)}</div>
<p class="note">Vous gérez un site (mairie, association, hébergement) ? <a href="/widget/integrer/?ville=${encodeURIComponent(c.name)}">Affichez gratuitement ce programme chez vous</a>.</p>`;
  return layout({
    title: `Que faire à ${c.name} ? Agenda des activités | Fontainebleau Live`,
    description: truncate(`${n} activité${n > 1 ? 's' : ''} à venir à ${c.name}, autour de Fontainebleau : sport, nature, culture, sorties en famille.`, 155),
    canonical: `${SITE_URL}/${CITIES_DIR}/${c.slug}/`,
    body,
  });
}

function citiesIndex(cities) {
  const body = `<nav class="crumbs"><a href="/">Accueil</a></nav>
<h1>Que faire autour de Fontainebleau ?</h1>
<p>Les activités à venir, commune par commune.</p>
<ul class="list">${cities.map((c) => `<li><a href="/${CITIES_DIR}/${c.slug}/">${esc(c.name)}</a><small>${c.events.length} activité${c.events.length > 1 ? 's' : ''} à venir</small></li>`).join('')}</ul>`;
  return layout({
    title: 'Que faire autour de Fontainebleau ? Agenda par commune | Fontainebleau Live',
    description: 'Les activités sportives, culturelles et nature à venir autour de Fontainebleau, classées par commune.',
    canonical: `${SITE_URL}/${CITIES_DIR}/`,
    body,
  });
}

function sitemap(cities, events, homeLastmod) {
  const alt = [
    '    <xhtml:link rel="alternate" hreflang="fr" href="https://fontainebleaulive.fr/"/>',
    '    <xhtml:link rel="alternate" hreflang="en" href="https://fontainebleaulive.fr/?lang=en"/>',
  ].join('\n');
  const home = (loc) => `  <url>\n    <loc>${loc}</loc>\n${homeLastmod ? `    <lastmod>${homeLastmod}</lastmod>\n` : ''}${alt}\n  </url>`;
  const plain = (p) => `  <url><loc>${SITE_URL}${p}</loc></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${home(`${SITE_URL}/`)}
${home(`${SITE_URL}/?lang=en`)}
${[`/${CITIES_DIR}/`, '/widget/integrer/', ...cities.map((c) => `/${CITIES_DIR}/${c.slug}/`), ...events.map((e) => e.pagePath)].map(plain).join('\n')}
</urlset>
`;
}

// ───────────────────────────── Build ─────────────────────────────

/**
 * Pure: data.json payload + the folders already on disk → { files, remove }.
 * Nothing touches the disk here, so a failure half-way leaves the site as it was.
 */
// ───────────────────────────── Calendar feeds (item 69) ─────────────────────────────
//
// Subscribable iCalendar files (RFC 5545): one for everything, one per category, one per
// commune. A calendar app re-downloads them on its own, so the visitor's phone follows the
// site with no account, no e-mail and no server.
//
// Rules that are easy to get wrong, and silently: a calendar app that cannot parse a feed
// simply shows nothing.
//   - CRLF line endings, lines folded at 75 octets (not characters: é is two), and
//     `\` `;` `,` escaped in text values.
//   - All-day events: DTEND is EXCLUSIVE, so it is the day after the last day.
//   - UID = the event id, stable for the life of the record: an app updates the entry instead
//     of duplicating it, and drops it when it leaves the feed.
//   - Events longer than FEED_MAX_DAYS are left out: a four-month exhibition as an all-day
//     entry would sit at the top of the visitor's calendar every day until January.
//   - A feed is never deleted once published. A commune with nothing left gets an empty
//     calendar: a subscription that starts returning 404 makes some apps show an error.

const AGENDA_DIR = 'agenda';
const FEED_MAX_DAYS = 7;

const icsText = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/** Folds one content line at 75 octets, never inside a UTF-8 character. */
function icsFold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    const limit = out.length ? 74 : 75;   // continuation lines start with a space
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const icsDate = (iso) => iso.replace(/-/g, '');

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function spanDays(e) {
  const end = isIsoDate(e.endDate) ? e.endDate : e.startDate;
  return Math.round((Date.parse(end) - Date.parse(e.startDate)) / 86400000) + 1;
}

const inFeed = (e) => spanDays(e) <= FEED_MAX_DAYS;

function icsEvent(e) {
  const end = isIsoDate(e.endDate) ? e.endDate : e.startDate;
  const link = safeUrl(e.url);
  const details = [
    e.schedule && `Horaires : ${e.schedule}`,
    e.price && `Tarif : ${e.price}`,
    ageLabel(e) !== 'Tout public' && `Public : ${ageLabel(e)}`,
    e.description,
    link && `Organisateur : ${link}`,
    `Fiche : ${SITE_URL}${e.pagePath}`,
    'Informations collectées automatiquement : vérifiez-les auprès de l’organisateur.',
  ].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.id}@fontainebleaulive.fr`,
    // Required. Tied to the data, not to the clock, so an unchanged event is an unchanged file.
    `DTSTAMP:${icsDate(isIsoDate(e.lastSeen) ? e.lastSeen : e.startDate)}T000000Z`,
    `DTSTART;VALUE=DATE:${icsDate(e.startDate)}`,
    `DTEND;VALUE=DATE:${icsDate(nextDay(end))}`,
    `SUMMARY:${icsText(e.title)}`,
    `LOCATION:${icsText([e.locationName, e.city].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText(details)}`,
    `URL:${SITE_URL}${e.pagePath}`,
    e.category && `CATEGORIES:${icsText(e.category)}`,
    (!e.geoApprox && Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lng)))
      && `GEO:${Number(e.lat)};${Number(e.lng)}`,
    'TRANSP:TRANSPARENT',   // an event listing, not a commitment: never shown as "busy"
    'END:VEVENT',
  ].filter(Boolean);
  return lines;
}

function icsCalendar(name, description, events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fontainebleau Live//Agenda//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    `X-WR-CALDESC:${icsText(description)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    // A hint only: Google ignores it and refreshes on its own schedule (up to a day or more).
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...events.flatMap(icsEvent),
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** Feed files + the index the frontend reads to find them. */
function buildFeeds(events, existingFeeds) {
  const files = new Map();
  const feedEvents = events.filter(inFeed);
  const index = { all: `/${AGENDA_DIR}/fontainebleau-live.ics`, categories: {}, cities: {} };
  const desc = 'Sport, culture et nature autour de Fontainebleau. Mis à jour automatiquement : vérifiez auprès de l’organisateur avant de vous déplacer.';

  files.set(`${AGENDA_DIR}/fontainebleau-live.ics`, icsCalendar('Fontainebleau Live', desc, feedEvents));

  const groups = [
    ['categorie', 'categories', (e) => e.category, (v) => `${v} · Fontainebleau Live`],
    ['commune', 'cities', (e) => e.city, (v) => `${v} · Fontainebleau Live`],
  ];
  for (const [dir, key, pick, title] of groups) {
    const names = [...new Set(events.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    for (const name of names) {
      const slug = slugify(name, 50);
      if (!slug) continue;
      const rel = `${AGENDA_DIR}/${dir}/${slug}.ics`;
      files.set(rel, icsCalendar(title(name), desc, feedEvents.filter((e) => pick(e) === name)));
      index[key][name] = `/${rel}`;
    }
  }
  // Already published, nothing left: keep the subscription alive with an empty calendar.
  for (const rel of existingFeeds) {
    if (files.has(rel)) continue;
    const slug = path.basename(rel, '.ics');
    files.set(rel, icsCalendar(`${slug} · Fontainebleau Live`, desc, []));
  }
  files.set(`${AGENDA_DIR}/feeds.json`, JSON.stringify(index, null, 2) + '\n');
  return { files, stats: { feedEvents: feedEvents.length, longLeftOut: events.length - feedEvents.length } };
}

/** "S'abonner" links for one feed: Google (web), then webcal for Apple / Outlook. */
function subscribeLinks(feedPath) {
  const webcal = `webcal://fontainebleaulive.fr${feedPath}`;
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  return `<a class="btn alt" href="${esc(google)}" rel="noopener" target="_blank">Google Agenda</a>
<a class="btn alt" href="${esc(webcal)}">Apple / Outlook</a>`;
}

function build(payload, { today, existingEventDirs = [], existingFeeds = [] }) {
  const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.events) ? payload.events : null);
  if (!list) throw new Error('data.json: no event list');
  const generatedAt = !Array.isArray(payload) && payload.generatedAt;

  const events = list
    .filter((e) => e && idToken(e) && e.title && e.city && isIsoDate(e.startDate))
    .filter((e) => (isIsoDate(e.endDate) ? e.endDate : e.startDate) >= today)
    .map((e) => ({ ...e, pagePath: pagePath(e), citySlug: slugify(e.city, 50) }))
    .filter((e) => e.citySlug)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'fr') || a.id.localeCompare(b.id));

  const byCity = new Map();
  for (const e of events) {
    if (!byCity.has(e.citySlug)) byCity.set(e.citySlug, { name: e.city, slug: e.citySlug, events: [] });
    byCity.get(e.citySlug).events.push(e);
  }
  const cities = [...byCity.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const files = new Map();
  const liveDirs = new Set();
  const byToken = new Map();
  for (const e of events) {
    const dir = e.pagePath.split('/')[2];
    liveDirs.add(dir);
    byToken.set(idToken(e), e);
    files.set(`${EVENTS_DIR}/${dir}/index.html`, eventPage(e, byCity.get(e.citySlug).events));
  }
  for (const c of cities) files.set(`${CITIES_DIR}/${c.slug}/index.html`, cityPage(c));
  files.set(`${CITIES_DIR}/index.html`, citiesIndex(cities));
  files.set('sitemap.xml', sitemap(cities, events, generatedAt ? parisToday(new Date(generatedAt)) : null));
  const feeds = buildFeeds(events, existingFeeds);
  for (const [rel, content] of feeds.files) files.set(rel, content);

  // An old folder whose id token still belongs to a live event: its title changed. Redirect rather
  // than break a link Google already holds. Anything else is over or withdrawn: removed.
  const remove = [];
  for (const dir of existingEventDirs) {
    if (liveDirs.has(dir)) continue;
    const live = byToken.get(tokenOfDir(dir));
    if (live) files.set(`${EVENTS_DIR}/${dir}/index.html`, redirectPage(live));
    else remove.push(`${EVENTS_DIR}/${dir}`);
  }

  return { files, remove, stats: { events: events.length, cities: cities.length, ...feeds.stats } };
}

function listDirs(rel) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

function main() {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const existingFeeds = ['categorie', 'commune'].flatMap((d) => {
    const dir = path.join(ROOT, AGENDA_DIR, d);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.ics')).map((f) => `${AGENDA_DIR}/${d}/${f}`) : [];
  });
  const { files, remove, stats } = build(payload, { today: parisToday(), existingEventDirs: listDirs(EVENTS_DIR), existingFeeds });

  // Communes with nothing left are dropped too.
  const liveCityDirs = new Set([...files.keys()].filter((f) => f.startsWith(`${CITIES_DIR}/`)).map((f) => f.split('/')[1]));
  for (const d of listDirs(CITIES_DIR)) if (!liveCityDirs.has(d)) remove.push(`${CITIES_DIR}/${d}`);

  let written = 0;
  for (const [rel, content] of files) {
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    written++;
  }
  for (const rel of remove) fs.rmSync(path.join(ROOT, rel), { recursive: true, force: true });

  const line = `generate-pages: ${stats.events} événement(s), ${stats.cities} commune(s) · agendas : ${stats.feedEvents} événement(s), ${stats.longLeftOut} de plus de ${FEED_MAX_DAYS} jours écarté(s) · ${written} fichier(s) écrit(s), ${remove.length} dossier(s) supprimé(s)`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### 📄 Pages statiques\n\n${line}\n`); } catch { /* non-fatal */ }
  }
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error('❌ generate-pages:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

module.exports = {
  build, pagePath, slugify, idToken, tokenOfDir, offers, ageLabel, dateLabel, esc, safeUrl,
  icsText, icsFold, icsCalendar, inFeed, EVENTS_DIR, CITIES_DIR, AGENDA_DIR, FEED_MAX_DAYS,
};
