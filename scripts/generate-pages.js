#!/usr/bin/env node
/**
 * Static, indexable pages built from data.json (item 68, §3.X).
 *
 * The site itself is one page that loads data.json with JavaScript: a crawler sees almost none
 * of the events. This script writes plain HTML that needs no script at all:
 *   /evenements/<slug>-<hash>/   one page per event, with schema.org Event markup
 *   /que-faire/<commune>/        "Que faire à … ?", one page per commune
 *   /que-faire/                  the index of communes
 *   /ce-week-end/                the coming weekend, rebuilt every day
 *   /aujourdhui/                 today (and tomorrow, for the hours before the morning run)
 *   /sorties/<theme>/            seasonal pages (marchés de Noël, brame du cerf…), never removed
 *   /nos-sources/                how the agenda is collected and checked (item 79)
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
const { loadPlaces, placesOpen } = require('./affiliates');

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
.aff-note{display:block;margin-top:8px;font-size:12px}
footer a{color:var(--muted)}
@media (max-width:480px){dl{grid-template-columns:1fr}dt{margin-top:6px}}
`.trim();

// ─── English (04/10) ───
// The weekend, theme and holiday pages carry their English in data-en attributes: our own
// strings only (headings, filters, buttons, footer), never the event list. French is what the
// page serves and what search engines index; LANG_SCRIPT applies the English when the visitor
// chose it (the home page saves the choice, the FR/EN switch here too) or the address says
// ?lang=en. Unlike the home page, the browser's language is NOT used: Googlebot renders in
// English and would index these French pages in English. A data-en value is HTML built from our
// strings, with any data in it escaped; and data-en elements are never nested (the swap
// replaces innerHTML).
const en = (html) => ` data-en="${esc(html)}"`;
const enDate = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
const enDay = (iso) => enDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });   // "Saturday 10 October"
const enDM = (iso) => enDate(iso, { day: 'numeric', month: 'long' });                     // "10 October"
const enDMY = (iso) => enDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });   // "10 October 2026"
const enPl = (k, word) => `${k} ${word}${k > 1 ? 's' : ''}`;

const LANG_HEAD = '<script>try{if((new URLSearchParams(location.search).get(\'lang\')||localStorage.getItem(\'lang\'))===\'en\')document.documentElement.className=\'en\'}catch(e){}</script>';
const LANG_SWITCH = '<span class="lang" role="group" aria-label="Langue / Language"><button type="button" class="lang-btn" data-lang="fr" aria-pressed="true">FR</button><button type="button" class="lang-btn" data-lang="en" aria-pressed="false">EN</button></span>';
const LANG_STYLE = 'header{display:flex;align-items:center;justify-content:space-between;gap:12px}.lang{display:inline-flex;border:1px solid rgba(255,255,255,.5);border-radius:999px;overflow:hidden}.lang-btn{font:inherit;font-size:13px;font-weight:700;padding:3px 10px;border:0;background:transparent;color:#fff;cursor:pointer}.lang-btn[aria-pressed="true"]{background:#fff;color:var(--ink)}';
const LANG_SCRIPT = `(function () {
  // Swaps our own strings between French and English (see "English" in generate-pages.js).
  var root = document.documentElement;
  var titles = { fr: document.title, en: root.getAttribute('data-title-en') || document.title };
  var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };
  function apply(l) {
    each('[data-en]', function (el) {
      if (el.getAttribute('data-fr') === null) el.setAttribute('data-fr', el.innerHTML);
      el.innerHTML = el.getAttribute(l === 'en' ? 'data-en' : 'data-fr');
    });
    root.lang = l;
    root.className = l === 'en' ? 'en' : '';
    document.title = titles[l];
    each('.lang-btn', function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === l)); });
  }
  each('.lang-btn', function (b) {
    b.addEventListener('click', function () {
      var l = b.getAttribute('data-lang');
      try { localStorage.setItem('lang', l); } catch (e) { /* not fatal */ }
      apply(l);
    });
  });
  if (root.className === 'en') apply('en');
})();`;

// ─── Back to top (05/10) ───
// On the long pages (weekend, today, themes, holidays: `toTop`, on by default with titleEn), a fixed button at
// the bottom right. A plain link to #top, so it works without JavaScript; the script only hides
// it while the page is still at the top, where it would have nothing to do.
const TOP_STYLE = '.to-top{position:fixed;right:16px;bottom:16px;z-index:50;display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:var(--ink);color:#fff;font-size:1.3rem;font-weight:700;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.3)}.to-top.is-hidden{display:none}.to-top:focus-visible{outline:3px solid var(--accent-ink);outline-offset:2px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}';
const TOP_LINK = `<a href="#top" class="to-top"><span aria-hidden="true">↑</span><span class="sr-only"${en('Back to top')}>Haut de page</span></a>`;
const TOP_SCRIPT = `(function () {
  var b = document.querySelector('.to-top');
  if (!b) return;
  var f = function () { b.classList.toggle('is-hidden', window.scrollY < 400); };
  window.addEventListener('scroll', f, { passive: true });
  f();
})();`;

function layout({ title, description, canonical, body, ld, noindex, refresh, titleEn, toTop = Boolean(titleEn) }) {
  return `<!doctype html>
<html lang="fr"${titleEn ? ` data-title-en="${esc(titleEn)}"` : ''}>
<head>
${titleEn ? `${LANG_HEAD}\n` : ''}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}${refresh ? `<meta http-equiv="refresh" content="0; url=${esc(refresh)}">\n` : ''}<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
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
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>\n` : ''}<style>${STYLE}${titleEn ? `\n${LANG_STYLE}` : ''}${toTop ? `\n${TOP_STYLE}` : ''}</style>
</head>
<body>
<header${toTop ? ' id="top"' : ''}><a href="/"><img src="${ICON}" alt="" width="32" height="32">Fontainebleau Live</a>${titleEn ? LANG_SWITCH : ''}</header>
<main>
${body}
</main>
<footer><span${en('Agenda collected automatically. Check the details with the organiser before you go.')}>Agenda collecté automatiquement. Vérifiez les informations auprès de l’organisateur avant de vous déplacer.</span> · <a href="/${CITIES_DIR}/"${en('All towns (in French)')}>Toutes les communes</a> · <a href="/${SOURCES_DIR}/"${en('Our sources (in French)')}>Nos sources</a> · <a href="https://helioso.com" rel="noopener"${en('A Helioso project')}>Un projet Helioso</a>
<small class="aff-note"${en('Some links are partner links: we may earn a commission, at no extra cost to you.')}>Certains liens sont des liens partenaires : nous pouvons percevoir une commission, sans surcoût pour vous.</small></footer>
${toTop ? `${TOP_LINK}\n` : ''}${titleEn || toTop ? `<script>\n${titleEn ? `${LANG_SCRIPT}\n` : ''}${toTop ? `${TOP_SCRIPT}\n` : ''}</script>\n` : ''}</body>
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

/**
 * The <title> Google shows. Year and date up front (29/09): the searches that click are
 * "brame du cerf fontainebleau 2026", "marché de noël fontainebleau 2026"; "Melun Fête son Brie ·
 * Melun" drew 240 impressions for one click while people typed "fête du brie melun 2026".
 */
// Item 80: past this length Google cuts the title on a phone, so what is added after the date
// must fit or be left out. The date never is.
const TITLE_WORDS_MAX = 70;
const TITLE_BRAND_MAX = 60;

const firstOf = (s) => s.replace(/(^|\D)1 (?=\p{L})/gu, '$11er ');
// "au Châtelet-en-Brie", "aux Écrennes", "à La Chapelle-la-Reine".
const atCity = (city) => String(city).replace(/^(?:Le (?=\S)|Les (?=\S)|)/, (m) => ({ 'Le ': 'au ', 'Les ': 'aux ' }[m] || 'à '));
const titleHasCity = (e) => `-${slugify(e.title)}-`.includes(`-${slugify(e.city, 30)}-`);

/**
 * What the title may promise (item 80): only what the page shows. "Horaires" needs a schedule,
 * "tarif" a price, "accès" a named venue at an exact position (the map otherwise shows the town
 * centre). "Programme" is never promised: no description carries one, and a title that promises
 * an absent programme sends the visitor back to Google.
 */
function titleWords(e) {
  return [
    e.schedule && 'horaires',
    e.price && 'tarif',
    e.locationName && !e.geoApprox && 'accès',
  ].filter(Boolean);
}

function eventTitle(e) {
  const name = /\b20\d{2}\b/.test(e.title) ? e.title : `${e.title} ${e.startDate.slice(0, 4)}`;
  const end = isIsoDate(e.endDate) ? e.endDate : e.startDate;
  const when = end === e.startDate ? shortDate(e.startDate)
    : spanDays(e) > FEED_MAX_DAYS ? `jusqu’au ${shortDate(end).replace(/^\S+ /, '')}`
      : shareWhen(e);
  // "Marché de Noël d'Avon à Avon" says the town twice.
  let title = `${name}${titleHasCity(e) ? '' : ` ${atCity(e.city)}`} (${firstOf(when)})`;
  // As many words as fit, in order: "horaires, tarif" beats nothing.
  const words = titleWords(e);
  while (words.length && title.length + 3 + words.join(', ').length > TITLE_WORDS_MAX) words.pop();
  if (words.length) title += ` : ${words.join(', ')}`;
  const brand = ' | Fontainebleau Live';
  return title.length + brand.length <= TITLE_BRAND_MAX ? title + brand : title;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "Tous les jours sauf le mardi" inside a sentence; "LUN-VEN" stays as written.
const midSentence = (s) => (/^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "Du 19 septembre au 2 novembre 2026", "Du 13 au 17 octobre 2026": nothing said twice. */
function frSpan(start, end) {
  const strip = (iso) => frDate(iso).replace(/^\S+ /, '');
  const from = start.slice(0, 7) === end.slice(0, 7) ? strip(start).replace(/ \S+ \d{4}$/, '')
    : start.slice(0, 4) === end.slice(0, 4) ? strip(start).replace(/ \d{4}$/, '') : strip(start);
  return firstOf(`Du ${from} au ${strip(end)}`);
}

/**
 * The meta description answers before it describes (item 80): date, hours, place, price, then
 * the text of the event. Every part comes from the record; nothing is promised that is not on
 * the page.
 */
function eventDescription(e) {
  const end = isIsoDate(e.endDate) ? e.endDate : e.startDate;
  const date = end === e.startDate ? firstOf(capitalize(frDate(e.startDate))) : frSpan(e.startDate, end);
  const venue = slugify(e.locationName);
  const place = !venue || venue === slugify(e.city) ? atCity(e.city)
    : `-${venue}-`.includes(`-${slugify(e.city, 30)}-`) ? e.locationName : `${e.locationName} ${atCity(e.city)}`;
  const facts = [date, e.schedule && midSentence(String(e.schedule).trim()), place].filter(Boolean).join(', ');
  const price = String(e.price || '').trim().replace(/[.\s]+$/, '');
  const priceText = price && capitalize(price) + (price.endsWith('…') ? '' : '.');
  return truncate([`${facts}.`, priceText, e.description].filter(Boolean).join(' '), 155);
}

// "Halloween 2026 … ? : toutes les dates" reads badly once a heading is a question.
const allDates = (h1) => (h1.endsWith('?') ? `${h1} Toutes les dates` : `${h1} : toutes les dates`);

// ─── "À faire aussi" (item 82) ───
// Three suggestions under each event page, by a written rule: the best one (1) on the same
// dates within ~10 km, the best one (2) of the same category within 14 days and ~15 km, then
// the rest of (1) and (2), (3) the same town, and long exhibitions only for want of anything
// else. No draw and no `today`: the choice only changes when the data does, since a page is
// written only when it changes (§3.X) and a shuffle would rewrite ~290 pages a day.
const SUGGEST_MAX = 3;
const SUGGEST_NEAR_KM = 10;
const SUGGEST_AREA_KM = 15;
const SUGGEST_DAYS = 14;
const SUGGEST_CAT = {
  'Sport & Outdoor': 'Autre sortie sportive',
  'Nature & Environnement': 'Autre sortie nature',
  'Scène & Spectacles': 'Autre spectacle',
  'Culture & Ateliers': 'Autre sortie culturelle',
};

function distKm(a, b) {
  const [la1, lo1, la2, lo2] = [a.lat, a.lng, b.lat, b.lng].map(Number);
  if (![la1, lo1, la2, lo2].every(Number.isFinite)) return Infinity;
  const r = Math.PI / 180;
  const h = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function suggestionsFor(e, events) {
  const endOf = (x) => (isIsoDate(x.endDate) ? x.endDate : x.startDate);
  const key = (x) => slugify(x.title, 200);
  const cands = events.filter((o) => o.id !== e.id && key(o) !== key(e))
    .map((o) => ({ o, km: distKm(e, o), short: spanDays(o) <= FEED_MAX_DAYS }));
  const near = (a, b) => a.km - b.km || a.o.startDate.localeCompare(b.o.startDate) || a.o.id.localeCompare(b.o.id);
  const soon = (a, b) => a.o.startDate.localeCompare(b.o.startDate) || near(a, b);
  const overlaps = (o, from, to) => o.startDate <= to && endOf(o) >= from;
  // A town-centre position (geoApprox) is good enough to choose, not to print a distance.
  const away = ({ o, km }) => (e.geoApprox || o.geoApprox || !Number.isFinite(km) ? '' : km < 1 ? 'à moins d’1 km' : `à ${Math.round(km)} km`);
  const oneDay = e.startDate === endOf(e);

  const sameDates = cands.filter((c) => c.short && c.km <= SUGGEST_NEAR_KM && overlaps(c.o, e.startDate, endOf(e))).sort(near)
    .map((c) => ({ ...c, why: [oneDay ? 'Le même jour' : 'Aux mêmes dates', away(c)] }));
  const sameCat = cands.filter((c) => c.short && e.category && c.o.category === e.category && c.km <= SUGGEST_AREA_KM
    && overlaps(c.o, e.startDate, addDays(e.startDate, SUGGEST_DAYS))).sort(near)
    .map((c) => ({ ...c, why: [SUGGEST_CAT[e.category] || 'Dans le même genre', away(c)] }));
  const sameCity = cands.filter((c) => c.short && c.o.citySlug === e.citySlug).sort(soon).map((c) => ({ ...c, why: [] }));
  const long = cands.filter((c) => !c.short).sort(near).map((c) => ({ ...c, why: ['Exposition ou visite', away(c)] }));

  // One of each kind first, so three suggestions are not three of the same; never the same title twice.
  const picked = [];
  const take = (c) => {
    if (c && picked.length < SUGGEST_MAX && !picked.some((x) => key(x.o) === key(c.o))) picked.push(c);
  };
  take(sameDates[0]);
  take(sameCat[0]);
  for (const c of [...sameDates, ...sameCat, ...sameCity, ...long]) take(c);
  return picked.map(({ o, why }) => ({ o, why: why.filter(Boolean).join(', ') }));
}

const suggestionItem = ({ o, why }) =>
  `<li><a href="${esc(o.pagePath)}">${esc(o.title)}</a><small>${why ? `<b>${esc(why)}</b> · ` : ''}${esc(dateLabel(o))} · ${esc(place(o))}</small></li>`;

// ─── Provenance (item 79) ───
// Show what the pipeline checks instead of a blanket "vérifiez". The rule: "Confirmé" only when
// a legitimate source carries the record, never on Gemini alone; and when Gemini alone carries
// it with nothing more than a home page for a link (79b), the dates themselves are flagged, at
// the top, next to them. Same rule as datesAtRisk() in fetch-events.js, which reports them.
const SOURCE_LABEL = {
  site: 'le site d’un organisateur, de l’office de tourisme ou d’une mairie',
  datatourisme: 'DATAtourisme, la base des offices de tourisme',
  openagenda: 'OpenAgenda, l’agenda des organisateurs',
};
const isHomeUrl = (u) => { try { return ['', '/'].includes(new URL(u).pathname.replace(/\/(fr|en)\/?$/, '/')); } catch { return false; } };
const datesUnconfirmed = (e) => !SOURCE_LABEL[e.source] && (!e.url || isHomeUrl(e.url));
const dayMonthYear = (iso) => first(frDate(iso).replace(/^\S+ /, ''));

function provenanceHtml(e, link) {
  const host = link ? new URL(link).hostname.replace(/^www\./, '') : '';
  const lines = [];
  if (SOURCE_LABEL[e.source]) {
    lines.push(`<span class="ok">✓ Confirmé par ${esc(SOURCE_LABEL[e.source])}</span>`);
    if (host && e.urlStatus === 'ok' && isIsoDate(e.urlCheckedAt)) lines.push(`Lien vers ${esc(host)} vérifié le ${esc(dayMonthYear(e.urlCheckedAt))}.`);
  } else {
    lines.push(`Source : recherche web${host ? ` (${esc(host)})` : ''}, à confirmer auprès de l’organisateur.`);
  }
  if (isIsoDate(e.lastSeen)) lines.push(`Dernier relevé le ${esc(dayMonthYear(e.lastSeen))}.`);
  lines.push(`<a href="/${SOURCES_DIR}/">Comment nous collectons et vérifions</a>`);
  return `<p class="prov">${lines.join('<br>')}</p>`;
}

const PROV_STYLE = '.prov{font-size:14px;color:var(--muted);border-left:3px solid var(--line);padding:2px 0 2px 12px}.prov .ok{color:#3d5d1d;font-weight:700}.prov a{color:var(--ink)}.unsure{background:#fff4e0;border:1px solid #e8c48a;border-radius:8px;padding:8px 12px;color:#6b4a12;font-size:15px}.aff{font-size:14px;color:var(--muted);margin-top:-14px}';

/** Partner offer (affiliates.json, derived by the pipeline), or null. Never replaces the organiser's link. */
function bookingOf(e) {
  const b = e.booking;
  const url = b && safeUrl(b.url);
  return url && b.label ? { url, label: String(b.label), provider: typeof b.provider === 'string' ? b.provider : '', samePrice: b.samePrice === true } : null;
}

function eventPage(e, events, today) {
  const canonical = SITE_URL + e.pagePath;
  const link = safeUrl(e.url);
  const booking = bookingOf(e);
  const rows = [
    ['Horaires', e.schedule],
    ['Lieu', [e.locationName, e.city].filter(Boolean).join(', ')],
    ['Tarif', e.price],
    ['Public', ageLabel(e)],
    ['Organisateur', e.organizer],
    ['Catégorie', e.category],
  ].filter(([, v]) => v);
  const others = suggestionsFor(e, events);

  const body = `<nav class="crumbs"><a href="/">Accueil</a> › <a href="/${CITIES_DIR}/${e.citySlug}/">${esc(e.city)}</a></nav>
<h1>${esc(e.title)}</h1>
<p class="when">${esc(dateLabel(e))}</p>
${datesUnconfirmed(e) ? `<p class="unsure">Dates à confirmer : seule une recherche web les annonce, et ${link ? 'le lien ne mène qu’à l’accueil du site' : 'sans lien vers l’événement'}. Vérifiez auprès de l’organisateur avant de vous déplacer.</p>\n` : ''}<div class="sheet"><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
${e.description ? `<p>${esc(e.description)}</p>` : ''}
${themesOf(e).map((t) => `<p><a href="/${THEMES_DIR}/${t.slug}/">${esc(allDates(t.h1(e.startDate.slice(0, 4))))}</a></p>`).join('')}${holidaysOf(e, today).map(({ h, p }) => `<p><a href="/${THEMES_DIR}/${h.slug}/">${esc(h.name)} ${esc(p.from.slice(0, 4))} : toutes les sorties</a></p>`).join('')}
<div class="actions">
${link ? `<a class="btn" href="${esc(link)}" rel="nofollow noopener" target="_blank">Site de l’organisateur</a>\n` : ''}${booking ? `<a class="btn alt" href="${esc(booking.url)}" rel="sponsored noopener" target="_blank">🎟️ ${esc(booking.label)}</a>\n` : ''}<a class="btn alt" href="/?event=${encodeURIComponent(e.id)}" rel="nofollow">Voir sur la carte</a>
</div>
${booking ? `<p class="aff">Lien partenaire${booking.provider ? ` ${esc(booking.provider)}` : ''}${booking.samePrice ? ', au même prix que sur place' : ''} : Fontainebleau Live perçoit une commission si vous réservez par ce lien. <a href="/${SOURCES_DIR}/#financement">En savoir plus</a></p>\n` : ''}${provenanceHtml(e, link)}
${others.length ? `<h2>À faire aussi</h2>\n<ul class="list">${others.map(suggestionItem).join('')}</ul>\n` : ''}<p><a href="/${CITIES_DIR}/${e.citySlug}/">Tout ce qui se passe à ${esc(e.city)}</a></p>`;

  return layout({
    title: eventTitle(e),
    description: eventDescription(e),
    canonical,
    body,
    // No rich result for dates nothing confirms (79b): Google would show them in its own box.
    ld: e.urlStatus === 'ok' && !datesUnconfirmed(e) ? eventLd(e, canonical) : null,
  }).replace('</style>', `${PROV_STYLE}\n</style>`);
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

function cityPage(c, places = []) {
  const n = c.events.length;
  const body = `<nav class="crumbs"><a href="/">Accueil</a> › <a href="/${CITIES_DIR}/">Communes</a></nav>
<h1>Que faire à ${esc(c.name)} ?</h1>
<p>${n} activité${n > 1 ? 's' : ''} à venir à ${esc(c.name)} : sport, nature, culture et sorties en famille.</p>
<ul class="list">${c.events.map(eventItem).join('')}</ul>
<div class="actions"><a class="btn alt" href="/?ville=${encodeURIComponent(c.name)}" rel="nofollow">Voir sur la carte</a></div>${visitHtml(places, `À visiter à ${c.name}`)}
<h2>Recevoir le programme de ${esc(c.name)} dans votre agenda</h2>
<p class="note">Un abonnement : les activités s’ajoutent à votre agenda et se mettent à jour toutes seules. Les expositions de plus d’une semaine n’y figurent pas, elles restent ici.</p>
<div class="actions">${subscribeLinks(`/${AGENDA_DIR}/commune/${c.slug}.ics`)}</div>
<div class="partner-box"><p class="partner-title">Vous avez un site web ?</p>
<p>Mairie, office de tourisme, club, hôtel : affichez gratuitement les prochaines sorties de ${esc(c.name)} sur votre site.</p>
<a href="/widget/integrer/?ville=${encodeURIComponent(c.name)}" rel="nofollow">Intégrer l’agenda de ${esc(c.name)} →</a></div>`;
  return layout({
    title: `Que faire à ${c.name} ? Agenda des activités | Fontainebleau Live`,
    description: truncate(`${n} activité${n > 1 ? 's' : ''} à venir à ${c.name}, autour de Fontainebleau : sport, nature, culture, sorties en famille.`, 155),
    canonical: `${SITE_URL}/${CITIES_DIR}/${c.slug}/`,
    body,
  }).replace('</style>', `${PARTNER_STYLE}\n${places.length ? `${VISIT_STYLE}\n` : ''}</style>`);
}

// Same box as the home page footer (04/10): the widget is an offer to other websites, so it is
// set apart from the visitor's content instead of a grey line under it.
const PARTNER_STYLE = '.partner-box{margin:32px 0 8px;padding:14px 16px;background:var(--paper);border:1px solid var(--line);border-radius:10px}.partner-box p{margin:0 0 6px}.partner-title{font-weight:700;color:var(--ink)}.partner-box a{color:var(--ink);font-weight:700}';

// ─── « Visiter » (item 83c) ───
// A monument's entrance ticket at a partner, independent of any event (affiliates.json, "places").
// Shown on the commune page, the weekend page and the holiday pages, for the days the page
// covers: a place closed on all of them is left out, an exceptional closure among them is said.
const VISIT_STYLE = '.visit li{padding:14px 0}.visit .btn{margin-top:8px;padding:8px 14px;font-size:15px}.visit .closed{color:#8a4b00}.visit-aff{font-size:14px;color:var(--muted)}';

function visitHtml(list, heading = 'À visiter', headingEn = 'Places to visit') {
  if (!list.length) return '';
  const many = list.length > 1;
  const providers = [...new Set(list.map((p) => p.provider).filter(Boolean))].join(', ');
  const item = (p) => {
    const price = p.samePrice && p.price ? ` · ${p.price}, même prix que sur place` : '';
    const priceEn = p.samePrice && p.price ? ` · ${p.price}, same price as at the door` : '';
    const at = p.provider ? ` chez ${p.provider}` : '';
    const atEn = p.provider ? ` on ${p.provider}` : '';
    return `<li><b>${esc(p.name)}</b> · ${esc(p.city)}${p.blurb ? `<small${p.blurbEn ? en(esc(p.blurbEn)) : ''}>${esc(p.blurb)}</small>` : ''}`
      + `${p.closedIn.length && p.closedNote ? `<small class="closed"${p.closedNoteEn ? en(esc(p.closedNoteEn)) : ''}>${esc(p.closedNote)}</small>` : ''}`
      + `<a class="btn alt" href="${esc(p.url)}" rel="sponsored noopener" target="_blank"${en(`🎟️ ${esc(p.labelEn || p.label)}${esc(atEn)}${esc(priceEn)}`)}>🎟️ ${esc(p.label)}${esc(at)}${esc(price)}</a></li>`;
  };
  const disclosureEn = `Partner link${many ? 's' : ''}${providers ? ` (${esc(providers)})` : ''}: Fontainebleau Live earns a commission if you book through ${many ? 'them' : 'it'}, at no extra cost to you. <a href="/${SOURCES_DIR}/#financement">Learn more</a>`;
  return `
<h2 id="visiter"${en(esc(headingEn))}>${esc(heading)}</h2>
<ul class="list visit">${list.map(item).join('')}</ul>
<p class="visit-aff"${en(disclosureEn)}>Lien${many ? 's' : ''} partenaire${many ? 's' : ''}${providers ? ` ${esc(providers)}` : ''} : Fontainebleau Live perçoit une commission si vous réservez par ce${many ? 's' : ''} lien${many ? 's' : ''}, sans surcoût pour vous. <a href="/${SOURCES_DIR}/#financement">En savoir plus</a></p>`;
}

// ───────────────────────────── Posts to share (item 70) ─────────────────────────────
//
// Ready-to-paste texts for the towns' Facebook groups. Publishing stays by hand: Meta removed
// the Groups API in 2024, and a bot posting in a group it does not administer breaks Facebook's
// terms — the account is the channel. What is automated is the draft, rebuilt every day, so the
// month's post takes a minute. The page is noindex, absent from the sitemap and never linked.

const SHARE_DIR = 'publier';
const SHARE_DAYS = 30;
const SHARE_MAX = 6;
const SHARE_MIN = 3;   // below this, a post is not worth a group's attention

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const shareWhen = (e) => (!e.endDate || e.endDate === e.startDate)
  ? shortDate(e.startDate)
  : `du ${shortDate(e.startDate).replace(/^\S+ /, '')} au ${shortDate(e.endDate).replace(/^\S+ /, '')}`;

/**
 * The events worth a line: starting within SHARE_DAYS, soonest first, standing offers and long
 * exhibitions left out (they are on the site all season; a post is for what is coming up).
 */
function shareable(events, today) {
  const until = new Date(Date.parse(today) + SHARE_DAYS * 86400000).toISOString().slice(0, 10);
  return events
    .filter((e) => e.startDate >= today && e.startDate <= until)
    .filter((e) => Math.round((Date.parse(e.endDate || e.startDate) - Date.parse(e.startDate)) / 86400000) <= 7)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'fr'));
}

function postText(headline, picks, link) {
  const lines = picks.map((e) => `• ${shareWhen(e)} — ${e.title}${e.locationName && e.locationName !== e.city ? ` (${e.locationName})` : ''}`);
  return `${headline}\n\n${lines.join('\n')}\n\nTout le programme, horaires et liens, mis à jour chaque jour :\n${link}`;
}

function sharePage(cities, events, today) {
  const posts = [];
  const all = shareable(events, today);
  // One per town at most, so the general post shows the area, not just Fontainebleau.
  const spread = [];
  for (const e of all) if (!spread.some((s) => s.citySlug === e.citySlug)) spread.push(e);
  for (const e of all) if (spread.length < SHARE_MAX + 2 && !spread.includes(e)) spread.push(e);
  if (spread.length >= SHARE_MIN) {
    posts.push({ name: 'Autour de Fontainebleau', count: all.length, text: postText('🌳 Que faire autour de Fontainebleau ces prochaines semaines ?', spread.slice(0, SHARE_MAX + 2).sort((a, b) => a.startDate.localeCompare(b.startDate)), `${SITE_URL}/`) });
  }
  for (const c of cities) {
    const mine = shareable(c.events, today);
    if (mine.length < SHARE_MIN) continue;
    posts.push({ name: c.name, count: mine.length, text: postText(`📅 Que faire à ${c.name} ces prochaines semaines ?`, mine.slice(0, SHARE_MAX), `${SITE_URL}/${CITIES_DIR}/${c.slug}/`) });
  }

  const body = `<h1>Textes à partager</h1>
<p class="note">Page privée : non indexée, absente du plan du site, jamais liée. Régénérée chaque jour à partir du programme. Un post par groupe et par mois suffit ; lisez d'abord les règles du groupe — beaucoup interdisent l'auto-promotion, et demander à l'administrateur avant le premier post évite un bannissement.</p>
${posts.length ? posts.map((p, i) => `<h2>${esc(p.name)} <small class="note">· ${p.count} activité${p.count > 1 ? 's' : ''} dans les ${SHARE_DAYS} jours</small></h2>
<textarea id="t${i}" rows="${p.text.split('\n').length + 1}" readonly>${esc(p.text)}</textarea>
<button type="button" class="btn" data-copy="t${i}">Copier</button>`).join('\n') : '<p>Rien d\'assez fourni à partager pour l\'instant.</p>'}
<script>
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var t = document.getElementById(b.getAttribute('data-copy'));
    var done = function () { b.textContent = 'Copié ✓'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(done, function () { t.select(); });
    else t.select();
  });
});
</script>`;
  return layout({
    title: 'Textes à partager | Fontainebleau Live',
    description: 'Textes prêts à publier dans les groupes locaux.',
    canonical: `${SITE_URL}/${SHARE_DIR}/`,
    noindex: true,
    body,
  }).replace('</style>', 'textarea{width:100%;font:15px/1.5 inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:#fff;resize:vertical}\nh2 small{font-weight:400}\nbutton.btn{border:0;cursor:pointer;margin:8px 0 8px;font:inherit;font-weight:600}\n</style>');
}

// ───────────────────────────── Seasonal pages (item 74) ─────────────────────────────
//
// One page per recurring kind of outing people search for by name ("marché de noël fontainebleau
// 2026", "brame du cerf fontainebleau"). Two things an event page cannot do:
//   - gather the five "brame du cerf" pages into one strong answer instead of five weak ones;
//   - KEEP ITS ADDRESS from one year to the next. An event page is deleted when the event is over,
//     and what Google learnt about it goes with it; /sorties/marches-de-noel/ is still there in
//     December 2027. So a theme page is never removed: out of season it says when to come back.
// Matching is on the title only, accent-stripped: a description that mentions Christmas does not
// make a concert a Christmas market. The intro texts are ours and hold no event data.

const THEMES_DIR = 'sorties';
const THEMES = [
  {
    slug: 'marches-de-noel',
    match: /\b(marches? de noel|village (et |& )?marche de noel|village de noel|noel (au |du )?marche)\b/,
    name: 'Marchés de Noël',
    title: (y) => `Marchés de Noël ${y} autour de Fontainebleau : dates et lieux`,
    h1: (y) => `Marchés de Noël ${y} autour de Fontainebleau`,
    intro: 'Les marchés de Noël de Fontainebleau, d’Avon et des villages alentour : dates, horaires et lieux, mis à jour chaque jour à partir des annonces des communes, de l’office de tourisme et des organisateurs.',
    off: 'Les marchés de Noël sont annoncés en général à partir d’octobre : les dates apparaîtront ici dès leur publication.',
    nameEn: 'Christmas markets',
    titleEn: (y) => `Christmas markets ${y} around Fontainebleau: dates and places`,
    h1En: (y) => `Christmas markets ${y} around Fontainebleau`,
    introEn: 'The Christmas markets of Fontainebleau, Avon and the surrounding villages: dates, times and places, updated every day from the announcements of the towns, the tourist office and the organisers.',
    offEn: 'Christmas markets are usually announced from October: the dates will appear here as soon as they are published.',
  },
  {
    slug: 'noel',
    match: /\bnoel\b/,
    name: 'Noël',
    title: (y) => `Noël ${y} autour de Fontainebleau : marchés, spectacles et animations`,
    h1: (y) => `Noël ${y} autour de Fontainebleau`,
    intro: 'Marchés, spectacles, concerts, animations des châteaux et sorties en famille pour les fêtes, à Fontainebleau et dans les communes voisines.',
    off: 'Le programme des fêtes est annoncé à l’automne : il apparaîtra ici dès sa publication.',
    nameEn: 'Christmas',
    titleEn: (y) => `Christmas ${y} around Fontainebleau: markets, shows and events`,
    h1En: (y) => `Christmas ${y} around Fontainebleau`,
    introEn: 'Markets, shows, concerts, events at the châteaux and family outings for the festive season, in Fontainebleau and the neighbouring towns.',
    offEn: 'The festive programme is announced in the autumn: it will appear here as soon as it is published.',
  },
  {
    slug: 'brame-du-cerf',
    match: /\bbrame\b/,
    name: 'Brame du cerf',
    title: (y) => `Brame du cerf ${y} en forêt de Fontainebleau : sorties guidées`,
    h1: (y) => `Brame du cerf ${y} en forêt de Fontainebleau`,
    intro: 'Le brame du cerf s’écoute en forêt de Fontainebleau de la mi-septembre à la mi-octobre, surtout au crépuscule. Les sorties guidées ci-dessous permettent de l’écouter sans déranger les animaux : restez sur les chemins, en silence, sans lampe puissante.',
    off: 'La saison du brame va de la mi-septembre à la mi-octobre : les sorties guidées de l’année prochaine apparaîtront ici dès leur annonce.',
    nameEn: 'Deer rut',
    titleEn: (y) => `Deer rut ${y} in the Forest of Fontainebleau: guided outings`,
    h1En: (y) => `The deer rut ${y} in the Forest of Fontainebleau`,
    introEn: 'The stags’ bellowing can be heard in the Forest of Fontainebleau from mid-September to mid-October, mostly at dusk. The guided outings below let you listen without disturbing the animals: stay on the paths, keep quiet, and leave powerful torches at home.',
    offEn: 'The rut runs from mid-September to mid-October: next year’s guided outings will appear here as soon as they are announced.',
  },
  {
    slug: 'champignons',
    match: /\b(champignons?|mycolog\w*)\b/,
    name: 'Champignons',
    title: (y) => `Sorties champignons ${y} en forêt de Fontainebleau`,
    h1: (y) => `Sorties champignons et mycologie ${y} autour de Fontainebleau`,
    intro: 'Sorties d’initiation, stages et expositions mycologiques en forêt de Fontainebleau et alentour. Ne consommez jamais un champignon sans l’avoir fait identifier par un pharmacien ou une société mycologique.',
    off: 'La saison des champignons est surtout l’automne : les sorties apparaîtront ici dès leur annonce.',
    nameEn: 'Mushrooms',
    titleEn: (y) => `Mushroom outings ${y} in the Forest of Fontainebleau`,
    h1En: (y) => `Mushroom and mycology outings ${y} around Fontainebleau`,
    introEn: 'Introductory walks, workshops and mycology exhibitions in the Forest of Fontainebleau and nearby. Never eat a mushroom without having it identified by a pharmacist or a mycological society.',
    offEn: 'Mushroom season is mostly the autumn: outings will appear here as soon as they are announced.',
  },
  {
    slug: 'halloween',
    match: /\bhalloween\b/,
    name: 'Halloween',
    // Worded as the search is typed (item 81): "que faire à fontainebleau pour halloween".
    title: (y) => `Que faire à Fontainebleau pour Halloween ${y} ? Sorties et animations`,
    h1: (y) => `Que faire pour Halloween ${y} autour de Fontainebleau ?`,
    intro: 'Jeux de piste, soirées en médiathèque, murder parties dans les châteaux et animations pour enfants : toutes les sorties d’Halloween à Fontainebleau et dans les communes voisines, mises à jour chaque jour.',
    off: 'Les animations d’Halloween sont annoncées en début d’automne : elles apparaîtront ici dès leur publication.',
    nameEn: 'Halloween',
    titleEn: (y) => `What to do in Fontainebleau for Halloween ${y}? Outings and events`,
    h1En: (y) => `What to do for Halloween ${y} around Fontainebleau?`,
    introEn: 'Treasure hunts, evenings at the libraries, murder mystery parties in the châteaux and activities for children: every Halloween outing in Fontainebleau and the neighbouring towns, updated every day.',
    offEn: 'Halloween events are announced in early autumn: they will appear here as soon as they are published.',
    faqEn: [
      ['Where to celebrate Halloween with children around Fontainebleau?', 'Treasure hunts, workshops and activities at the libraries and châteaux suit children best. Check the recommended age on each outing’s page: some evenings, such as murder mystery parties, are for adults.'],
      ['When do the Halloween events take place?', 'Mostly in the last week of October and on the evening of the 31st. Some evenings start as early as mid-October. Halloween falls during the Toussaint school holidays: more ideas are on the holidays page.'],
    ],
    related: 'vacances-toussaint',
    faq: [
      ['Où fêter Halloween avec des enfants autour de Fontainebleau ?', 'Les jeux de piste, ateliers et animations des médiathèques et des châteaux sont les sorties les plus adaptées aux enfants. Vérifiez l’âge conseillé sur la page de chaque sortie : certaines soirées, comme les murder parties, s’adressent aux adultes.'],
      ['Quand ont lieu les animations d’Halloween ?', 'Surtout la dernière semaine d’octobre et le soir du 31. Certaines soirées commencent dès la mi-octobre. Halloween tombe pendant les vacances de la Toussaint : d’autres idées de sorties sont sur la page des vacances.'],
    ],
  },
];

// ─── School holidays (item 81) ───
// Hubs chosen by DATE, not by title: "que faire pendant les vacances de la Toussaint" asks for
// everything on during the holidays. Same rule as the themes: the address is kept from one year
// to the next and the page is never deleted. Add the next year's dates to `periods` when the
// Education ministry publishes them; once the last period is over, the page says so.
// Family ideas are picked on the TITLE only, like the themes: ageMin/ageMax cannot do it (every
// event in the window is "0-99" on 04/10), and a description mentioning children proves nothing.
const FAMILY = /\b(enfants?|familles?|familial\w*|jeune public|contee?s?|jeu de piste|chasse au tresor|marionnettes?|magie|magicien\w*|illusionniste|halloween)\b/;
const FAMILY_MAX = 8;

const HOLIDAYS = [
  {
    slug: 'vacances-toussaint',
    name: 'Vacances de la Toussaint',
    // Same dates for every zone at Toussaint.
    periods: [{ from: '2026-10-17', to: '2026-11-02' }],
    title: (y) => `Que faire pendant les vacances de la Toussaint ${y} autour de Fontainebleau ?`,
    intro: 'Balades guidées en forêt, sorties champignons, spectacles, ateliers, visites des châteaux et animations d’Halloween : toutes les sorties des vacances à Fontainebleau et dans les communes voisines, jour par jour.',
    off: (y) => `Les vacances de la Toussaint ${y} sont terminées. Le programme des prochaines vacances de la Toussaint apparaîtra ici dès la fin de l’été.`,
    nameEn: 'Toussaint school holidays',
    titleEn: (y) => `What to do during the Toussaint school holidays ${y} around Fontainebleau?`,
    introEn: 'Guided forest walks, mushroom outings, shows, workshops, château visits and Halloween events: every outing of the holidays in Fontainebleau and the neighbouring towns, day by day.',
    offEn: (y) => `The Toussaint school holidays ${y} are over. The programme for next year’s Toussaint holidays will appear here from the end of the summer.`,
    faqEn: [
      ['What to do with children during the Toussaint holidays?', 'Storytelling walks, treasure hunts, shows and the Halloween events at the end of October. In the Forest of Fontainebleau, autumn is the season for guided mushroom outings, and the white and yellow bouldering circuits are made for children.'],
      ['What to do if it rains?', 'The Château de Fontainebleau (closed on Tuesdays), the museums and exhibitions listed below, shows and concerts.'],
      ['Is the programme up to date?', 'The page is rebuilt every day from the announcements of the towns, the tourist office, OpenAgenda and the organisers’ websites. For times and bookings, the organiser’s link is on each outing’s page.'],
    ],
    faq: [
      ['Que faire avec des enfants pendant les vacances de la Toussaint ?', 'Les promenades contées, jeux de piste, spectacles et animations d’Halloween de la fin octobre. En forêt de Fontainebleau, l’automne est la saison des sorties champignons guidées, et les circuits d’escalade de bloc blancs et jaunes sont faits pour les enfants.'],
      ['Que faire s’il pleut ?', 'Le château de Fontainebleau (fermé le mardi), les musées et les expositions listés plus bas, les spectacles et les concerts.'],
      ['Le programme est-il à jour ?', 'La page est reconstruite chaque jour à partir des annonces des communes, de l’office de tourisme, d’OpenAgenda et des sites des organisateurs. Pour les horaires et les réservations, le lien de l’organisateur est sur la page de chaque sortie.'],
    ],
  },
];

/** The period on show: the first one not over yet, else the last one (and `over` is true). */
function holidayPeriod(h, today) {
  const next = h.periods.find((p) => p.to >= today);
  return next ? { ...next, over: false } : { ...h.periods[h.periods.length - 1], over: true };
}

const themeKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const themesOf = (e) => THEMES.filter((t) => t.match.test(themeKey(e.title)));

// Our own questions and answers, no event data in them: durable text, so a hub with two events
// in it is not a thin page.
const faqHtml = (faq, faqEn = []) => (faq && faq.length
  ? `<h2${en('Frequently asked questions')}>Questions fréquentes</h2>\n${faq.map(([q, a], i) => {
    const [qEn, aEn] = faqEn[i] || [];
    return `<h3${qEn ? en(esc(qEn)) : ''}>${esc(q)}</h3>\n<p${aEn ? en(esc(aEn)) : ''}>${esc(a)}</p>`;
  }).join('\n')}\n`
  : '');

function themePage(t, events, today) {
  // The year of the season on show: the first event's, or this year when there is none yet.
  const year = (events[0] ? events[0].startDate : today).slice(0, 4);
  const n = events.length;
  const related = t.related && HOLIDAYS.find((h) => h.slug === t.related);
  const relYear = related ? holidayPeriod(related, today).from.slice(0, 4) : '';
  const body = `<nav class="crumbs"><a href="/"${en('Home')}>Accueil</a> › <a href="/${THEMES_DIR}/"${en('Seasonal outings')}>Sorties de saison</a></nav>
<h1${en(esc(t.h1En(year)))}>${esc(t.h1(year))}</h1>
<p${en(esc(t.introEn))}>${esc(t.intro)}</p>
${n ? `<p class="note"${en(`${enPl(n, 'upcoming date')}, soonest first.`)}>${n} date${n > 1 ? 's' : ''} à venir, de la plus proche à la plus lointaine.</p>
<ul class="list">${events.map(eventItem).join('')}</ul>` : `<p${en(esc(t.offEn))}>${esc(t.off)}</p>`}
${related ? `<p><a href="/${THEMES_DIR}/${related.slug}/"${en(`${esc(related.nameEn)} ${relYear}: all outings`)}>${esc(related.name)} ${relYear} : toutes les sorties</a></p>\n` : ''}${faqHtml(t.faq, t.faqEn)}
<div class="actions"><a class="btn alt" href="/"${en('Full agenda on the map')}>Tout l’agenda sur la carte</a> <a class="btn alt" href="/${WEEKEND_DIR}/"${en('This weekend')}>Ce week-end</a></div>`;
  return layout({
    title: `${t.title(year)} | Fontainebleau Live`,
    description: truncate(n ? `${n} date${n > 1 ? 's' : ''} à venir. ${t.intro}` : t.intro, 155),
    canonical: `${SITE_URL}/${THEMES_DIR}/${t.slug}/`,
    body,
    titleEn: `${t.titleEn(year)} | Fontainebleau Live`,
  }).replace('</style>', t.faq ? `${FAQ_STYLE}
</style>` : '</style>');
}

// ───────────────────────────── This weekend (item 74.3) ─────────────────────────────
//
// "Que faire à Fontainebleau ce week-end" comes back every week, and it is the link a Facebook
// post wants. Rebuilt with the other pages every day: Monday to Saturday it shows the coming
// Saturday and Sunday, on Sunday what is left of the day. Long exhibitions (over FEED_MAX_DAYS)
// are open that weekend too, but listed apart: fifteen of them would bury the outings.

const WEEKEND_DIR = 'ce-week-end';

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** { sat, sun } of the weekend on show for `today` (Paris date, YYYY-MM-DD). */
function weekendOf(today) {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (dow === 0) return { sat: addDays(today, -1), sun: today };
  const sat = addDays(today, 6 - dow);
  return { sat, sun: addDays(sat, 1) };
}

const first = (s) => s.replace(/(^|\D)1 (?=\p{L})/gu, '$11er ');
const dayName = (iso) => first(frDate(iso).replace(/ \d{4}$/, ''));
// "La Solle, Fontainebleau" needs no second "Fontainebleau".
const place = (e) => (e.locationName && slugify(e.locationName, 200).includes(slugify(e.city, 50)) ? e.locationName : [e.locationName, e.city].filter(Boolean).join(', '));

// Category colours: the same four as the map markers and cards of the main page.
const CAT_CLASS = { 'Sport & Outdoor': 'c-sport', 'Nature & Environnement': 'c-nature', 'Scène & Spectacles': 'c-scene', 'Culture & Ateliers': 'c-culture' };

// "08h00–18h00", "Dimanche à 16h00", "10h15 à 11h30" → "8h–18h", "16h", "10h15–11h30".
// A colon only separates hours and minutes when it touches both ("19:00"), and a number next to a
// slash is a date: « 10/10 : 19h00 ; 11/10 : 17h00 » was shown as "10h19–10h17" (05/10).
const TIME_RE = /(?<![\d/])([01]?\d|2[0-3])(?:\s*h\s*([0-5]\d)?|:([0-5]\d))(?![\d/])/gi;
function allTimes(schedule) {
  return [...String(schedule || '').matchAll(TIME_RE)].map((m) => ({ h: Number(m[1]), m: Number(m[2] || m[3] || 0) }));
}
const hm = (t) => `${t.h}h${t.m ? String(t.m).padStart(2, '0') : ''}`;
const range = (s) => allTimes(s).slice(0, 2).map(hm).join('–');
function timeOf(schedule) {
  // Hours given day by day are separated by « ; » (« sam. 10 : 10h–18h ; dim. 11 : 13h–18h »,
  // the format the pipeline asks for). Each day keeps its own range, and different days are
  // alternatives — "19h / 17h", never the range "19h–17h". Same hours every day: said once.
  const days = [...new Set(String(schedule || '').split(';').map(range).filter(Boolean))];
  // A schedule cut at 120 characters can end on half a range ("10h" after "10h–12h" days).
  return days.filter((r) => !days.some((o) => o !== r && o.startsWith(`${r}–`))).slice(0, 2).join(' / ');
}
/** Minutes after midnight of the first time, for sorting; untimed outings last. */
function timeKey(e) {
  const t = allTimes(e.schedule)[0];
  return t ? t.h * 60 + t.m : 24 * 60;
}
// Only a price that says free and nothing else: "Gratuit pour les adhérents, 10 €" is not.
const isFree = (e) => /^(gratuit|entr[ée]e libre|acc[èe]s libre)/i.test(String(e.price || '').trim()) && !/\d\s*€/.test(String(e.price || ''));

const WEEKEND_STYLE = `
.now{font-size:15px;margin:0 0 12px}
.we{color:var(--ink);font-weight:700}
.we img{width:auto;height:2.2rem;margin-right:10px;vertical-align:-.6rem}
.chip{display:inline-block;margin:2px 4px 2px 0;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--paper);color:var(--ink);text-decoration:none;font-weight:600;font-size:15px;line-height:1.5}
.chip b{color:var(--muted);font-weight:600}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 8px}
.toc a{padding:3px 10px;border:1px solid var(--ink);border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:15px;line-height:1.5}
.legend{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.legend .f{font:inherit;font-size:14px;line-height:1.5;padding:2px 10px;border:1px solid var(--line);border-radius:999px;background:var(--paper);color:var(--text);cursor:pointer}
.legend .f[aria-pressed="true"]{border-color:var(--ink);background:#e6efe9;color:var(--ink);font-weight:600}
.legend .f:focus-visible{outline:3px solid var(--accent-ink);outline-offset:2px}
.legend .dot{margin-right:6px}
.legend .f-free{margin-left:6px}
.legend .f-free[aria-pressed="true"]{border-color:#3d5d1d;background:#ecf3e0;color:#3d5d1d}
.filtered-out{display:none!important}
h2.day{position:sticky;top:0;z-index:1;background:var(--bg);padding:10px 0 6px;margin-top:24px}
ul.agenda li{display:grid;grid-template-columns:6.2rem 1fr;gap:4px 12px;align-items:baseline}
ul.agenda .t{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:#6b6257;vertical-align:1px}
.c-sport{background:#0f8f9e}.c-nature{background:#5f8f2f}.c-scene{background:#4a5bb8}.c-culture{background:#9247a0}
.free{display:inline-block;margin-left:6px;padding:0 8px;border-radius:999px;background:#ecf3e0;color:#3d5d1d;font-size:12px;font-weight:700;vertical-align:2px}
.share{text-align:center;margin:8px 0 24px}
.share-btn{display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border:1.5px solid var(--ink);border-radius:999px;background:var(--paper);color:var(--ink);font:inherit;font-weight:600;font-size:15px;cursor:pointer}
.share-btn:hover{background:#e6efe9}
.share-btn[hidden]{display:none}
@media (max-width:480px){ul.agenda li{grid-template-columns:1fr;gap:2px}ul.agenda .t:empty{display:none}}
`.trim();

const FAQ_STYLE = 'h3{font-size:1.05rem;margin:20px 0 4px;color:var(--ink)}';

// ─── Shared by the weekend and holiday pages ───

const endOf = (e) => (isIsoDate(e.endDate) ? e.endDate : e.startDate);

// One line per outing: time on the left (bold), then a category dot, the title, a "Gratuit"
// badge when the price says so, and the place. Plain list underneath, so it reads without CSS.
const freeAttr = (e) => (isFree(e) ? ' data-free="1"' : '');
const agendaItem = (e, note = '') => `<li class="ev" data-cat="${CAT_CLASS[e.category] || ''}"${freeAttr(e)}><span class="t">${esc(timeOf(e.schedule))}</span><div><span class="dot ${CAT_CLASS[e.category] || ''}" title="${esc(e.category || '')}"></span><a href="${esc(e.pagePath)}">${esc(e.title)}</a>${isFree(e) ? ` <span class="free"${en('Free')}>Gratuit</span>` : ''}<small>${esc(place(e))}${note ? ` · ${esc(note)}` : ''}</small></div></li>`;
const daySection = (s) => `<h2 class="day" id="${s.id}"${s.hEn ? en(esc(s.hEn)) : ''}>${esc(s.h)}</h2>\n<ul class="list${s.long ? '' : ' agenda'}">${s.list.map(s.long ? (e) => eventItem(e).replace('<li>', `<li data-cat="${CAT_CLASS[e.category] || ''}"${freeAttr(e)}>`) : (e) => agendaItem(e, s.note ? s.note(e) : '')).join('')}</ul>`;

// "Gratuit" (item 77) is a switch of its own: it combines with a category instead of replacing it.
const LEGEND = `<div class="legend" role="group" aria-label="Filtrer par type"><button type="button" class="f" data-cat="" aria-pressed="true"${en('All')}>Tous</button>${[['c-sport', 'Sport', 'Sport'], ['c-nature', 'Nature', 'Nature'], ['c-scene', 'Spectacles', 'Shows'], ['c-culture', 'Culture', 'Culture']].map(([c, l, lEn]) => `<button type="button" class="f" data-cat="${c}" aria-pressed="false"${en(`<span class="dot ${c}"></span>${lEn}`)}><span class="dot ${c}"></span>${l}</button>`).join('')}<button type="button" class="f f-free" aria-pressed="false"${en('Free')}>Gratuit</button></div>`;

const FILTER_SCRIPT = `(function () {
  // Category filter: the legend's buttons, plus the "Gratuit" switch that combines with them.
  // A section left empty disappears, and so does its link in the contents. Without JavaScript
  // the buttons stay a legend and everything is shown.
  var cat = '', free = false;
  var cats = document.querySelectorAll('.legend .f[data-cat]');
  var frees = document.querySelectorAll('.legend .f-free');
  function apply() {
    Array.prototype.forEach.call(document.querySelectorAll('li[data-cat]'), function (li) {
      li.classList.toggle('filtered-out', (!!cat && li.getAttribute('data-cat') !== cat) || (free && li.getAttribute('data-free') !== '1'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('h2.day'), function (h) {
      var list = h.nextElementSibling;
      var empty = !list.querySelector('li[data-cat]:not(.filtered-out)');
      h.classList.toggle('filtered-out', empty);
      list.classList.toggle('filtered-out', empty);
      var link = document.querySelector('.toc a[href="#' + h.id + '"]');
      if (link) link.classList.toggle('filtered-out', empty);
    });
  }
  Array.prototype.forEach.call(cats, function (btn) {
    btn.addEventListener('click', function () {
      cat = btn.getAttribute('data-cat');
      Array.prototype.forEach.call(cats, function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-cat') === cat)); });
      apply();
    });
  });
  Array.prototype.forEach.call(frees, function (btn) {
    btn.addEventListener('click', function () {
      free = !free;
      Array.prototype.forEach.call(frees, function (x) { x.setAttribute('aria-pressed', String(free)); });
      apply();
    });
  });
})();`;

/**
 * Seasonal pages with something in the next 30 days: holidays about to start or under way, then
 * themes. "Noël" is left out: until December it only repeats the Christmas markets.
 */
function seasonNow(events, today) {
  const soon = addDays(today, 30);
  const holidays = HOLIDAYS.map((h) => {
    const p = holidayPeriod(h, today);
    if (p.over || p.from > soon) return null;
    const k = holidayEvents(p, events, today).short.length;
    return k ? { href: `/${THEMES_DIR}/${h.slug}/`, name: h.name, nameEn: h.nameEn, k } : null;
  }).filter(Boolean);
  const themes = THEMES.filter((t) => t.slug !== 'noel')
    .map((t) => ({ href: `/${THEMES_DIR}/${t.slug}/`, name: t.name, nameEn: t.nameEn, k: events.filter((e) => t.match.test(themeKey(e.title)) && e.startDate <= soon && endOf(e) >= today).length }))
    .filter((x) => x.k);
  return [...holidays, ...themes];
}

// No visible label by default since 04/10, as on the home page: on a site called "Live" the chips
// speak for themselves. Screen readers still get one.
const nowHtml = (now, label = '', labelEn = '') => (now.length
  ? `<p class="now"${label ? '' : ' role="group" aria-label="En ce moment"'}>${label ? `<span${labelEn ? en(`${esc(labelEn)}:`) : ''}>${esc(label)} :</span> ` : ''}${now.map(({ href, name, nameEn, k }) => `<a class="chip" href="${href}"${nameEn ? en(`${esc(nameEn)} <b>${k}</b>`) : ''}>${esc(name)} <b>${k}</b></a>`).join(' ')}</p>`
  : '');

/** What is still to come during a holiday period: outings, and long exhibitions apart. */
function holidayEvents(p, events, today) {
  if (p.over) return { start: p.from, short: [], long: [] };
  const start = p.from > today ? p.from : today;
  const open = events.filter((e) => e.startDate <= p.to && endOf(e) >= start);
  return {
    start,
    short: open.filter((e) => spanDays(e) <= FEED_MAX_DAYS),
    long: open.filter((e) => spanDays(e) > FEED_MAX_DAYS),
  };
}

/** Holiday hubs an event page links to: the ones under way or coming whose dates it shares. */
const holidaysOf = (e, today) => HOLIDAYS.map((h) => ({ h, p: holidayPeriod(h, today) }))
  .filter(({ p }) => !p.over && e.startDate <= p.to && endOf(e) >= p.from);

function holidayPage(h, events, today, places = []) {
  const p = holidayPeriod(h, today);
  const year = p.from.slice(0, 4);
  const { start, short, long } = holidayEvents(p, events, today);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const byTime = (a, b) => timeKey(a) - timeKey(b) || a.title.localeCompare(b.title, 'fr');

  // Each outing once, on its first day still to come within the holidays.
  const dayOf = (e) => (e.startDate > start ? e.startDate : start);
  const days = new Map();
  for (const e of short) {
    const d = dayOf(e);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(e);
  }
  const until = (e) => (endOf(e) > dayOf(e) ? `jusqu’au ${first(shortDate(endOf(e)))}` : '');
  const sections = [...days.keys()].sort().map((d) => ({ id: `j-${d}`, h: cap(dayName(d)), hEn: enDay(d), list: days.get(d).sort(byTime), note: until }));
  if (long.length) sections.push({ id: 'expositions', h: 'Expositions et visites ouvertes pendant les vacances', hEn: 'Exhibitions and visits open during the holidays', list: long, long: true });

  // Contents: the first day of each holiday week, labelled by its dates ("31 oct.-2 nov.": the
  // last week is often a long weekend, so "3e semaine" would mislead), then the exhibitions.
  const week = (d) => Math.floor((Date.parse(d) - Date.parse(p.from)) / (7 * 864e5));
  const dm = (d) => first(shortDate(d).replace(/^\S+ /, ''));
  const weekLabel = (w) => {
    const a = addDays(p.from, 7 * w);
    const b = addDays(a, 6) < p.to ? addDays(a, 6) : p.to;
    return a.slice(5, 7) === b.slice(5, 7) ? `${first(`${Number(a.slice(8))} `).trim()}-${dm(b)}` : `${dm(a)}-${dm(b)}`;
  };
  const weekLabelEn = (w) => {
    const a = addDays(p.from, 7 * w);
    const b = addDays(a, 6) < p.to ? addDays(a, 6) : p.to;
    const dmEn = (d) => enDate(d, { day: 'numeric', month: 'short' });
    return a.slice(5, 7) === b.slice(5, 7) ? `${Number(a.slice(8))}–${dmEn(b)}` : `${dmEn(a)} – ${dmEn(b)}`;
  };
  const toc = [];
  for (const s of sections) {
    if (s.long) { toc.push({ id: s.id, nav: 'Expositions', navEn: 'Exhibitions' }); continue; }
    const w = week(s.id.slice(2));
    if (!toc.some((x) => x.w === w)) toc.push({ id: s.id, w, nav: weekLabel(w), navEn: weekLabelEn(w) });
  }
  // A title that says "enfants" or "Halloween" is not enough when the organiser set an age floor.
  const family = short.filter((e) => FAMILY.test(themeKey(e.title)) && !(Number(e.ageMin) >= 12)).slice(0, FAMILY_MAX);
  if (family.length) toc.unshift({ id: 'en-famille', nav: 'En famille', navEn: 'Family' });

  const n = short.length;
  const themesHere = THEMES.filter((t) => t.slug !== 'noel')
    .map((t) => ({ href: `/${THEMES_DIR}/${t.slug}/`, name: t.name, nameEn: t.nameEn, k: [...short, ...long].filter((e) => t.match.test(themeKey(e.title))).length }))
    .filter((x) => x.k);
  const lead = p.over ? h.off(year)
    : n ? `${n} sortie${n > 1 ? 's' : ''}${long.length ? ` et ${long.length} exposition${long.length > 1 ? 's' : ''} ou visite${long.length > 1 ? 's' : ''}` : ''} ${p.from > today ? 'pendant les vacances' : 'd’ici la fin des vacances'}, à Fontainebleau et dans les communes voisines. Mis à jour chaque jour.`
      : 'Rien d’annoncé pour l’instant : le programme se remplit au fil des annonces et se met à jour chaque jour.';
  const leadEn = p.over ? h.offEn(year)
    : n ? `${enPl(n, 'outing')}${long.length ? ` and ${long.length} exhibition${long.length > 1 ? 's' : ''} or visit${long.length > 1 ? 's' : ''}` : ''} ${p.from > today ? 'during the holidays' : 'until the end of the holidays'}, in Fontainebleau and the neighbouring towns. Updated every day.`
      : 'Nothing announced yet: the programme fills up as events are announced and is updated every day.';

  const body = `<nav class="crumbs"><a href="/"${en('Home')}>Accueil</a> › <a href="/${THEMES_DIR}/"${en('Seasonal outings')}>Sorties de saison</a></nav>
<h1${en(esc(h.titleEn(year)))}>${esc(h.title(year))}</h1>
<p class="when"${en(esc(`From ${enDM(p.from)} to ${enDMY(p.to)}`))}>${esc(first(`Du ${frDate(p.from).replace(/ \d{4}$/, '')} au ${frDate(p.to)}`))}</p>
<p${en(esc(h.introEn))}>${esc(h.intro)}</p>
<p${en(esc(leadEn))}>${esc(lead)}</p>
${nowHtml(themesHere, 'Pendant les vacances', 'During the holidays')}
${toc.length > 1 ? `<nav class="toc" aria-label="Sommaire">${toc.map((s) => `<a href="#${s.id}"${en(esc(s.navEn))}>${esc(s.nav)}</a>`).join('')}</nav>` : ''}
${family.length ? `<h2 id="en-famille"${en('Family outing ideas')}>Idées de sorties en famille</h2>\n<ul class="list">${family.map(eventItem).join('')}</ul>` : ''}
${n ? LEGEND : ''}
${sections.map(daySection).join('\n')}${p.over ? '' : visitHtml(placesOpen(places, start, p.to), 'À visiter pendant les vacances', 'Places to visit during the holidays')}
${faqHtml(h.faq, h.faqEn)}<div class="actions"><a class="btn alt" href="/"${en('Full agenda on the map')}>Tout l’agenda sur la carte</a> <a class="btn alt" href="/${WEEKEND_DIR}/"${en('This weekend')}>Ce week-end</a></div>
<script>
${FILTER_SCRIPT}
</script>`;

  return layout({
    title: `${h.title(year)} | Fontainebleau Live`,
    description: truncate(p.over ? h.off(year) : `${first(`Du ${shortDate(p.from).replace(/^\S+ /, '')} au ${shortDate(p.to).replace(/^\S+ /, '')}`)} ${year} : ${n ? `${n} sorties` : 'les sorties'} à Fontainebleau et alentour — balades en forêt, spectacles, ateliers, Halloween. Mis à jour chaque jour.`, 155),
    canonical: `${SITE_URL}/${THEMES_DIR}/${h.slug}/`,
    body,
    titleEn: `${h.titleEn(year)} | Fontainebleau Live`,
  }).replace('</style>', `${WEEKEND_STYLE}\n${FAQ_STYLE}\n${VISIT_STYLE}\n</style>`);
}

/** /sorties/ — every seasonal hub, holidays first. A plain page of links a crawler can follow. */
function seasonIndex(events, today) {
  const holidays = HOLIDAYS.map((h) => {
    const p = holidayPeriod(h, today);
    const k = holidayEvents(p, events, today).short.length;
    const when = first(`du ${shortDate(p.from).replace(/^\S+ /, '')} au ${shortDate(p.to).replace(/^\S+ /, '')} ${p.to.slice(0, 4)}`);
    const whenEn = `${enDM(p.from)} to ${enDMY(p.to)}`;
    const y = esc(p.from.slice(0, 4));
    return `<li><a href="/${THEMES_DIR}/${h.slug}/"${en(`${esc(h.nameEn)} ${y}`)}>${esc(h.name)} ${y}</a><small${en(p.over ? 'Over' : `${esc(whenEn)}${k ? ` · ${enPl(k, 'outing')}` : ''}`)}>${p.over ? 'Terminées' : `${esc(when)}${k ? ` · ${k} sortie${k > 1 ? 's' : ''}` : ''}`}</small></li>`;
  });
  const themes = THEMES.map((t) => {
    const list = events.filter((e) => t.match.test(themeKey(e.title)));
    const year = (list[0] ? list[0].startDate : today).slice(0, 4);
    return `<li><a href="/${THEMES_DIR}/${t.slug}/"${en(esc(t.h1En(year)))}>${esc(t.h1(year))}</a><small${en(list.length ? `${enPl(list.length, 'upcoming date')}` : 'No date announced yet')}>${list.length ? `${list.length} date${list.length > 1 ? 's' : ''} à venir` : 'Pas encore de date annoncée'}</small></li>`;
  });
  const body = `<nav class="crumbs"><a href="/"${en('Home')}>Accueil</a> › <a href="/${CITIES_DIR}/"${en('Things to do around Fontainebleau')}>Que faire autour de Fontainebleau</a></nav>
<h1${en('Seasonal outings around Fontainebleau')}>Sorties de saison autour de Fontainebleau</h1>
<p${en('School holidays, festivals and the great moments of nature: the pages that come back every year, updated every day.')}>Vacances scolaires, fêtes et rendez-vous de la nature : les pages qui reviennent chaque année, mises à jour chaque jour.</p>
<h2${en('School holidays')}>Vacances scolaires</h2>
<ul class="list">${holidays.join('')}</ul>
<h2${en('Festivals and seasons')}>Fêtes et saisons</h2>
<ul class="list">${themes.join('')}</ul>
<div class="actions"><a class="btn alt" href="/"${en('Full agenda on the map')}>Tout l’agenda sur la carte</a> <a class="btn alt" href="/${WEEKEND_DIR}/"${en('This weekend')}>Ce week-end</a></div>`;
  return layout({
    title: 'Sorties de saison autour de Fontainebleau : vacances, Halloween, Noël, brame du cerf | Fontainebleau Live',
    description: 'Vacances de la Toussaint, Halloween, marchés de Noël, brame du cerf, champignons : les sorties de saison autour de Fontainebleau, mises à jour chaque jour.',
    canonical: `${SITE_URL}/${THEMES_DIR}/`,
    body,
    titleEn: 'Seasonal outings around Fontainebleau: holidays, Halloween, Christmas, deer rut | Fontainebleau Live',
  });
}

// Share button of the weekend and today pages. Our own strings only: no data reaches the script.
const shareHtml = (text, textEn = '') => `<div class="share"><button type="button" id="share" class="share-btn" hidden data-text="${esc(text)}"${textEn ? ` data-text-en="${esc(textEn)}"` : ''}><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg><span${en('Share this programme')}>Partager ce programme</span></button></div>`;
const shareScript = (url, title) => `(function () {
  // Shown only where it works: the phone's share sheet, or failing that a copied link.
  var b = document.getElementById('share');
  var url = '${url}';
  if (!navigator.share && !(navigator.clipboard && navigator.clipboard.writeText)) return;
  b.hidden = false;
  b.addEventListener('click', function () {
    var label = b.querySelector('span');
    // In English (see LANG_SCRIPT), the English text and a link that opens in English.
    var isEn = document.documentElement.lang === 'en' && b.getAttribute('data-text-en');
    var link = isEn ? url + '?lang=en' : url;
    if (navigator.share) {
      var text = isEn ? b.getAttribute('data-text-en') + ', on Fontainebleau Live:' : b.getAttribute('data-text') + ', sur Fontainebleau Live :';
      navigator.share({ title: document.title, text: text, url: link }).catch(function () {});
    } else {
      navigator.clipboard.writeText(link).then(function () { label.textContent = isEn ? 'Link copied ✓' : 'Lien copié ✓'; });
    }
  });
})();`;

/**
 * "À ne pas manquer" (item 77): a written rule, not a taste. Eligible: a legitimate source
 * (organiser's site, DATAtourisme, OpenAgenda — never Gemini alone, whose dates were once copied
 * from the year before), a verified link, four days at most. Ranked: seasonal outing (/sorties/),
 * then a big date by its title, then the longest. Promoting a wrong date is worse than none.
 */
const PICKS_MAX = 4;
const BIG_DATE = /\b(fetes?|festivals?|salons?|foires?|marches?|concours|brocantes?|vide-greniers?)\b/;

function picksOf(list) {
  const score = (e) => [themesOf(e).length ? 0 : 1, BIG_DATE.test(themeKey(e.title)) ? 0 : 1, -spanDays(e)];
  return list
    .filter((e) => e.source && e.urlStatus === 'ok' && spanDays(e) <= 4)
    .map((e) => ({ e, k: score(e) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.e.title.localeCompare(b.e.title, 'fr'))
    .slice(0, PICKS_MAX)
    .map(({ e }) => e);
}

function weekendPage(events, today, places = []) {
  const { sat, sun } = weekendOf(today);
  const end = (e) => (isIsoDate(e.endDate) ? e.endDate : e.startDate);
  // Still to come (a Sunday page drops Saturday-only outings) and overlapping the weekend.
  const open = events.filter((e) => e.startDate <= sun && end(e) >= sat && end(e) >= today);
  const long = open.filter((e) => spanDays(e) > FEED_MAX_DAYS);
  const short = open.filter((e) => spanDays(e) <= FEED_MAX_DAYS);
  const on = (day) => (e) => e.startDate <= day && end(e) >= day;
  const byTime = (a, b) => timeKey(a) - timeKey(b) || a.title.localeCompare(b.title, 'fr');
  const both = (today < sun ? short.filter((e) => on(sat)(e) && on(sun)(e)) : []).sort(byTime);
  const satOnly = (today < sun ? short.filter((e) => on(sat)(e) && !on(sun)(e)) : []).sort(byTime);
  const sunOnly = short.filter((e) => on(sun)(e) && !both.includes(e)).sort(byTime);

  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const satLabel = dayName(sat), sunLabel = dayName(sun);
  const dayWord = (e) => (today === sun ? '' : on(sat)(e) && on(sun)(e) ? 'samedi et dimanche' : on(sat)(e) ? 'samedi' : 'dimanche');
  const picks = picksOf(today === sun ? sunOnly : short);

  // On Sunday the page shows the day itself: the next weekend follows, so the page still has
  // something to offer on Sunday evening.
  const next = today === sun ? weekendOf(addDays(today, 1)) : null;
  const firstDay = (e) => (e.startDate > next.sat ? e.startDate : next.sat);
  const nextList = next ? events.filter((e) => e.startDate <= next.sun && end(e) >= next.sat && spanDays(e) <= FEED_MAX_DAYS)
    .sort((a, b) => firstDay(a).localeCompare(firstDay(b)) || byTime(a, b)) : [];
  const nextWord = (e) => (on(next.sat)(e) && on(next.sun)(e) ? 'samedi et dimanche' : on(next.sat)(e) ? 'samedi' : 'dimanche');

  const sections = [
    { id: 'a-ne-pas-manquer', nav: 'À ne pas manquer', navEn: 'Don’t miss', h: 'À ne pas manquer', hEn: 'Don’t miss', list: picks, note: dayWord },
    { id: 'tout-le-week-end', nav: 'Tout le week-end', navEn: 'All weekend', h: 'Tout le week-end', hEn: 'All weekend', list: both },
    { id: 'samedi', nav: 'Samedi', navEn: 'Saturday', h: cap(satLabel), hEn: enDay(sat), list: satOnly },
    { id: 'dimanche', nav: today === sun ? 'Aujourd’hui' : 'Dimanche', navEn: today === sun ? 'Today' : 'Sunday', h: today === sun ? `Aujourd’hui, ${sunLabel}` : cap(sunLabel), hEn: today === sun ? `Today, ${enDay(sun)}` : enDay(sun), list: sunOnly },
  ].filter((s) => s.list.length);
  if (long.length) sections.push({ id: 'expositions', nav: 'Expositions', navEn: 'Exhibitions', h: 'Expositions et visites en cours', hEn: 'Exhibitions and visits on now', list: long, long: true });
  if (nextList.length) {
    const sameMonth = next.sat.slice(5, 7) === next.sun.slice(5, 7);
    sections.push({ id: 'week-end-prochain', nav: 'Week-end prochain', navEn: 'Next weekend', h: `Le week-end prochain : ${sameMonth ? dayName(next.sat).replace(/ \S+$/, '') : dayName(next.sat)} et ${dayName(next.sun)}`, hEn: `Next weekend: ${sameMonth ? enDate(next.sat, { weekday: 'long', day: 'numeric' }) : enDay(next.sat)} and ${enDay(next.sun)}`, list: nextList, note: nextWord });
  }

  const range = first(`${sat.slice(8, 10).replace(/^0/, '')}${sat.slice(5, 7) === sun.slice(5, 7) ? '' : ` ${frDate(sat).split(' ')[2]}`}-${frDate(sun).split(' ').slice(1).join(' ')}`);
  const rangeEn = sat.slice(5, 7) === sun.slice(5, 7) ? `${Number(sat.slice(8))}–${enDMY(sun)}` : `${enDM(sat)} – ${enDMY(sun)}`;
  const n = short.length;

  const now = seasonNow(events, today);
  const shareText = `${n} sortie${n > 1 ? 's' : ''} ${today === sun ? 'aujourd’hui' : 'ce week-end'} autour de Fontainebleau`;
  const shareTextEn = `${enPl(n, 'outing')} ${today === sun ? 'today' : 'this weekend'} around Fontainebleau`;

  const body = `<nav class="crumbs"><a href="/"${en('Home')}>Accueil</a> › <a href="/${CITIES_DIR}/"${en('Things to do around Fontainebleau')}>Que faire autour de Fontainebleau</a></nav>
<h1${en('What’s on this weekend around Fontainebleau?')}>Que faire ce week-end autour de Fontainebleau ?</h1>
<p class="when"><span class="we"><img src="/public/assets/img/brand/calendrier-sam-dim.svg" alt="" width="46" height="36"><span${en('Weekend')}>Week-end</span></span> <span${en(`of ${esc(rangeEn)}${today === sun ? ' · today, Sunday' : ''}`)}>du ${esc(range)}${today === sun ? ` · aujourd’hui ${esc(sunLabel.replace(/ \d.*$/, ''))}` : ''}</span></p>
<p${en(n ? `${enPl(n, 'outing')} ${today === sun ? 'today' : 'this weekend'} in Fontainebleau and the neighbouring towns: sport, nature, shows, culture and family outings. Updated every day.` : 'Nothing announced for this weekend yet: come back in a few days, the programme is updated every day.')}>${n ? `${n} sortie${n > 1 ? 's' : ''} ${today === sun ? 'aujourd’hui' : 'ce week-end'} à Fontainebleau et dans les communes voisines : sport, nature, spectacles, culture et sorties en famille. Mis à jour chaque jour.` : 'Rien d’annoncé pour l’instant ce week-end : revenez dans quelques jours, le programme se met à jour chaque jour.'}</p>
${nowHtml(now)}
${sections.length > 1 ? `<nav class="toc" aria-label="Sommaire">${sections.map((s) => `<a href="#${s.id}"${s.navEn ? en(esc(s.navEn)) : ''}>${esc(s.nav)}</a>`).join('')}</nav>` : ''}
${n || nextList.length ? LEGEND : ''}
${sections.map(daySection).join('\n')}${visitHtml(placesOpen(places, today > sat ? today : sat, sun), 'À visiter ce week-end', 'Places to visit this weekend')}
<div class="actions">${today === sun ? '' : `<a class="btn alt" href="/${TODAY_DIR}/"${en('Today')}>Aujourd’hui</a> `}<a class="btn alt" href="/"${en('Full agenda on the map')}>Tout l’agenda sur la carte</a></div>
${shareHtml(shareText, shareTextEn)}
<p class="note"><span${en('Seasonal outings:')}>Sorties de saison :</span> ${THEMES.map((t) => `<a href="/${THEMES_DIR}/${t.slug}/"${en(esc(t.nameEn))}>${esc(t.name)}</a>`).join(' · ')}.</p>
<script>
${FILTER_SCRIPT}
${shareScript(`${SITE_URL}/${WEEKEND_DIR}/`, 'Que faire ce week-end autour de Fontainebleau ? — Fontainebleau Live')}
</script>`;

  return layout({
    title: `Que faire ce week-end autour de Fontainebleau ? (${range}) | Fontainebleau Live`,
    description: truncate(`${n} sortie${n > 1 ? 's' : ''} le week-end du ${range} à Fontainebleau et alentour : sport, nature, spectacles, culture, en famille.`, 155),
    canonical: `${SITE_URL}/${WEEKEND_DIR}/`,
    body,
    titleEn: `What’s on this weekend around Fontainebleau? (${rangeEn}) | Fontainebleau Live`,
  }).replace('</style>', `${WEEKEND_STYLE}\n${VISIT_STYLE}\n</style>`);
}

// ─── /aujourdhui/ (item 78) ───
// What is on today, rebuilt with the other pages every morning (06:00 UTC). Between midnight
// and that run the page would show yesterday, so it carries tomorrow too, hidden: a small script
// shows the block of the phone's date. Without JavaScript, the day it was built.

const TODAY_DIR = 'aujourdhui';

function todayPage(events, today) {
  const tomorrow = addDays(today, 1);
  const byTime = (a, b) => timeKey(a) - timeKey(b) || a.title.localeCompare(b.title, 'fr');
  const on = (d) => events.filter((e) => e.startDate <= d && endOf(e) >= d);
  const day = (d) => {
    const open = on(d);
    return { d, short: open.filter((e) => spanDays(e) <= FEED_MAX_DAYS).sort(byTime), long: open.filter((e) => spanDays(e) > FEED_MAX_DAYS) };
  };
  const days = [day(today), day(tomorrow)];
  const n = days[0].short.length;

  const block = ({ d, short, long }, i) => {
    const k = short.length;
    const until = (e) => (endOf(e) > d ? `jusqu’au ${first(shortDate(endOf(e)))}` : '');
    const sections = [
      { id: `sorties-${d}`, h: 'Au programme', list: short, note: until },
      { id: `expositions-${d}`, h: 'Expositions et visites ouvertes', list: long, long: true },
    ].filter((s) => s.list.length);
    return `<section class="daybox" data-day="${d}"${i ? ' hidden' : ''}>
<p class="when">Aujourd’hui, ${esc(dayName(d))}</p>
<p>${k ? `${k} sortie${k > 1 ? 's' : ''} aujourd’hui à Fontainebleau et dans les communes voisines : sport, nature, spectacles, culture et sorties en famille.` : 'Rien d’annoncé aujourd’hui pour l’instant.'}${long.length ? ` Et ${long.length} exposition${long.length > 1 ? 's' : ''} ou visite${long.length > 1 ? 's' : ''} ouverte${long.length > 1 ? 's' : ''}.` : ''}</p>
${k ? LEGEND : ''}
${sections.map(daySection).join('\n')}
</section>`;
  };

  const shareText = `${n} sortie${n > 1 ? 's' : ''} aujourd’hui autour de Fontainebleau`;
  const body = `<nav class="crumbs"><a href="/">Accueil</a> › <a href="/${CITIES_DIR}/">Que faire autour de Fontainebleau</a></nav>
<h1>Que faire aujourd’hui autour de Fontainebleau ?</h1>
<p class="note" id="stale" hidden>Ce programme date du ${esc(dayName(today))} et n’a pas encore été mis à jour : <a href="/">l’agenda complet</a> est à jour.</p>
${nowHtml(seasonNow(events, today))}
${days.map(block).join('\n')}
<div class="actions"><a class="btn alt" href="/${WEEKEND_DIR}/">Ce week-end</a> <a class="btn alt" href="/">Tout l’agenda sur la carte</a></div>
${shareHtml(shareText)}
<p class="note">Agenda collecté automatiquement : vérifiez les informations auprès de l’organisateur avant de vous déplacer.</p>
<script>
${FILTER_SCRIPT}
(function () {
  // The block of the phone's date (Paris): tomorrow's between midnight and the morning rebuild.
  // Past both, the page is stale (a failed run): it says so instead of showing a past day.
  var d;
  try { d = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); } catch (e) { return; }
  var boxes = document.querySelectorAll('.daybox');
  var match = null;
  Array.prototype.forEach.call(boxes, function (b) { if (b.getAttribute('data-day') === d) match = b; });
  if (match) Array.prototype.forEach.call(boxes, function (b) { b.hidden = b !== match; });
  else if (d > '${tomorrow}') document.getElementById('stale').hidden = false;
})();
${shareScript(`${SITE_URL}/${TODAY_DIR}/`, 'Que faire aujourd’hui autour de Fontainebleau ? — Fontainebleau Live')}
</script>`;

  return layout({
    title: `Que faire aujourd’hui autour de Fontainebleau ? (${first(shortDate(today))}) | Fontainebleau Live`,
    description: truncate(`${n ? `${n} sortie${n > 1 ? 's' : ''}` : 'Les sorties'} aujourd’hui, ${dayName(today)}, à Fontainebleau et alentour : sport, nature, spectacles, culture, en famille. Mis à jour chaque matin.`, 155),
    canonical: `${SITE_URL}/${TODAY_DIR}/`,
    body,
    toTop: true,   // no English on this page, but just as long
  }).replace('</style>', `${WEEKEND_STYLE}\n</style>`);
}

function citiesIndex(cities) {
  const seasonal = [...HOLIDAYS, ...THEMES].map((t) => `<a href="/${THEMES_DIR}/${t.slug}/">${esc(t.name)}</a>`).join(' · ');
  const body = `<nav class="crumbs"><a href="/">Accueil</a></nav>
<h1>Que faire autour de Fontainebleau ?</h1>
<p>Les activités à venir, commune par commune.</p>
<ul class="list">${cities.map((c) => `<li><a href="/${CITIES_DIR}/${c.slug}/">${esc(c.name)}</a><small>${c.events.length} activité${c.events.length > 1 ? 's' : ''} à venir</small></li>`).join('')}</ul>
<h2>Aujourd’hui et ce week-end</h2>
<p><a href="/${TODAY_DIR}/">Que faire aujourd’hui autour de Fontainebleau ?</a></p>
<p><a href="/${WEEKEND_DIR}/">Que faire ce week-end autour de Fontainebleau ?</a></p>
<h2><a href="/${THEMES_DIR}/">Sorties de saison</a></h2>
<p>${seasonal}</p>`;
  return layout({
    title: 'Que faire autour de Fontainebleau ? Agenda par commune | Fontainebleau Live',
    description: 'Les activités sportives, culturelles et nature à venir autour de Fontainebleau, classées par commune.',
    canonical: `${SITE_URL}/${CITIES_DIR}/`,
    body,
  });
}

function sitemap(cities, events, homeLastmod) {
  // Only self-canonical addresses (07/10): /?lang=en declares / as its canonical, so listing it
  // (or pointing an hreflang at it) told Google to index a page that defers to another one.
  const home = `  <url>\n    <loc>${SITE_URL}/</loc>\n${homeLastmod ? `    <lastmod>${homeLastmod}</lastmod>\n` : ''}  </url>`;
  const plain = (p) => `  <url><loc>${SITE_URL}${p}</loc></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${home}
${[`/${CITIES_DIR}/`, '/widget/integrer/', `/${TODAY_DIR}/`, `/${WEEKEND_DIR}/`, `/${THEMES_DIR}/`, `/${SOURCES_DIR}/`, ...HOLIDAYS.map((h) => `/${THEMES_DIR}/${h.slug}/`), ...THEMES.map((t) => `/${THEMES_DIR}/${t.slug}/`), ...cities.map((c) => `/${CITIES_DIR}/${c.slug}/`), ...events.map((e) => e.pagePath)].map(plain).join('\n')}
</urlset>
`;
}

// ───────────────────────────── /nos-sources/ (item 79) ─────────────────────────────
// How the agenda is collected and checked, with today's counts. Every claim here is something
// the pipeline does (fetch-events.js); what it does not do is said as plainly. Gemini is named:
// hiding where a record comes from was rejected on 24/09 (§7).

const SOURCES_DIR = 'nos-sources';
const FEEDBACK_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLScRjLM5_R4K_d-0UUJk7lT1hvP8UBKyBMtniKskJviaG8ZRgw/viewform';

function sourcesPage(events, generatedAt, registry, places = [], today = '') {
  const n = events.length;
  const count = (k) => events.filter((e) => (k ? e.source === k : !SOURCE_LABEL[e.source])).length;
  const linksOk = events.filter((e) => e.urlStatus === 'ok').length;
  const unsure = events.filter(datesUnconfirmed).length;
  const sites = registry.filter((s) => s.enabled !== false && s.name).map((s) => s.name);
  const when = generatedAt ? dayMonthYear(parisToday(new Date(generatedAt))) : '';
  const pl = (k, one, many) => `${k} ${k > 1 ? many : one}`;
  // Each sentence must stay true (item 79): the paragraph only exists while an offer is live.
  const withBooking = events.filter((e) => bookingOf(e));
  const booked = withBooking.length;
  const visits = today ? placesOpen(places, today, addDays(today, 365)) : [];
  const partners = [...new Set([...withBooking.map((e) => bookingOf(e).provider), ...visits.map((p) => p.provider)].filter(Boolean))].sort();

  const body = `<nav class="crumbs"><a href="/">Accueil</a></nav>
<h1>Nos sources : d’où viennent les sorties de l’agenda</h1>
<p>Fontainebleau Live rassemble automatiquement les sorties annoncées autour de Fontainebleau : toutes les communes à moins de 15 km et, jusqu’à 20 km, les villes et les grands sites (Vaux-le-Vicomte, Blandy, Courances). Personne ne saisit les fiches à la main. Voici où nous les trouvons, ce que nous vérifions, et ce que nous ne pouvons pas vérifier.</p>
<p class="when">${when ? `Dernière collecte le ${esc(when)} · ` : ''}${pl(n, 'sortie à venir', 'sorties à venir')}</p>

<h2>Où nous cherchons</h2>
<ul class="list">
<li><b>Les sites des organisateurs, de l’office de tourisme et des mairies</b><small>${pl(count('site'), 'fiche confirmée', 'fiches confirmées')}. Lus directement, en respectant les consignes de chaque site aux robots${sites.length ? ` : ${esc(sites.join(', '))}` : ''}.</small></li>
<li><b>DATAtourisme</b><small>${pl(count('datatourisme'), 'fiche', 'fiches')}. La base nationale ouverte, alimentée par les offices de tourisme.</small></li>
<li><b>OpenAgenda</b><small>${pl(count('openagenda'), 'fiche', 'fiches')}. Les agendas que les organisateurs publient eux-mêmes, via le portail de la Région Île-de-France.</small></li>
<li><b>La recherche web</b><small>${pl(count(''), 'fiche', 'fiches')}. Une recherche Google automatisée, menée par Gemini, l’intelligence artificielle de Google. Elle trouve ce que les autres sources ignorent, mais elle est moins sûre : ces fiches portent la mention « recherche web, à confirmer », et ne sont jamais mises en avant.</small></li>
</ul>

<h2>Ce que nous vérifions, à chaque collecte</h2>
<p>La collecte a lieu tous les trois jours environ.</p>
<ul class="list">
<li><b>Les liens</b><small>Chaque lien est ouvert. Une page introuvable retire la fiche ; un site qui refuse les robots garde la fiche, sans la mention « vérifié ». Aujourd’hui : ${linksOk} lien${linksOk > 1 ? 's' : ''} vérifié${linksOk > 1 ? 's' : ''} sur ${n}.</small></li>
<li><b>Les dates</b><small>Une date passée, hors de la fenêtre des trois prochains mois, ou qui contredit le jour annoncé (un « samedi » qui tombe un mardi) écarte la fiche.</small></li>
<li><b>Les dates recopiées</b><small>Une fiche que seule la recherche web annonce, avec un lien qui ne mène qu’à l’accueil d’un site, peut porter les dates de l’an dernier. Elle est marquée « Dates à confirmer »${unsure ? ` (${pl(unsure, 'fiche', 'fiches')} aujourd’hui)` : ''}.</small></li>
<li><b>Les doublons</b><small>La même sortie annoncée par plusieurs sources n’apparaît qu’une fois.</small></li>
<li><b>Le lieu</b><small>L’adresse est placée sur la carte grâce à la Base Adresse Nationale ; une sortie hors de cette zone est écartée.</small></li>
</ul>

${partners.length ? `<h2 id="financement">Comment le site est financé</h2>
${booked ? `<p>Certaines fiches proposent, à côté du lien vers l’organisateur, un bouton de réservation chez un partenaire (aujourd’hui : ${esc(partners.join(', '))}, sur ${pl(booked, 'fiche', 'fiches')}). Si vous réservez par ce lien, Fontainebleau Live perçoit une commission. Ce bouton est marqué « lien partenaire ». Il n’apparaît que sur une sortie confirmée par une source lue directement, jamais sur une fiche issue de la seule recherche web. Le partenaire ne choisit ni les sorties publiées ni leur ordre.</p>` : ''}${visits.length ? `
<p>Les encarts « À visiter » proposent le billet d’entrée ${esc(visits.map((p) => `du ${p.name.replace(/^Château de /, 'château de ')}`).join(', ').replace(/, ([^,]*)$/, ' et $1'))} chez un partenaire, avec la même commission. Ils ne dépendent d’aucune sortie de l’agenda et n’apparaissent que les jours d’ouverture.</p>` : ''}

` : ''}<h2>Ce que nous ne vérifions pas</h2>
<p>Nous n’appelons pas les organisateurs : une annulation de dernière minute peut nous échapper. Avant un long trajet, un coup d’œil au site de l’organisateur reste prudent.</p>
<p>Une erreur, une sortie annulée ? <a href="${FEEDBACK_FORM}" rel="noopener" target="_blank">Signalez-la</a> : chaque signalement est relu, et une fiche signalée comme annulée peut être masquée dès la collecte suivante.</p>
<div class="actions"><a class="btn alt" href="/">Tout l’agenda sur la carte</a> <a class="btn alt" href="/${WEEKEND_DIR}/">Ce week-end</a></div>`;

  return layout({
    title: 'Nos sources : comment l’agenda de Fontainebleau Live est collecté et vérifié',
    description: 'Sites des organisateurs, office de tourisme, DATAtourisme, OpenAgenda et recherche web : d’où viennent les sorties de Fontainebleau Live, et ce que nous vérifions.',
    canonical: `${SITE_URL}/${SOURCES_DIR}/`,
    body,
  });
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

function build(payload, { today, existingEventDirs = [], existingFeeds = [], registry = [], places = [] }) {
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
    files.set(`${EVENTS_DIR}/${dir}/index.html`, eventPage(e, events, today));
  }
  // A commune page lists what is coming: a monument shows there if it opens in the next 30 days.
  for (const c of cities) files.set(`${CITIES_DIR}/${c.slug}/index.html`, cityPage(c, placesOpen(places, today, addDays(today, 30), c.name)));
  files.set(`${CITIES_DIR}/index.html`, citiesIndex(cities));
  files.set(`${WEEKEND_DIR}/index.html`, weekendPage(events, today, places));
  files.set(`${TODAY_DIR}/index.html`, todayPage(events, today));
  // Always written, even empty: the address is the point (see THEMES).
  for (const t of THEMES) files.set(`${THEMES_DIR}/${t.slug}/index.html`, themePage(t, events.filter((e) => t.match.test(themeKey(e.title))), today));
  for (const h of HOLIDAYS) files.set(`${THEMES_DIR}/${h.slug}/index.html`, holidayPage(h, events, today, places));
  files.set(`${THEMES_DIR}/index.html`, seasonIndex(events, today));
  // The home page's "En ce moment" row reads this: the same picks and counts as the weekend page,
  // and index.html never re-implements the theme matching.
  files.set(`${THEMES_DIR}/en-ce-moment.json`, JSON.stringify(seasonNow(events, today).map(({ href, name, nameEn, k }) => ({ href, name, nameEn, count: k })), null, 2) + '\n');
  files.set(`${SHARE_DIR}/index.html`, sharePage(cities, events, today));
  files.set(`${SOURCES_DIR}/index.html`, sourcesPage(events, generatedAt, registry, places, today));
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

/** sources.json, for the names on /nos-sources/. Missing or unreadable: the page lists none. */
function readRegistry() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));
    return Array.isArray(s.sources) ? s.sources : [];
  } catch {
    return [];
  }
}

function main() {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const existingFeeds = ['categorie', 'commune'].flatMap((d) => {
    const dir = path.join(ROOT, AGENDA_DIR, d);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.ics')).map((f) => `${AGENDA_DIR}/${d}/${f}`) : [];
  });
  const { files, remove, stats } = build(payload, { today: parisToday(), existingEventDirs: listDirs(EVENTS_DIR), existingFeeds, registry: readRegistry(), places: loadPlaces() });

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
  icsText, icsFold, icsCalendar, inFeed, shareable, EVENTS_DIR, CITIES_DIR, AGENDA_DIR, SHARE_DIR, FEED_MAX_DAYS,
  THEMES, THEMES_DIR, themesOf, HOLIDAYS, holidayPeriod, FAMILY, eventTitle, eventDescription, WEEKEND_DIR, weekendOf, TODAY_DIR,
};
