'use strict';
/**
 * /jeu/ — Fontainebleau Live Collection, the playable prototype (item 116e, GDD §11, §15 M1).
 * Called by generate-pages.js on every run; never writes anything itself.
 *
 * - Content: scripts/live-collection.js (hand-written, sourced). Events: data.json, only those
 *   confirmed by a source we read (the carousel rule), within the agenda's zone.
 * - Launched on 23/11 by the project lead, before every question was checked on site: the page is
 *   indexed and linked from the site, and says « bêta » in the profile, with the error form.
 * - Frontend rules: every text from the data goes through textContent; innerHTML only receives
 *   fixed markup written here (icons). Links are http(s) only. localStorage under try/catch.
 * - The position never leaves the phone: it is read by the browser, compared here, never stored.
 * - The game's own "today" is the phone's date in Europe/Paris (the page is rebuilt each day,
 *   and embeds the next days' events, so a page a day old still plays right).
 */
const C = require('./live-collection');
const { ICONS } = require('./live-collection-icons');
const { AVATAR_ART, FRAME_ART } = require('./live-collection-avatars');

const JEU_DIR = 'jeu';
const CENTRE = { lat: 48.4045, lng: 2.7016 };
const CONFIRMED = new Set(['site', 'datatourisme', 'openagenda', 'francebillet']);
const EVENT_KM = 12;      // around the player, and the range follows them (GDD §7.2)
const ZONE_KM = 35;       // what the page embeds: the agenda's zone (20 km) plus a margin
const EVENT_DAYS = 9;     // a week, plus two days of slack for a page that was not rebuilt
const SEASON_KM = 15;
const SEASON_DAYS = 40;
const SEASON_RE = /no[eë]l|avent|saint[- ]nicolas|illumination/i;
// Leaflet, byte-identical to the CDN files: the same SRI digests as index.html.
// Home-screen icon (23/11): a folded map and a collected place, drawn for the game.
const ICON_DIR = '/public/assets/img/brand';
const ICON_180 = `${ICON_DIR}/Icon-FLC-180.png`;
/** /jeu/manifest.json: the game installs as its own app, scoped to /jeu/ (the site keeps its own). */
function jeuManifest() {
  return JSON.stringify({
    id: `/${JEU_DIR}/`, name: 'Fontainebleau Live Collection', short_name: 'FL Collection',
    description: 'Le jeu de collection de Fontainebleau : lieux, histoires et événements du jour.',
    lang: 'fr', start_url: `/${JEU_DIR}/`, scope: `/${JEU_DIR}/`, display: 'standalone', orientation: 'portrait',
    theme_color: '#1d3b29', background_color: '#f4f3ef',
    icons: [
      { src: `${ICON_DIR}/Icon-FLC-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${ICON_DIR}/Icon-FLC-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${ICON_DIR}/Icon-FLC-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n';
}
const LEAFLET_CSS = '<link rel="stylesheet" href="/vendor/leaflet-1.9.4/leaflet.css" integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H">';
const LEAFLET_JS = '<script src="/vendor/leaflet-1.9.4/leaflet.js" integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"></script>';

function km(a, b) {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const endOf = (e) => (isDay(e.endDate) ? e.endDate : e.startDate);
const httpUrl = (u) => (/^https?:\/\/[^\s"<>]+$/i.test(String(u || '')) ? String(u) : null);
const sitePath = (p) => (/^\/[a-z0-9\-/]+\/$/i.test(String(p || '')) ? String(p) : '');

/** The events the page embeds: this week's (and the season's), confirmed, within the zone. */
function jeuEvents(events, today, { addDays, spanDays }) {
  const ok = events.filter((e) => e && e.id && e.title && CONFIRMED.has(e.source) && isDay(e.startDate)
    && Number.isFinite(e.lat) && Number.isFinite(e.lng) && km(CENTRE, e) <= ZONE_KM && endOf(e) >= today);
  const slim = (e) => ({ id: e.id, title: e.title, cat: e.category || '', place: e.locationName || e.city || '',
    lat: e.lat, lng: e.lng, start: e.startDate, end: endOf(e), schedule: e.schedule || '', page: sitePath(e.pagePath),
    season: SEASON_RE.test(e.title) });
  const week = ok.filter((e) => e.startDate <= addDays(today, EVENT_DAYS - 1) && spanDays(e) <= 4).map(slim);
  const seen = new Set(week.map((e) => e.id));
  const season = ok.filter((e) => !seen.has(e.id) && SEASON_RE.test(e.title) && e.startDate <= addDays(today, SEASON_DAYS)
    && spanDays(e) <= SEASON_DAYS).map(slim);
  return { week, season };
}

/** The content, as the page needs it: no review state, links checked. */
function jeuContent() {
  const spots = C.SPOTS.map((p) => {
    const o = { id: p.id, name: p.name, set: p.set, type: p.type, rarity: p.rarity, zone: p.zone, lat: p.lat, lng: p.lng, icon: p.icon };
    if (p.text) {
      o.text = { fr: p.text.fr, en: p.text.en };
      o.src = (p.sources || []).map((s) => ({ label: s.label, url: httpUrl(s.url) }));
    }
    if (p.q) o.q = { fr: p.q.fr, en: p.q.en, c: p.q.choices, a: p.q.answer };
    return o;
  });
  // The shop: links checked, the group quests' steps reduced to a distance (they are what is bought).
  const byId = new Map(C.SPOTS.map((p) => [p.id, p]));
  const crow = (ids) => { const pts = ids.map((id) => byId.get(id)).filter(Boolean); let d = 0; for (let i = 1; i < pts.length; i++) d += km(pts[i - 1], pts[i]); return Math.max(1, Math.round(d)); };
  const S = C.SHOP;
  const shop = {
    mecene: { url: httpUrl(S.mecene.url), suggested: S.mecene.suggested },
    email: S.email, groupPrices: S.groupPrices,
    groups: S.groups.map((g) => ({ id: g.id, icon: g.icon, color: g.color, dur: g.dur, name: g.name, pts: g.pts, km: crow(g.steps), n: g.steps.length })),
  };
  return { spots, sets: C.SETS, types: C.TYPES, fils: C.FILS, invaders: C.INVADERS, shop, art: { avatars: AVATAR_ART, frames: FRAME_ART } };
}

// JSON inside <script>: no "</script>" or "<!--" can close or confuse it.
const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function jeuPage({ events, today, helpers, analytics = '', siteUrl = 'https://fontainebleaulive.fr', feedback = '' }) {
  const { week, season } = jeuEvents(events, today, helpers);
  const data = Object.assign(jeuContent(), {
    events: week, season, built: today, icons: ICONS, feedback: httpUrl(feedback), icon192: `${ICON_DIR}/Icon-FLC-192.png`,
    range: { events: EVENT_KM * 1000, season: SEASON_KM * 1000, centre: CENTRE },
  });
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Fontainebleau Live Collection, le jeu de Fontainebleau sur téléphone</title>
<meta name="description" content="Un jeu gratuit sur téléphone : explorez le château, la ville et la forêt de Fontainebleau, collectionnez 40 lieux et leurs histoires, et gagnez des XP aux événements du jour.">
<link rel="canonical" href="${siteUrl}/${JEU_DIR}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fontainebleau Live">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="Fontainebleau Live Collection">
<meta property="og:description" content="Le jeu gratuit de Fontainebleau sur téléphone : 40 lieux à collectionner, leurs histoires, et les événements du jour.">
<meta property="og:url" content="${siteUrl}/${JEU_DIR}/">
<meta property="og:image" content="${siteUrl}${ICON_DIR}/Icon-FLC-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<meta name="theme-color" content="#1d3b29">
<link rel="manifest" href="/${JEU_DIR}/manifest.json">
<link rel="apple-touch-icon" href="${ICON_180}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="FL Collection">
${LEAFLET_CSS}
<style>${STYLE}</style>
</head>
<body>
<div class="app" id="app">
<a class="back" id="back" href="/"><span aria-hidden="true">←</span> <b>Fontainebleau Live</b> <span data-t="backSub"></span></a>
<div class="top"><div class="lvl" id="lvl">1</div><div class="who"><b id="title"></b><div class="bar"><i id="xpbar"></i></div><span class="xp" id="xptxt"></span></div><button type="button" class="mebtn" id="mebtn"><span data-ico="user"></span></button></div>
<section class="screen on" id="s-map"><div id="map"></div>
<button type="button" class="livebar" id="livebar"><span class="dot"></span><span id="livetxt"></span></button>
<button type="button" class="lbtn" id="lbtn" aria-expanded="false"><span data-ico="layers"></span></button>
<button type="button" class="locbtn" id="locbtn"><span data-ico="pin"></span></button>
<div class="lpanel" id="lpanel"><h4 id="h-bases"></h4><div class="lgrid" id="bases"></div><h4 id="h-layers"></h4><div class="lgrid" id="overlays"></div></div>
</section>
<section class="screen" id="s-live"><div class="pad" id="live"></div></section>
<section class="screen" id="s-dex"><div class="pad" id="dex"></div></section>
<section class="screen" id="s-quests"><div class="pad" id="quests"></div></section>
<section class="screen" id="s-me"><div class="pad" id="me"></div></section>
<section class="screen" id="s-shop"><div class="pad" id="shop"></div></section>
<div class="install" id="install" role="dialog" hidden></div>
<div class="sheet" id="sheet" role="dialog"></div>
<div class="onb" id="onb"></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="levelup" id="levelup"><div id="lu-h"></div><div class="n" id="lu-n"></div><div id="lu-t" class="lu-t"></div><p id="lu-p"></p><button type="button" class="btn alt" id="lu-ok"></button></div>
<nav class="tabs" role="tablist">
<button type="button" role="tab" aria-selected="true" data-tab="map"><span data-ico="map"></span><em data-t="tabMap"></em></button>
<button type="button" role="tab" aria-selected="false" data-tab="live"><span data-ico="live"></span><em data-t="tabLive"></em><b class="nb" id="nb"></b></button>
<button type="button" role="tab" aria-selected="false" data-tab="dex"><span data-ico="cards"></span><em data-t="tabDex"></em></button>
<button type="button" role="tab" aria-selected="false" data-tab="quests"><span data-ico="flag"></span><em data-t="tabQuests"></em></button>
<button type="button" role="tab" aria-selected="false" data-tab="shop"><span data-ico="bag"></span><em data-t="tabShop"></em></button>
</nav>
</div>
<noscript><p style="padding:16px">Le jeu a besoin de JavaScript. · The game needs JavaScript.</p></noscript>
${LEAFLET_JS}
<script type="application/json" id="jeu-data">${inline(data)}</script>
<script>
${CLIENT}
</script>
${analytics}</body>
</html>
`;
}

const STYLE = `
:root{--ink:#1d3b29;--accent:#afe14f;--paper:#fff;--bg:#f4f3ef;--line:#e6e2da;--muted:#5b645e;--live:#e0262f;--gold:#e3a51a;
--commun:#8a8f8b;--peu-commun:#2f8f5b;--rare:#2f63b8;--legendaire:#c28a14}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#d9d6cd;font:15px/1.4 "Segoe UI",-apple-system,Roboto,Arial,sans-serif;color:#1f2622}
.app{position:relative;max-width:520px;margin:0 auto;height:100vh;height:100dvh;background:var(--bg);overflow:hidden;display:flex;flex-direction:column}
.back{display:flex;align-items:center;gap:6px;padding:6px 14px 5px;padding-top:max(6px,env(safe-area-inset-top));background:#132a1c;color:#dfe8e1;font-size:12.5px;text-decoration:none;white-space:nowrap;overflow:hidden}.back b{color:#fff}.back:hover b{text-decoration:underline}
.top{display:flex;align-items:center;gap:10px;padding:8px 14px 10px;background:var(--ink);color:#fff}
.lvl{width:38px;height:38px;border-radius:50%;background:var(--accent);color:var(--ink);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
.who{flex:1;min-width:0}.who b{display:block;font-size:14px}.bar{height:7px;background:rgba(255,255,255,.25);border-radius:9px;overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:var(--accent);width:0;transition:width .6s}
.xp{font-size:12px;opacity:.85}
.mebtn{width:38px;height:38px;border-radius:50%;border:0;background:none;padding:0;cursor:pointer;flex:none;display:flex;align-items:center;justify-content:center;color:var(--ink);font-size:18px}
.ico{display:inline-flex;width:1em;height:1em;vertical-align:-.15em}.ico svg{width:100%;height:100%;display:block}
.pin,.evt,.art,.ev-row .ic{color:#fff}.pin .ico{font-size:16px}.evt .ico{font-size:13px}.evt.star .ico{font-size:16px}.art .ico{font-size:64px}.ev-row .ic .ico{font-size:20px}
.lgrid .ico{font-size:20px;display:block;margin:0 auto 2px}.lbtn .ico,.locbtn .ico{font-size:22px;color:var(--ink)}
.pin.inv{width:26px;height:26px;background:#2b2d42;font-size:14px}.pin.inv .ico{font-size:14px}
.screen{flex:1;position:relative;overflow:auto;display:none}.screen.on{display:block}
#map{position:absolute;inset:0;background:#e8e4da;z-index:0}
.leaflet-fog-pane canvas{position:absolute;left:0;top:0;pointer-events:none}
#map.doux .leaflet-tile-pane{filter:saturate(.4) sepia(.25) brightness(1.05)}
#map.nuit .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9)}
.livebar{position:absolute;z-index:500;top:10px;left:10px;right:62px;display:flex;align-items:center;gap:8px;background:#fff;border:0;border-radius:14px;padding:8px 12px;box-shadow:0 1px 6px rgba(0,0,0,.25);font:inherit;font-size:13px;text-align:left;cursor:pointer;color:inherit}
.livebar b{color:var(--live)}.livebar .dot{width:10px;height:10px;border-radius:50%;background:var(--live);flex:none;animation:blink 1.4s infinite}
@keyframes blink{50%{opacity:.3}}
.lbtn,.locbtn{position:absolute;z-index:500;right:10px;width:44px;height:44px;border-radius:12px;border:0;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center}
.lbtn{top:10px}.locbtn{bottom:16px}.locbtn.on .ico{color:#2f7cf6}
.lpanel{position:absolute;z-index:950;top:60px;right:10px;left:10px;background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.3);padding:12px 14px;display:none}
.lpanel.on{display:block}.lpanel h4{margin:4px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.lgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.lgrid button{font:inherit;font-size:12px;border:2px solid transparent;background:#f3f4f1;border-radius:12px;padding:8px 4px;cursor:pointer;color:var(--ink)}
.lgrid button[aria-pressed="true"]{border-color:var(--ink);background:#eef7dc;font-weight:700}
.lgrid .thumb{height:34px;border-radius:8px;margin-bottom:4px}
#map .leaflet-control-attribution{font-size:9px;line-height:1.3;padding:0 4px;background:rgba(255,255,255,.55);color:#6b716d}
#map .leaflet-control-attribution a{color:#6b716d}
.tabs{display:flex;background:#fff;border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
.tabs button{flex:1;font:inherit;font-size:12px;border:0;background:none;padding:8px 0 10px;color:var(--muted);cursor:pointer;position:relative}
.tabs button em{font-style:normal}
.tabs button span{display:flex;justify-content:center;font-size:22px;margin-bottom:2px}.tabs button[aria-selected="true"]{color:var(--ink);font-weight:700}
.tabs .nb{position:absolute;top:4px;left:56%;background:var(--live);color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:0 5px}.tabs .nb:empty{display:none}
.pin{width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.4);position:relative}
.pin.locked{filter:grayscale(1);opacity:.8}
.pin.got::after{content:"✓";position:absolute;right:-6px;top:-6px;width:16px;height:16px;border-radius:50%;background:var(--accent);color:var(--ink);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
.qnum{width:20px;height:20px;border-radius:50%;background:var(--gold);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.evt{position:relative;width:24px;height:24px;border-radius:7px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.3);opacity:.9}
.evt i{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-style:normal;font-size:10px;font-weight:800;background:#fff;color:var(--ink);border-radius:6px;padding:0 4px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.evt.live{opacity:1;box-shadow:0 0 0 0 rgba(175,225,79,.8);animation:pulse 2.6s infinite}
.evt.live i{background:var(--live);color:#fff}
.evt.star{width:30px;height:30px;font-size:15px;border:2px solid var(--gold);opacity:1}
.evt.star::before{content:"★";position:absolute;top:-10px;right:-10px;font-size:15px;color:var(--gold);text-shadow:0 0 2px #fff,0 0 2px #fff}
.evt.got{filter:grayscale(.7);opacity:.7}
.evt.season{border-color:#1d7a43}
@keyframes pulse{70%{box-shadow:0 0 0 9px rgba(175,225,79,0)}100%{box-shadow:0 0 0 0 rgba(175,225,79,0)}}
@media (prefers-reduced-motion:reduce){.evt.live,.livebar .dot{animation:none}}
.me{width:18px;height:18px;border-radius:50%;background:#2f7cf6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(47,124,246,.25)}
.sheet{position:absolute;z-index:900;left:0;right:0;bottom:0;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.25);transform:translateY(105%);transition:transform .3s;max-height:88%;overflow:auto}
.sheet.on{transform:none}
.art{height:130px;display:flex;align-items:center;justify-content:center;position:relative}
.art .r{position:absolute;left:12px;top:12px;font-size:12px;font-weight:700;color:#fff;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.art .x{position:absolute;right:10px;top:8px;font-size:24px;background:rgba(255,255,255,.85);border:0;border-radius:50%;width:34px;height:34px;cursor:pointer;line-height:1;color:var(--ink)}
.body{padding:14px 16px 24px;position:relative}
.body h2{margin:0;font-size:20px;color:var(--ink);padding-right:30px}
.meta{color:var(--muted);font-size:13px;margin:2px 0 10px}
.note{background:#f3f6ee;border-left:3px solid var(--peu-commun);border-radius:6px;padding:8px 10px;font-size:13px;margin:8px 0}
.acts{display:grid;gap:8px;margin-top:12px}
.btn{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px;cursor:pointer;background:var(--ink);color:#fff;text-align:center;text-decoration:none}
.btn.alt{background:#fff;color:var(--ink);border:1.5px solid var(--ink)}
.btn.soft{background:#eef0ec;color:var(--ink)}
.btn.live{background:var(--live)}
.btn:disabled{opacity:.45;cursor:default}
.got-banner{background:var(--accent);color:var(--ink);font-weight:700;border-radius:10px;padding:8px 12px;margin-top:10px}
.xpchip{display:inline-block;font-size:12px;font-weight:800;background:var(--accent);color:var(--ink);border-radius:999px;padding:2px 8px;white-space:nowrap}
.xpchip.gold{background:var(--gold);color:#fff}
.livechip{display:inline-block;font-size:11px;font-weight:800;background:var(--live);color:#fff;border-radius:999px;padding:2px 8px;text-transform:uppercase}.livechip.gold{background:#b8860b}
.q{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}.q .qtext{flex-basis:100%;margin:0 0 2px;font-weight:600}.q .btn{flex:1 1 30%}.q .btn[disabled]{opacity:.45}.q .btn.right{background:#e3f1e8;border-color:#3d8b5a;color:#1f5f38;font-weight:600;opacity:1}.q .btn.wrong{background:#fbe9e7;border-color:#c0392b;color:#a02a1e;opacity:1}.qmsg{flex-basis:100%;margin:4px 0 0;font-weight:700;font-size:15px}.qmsg:empty{display:none}.qmsg.ok{color:#1f7a3f}.qmsg.ko{color:#b3261e}.qlead{margin:10px 0 0;font-size:14px;color:#5b625d}
.src{font-size:12px;color:var(--muted);font-style:italic;margin:-4px 0 8px}.src a{color:var(--muted)}
.sheet-link{font-size:13px}.sheet-link a{color:var(--ink)}
.pad{padding:14px 14px 28px}
.pad h2{font-size:18px;color:var(--ink);margin:6px 0 10px}
.set{background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;border:1px solid var(--line)}
.set h3{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between;gap:8px}
.prog{height:6px;background:#e9ece6;border-radius:9px;overflow:hidden;margin-bottom:6px}.prog i{display:block;height:100%;background:var(--peu-commun)}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 6px}
.mtile{min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:0;padding:0;font:inherit;cursor:pointer;color:inherit}
.mtile .medal{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;border:3px solid currentColor;box-shadow:0 0 0 3px #fff,0 0 0 5px var(--ring,transparent),0 2px 6px rgba(0,0,0,.18);position:relative}
.mtile .medal::after{content:'';position:absolute;inset:4px;border-radius:50%;border:1px dashed currentColor;opacity:.35}
.mtile small{font-size:10.5px;line-height:1.15;text-align:center;font-weight:600;color:var(--ink);max-width:100%;overflow-wrap:anywhere;hyphens:auto;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mtile.locked .medal{background:#f1efea!important;color:#a3a7a2!important;border-style:dashed;box-shadow:none}.mtile.locked .medal .ico{opacity:.5}.mtile.locked .medal::after{display:none}.mtile.locked small{color:#7b807b;font-weight:500}
.mtile.dark .medal{background:#2b2d42!important;color:#fff!important;border-color:#8b8fb0}
.pmedal .pring{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center}.pmedal .medal{width:58px;height:58px;box-shadow:0 0 0 2px #fff}.pmedal .medal::after{display:none}.pmedal.locked .medal{border-style:solid;border-color:#d6d2ca}
.target{font-size:11px;font-weight:700;color:var(--muted);background:#eceae4;border-radius:999px;padding:1px 8px}.target.done{background:#e3f1e8;color:#1f7a3f}
.titles{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.trow{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 10px}.tcirc{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;background:#eceae4;color:#8a8f8b;flex:none}.trow.on .tcirc{background:#2e7d4f;color:#fff}.ttx b{display:block;font-size:14px;color:var(--ink)}.ttx small{font-size:12px;color:var(--muted)}.trow:not(.on) .ttx b{color:#7b807b}
.ev-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;background:#fff;border:0;border-bottom:1px solid var(--line);padding:10px 2px;cursor:pointer;color:inherit}
.ev-row .ic{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none}
.ev-row .tx{flex:1;min-width:0}.ev-row .tx b{display:block;font-size:14px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ev-row .tx span{font-size:12px;color:var(--muted)}
.day{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 2px}
.quest{background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;border:1px solid var(--line);display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:12px;align-items:start}
.quest b{color:var(--ink)}.quest p{margin:4px 0 8px;font-size:13px;color:var(--muted)}
.qmedal{width:44px;height:44px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;font-size:22px}.qbody{min-width:0}.qextra{grid-column:1 / -1;margin-top:6px}
.fsteps{display:flex;flex-direction:column;gap:6px}.fstep{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;background:#f7f6f2;border:1px solid var(--line);border-radius:10px;padding:6px 8px;cursor:pointer;color:inherit}.fdot{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;background:#eceae4;color:#8a8f8b;flex:none}.fstep.half .fdot{background:#fff4d6;color:#9a6b00}.fstep.done .fdot{background:#2e7d4f;color:#fff}.ftx{min-width:0}.ftx b{display:block;font-size:13px;color:var(--ink)}.ftx small{font-size:11.5px;color:var(--muted)}
.quest.plain{display:block}.quest.hot{border:2px solid #d4a72c;background:#fffaf0}.btn.gold{display:block;margin:4px auto 0;background:#fff;color:#7a5a00;border:1.5px solid #d4a72c}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef0ec;color:var(--ink);margin-right:4px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.stat{background:#fff;border-radius:12px;padding:10px;text-align:center;border:1px solid var(--line)}.stat b{display:block;font-size:20px;color:var(--ink)}
.row2{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.row2 .btn{flex:1}
.code{width:100%;font:13px/1.3 ui-monospace,Consolas,monospace;padding:8px;border:1px solid var(--line);border-radius:10px;margin-top:8px;resize:vertical;min-height:64px}
.foot-links{font-size:12px;color:var(--muted);margin-top:18px}.foot-links a{color:var(--muted)}
.langsw{display:inline-flex;border:1.5px solid var(--ink);border-radius:999px;overflow:hidden}.langsw button{font:inherit;font-size:13px;font-weight:700;padding:4px 12px;border:0;background:#fff;color:var(--ink);cursor:pointer}.langsw button[aria-pressed="true"]{background:var(--ink);color:#fff}
.install{position:absolute;z-index:880;left:10px;right:10px;bottom:10px;background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.3);padding:12px;display:grid;grid-template-columns:48px minmax(0,1fr);gap:4px 12px;align-items:center}
.install[hidden]{display:none}.install img{width:48px;height:48px;border-radius:12px;grid-row:span 2}.install b{color:var(--ink);font-size:15px}.install small{color:var(--muted);font-size:12.5px}
.install .row2{grid-column:1 / -1;margin-top:6px}.install .ios{grid-column:1 / -1;margin:6px 0 0;font-size:14px;background:#f3f6ee;border-radius:10px;padding:8px 10px}.install .ios .ico{font-size:18px;color:#2f7cf6;vertical-align:-.25em}
.mehead{display:flex;align-items:center;gap:16px;margin:4px 0 12px}.mehead h2{margin:0 0 4px}.tag.mec{background:#f6e6ea;color:#8f4a58}
.av{position:relative;width:42px;height:42px;display:inline-flex;flex:none;font-size:22px;margin:7px}.av.big{width:76px;height:76px;font-size:40px;margin:14px}.av.top{width:36px;height:36px;font-size:19px;margin:0}.av-in{position:absolute;inset:0;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#eef0ec;color:var(--ink)}.av-in svg{width:100%;height:100%;display:block}.av-fr{position:absolute;inset:-22%;pointer-events:none}.av-fr svg{width:100%;height:100%;display:block;overflow:visible}
.av.fr-simple .av-in{box-shadow:0 0 0 2px #fff,0 0 0 4px #1f2622}
.pick{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px 4px;margin:6px 0 10px}.pick button{background:none;border:0;padding:8px 0 4px;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;position:relative;border-radius:12px}.pick button small{font-size:10.5px;color:var(--ink)}.pick button[aria-pressed=true]{background:#fff4d6}.pick button[aria-pressed=true] small{font-weight:800}.pick button.locked .av{opacity:.5}.pick .lk{position:absolute;top:2px;right:6px;width:18px;height:18px;border-radius:50%;background:#fff;color:#7b807b;font-size:11px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.btn.wide{display:block;width:100%;margin-top:8px}.linkbtn{display:block;margin:8px auto 0;background:none;border:0;font:inherit;font-size:13px;color:var(--muted,#5b625d);text-decoration:underline;cursor:pointer}
.sblock{background:#fff;border:1px solid var(--line);border-radius:14px;margin-bottom:10px;overflow:hidden}.shead{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:12px;font:inherit;color:inherit;text-align:left;cursor:pointer}.stx{flex:1;min-width:0}.stx b{display:block;font-size:15.5px}.stx small{display:block;font-size:12.5px;color:var(--muted,#5b625d)}.chip{flex:none;font-weight:800;font-size:13px;background:#fff4d6;color:#7a5a00;border-radius:999px;padding:3px 10px}.chev{flex:none;font-size:20px;color:#7b807b;transition:transform .2s;display:flex}.sblock.open .chev{transform:rotate(180deg)}.sbody{padding:0 12px 12px;border-top:1px solid var(--line)}.sbody>.sh4:first-child,.sbody>.strip:first-child,.sbody>.lead2:first-child,.sbody>.meta:first-child{margin-top:12px}.qmedal.sm{width:34px;height:34px;font-size:18px;flex:none}.soon{margin-left:auto;font-size:11px;font-weight:700;background:#eceae4;color:#5b625d;border-radius:999px;padding:2px 8px}.lead2{margin:0 0 10px;font-size:13.5px;color:var(--muted,#5b625d)}.sh4{margin:10px 0 6px;font-size:13px}
.gq{display:grid;grid-template-columns:40px minmax(0,1fr);gap:10px;width:100%;text-align:left;font:inherit;background:#f7f6f2;border:1.5px solid var(--line);border-radius:12px;padding:10px;margin-bottom:8px;cursor:pointer;color:inherit}.gq .qmedal{width:40px;height:40px;font-size:20px}.gq[aria-pressed=true]{background:#fff;border-color:#1f2622}.gqb{min-width:0}.gqb b{display:block;font-size:14px}.gqb small{display:block;font-size:12px;color:var(--muted,#5b625d)}.gpt{display:block;font-size:12.5px;color:var(--ink);padding-left:12px;position:relative;margin-top:2px}.gpt::before{content:'•';position:absolute;left:2px}
.tiers{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tier{font:inherit;background:#fff;border:1.5px solid #1f2622;border-radius:12px;padding:10px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--ink)}.tier small{font-size:12px;color:var(--muted,#5b625d)}.tier b{font-size:20px}.smedal{width:48px;height:48px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:24px;color:#b8707d;background:color-mix(in srgb,#b8707d 14%,#fff);border:2.5px solid #b8707d}.smedal.off{color:#a3a7a2;background:#f1efea;border:2.5px dashed #c9c5bc}.srow{display:flex;align-items:center;gap:14px}.srow p{margin:0;font-size:13.5px}.okline{color:#1f7a3f;font-weight:700;margin:10px 0 0}
.strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px 2px;margin:8px 0 6px}.strip .av{width:38px;height:38px;font-size:20px;margin:0}.strip small{white-space:nowrap}.fw{display:flex;flex-direction:column;align-items:center;gap:6px}.fw small{font-size:10.5px}
.thanks{background:#fffaf0;border:2px solid #d4a72c;border-radius:14px;padding:12px;margin-bottom:12px}.thanks b{color:var(--ink)}.thanks code{display:inline-block;font:700 15px ui-monospace,Consolas,monospace;background:#fff;border:1px dashed #b9b3a6;border-radius:8px;padding:4px 8px;margin:4px 0;user-select:all}.small{font-size:12px;color:var(--muted);text-align:center;margin:6px 0 0}.small a{color:var(--muted)}.codein{display:flex;gap:6px;margin-top:6px}.codein input{flex:1;min-width:0;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;text-transform:uppercase}
.toast{position:absolute;z-index:1200;left:50%;top:70px;transform:translate(-50%,-20px);background:var(--ink);color:#fff;padding:10px 16px;border-radius:14px;font-weight:700;opacity:0;transition:.3s;pointer-events:none;width:max-content;max-width:calc(100% - 32px);text-align:center;line-height:1.35;white-space:pre-line}
.toast.on{opacity:1;transform:translate(-50%,0)}
.levelup{position:absolute;inset:0;z-index:1100;background:rgba(29,59,41,.92);color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
.levelup.on{display:flex}.levelup .n{font-size:72px;font-weight:900;color:var(--accent)}.lu-t{font-size:20px;font-weight:700}
.onb{position:absolute;inset:0;z-index:1150;background:var(--bg);display:none;flex-direction:column}
.onb.on{display:flex}
.onb .dots{display:flex;gap:6px;justify-content:center;padding:14px 0 0}.onb .dots i{width:7px;height:7px;border-radius:50%;background:#cfd3cc}.onb .dots i.on{background:var(--ink);width:20px;border-radius:9px}
.onb .skip{position:absolute;right:14px;top:8px;font:inherit;font-size:13px;border:0;background:none;color:var(--muted);cursor:pointer}
.onb .in{flex:1;overflow:auto;padding:18px 22px 10px;display:flex;flex-direction:column}
.onb h1{font-size:26px;color:var(--ink);margin:10px 0 6px;line-height:1.15}.onb .lead{color:var(--muted);margin:0 0 16px}
.onb .hero{height:200px;border-radius:22px;background:linear-gradient(160deg,#1d3b29,#2f6b44 60%,#afe14f);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:56px;margin-top:8px}
.onb .hero b{font-size:28px;letter-spacing:.02em;margin-top:6px;text-align:center;line-height:1.15;padding:0 16px}.onb .hero small{font-size:14px;opacity:.9}
.onb .feat{display:flex;gap:12px;align-items:center;margin:8px 0}.onb .feat span{font-size:22px;width:40px;height:40px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none;border:1px solid var(--line);color:var(--ink)}
.choice{display:flex;gap:12px;align-items:center;width:100%;text-align:left;font:inherit;background:#fff;border:2px solid var(--line);border-radius:14px;padding:12px;margin-bottom:8px;cursor:pointer;color:inherit}
.choice span{font-size:26px}.choice b{display:block;color:var(--ink)}.choice small{color:var(--muted)}
.choice[aria-pressed="true"]{border-color:var(--ink);background:#eef7dc}
.onb .foot{padding:10px 22px 22px;display:grid;gap:8px}.onb .foot .why{margin:0 0 4px;text-align:center}
`;

// The page's own script (ES5, no dependency but Leaflet). Every text from the data goes through
// textContent; innerHTML only receives the fixed icon markup of live-collection-icons.js.
const CLIENT = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('jeu-data').textContent);
  var ICON_192 = D.icon192;
  // Home-screen install state (used by the profile from the first render)
  var IKEY = 'fl-collection-install', deferred = null, instShown = false;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var SPOTS = D.spots, SETS = D.sets, TYPES = D.types, FILS = D.fils, INVADERS = D.invaders, ICONS = D.icons, RANGE = D.range;

  // ── Language: the site's choice (localStorage 'lang', ?lang=en) ──
  var LANG = 'fr';
  try { LANG = (new URLSearchParams(location.search).get('lang') || localStorage.getItem('lang')) === 'en' ? 'en' : 'fr'; } catch (e) {}
  var S = {
    backSub: [': l’agenda des sorties', ': what’s on'], siteWeek: ['Toutes les sorties du week-end sur Fontainebleau Live →', 'Every outing this weekend on Fontainebleau Live →'],
    tabShop: ['Boutique', 'Shop'], soon: ['Bientôt', 'Soon'],
    packHave: ['✓ Pack débloqué : choisissez dans votre profil', '✓ Pack unlocked: choose in your profile'], toProfile: ['Choisir mon avatar', 'Choose my avatar'],
    packFree: ['Débloquer le pack sans payer', 'Unlock the pack without paying'], packFreeOk: ['Pack débloqué. Bonne collection !', 'Pack unlocked. Happy collecting!'],
    stripe: ['Paiement sécurisé par Stripe', 'Secure payment by Stripe'],
    grpT: ['Jouer en groupe', 'Play as a group'], grpSub: ['Une quête pour votre groupe, en équipes, avec classement en direct et récapitulatif', 'A quest for your group, in teams, with a live leaderboard and a recap'], grpFrom: ['dès {0} €', 'from €{0}'],
    grp1: ['1. Choisissez votre quête', '1. Choose your quest'], grp2: ['2. Une sortie « {0} »', '2. One outing: “{0}”'], grpUpTo: ['jusqu’à {0} joueurs', 'up to {0} players'],
    grpMore: ['Au-delà de 30 joueurs, ou pour une date : écrivez-nous.', 'Over 30 players, or to book a date: write to us.'], grpContact: ['Réserver par e-mail', 'Book by e-mail'],
    grpMailS: ['Session de groupe — Fontainebleau Live Collection', 'Group session — Fontainebleau Live Collection'], grpMailB: ['Quête : {0}\nDate souhaitée :\nNombre de joueurs :\n', 'Quest: {0}\nPreferred date:\nNumber of players:\n'],
    mecT: ['Soutenir le jeu', 'Support the game'], mecSub: ['Pour ajouter des lieux et leurs histoires. En remerciement : le badge Mécène et ce pack de 6 avatars et 4 cadres', 'To add more places and their stories. As a thank-you: the Patron badge and this pack of 6 avatars and 4 frames'], mecChip: ['{0} € conseillés', '€{0} suggested'],
    mecBuy: ['Soutenir · {0} € conseillés', 'Support · €{0} suggested'], mecHave: ['✓ Vous êtes Mécène. Merci !', '✓ You are a Patron. Thank you!'],
    codeQ: ['J’ai un code d’achat', 'I have a purchase code'], codeOk: ['Valider', 'Apply'], codeBad: ['Ce code n’est pas reconnu.', 'This code is not recognised.'],
    thxPack: ['Le pack collectionneur est débloqué.', 'The collector pack is unlocked.'], thxMec: ['Merci pour votre soutien ! Le badge Mécène et le pack collectionneur sont sur votre profil.', 'Thank you for your support! The Patron badge and the collector pack are on your profile.'],
    thxCode: ['Pour l’autre téléphone ou le jeu installé, gardez ce code :', 'For another phone or the installed game, keep this code:'],
    mecene: ['Mécène', 'Patron'], avatarH: ['Mon avatar', 'My avatar'], frameH: ['Cadre', 'Frame'], morePack: ['Plus d’avatars et de cadres : le pack collectionneur', 'More avatars and frames: the collector pack'],
    tabMap: ['Carte', 'Map'], tabLive: ['En direct', 'Live'], tabDex: ['Collection', 'Collection'], tabQuests: ['Quêtes', 'Quests'],
    profile: ['Profil', 'Profile'], layers: ['Couches', 'Layers'], locate: ['Ma position', 'My location'], close: ['Fermer', 'Close'],
    bases: ['Type de carte', 'Map style'], overlays: ['Couches', 'Layers'],
    bPlan: ['Plan', 'Map'], bDoux: ['Doux', 'Soft'], bNuit: ['Nuit', 'Night'],
    lSpots: ['Lieux', 'Places'], lEvents: ['En direct', 'Live'], lInv: ['Invaders', 'Invaders'], lQuests: ['Quêtes', 'Quests'], lClimb: ['Grimpe', 'Climbing'], lSeason: ['Saison', 'Season'], lFog: ['Brouillard', 'Fog'],
    level: ['Niveau', 'Level'], maxLevel: ['{0} XP · niveau maximum', '{0} XP · top level'], nextLevel: ['{0} XP · niveau {1} à {2}', '{0} XP · level {1} at {2}'],
    newTitle: ['Nouveau titre débloqué', 'New title unlocked'], nextTitle: ['Prochain titre au niveau {0} : {1}', 'Next title at level {0}: {1}'], cont: ['Continuer', 'Continue'],
    liveBar: [' aujourd’hui · {0} cette semaine · jusqu’à +{1} XP', ' today · {0} this week · up to +{1} XP'], liveN: ['{0} en direct', '{0} live'],
    rarity: { 'commun': ['commun', 'common'], 'peu commun': ['peu commun', 'uncommon'], 'rare': ['rare', 'rare'], 'légendaire': ['légendaire', 'legendary'] },
    away: [' · à {0}', ' · {0} away'],
    climbNote: ['En famille : on vient voir, on essaie les premiers blocs du circuit le plus facile, à son niveau. Crash-pad, parade, jamais sur rocher mouillé.', 'For families: come and look, try the first problems of the easiest circuit, at your own level. Crash pad, spotting, never on wet rock.'],
    boolder: ['Le topo sur Boolder', 'The topo on Boolder'],
    gotHow: { gps: ['✓ Dans votre collection — sur place (GPS)', '✓ In your collection — on the spot (GPS)'], question: ['✓ Dans votre collection — par la question', '✓ In your collection — by the question'], honneur: ['✓ Dans votre collection — sur l’honneur', '✓ In your collection — on your honour'] },
    goThere: ['Rendez-vous sur place pour collecter ce lieu et lire son histoire.', 'Go there to collect this place and read its story.'],
    imHere: ['📍 Je suis ici (GPS, {0} m)', '📍 I’m here (GPS, {0} m)'], noGps: ['Pas de GPS ? Répondez à la question :', 'No GPS? Answer the question:'],
    source: ['Source : ', 'Source: '], right: ['Bonne réponse !', 'Right answer!'], wrong: ['Pas tout à fait : regardez encore autour de vous.', 'Not quite: look around you again.'],
    goodEye: ['bonne observation', 'sharp eye'], firstStep: ['premier pas', 'first step'],
    locating: ['Recherche de votre position…', 'Finding your location…'], tooFar: ['Vous êtes à {0}. Approchez-vous (moins de {1} m).', 'You are {0} away. Get closer (under {1} m).'],
    noGeo: ['Position indisponible. Autorisez-la dans le navigateur, ou répondez à la question.', 'Location unavailable. Allow it in your browser, or answer the question.'],
    evStar: ['★ événement du jour', '★ event of the day'], evLive: ['en direct', 'live'],
    evStarTxt: ['  Événement du jour : XP doublée.', '  Event of the day: double XP.'], evSeasonTxt: ['  Bonus de saison compris.', '  Seasonal bonus included.'], evCardTxt: ['  Une carte souvenir datée.', '  A dated keepsake card.'],
    noTicket: ['Passer le jour J suffit : on n’exige jamais un billet.', 'Passing by on the day is enough: a ticket is never required.'],
    evGot: ['✓ Carte souvenir obtenue le {0}', '✓ Keepsake card won on {0}'], evGo: ['📍 J’y suis (GPS, {0} m)', '📍 I’m here (GPS, {0} m)'],
    evHonour: ['🤝 Sur l’honneur ({0} XP)', '🤝 On my honour ({0} XP)'], plan: ['🔔 J’y vais', '🔔 I’m going'], planned: ['🔔 Prévu', '🔔 Planned'],
    evLater: ['La carte souvenir se gagne le jour même : {0}.', 'The keepsake card is won on the day: {0}.'], evPage: ['La fiche sur Fontainebleau Live', 'The listing on Fontainebleau Live'],
    keepsake: ['carte souvenir', 'keepsake card'], today: ['Aujourd’hui', 'Today'],
    liveH: ['En direct aujourd’hui et demain', 'Live today and tomorrow'],
    liveLead: ['Les sorties de l’agenda deviennent des étapes le jour J : passez-y, gagnez une carte souvenir et de l’XP.', 'Outings from the agenda become stops on the day: drop by, win a keepsake card and XP.'],
    starH: ['★ Événement du jour', '★ Event of the day'], starTxt: ['XP doublée aujourd’hui, pour tout le monde.', 'Double XP today, for everyone.'],
    later: ['Plus tard : {0} sorties cette semaine, sur la carte.', 'Later: {0} outings this week, on the map.'], laterSeason: [' Et {0} rendez-vous de saison (couche Saison).', ' And {0} seasonal events (Season layer).'],
    noLive: ['Rien aujourd’hui ni demain à moins de 12 km.', 'Nothing today or tomorrow within 12 km.'],
    dexH: ['Collection · {0} / {1} lieux', 'Collection · {0} / {1} places'], souvenirs: ['★ Cartes souvenirs', '★ Keepsake cards'],
    noSouvenir: ['Allez à une sortie de l’agenda, le jour même : vous gagnez sa carte souvenir, avec la date.', 'Go to an outing from the agenda, on the day: you win its keepsake card, with the date.'],
    invH: ['Les Space Invaders', 'The Space Invaders'], invLead: ['{0} mosaïques d’Invader dans les rues de Fontainebleau. La carte montre la rue, pas le mur : à vous de lever les yeux.', '{0} Invader mosaics in the streets of Fontainebleau. The map shows the street, not the wall: look up.'],
    invOne: ['Une mosaïque d’Invader', 'An Invader mosaic'], invWhere: ['Quelque part {0}, en hauteur. Trouvez-la pour découvrir son nom.', 'Somewhere {0}, up high. Find it to learn its name.'],
    invGotGps: ['✓ Dans votre collection — trouvée sur place (GPS)', '✓ In your collection — found on the spot (GPS)'], invGotHon: ['✓ Dans votre collection — sur l’honneur', '✓ In your collection — on your honour'],
    invFound: ['Je l’ai trouvée (GPS, {0} m)', 'I found it (GPS, {0} m)'], invSeen: ['Je l’ai vue (sur l’honneur, +{0} XP)', 'I saw it (on my honour, +{0} XP)'], invXp: ['mosaïque trouvée', 'mosaic found'],
    week: ['Cette semaine', 'This week'], always: ['Toujours là', 'All year'], seasonal: ['De saison', 'Seasonal'],
    qStar: ['L’événement du jour', 'The event of the day'], qStarTags: ['+{0} XP', 'Change chaque jour', '+{0} XP', 'Changes daily'], qStarNone: ['Pas d’événement aujourd’hui à moins de 12 km.', 'No event today within 12 km.'], qStarBtn: ['Voir l’événement du jour', 'See the event of the day'],
    qWeek: ['La quête de la semaine', 'The quest of the week'], qWeekTxt: ['Passez à deux sorties de l’agenda d’ici dimanche ({0} sur la carte).', 'Drop by two outings from the agenda by Sunday ({0} on the map).'], qWeekXp: ['quête de la semaine', 'quest of the week'],
    qCats: ['Quatre genres de sorties', 'Four kinds of outings'], qCatsTxt: ['Une sortie de chaque genre : un spectacle, un atelier ou une expo, une sortie nature, une activité sportive.', 'One outing of each kind: a show, a workshop or exhibition, a nature outing, a sport.'], qCatsXp: ['quatre genres de sorties', 'four kinds of outings'],
    qFils: ['Les fils de l’histoire', 'The threads of history'], qFilsTxt: ['Cinq fils, dans l’ordre de l’histoire. Collectez leurs lieux et répondez à leur question, dans l’ordre que vous voulez.', 'Five threads, in the order of history. Collect their places and answer their question, in any order.'],
    filsDone: ['{0} / {1} fils complets', '{0} / {1} threads complete'], steps: ['{0} étapes', '{0} stops'],
    stDone: ['collecté, question résolue', 'collected, question answered'], stHalf: ['collecté : reste la question', 'collected: the question is left'], stQ: ['à collecter, avec sa question', 'to collect, with its question'], stTodo: ['à collecter', 'to collect'],
    filXp: ['fil complet : {0}', 'thread complete: {0}'], setXp: ['série complète : {0}', 'set complete: {0}'],
    qSport: ['Trois sorties sportives', 'Three sport outings'], qSportTxt: ['Une course, un trail, une sortie VTT… Trois événements sportifs de l’agenda, le jour J.', 'A run, a trail race, a mountain-bike ride… Three sport events from the agenda, on the day.'], qSportXp: ['trois sorties sportives', 'three sport outings'], bSport: ['Sportif', 'Sporty'],
    qClimb: ['5 Must Climb, en famille', '5 Must Climb, for families'], qClimbTxt: ['Cinq sites de bloc à découvrir en famille, à son niveau.', 'Five bouldering sites to discover as a family, at your own level.'],
    qInv: ['La chasse aux Invaders', 'The Invader hunt'],
    qXmas: ['Les rendez-vous de Noël', 'Christmas outings'], qXmasTxt: ['Deux marchés ou rendez-vous de Noël ({0} sur la carte, couche Saison).', 'Two Christmas markets or events ({0} on the map, Season layer).'],
    qAdvent: ['Le calendrier de l’Avent', 'The Advent calendar'], qAdventTxt: ['Une case par jour sur Fontainebleau Live, jusqu’à Noël.', 'One door a day on Fontainebleau Live, until Christmas.'], qAdventBtn: ['Ouvrir le calendrier', 'Open the calendar'],
    qEco: ['Éco-geste', 'Eco-gesture'], qEcoTxt: ['Ramasser un déchet en forêt et le rapporter.', 'Pick up a piece of litter in the forest and take it home.'], qEcoBtn: ['J’ai ramassé un déchet', 'I picked up some litter'], qEcoDone: ['✓ Fait', '✓ Done'], ecoXp: ['éco-geste', 'eco-gesture'],
    honour: ['Sur l’honneur', 'On your honour'],
    meStats: [['lieux', 'places'], ['souvenirs', 'keepsakes'], ['XP', 'XP']], badges: ['Badges', 'Badges'], titles: ['Titres', 'Titles'], levelN: ['niveau {0}', 'level {0}'], got: ['✓ obtenu', '✓ earned'],
    bNap: ['Napoléon', 'Napoleon'], bBlue: ['Sentiers bleus', 'Blue trails'], bPaint: ['Peintres', 'Painters'], bFirst: ['1er souvenir', '1st keepsake'], bCats: ['4 genres', '4 kinds'], bEco: ['Éco-geste', 'Eco-gesture'], bClimb: ['5 Must Climb', '5 Must Climb'], bXmas: ['Noël', 'Christmas'], bInv: ['Invaders', 'Invaders'],
    instH: ['Le jeu sur votre écran d’accueil', 'The game on your home screen'], instSub: ['En plein écran, à un geste, même sans réseau.', 'Full screen, one tap away, even offline.'],
    instAdd: ['Ajouter', 'Add'], instLater: ['Plus tard', 'Later'], instIos1: ['Touchez ', 'Tap '], instIos2: [' Partager, puis « Sur l’écran d’accueil ».', ' Share, then “Add to Home Screen”.'],
    instMenu: ['Ouvrez le menu ⋮ du navigateur, puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».', 'Open the browser menu ⋮, then “Install app” or “Add to Home screen”.'],
    sportLead: ['Trois événements sportifs de l’agenda, le jour J : course, trail, VTT…', 'Three sport events from the agenda, on the day: a run, a trail race, mountain biking…'], sportGot: ['✓ Badge Sportif obtenu', '✓ Sporty badge earned'],
    instMe: ['Sur l’écran d’accueil', 'On your home screen'], instMeBtn: ['Ajouter le jeu à mon écran d’accueil', 'Add the game to my home screen'],
    lang: ['Langue', 'Language'], saveH: ['Ma sauvegarde', 'My save'],
    saveLead: ['Sans compte : tout reste sur ce téléphone, votre position aussi. Pour changer de téléphone, copiez votre code et collez-le sur le nouveau.', 'No account: everything stays on this phone, your location too. To switch phones, copy your code and paste it on the new one.'],
    copy: ['Copier mon code', 'Copy my code'], copied: ['Code copié', 'Code copied'], paste: ['Coller un code', 'Paste a code'], load: ['Reprendre cette partie', 'Load this game'],
    badCode: ['Ce code n’est pas reconnu.', 'This code is not recognised.'], loaded: ['Partie reprise', 'Game loaded'], replace: ['Remplacer la partie de ce téléphone par celle du code ?', 'Replace this phone’s game with the one in the code?'],
    reset: ['Tout effacer', 'Erase everything'], resetAsk: ['Effacer toute votre progression sur ce téléphone ?', 'Erase all your progress on this phone?'],
    testNote: ['Version bêta : les questions sont en cours de vérification sur place.', 'Beta version: the questions are being checked on site.'], report: ['Signaler une erreur', 'Report a mistake'],
    home: ['Fontainebleau Live', 'Fontainebleau Live'], legal: ['Mentions légales', 'Legal notice'],
    onbTag: ['Fontainebleau se collectionne', 'Collect Fontainebleau'], onbF1: ['Explorez le château, la ville et la forêt', 'Explore the château, the town and the forest'], onbF2: ['Collectionnez les lieux et leurs histoires', 'Collect places and their stories'], onbF3: ['Vivez les événements du jour : ils rapportent le plus', 'Live the events of the day: they earn the most'],
    free: ['Gratuit.', 'Free.'], start: ['Commencer', 'Start'], skip: ['Passer', 'Skip'], youCome: ['Vous venez…', 'You are here…'],
    why: ['Votre réponse sert seulement à choisir votre première quête. Tout le jeu reste ouvert.', 'Your answer only helps pick your first quest. The whole game stays open.'],
    geoH: ['Votre position reste sur ce téléphone', 'Your location stays on this phone'], geoLead: ['Elle sert seulement à vérifier que vous êtes devant un lieu. Elle n’est jamais envoyée ni enregistrée ailleurs.', 'It is only used to check that you are at a place. It is never sent or stored anywhere else.'],
    geoNo: ['Sans elle, on joue quand même : une question d’observation sur place.', 'Without it, you can still play: an observation question on the spot.'], geoYes: ['Autoriser la position', 'Allow location'], geoLater: ['Plus tard', 'Later'],
    touch: ['Touchez un lieu près de vous pour commencer', 'Tap a place near you to begin'],
    profiles: [['weekend', '🧳', 'Je viens pour un week-end', 'Le meilleur en deux jours', 'Here for a weekend', 'The best in two days'], ['local', '🏡', 'J’habite dans le coin', 'Tout collectionner, à son rythme', 'I live nearby', 'Collect it all, at my pace'],
      ['etudiant', '🎓', 'J’étudie ici', 'INSEAD, écoles, campus', 'I study here', 'INSEAD, schools, campus'], ['tout', '✨', 'Un peu de tout', 'Plusieurs à la fois, ou je préfère ne pas répondre', 'A bit of everything', 'Several at once, or I’d rather not say']],
    titlesList: [[1, 'Promeneur', 'Walker'], [3, 'Flâneur', 'Stroller'], [5, 'Bellifontain', 'Bellifontain'], [8, 'Bleausard', 'Bleausard'], [12, 'Peintre de Barbizon', 'Barbizon Painter'], [20, 'Denecourt', 'Denecourt']],
    cats: { 'Scène & Spectacles': ['Scène', 'Stage'], 'Culture & Ateliers': ['Culture', 'Culture'], 'Nature & Environnement': ['Nature', 'Nature'], 'Sport & Outdoor': ['Sport', 'Sport'] }, outing: ['Sortie', 'Outing'],
  };
  var LI = LANG === 'en' ? 1 : 0;
  function t(k) { var v = S[k], s = Array.isArray(v) ? v[LI] : k, a = arguments; return String(s).replace(/\{(\d)\}/g, function (_, i) { return a[+i + 1]; }); }
  function tr(o) { return o ? (o[LANG] || o.fr) : ''; }
  document.documentElement.lang = LANG;

  // ── Rules (GDD §8): no single gain worth more than one level ──
  var XP = { 'commun': 15, 'peu commun': 20, 'rare': 30, 'légendaire': 60 };
  var EVENT_XP = 20, FEATURED_XP = 40, SEASON_BONUS = 5, SET_XP = 40, ALL_CATS_XP = 50, FIRST_STEP_XP = 5, ECO_XP = 10, QUESTION_XP = 5, FIL_XP = 60, WEEK_XP = 40, INV_XP = 15, SPORT_XP = 40, SPORT_MIN = 3; // 23/11: a sport badge, three sport outings
  var SET_MIN_PLACES = 3;
  var RADIUS = { ville: 100, foret: 150, event: 200, invader: 100 };
  var GPS_SLACK = 50; // the phone's own accuracy, counted up to 50 m
  var RCOL = { 'commun': 'var(--commun)', 'peu commun': 'var(--peu-commun)', 'rare': 'var(--rare)', 'légendaire': 'var(--legendaire)' };
  var SETCOL = { napoleon: '#4a5bb8', chateau: '#0f8f9e', ville: '#9247a0', denecourt: '#27503a', foret: '#5f8f2f', peintres: '#b8707d', grimpe: '#6b6257' };
  var RING = { 'peu commun': '#b9bec4', rare: '#d4a72c', 'légendaire': '#d4a72c' };
  function tint(c) { return 'color-mix(in srgb, ' + c + ' 14%, #fff)'; }
  var CATS = { 'Scène & Spectacles': ['mask', '#b8707d'], 'Culture & Ateliers': ['palette', '#9282b5'], 'Nature & Environnement': ['leaf', '#6f9e80'], 'Sport & Outdoor': ['run', '#6d8bb5'] };
  function half(x) { return Math.round(x / 2); }

  // ── Today: the phone's date in Europe/Paris ──
  var TODAY = D.built;
  try { var tz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); if (/^\d{4}-\d{2}-\d{2}$/.test(tz)) TODAY = tz; } catch (e) {}
  function addDays(d, n) { var x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  var TOMORROW = addDays(TODAY, 1);
  var MONDAY = (function () { var x = new Date(TODAY + 'T12:00:00Z'), w = (x.getUTCDay() + 6) % 7; return addDays(TODAY, -w); })();
  var EVENTS_ALL = D.events.filter(function (e) { return e.end >= TODAY && e.start <= addDays(TODAY, 6); });
  var SEASON_ALL = D.season.filter(function (e) { return e.end >= TODAY; });
  var LOC = LANG === 'en' ? 'en-GB' : 'fr-FR';
  function dayShort(d) { return new Date(d + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short' }).replace('.', ''); }
  function dayLong(d) { return d === TODAY ? t('today') : new Date(d + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function when(e) { return e.start === e.end ? dayLong(e.start) : dayLong(e.start < TODAY ? TODAY : e.start) + ' → ' + new Date(e.end + 'T12:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'long' }); }
  function isLive(e) { return e.start <= TODAY && e.end >= TODAY; }
  function firstDay(e) { return e.start < TODAY ? TODAY : e.start; }

  // ── Save (this phone only) ──
  var KEY = 'fl-collection-v1';
  function fresh() { return { xp: 0, spots: {}, answered: {}, invaders: {}, events: {}, plans: {}, sets: {}, weeks: {}, eco: false, onboarded: false, profile: '', geo: '', firstStep: false, pack: false, mecene: false, avatar: 'user', frame: 'none' }; }
  function clean(s) {
    var f = fresh(); if (!s || typeof s !== 'object' || typeof s.xp !== 'number' || !s.spots || typeof s.spots !== 'object') return null;
    Object.keys(f).forEach(function (k) { if (s[k] != null && typeof s[k] === typeof f[k]) f[k] = s[k]; });
    f.xp = Math.max(0, Math.min(1e6, Math.round(f.xp))); return f;
  }
  function load() { try { return clean(JSON.parse(localStorage.getItem(KEY))) || fresh(); } catch (e) { return fresh(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  var st = load();
  function exportCode() { try { return 'FLC1.' + btoa(unescape(encodeURIComponent(JSON.stringify(st)))); } catch (e) { return ''; } }
  function importCode(c) { try { var m = /FLC1\.([A-Za-z0-9+\/=]+)/.exec(String(c).replace(/\s+/g, '')); return m ? clean(JSON.parse(decodeURIComponent(escape(atob(m[1]))))) : null; } catch (e) { return null; } }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function $(id) { return document.getElementById(id); }
  function ico(name) {
    var d = ICONS[name] || ICONS.star, sp = document.createElement('span'); sp.className = 'ico';
    sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d.l + '"/></svg>';
    return sp;
  }
  function spotById(id) { return SPOTS.filter(function (x) { return x.id === id; })[0]; }
  function chrome() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ico]'), function (n) { n.textContent = ''; n.appendChild(ico(n.getAttribute('data-ico'))); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (n) { n.textContent = t(n.getAttribute('data-t')); });
    $('mebtn').setAttribute('aria-label', t('profile')); $('lbtn').setAttribute('aria-label', t('layers')); $('locbtn').setAttribute('aria-label', t('locate'));
    $('h-bases').textContent = t('bases'); $('h-layers').textContent = t('overlays'); $('lu-h').textContent = t('level'); $('lu-ok').textContent = t('cont');
  }
  function cat(e) { return CATS[e.cat] || ['star', '#555']; }
  function catLabel(e) { return S.cats[e.cat] ? S.cats[e.cat][LI] : t('outing'); }
  function byId(id) { return EVENTS_ALL.concat(SEASON_ALL).filter(function (x) { return x.id === id; })[0]; }
  function track(path) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'jeu/' + path, title: 'jeu', event: true }); } catch (e) {} }

  // Event of the day: one of today's events, the same for everyone in a sector (a stable hash).
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
  var EVENTS = [], SEASON = [], liveNow = [], featured = null;
  function refreshRange() {
    var c = me || RANGE.centre;
    EVENTS = EVENTS_ALL.filter(function (e) { return dist(c, e) <= RANGE.events; });
    SEASON = SEASON_ALL.filter(function (e) { return dist(c, e) <= RANGE.season; });
    liveNow = EVENTS.filter(isLive);
    featured = liveNow.slice().sort(function (a, b) { return hash(a.id + TODAY) - hash(b.id + TODAY); })[0] || null;
  }
  function xpOf(e) { return (featured && e.id === featured.id ? FEATURED_XP : EVENT_XP) + (e.season ? SEASON_BONUS : 0); }

  // ── Levels: level n starts at 30·n·(n−1) XP ──
  var MAX_LEVEL = 30;
  function floorOf(n) { return 30 * n * (n - 1); }
  function levelOf(xp) { var n = 1; while (n < MAX_LEVEL && floorOf(n + 1) <= xp) n++; return n; }
  function titleOf(n) { var x0 = S.titlesList[0]; S.titlesList.forEach(function (x) { if (n >= x[0]) x0 = x; }); return x0[1 + LI]; }
  // [id, FR, EN, in the pack]
  var AVATARS = [['user', 'Promeneur', 'Walker', 0], ['tree', 'Arbre', 'Tree', 0], ['leaf', 'Feuille', 'Leaf', 0], ['renard', 'Renard', 'Fox', 1], ['chouette', 'Chouette', 'Owl', 1],
    ['ecureuil', 'Écureuil', 'Squirrel', 1], ['cepe', 'Cèpe', 'Cep', 1], ['bicorne', 'Napoléon', 'Napoleon', 1], ['bloc', 'Bloc', 'Boulder', 1]];
  var FRAMES = [['none', 'Sans', 'None', 0], ['simple', 'Simple', 'Simple', 0], ['or', 'Or', 'Gold', 1], ['feuillage', 'Feuillage', 'Foliage', 1], ['gravure', 'Gravure', 'Engraving', 1], ['gres', 'Grès', 'Sandstone', 1]];
  function owned(list, id) { var x = list.filter(function (y) { return y[0] === id; })[0]; return x && (!x[3] || st.pack); }
  function avEl(id, frame, size) {
    var a = el('span', 'av' + (size ? ' ' + size : '')), inn = el('span', 'av-in'), art = D.art.avatars[id];
    if (art) { inn.style.background = art.bg; inn.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true">' + art.svg + '</svg>'; } else inn.appendChild(ico(id));
    a.appendChild(inn);
    if (frame === 'simple') a.classList.add('fr-simple');
    else if (D.art.frames[frame]) { var fr = el('span', 'av-fr'); fr.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true">' + D.art.frames[frame] + '</svg>'; a.appendChild(fr); }
    return a;
  }
  function hud() {
    var mb = $('mebtn'); mb.textContent = ''; mb.appendChild(avEl(owned(AVATARS, st.avatar) ? st.avatar : 'user', owned(FRAMES, st.frame) ? st.frame : 'none', 'top'));
    var n = levelOf(st.xp), a = floorOf(n), b = floorOf(n + 1);
    $('lvl').textContent = n; $('title').textContent = titleOf(n);
    $('xpbar').style.width = Math.round(100 * (st.xp - a) / (b - a)) + '%';
    $('xptxt').textContent = n >= MAX_LEVEL ? t('maxLevel', st.xp) : t('nextLevel', st.xp, n + 1, b);
  }
  function toast(s) { var x = $('toast'); x.textContent = x.classList.contains('on') ? x.textContent + String.fromCharCode(10) + s : s; x.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { x.classList.remove('on'); }, 2800); }
  var luQueue = [], luShowing = false, luTimer = 0;
  function gain(xp, why) {
    var before = levelOf(st.xp); st.xp += xp; save(); hud(); toast('+' + xp + ' XP · ' + why);
    var after = levelOf(st.xp);
    for (var n = before + 1; n <= after; n++) { luQueue.push(n); track('level/' + n); }
    if (luQueue.length && !luShowing && !luTimer) luTimer = setTimeout(nextLevelUp, 900);
  }
  function nextLevelUp() {
    luTimer = 0; var n = luQueue.shift(); if (!n) return;
    var tt = titleOf(n), isNew = titleOf(n - 1) !== tt, nx = S.titlesList.filter(function (x) { return x[0] > n; })[0];
    $('lu-n').textContent = n; $('lu-t').textContent = isNew ? tt : '';
    $('lu-p').textContent = isNew ? t('newTitle') : nx ? t('nextTitle', nx[0], nx[1 + LI]) : '';
    luShowing = true; $('levelup').classList.add('on');
  }
  $('lu-ok').onclick = function () { $('levelup').classList.remove('on'); luShowing = false; if (luQueue.length) luTimer = setTimeout(nextLevelUp, 300); };

  function filStep(id) { var p = spotById(id); return p && st.spots[id] && (!p.q || st.answered[id]); }
  function sportClaims() { return Object.keys(st.events).filter(function (id) { return st.events[id].cat === 'Sport & Outdoor'; }).length; }
  function weekClaims() { return Object.keys(st.events).filter(function (id) { return st.events[id].d >= MONDAY; }).length; }
  function checkSets() {
    Object.keys(SETS).forEach(function (s) {
      var all = SPOTS.filter(function (p) { return p.set === s; });
      if (all.length < SET_MIN_PLACES) return;
      if (!st.sets[s] && all.every(function (p) { return st.spots[p.id]; })) { st.sets[s] = true; gain(SET_XP, t('setXp', tr(SETS[s]))); track('set-complete/' + s); }
    });
    FILS.forEach(function (fl) {
      if (!st.sets['fil-' + fl.id] && fl.steps.every(filStep)) { st.sets['fil-' + fl.id] = true; gain(FIL_XP, t('filXp', tr(fl.name))); track('set-complete/fil-' + fl.id); }
    });
    var cats = {}; Object.keys(st.events).forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    if (!st.sets.cats && Object.keys(CATS).every(function (c) { return cats[c]; })) { st.sets.cats = true; gain(ALL_CATS_XP, t('qCatsXp')); }
    if (!st.sets.sport && sportClaims() >= SPORT_MIN) { st.sets.sport = true; gain(SPORT_XP, t('qSportXp')); }
    if (!st.weeks[MONDAY] && weekClaims() >= 2) { st.weeks[MONDAY] = true; gain(WEEK_XP, t('qWeekXp')); }
    save();
  }

  // ── Map and layers ──
  var map = L.map('map', { zoomControl: false }).setView([48.404, 2.698], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  var FogLayer = L.Layer.extend({
    initialize: function () { this._holes = []; },
    onAdd: function (m) {
      if (!m.getPane('fog')) { m.createPane('fog').style.zIndex = 350; }
      this._c = L.DomUtil.create('canvas', '', m.getPane('fog'));
      m.on('moveend zoomend resize viewreset', this._redraw, this); m.on('zoomstart', this._hide, this); this._redraw();
    },
    onRemove: function (m) { L.DomUtil.remove(this._c); m.off('moveend zoomend resize viewreset', this._redraw, this); m.off('zoomstart', this._hide, this); },
    clearLayers: function () { return this; },
    setHoles: function (h) { this._holes = h; if (this._map) this._redraw(); },
    _hide: function () { if (this._c) this._c.style.opacity = 0; },
    _redraw: function () {
      var m = this._map, c = this._c; if (!m || !c) return;
      var sz = m.getSize(), px = Math.round(sz.x / 2), py = Math.round(sz.y / 2), w = sz.x + 2 * px, h = sz.y + 2 * py;
      var r = window.devicePixelRatio || 1;
      c.width = Math.ceil(w * r); c.height = Math.ceil(h * r); c.style.width = w + 'px'; c.style.height = h + 'px';
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([-px, -py]));
      var g = c.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(36,48,42,.55)'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-out';
      this._holes.forEach(function (o) {
        var p = m.latLngToContainerPoint([o.lat, o.lng]), q = m.latLngToContainerPoint([o.lat + o.r / 111320, o.lng]);
        var x = p.x + px, y = p.y + py, rad = Math.max(4, Math.abs(p.y - q.y));
        var grd = g.createRadialGradient(x, y, rad * .65, x, y, rad); grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 2 * Math.PI); g.fill();
      });
      g.globalCompositeOperation = 'source-over'; c.style.opacity = 1;
    }
  });
  var LAYERS = {
    spots: { icon: 'pin', label: 'lSpots', on: true, g: L.layerGroup() },
    events: { icon: 'live', label: 'lEvents', on: true, g: L.layerGroup() },
    invaders: { icon: 'invader', label: 'lInv', on: true, g: L.layerGroup() },
    quests: { icon: 'flag', label: 'lQuests', on: false, g: L.layerGroup() },
    climb: { icon: 'climb', label: 'lClimb', on: false, g: L.layerGroup() },
    season: { icon: 'xmas', label: 'lSeason', on: false, g: L.layerGroup() },
    fog: { icon: 'fog', label: 'lFog', on: true, g: new FogLayer() },
  };
  var BASES = [['plan', 'bPlan', '#e9e5dc'], ['doux', 'bDoux', '#ece3cf'], ['nuit', 'bNuit', '#2b3540']];
  var base = 'plan';
  Object.keys(LAYERS).forEach(function (k) { if (LAYERS[k].on) LAYERS[k].g.addTo(map); });
  function panel() {
    var bs = $('bases'); bs.textContent = '';
    BASES.forEach(function (b) {
      var x = el('button'); x.type = 'button'; x.setAttribute('aria-pressed', base === b[0]);
      var th = el('div', 'thumb'); th.style.background = b[2]; x.appendChild(th); x.appendChild(document.createTextNode(t(b[1])));
      x.onclick = function () { base = b[0]; $('map').className = b[0] === 'plan' ? '' : b[0]; panel(); };
      bs.appendChild(x);
    });
    var ov = $('overlays'); ov.textContent = '';
    Object.keys(LAYERS).forEach(function (k) {
      var L0 = LAYERS[k], x = el('button'); x.type = 'button'; x.setAttribute('aria-pressed', L0.on);
      x.appendChild(ico(L0.icon)); x.appendChild(document.createTextNode(t(L0.label)));
      x.onclick = function () { L0.on = !L0.on; if (L0.on) L0.g.addTo(map); else map.removeLayer(L0.g); panel(); };
      ov.appendChild(x);
    });
  }
  $('lbtn').onclick = function () { var p = $('lpanel'), on = !p.classList.contains('on'); p.classList.toggle('on', on); this.setAttribute('aria-expanded', on); };
  map.on('movestart', function () { $('lpanel').classList.remove('on'); });

  function pinMarker(p, layer) {
    var got = !!st.spots[p.id];
    var m = L.marker([p.lat, p.lng], { icon: L.divIcon({ html: '<div class="pin' + (got ? ' got' : ' locked') + '" style="background:' + RCOL[p.rarity] + '"></div>', className: '', iconSize: [30, 30], iconAnchor: [15, 15] }) });
    m.on('add', function () { m.getElement().querySelector('.pin').appendChild(ico(p.icon)); });
    m.on('click', function () { openSpot(p); });
    layer.addLayer(m);
  }
  function evtMarker(e, layer) {
    var live = isLive(e), star = featured && e.id === featured.id, got = !!st.events[e.id];
    var cls = 'evt' + (live ? ' live' : '') + (star ? ' star' : '') + (got ? ' got' : '') + (e.season ? ' season' : '');
    var size = star ? 30 : 24;
    var m = L.marker([e.lat, e.lng], { zIndexOffset: star ? 1000 : live ? 500 : 0,
      icon: L.divIcon({ html: '<div class="' + cls + '"><b></b><i></i></div>', className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) });
    m.on('add', function () {
      var d = m.getElement().querySelector('.evt'); d.style.background = cat(e)[1];
      d.querySelector('b').appendChild(ico(e.season ? 'xmas' : cat(e)[0]));
      d.querySelector('i').textContent = live ? 'LIVE' : dayShort(firstDay(e));
    });
    m.on('click', function () { openEvent(e); });
    layer.addLayer(m);
  }
  function draw() {
    Object.keys(LAYERS).forEach(function (k) { LAYERS[k].g.clearLayers(); });
    SPOTS.forEach(function (p) { pinMarker(p, p.set === 'grimpe' ? LAYERS.climb.g : LAYERS.spots.g); });
    EVENTS.forEach(function (e) { evtMarker(e, e.season ? LAYERS.season.g : LAYERS.events.g); });
    SEASON.forEach(function (e) { evtMarker(e, LAYERS.season.g); });
    INVADERS.forEach(function (v) {
      var on = invGot(v), mk = L.marker([v.lat, v.lng], { icon: L.divIcon({ html: '<div class="pin inv' + (on ? ' got' : '') + '"></div>', className: '', iconSize: [26, 26], iconAnchor: [13, 13] }) });
      mk.on('add', function () { mk.getElement().querySelector('.pin').appendChild(ico('invader')); });
      mk.on('click', function () { openInvader(v); });
      LAYERS.invaders.g.addLayer(mk);
    });
    FILS[0].steps.forEach(function (id, i) {
      var p = spotById(id); if (!p || st.spots[id]) return;
      LAYERS.quests.g.addLayer(L.marker([p.lat, p.lng], { interactive: false, zIndexOffset: 800, icon: L.divIcon({ html: '<div class="qnum">' + (i + 1) + '</div>', className: '', iconSize: [20, 20], iconAnchor: [26, 26] }) }));
    });
    drawFog();
  }
  function ring(c, r) { return { lat: c.lat, lng: c.lng, r: r }; }
  function drawFog() {
    var holes = [];
    SPOTS.forEach(function (p) { if (st.spots[p.id]) holes.push(ring(p, 700)); });
    Object.keys(st.events).forEach(function (id) { var e = byId(id); if (e) holes.push(ring(e, 500)); });
    INVADERS.forEach(function (v) { if (invGot(v)) holes.push(ring(v, 250)); });
    holes.push(me ? ring(me, 400) : ring({ lat: 48.404, lng: 2.698 }, 600));
    LAYERS.fog.g.setHoles(holes);
  }

  // ── Position: read by the browser, compared here, never sent nor stored ──
  var me = null, acc = 0, meMarker = null, watchId = null, drawnAt = null, waiting = [], geoFailed = false;
  function dist(a, b) {
    var r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
  }
  function onFix(p) {
    var first = !me; geoFailed = false;
    me = { lat: p.coords.latitude, lng: p.coords.longitude }; acc = p.coords.accuracy || 0;
    if (meMarker) meMarker.setLatLng([me.lat, me.lng]);
    else meMarker = L.marker([me.lat, me.lng], { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ html: '<div class="me"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
    $('locbtn').classList.add('on');
    // The range follows the player; redraw only after a real move (50 m), not at every fix.
    if (first || !drawnAt || dist(drawnAt, me) > 50) { drawnAt = me; refreshRange(); draw(); liveBar(); renderAll(); }
    if (first) map.setView([me.lat, me.lng], 15);
    var w = waiting; waiting = []; w.forEach(function (fn) { fn(); });
  }
  function onGeoErr() { geoFailed = true; var w = waiting; waiting = []; if (w.length) toast(t('noGeo')); }
  function startGeo() {
    if (watchId != null || !navigator.geolocation) { if (!navigator.geolocation) geoFailed = true; return; }
    watchId = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  // Runs fn once a position is known; asks for it if needed.
  function withFix(fn) {
    if (me) return fn();
    if (geoFailed && watchId != null) { toast(t('noGeo')); return; }
    waiting.push(fn); toast(t('locating')); startGeo();
    if (!st.geo) { st.geo = 'oui'; save(); }
  }
  function nearEnough(p, r, ok) {
    withFix(function () {
      var d = dist(me, p);
      if (d <= r + Math.min(acc, GPS_SLACK)) ok(); else toast(t('tooFar', fmtDist(d), r));
    });
  }
  $('locbtn').onclick = function () { if (me) map.setView([me.lat, me.lng], 16); else withFix(function () {}); };
  function radiusOf(p) { return p.zone === 'foret' ? RADIUS.foret : RADIUS.ville; }
  function fmtDist(d) { return d > 1500 ? (d / 1000).toFixed(1).replace('.', LANG === 'en' ? '.' : ',') + ' km' : Math.round(d) + ' m'; }

  function liveBar() {
    var n = liveNow.length, lt = $('livetxt'); lt.textContent = '';
    lt.appendChild(el('b', null, t('liveN', n)));
    lt.appendChild(document.createTextNode(t('liveBar', EVENTS.length, FEATURED_XP)));
    $('nb').textContent = n ? String(n) : '';
  }
  $('livebar').onclick = function () { tab('live'); };

  // ── Sheets ──
  var sheet = $('sheet');
  function closeSheet() { sheet.classList.remove('on'); }
  function header(bg, icon, chip, chipCol) {
    var art = el('div', 'art'); art.style.background = tint(bg); art.style.color = bg; art.appendChild(ico(icon));
    if (chip) { var r = el('span', 'r', chip); r.style.background = chipCol; art.appendChild(r); }
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', t('close')); x.onclick = closeSheet; art.appendChild(x);
    return art;
  }
  function link(text, href, cls) { var a = el('a', cls || null, text); a.href = href; if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } return a; }
  function firstStep() { if (st.onboarded && !st.firstStep) { st.firstStep = true; gain(FIRST_STEP_XP, t('firstStep')); } }
  function openSpot(p) {
    firstStep();
    sheet.textContent = '';
    var got = st.spots[p.id];
    sheet.appendChild(header(got ? SETCOL[p.set] : '#8a8f8b', p.icon, S.rarity[p.rarity][LI], RCOL[p.rarity]));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, p.name));
    b.appendChild(el('p', 'meta', (LANG === 'en' ? TYPES[p.type] || p.type : p.type) + ' · ' + tr(SETS[p.set]) + ' · ' + XP[p.rarity] + ' XP' + (me ? t('away', fmtDist(dist(me, p))) : '')));
    if (p.set === 'grimpe') b.appendChild(el('div', 'note', t('climbNote')));
    if (got) {
      b.appendChild(el('div', 'got-banner', S.gotHow[got] ? S.gotHow[got][LI] : S.gotHow.gps[LI]));
      if (p.q) {
        var q2 = questionBlock(p, function () { st.answered[p.id] = 1; save(); gain(QUESTION_XP, t('goodEye')); checkSets(); renderAll(); openSpot(p); }, !!st.answered[p.id]);
        b.appendChild(q2);
      }
      if (p.text && (!p.q || st.answered[p.id])) {
        b.appendChild(el('p', null, tr(p.text)));
        var src = el('p', 'src', t('source'));
        (p.src || []).forEach(function (s, i) {
          if (i) src.appendChild(document.createTextNode(' ; '));
          if (s.url) src.appendChild(link(s.label, s.url)); else src.appendChild(document.createTextNode(s.label));
        });
        b.appendChild(src);
      }
    } else {
      b.appendChild(el('p', null, t('goThere')));
      var acts = el('div', 'acts');
      var gps = el('button', 'btn', t('imHere', radiusOf(p))); gps.type = 'button';
      gps.onclick = function () { nearEnough(p, radiusOf(p), function () { unlock(p, 'gps'); }); };
      acts.appendChild(gps);
      if (p.q) {
        acts.appendChild(el('p', 'qlead', t('noGps')));
        acts.appendChild(questionBlock(p, function () { st.answered[p.id] = 1; unlock(p, 'question'); }));
      }
      b.appendChild(acts);
    }
    if (p.set === 'grimpe') { var pp = el('p', 'sheet-link'); pp.appendChild(link(t('boolder'), 'https://www.boolder.com/' + (LANG === 'en' ? 'en' : 'fr'))); b.appendChild(pp); }
    sheet.appendChild(b); sheet.classList.add('on'); sheet.scrollTop = 0;
  }
  // done: already answered — the question stays on view, the right answer marked.
  function questionBlock(p, onRight, done) {
    var q = el('div', 'q'), choices = p.q.c[LANG] || p.q.c.fr;
    q.appendChild(el('p', 'qtext', tr(p.q)));
    var msg = el('p', 'qmsg');
    choices.forEach(function (c, i) {
      var cb = el('button', 'btn alt' + (done && i === p.q.a ? ' right' : ''), (done && i === p.q.a ? '✓ ' : '') + c); cb.type = 'button';
      if (done) cb.disabled = i !== p.q.a;
      else cb.onclick = function () {
        if (i === p.q.a) {
          cb.classList.add('right'); cb.textContent = '✓ ' + c; msg.className = 'qmsg ok'; msg.textContent = t('right');
          Array.prototype.forEach.call(q.querySelectorAll('button'), function (x) { x.onclick = null; });
          setTimeout(function () { onRight(); sheet.scrollTop = 0; }, 700);
        } else {
          cb.disabled = true; cb.classList.add('wrong'); cb.textContent = '✗ ' + c;
          msg.className = 'qmsg ko'; msg.textContent = t('wrong');
        }
      };
      q.appendChild(cb);
    });
    q.appendChild(msg);
    return q;
  }
  function unlock(p, how) {
    st.spots[p.id] = how; save(); track('spot-unlock/' + p.id); track('spot-method/' + how);
    gain(XP[p.rarity], p.name);
    draw(); checkSets(); renderAll(); openSpot(p);
  }
  function openEvent(e) {
    firstStep();
    sheet.textContent = '';
    var c = cat(e), live = isLive(e), star = featured && e.id === featured.id, xp = xpOf(e);
    sheet.appendChild(header(c[1], e.season ? 'xmas' : c[0], star ? t('evStar') : live ? t('evLive') : catLabel(e), star ? 'var(--gold)' : live ? 'var(--live)' : 'rgba(29,59,41,.55)'));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, e.title));
    b.appendChild(el('p', 'meta', when(e) + ' · ' + e.place + (e.schedule ? ' · ' + e.schedule : '') + (me ? t('away', fmtDist(dist(me, e))) : '')));
    var line = el('p'); line.appendChild(el('span', 'xpchip' + (star ? ' gold' : ''), '+' + xp + ' XP'));
    line.appendChild(document.createTextNode(star ? t('evStarTxt') : e.season ? t('evSeasonTxt') : t('evCardTxt')));
    b.appendChild(line);
    b.appendChild(el('p', 'meta', t('noTicket')));
    if (st.events[e.id]) b.appendChild(el('div', 'got-banner', t('evGot', dayLong(st.events[e.id].d))));
    else {
      var acts = el('div', 'acts');
      if (live) {
        var go = el('button', 'btn live', t('evGo', RADIUS.event)); go.type = 'button';
        go.onclick = function () { nearEnough(e, RADIUS.event, function () { claimEvent(e, 'gps'); }); };
        var hon = el('button', 'btn soft', t('evHonour', half(xp))); hon.type = 'button'; hon.onclick = function () { claimEvent(e, 'honneur'); };
        acts.appendChild(go); acts.appendChild(hon);
      } else {
        var plan = el('button', 'btn alt', st.plans[e.id] ? t('planned') : t('plan')); plan.type = 'button';
        plan.onclick = function () { if (st.plans[e.id]) delete st.plans[e.id]; else st.plans[e.id] = 1; save(); renderAll(); openEvent(e); };
        acts.appendChild(plan);
        acts.appendChild(el('p', 'meta', t('evLater', dayLong(firstDay(e)))));
      }
      b.appendChild(acts);
    }
    if (e.page) { var pp = el('p', 'sheet-link'); pp.appendChild(link(t('evPage'), e.page)); b.appendChild(pp); }
    sheet.appendChild(b); sheet.classList.add('on'); sheet.scrollTop = 0;
  }
  function claimEvent(e, how) {
    var xp = how === 'honneur' ? half(xpOf(e)) : xpOf(e);
    st.events[e.id] = { d: TODAY, how: how, cat: e.cat, season: !!e.season }; delete st.plans[e.id]; save(); track('event-checkin');
    gain(xp, t('keepsake')); draw(); checkSets(); renderAll(); openEvent(e);
  }

  // ── En direct ──
  function evRow(root, e) {
    var c = cat(e), r = el('button', 'ev-row'); r.type = 'button';
    var ic = el('span', 'ic'); ic.appendChild(ico(e.season ? 'xmas' : c[0])); ic.style.background = c[1]; r.appendChild(ic);
    var tx = el('span', 'tx'); tx.appendChild(el('b', null, e.title)); tx.appendChild(el('span', null, e.place + (e.schedule ? ' · ' + e.schedule : '')));
    r.appendChild(tx);
    if (st.events[e.id]) r.appendChild(el('span', 'xpchip', '✓'));
    else { if (st.plans[e.id]) r.appendChild(el('span', null, '🔔')); r.appendChild(el('span', 'xpchip' + (featured && e.id === featured.id ? ' gold' : ''), '+' + xpOf(e))); }
    r.onclick = function () { tab('map'); map.setView([e.lat, e.lng], 15); openEvent(e); };
    root.appendChild(r);
  }
  function renderLive() {
    var root = $('live'); root.textContent = '';
    root.appendChild(el('h2', null, t('liveH')));
    root.appendChild(el('p', 'meta', t('liveLead')));
    if (featured) {
      var q = el('div', 'quest hot plain'); q.appendChild(el('span', 'livechip gold', t('starH')));
      q.appendChild(el('p', null, t('starTxt'))); evRow(q, featured); root.appendChild(q);
    }
    var days = {};
    EVENTS.forEach(function (e) { var d = firstDay(e); (days[d] = days[d] || []).push(e); });
    var shown = Object.keys(days).sort().filter(function (d) { return d <= TOMORROW; });
    if (!shown.length) root.appendChild(el('p', null, t('noLive')));
    shown.forEach(function (d) {
      // The event of the day is already in its gold box: not listed twice, and no empty heading.
      var rows = days[d].filter(function (e) { return !(featured && e.id === featured.id); });
      if (!rows.length) return;
      root.appendChild(el('div', 'day', dayLong(d) + ' · ' + rows.length));
      rows.forEach(function (e) { evRow(root, e); });
    });
    var later = EVENTS.filter(function (e) { return firstDay(e) > TOMORROW; }).length;
    if (later || SEASON.length) root.appendChild(el('p', 'meta', t('later', later) + (SEASON.length ? t('laterSeason', SEASON.length) : '')));
    var sw0 = el('p', 'sheet-link'); sw0.appendChild(link(t('siteWeek'), '/ce-week-end/' + (LANG === 'en' ? '?lang=en' : ''))); root.appendChild(sw0);
  }

  // ── Collection (badges) ──
  function tile(o) {
    var c = el(o.tag || 'button', 'mtile' + (o.locked ? ' locked' : '') + (o.dark ? ' dark' : ''));
    if (c.tagName === 'BUTTON') c.type = 'button';
    var m = el('span', 'medal'); m.style.background = o.bg; m.style.color = o.fg; if (!o.locked && RING[o.rarity]) m.style.setProperty('--ring', RING[o.rarity]);
    m.appendChild(o.icon); c.appendChild(m); c.appendChild(el('small', null, o.label));
    return c;
  }
  function renderDex() {
    var root = $('dex'); root.textContent = '';
    root.appendChild(el('h2', null, t('dexH', Object.keys(st.spots).length, SPOTS.length)));
    var ev = Object.keys(st.events);
    var box = el('div', 'set'), h0 = el('h3'); h0.appendChild(el('span', null, t('souvenirs'))); h0.appendChild(el('span', null, String(ev.length))); box.appendChild(h0);
    if (!ev.length) box.appendChild(el('p', 'meta', t('noSouvenir')));
    else {
      var g = el('div', 'cards');
      ev.forEach(function (id) { var e = byId(id), rec = st.events[id]; g.appendChild(tile({ tag: 'div', bg: e ? cat(e)[1] : '#555', fg: '#fff', icon: ico(e && e.season || rec.season ? 'xmas' : e ? cat(e)[0] : 'star'), label: e ? e.title : dayLong(rec.d) })); });
      box.appendChild(g);
    }
    root.appendChild(box);
    function sportBox() {
    // 23/11: the Sportif badge, here too, after the painters and before 5 Must Climb.
    var spIds = Object.keys(st.events).filter(function (id) { return st.events[id].cat === 'Sport & Outdoor'; }), spN = spIds.length;
    var sb = el('div', 'set'), sh = el('h3'); sh.appendChild(el('span', null, t('bSport'))); sh.appendChild(el('span', null, Math.min(spN, SPORT_MIN) + '/' + SPORT_MIN)); sb.appendChild(sh);
    var spr = el('div', 'prog'), spi = el('i'); spi.style.width = Math.round(100 * Math.min(spN, SPORT_MIN) / SPORT_MIN) + '%'; spr.appendChild(spi); sb.appendChild(spr);
    sb.appendChild(el('p', 'meta', spN >= SPORT_MIN ? t('sportGot') : t('sportLead')));
    var sg = el('div', 'cards');
    spIds.forEach(function (id) { var e = byId(id), rec = st.events[id]; sg.appendChild(tile({ tag: 'div', bg: '#6d8bb5', fg: '#fff', icon: ico('run'), label: e ? e.title : dayLong(rec.d) })); });
    for (var k = spN; k < SPORT_MIN; k++) sg.appendChild(tile({ tag: 'div', bg: tint('#6d8bb5'), fg: '#6d8bb5', icon: ico('run'), label: t('bSport'), locked: true }));
    sb.appendChild(sg); root.appendChild(sb);
    }
    Object.keys(SETS).forEach(function (s) {
      if (s === 'grimpe') sportBox();
      var all = SPOTS.filter(function (p) { return p.set === s; }), got = all.filter(function (p) { return st.spots[p.id]; }).length;
      var bx = el('div', 'set'), h = el('h3'); h.appendChild(el('span', null, tr(SETS[s]))); h.appendChild(el('span', null, got + '/' + all.length)); bx.appendChild(h);
      var pr = el('div', 'prog'), pi = el('i'); pi.style.width = Math.round(100 * got / all.length) + '%'; pr.appendChild(pi); bx.appendChild(pr);
      var grid = el('div', 'cards');
      all.forEach(function (p) {
        var c = tile({ bg: tint(SETCOL[s]), fg: SETCOL[s], icon: ico(p.icon), label: p.name, locked: !st.spots[p.id], rarity: p.rarity });
        c.onclick = function () { tab('map'); map.setView([p.lat, p.lng], 15); openSpot(p); };
        grid.appendChild(c);
      });
      bx.appendChild(grid); root.appendChild(bx);
    });
    invaderBox(root);
  }

  // ── Invaders: at street level, found by GPS or on one's honour ──
  function invGot(m) { return st.invaders[m.id] && st.invaders[m.id].how; }
  function invaderBox(root) {
    var got = INVADERS.filter(invGot).length;
    var bx = el('div', 'set'), h = el('h3'); h.appendChild(el('span', null, t('invH'))); h.appendChild(el('span', null, got + '/' + INVADERS.length)); bx.appendChild(h);
    bx.appendChild(el('p', 'meta', t('invLead', INVADERS.length)));
    var grid = el('div', 'cards');
    INVADERS.forEach(function (m) {
      var on = invGot(m), c = tile({ bg: '#2b2d42', fg: '#fff', icon: on ? ico('invader') : el('span', null, '?'), label: on ? m.name : m.street, locked: !on, dark: on });
      c.onclick = function () { tab('map'); map.setView([m.lat, m.lng], 17); openInvader(m); }; grid.appendChild(c);
    });
    bx.appendChild(grid); root.appendChild(bx);
  }
  function openInvader(m) {
    firstStep();
    sheet.textContent = '';
    var on = invGot(m);
    sheet.appendChild(header(on ? '#2b2d42' : '#8a8f8b', 'invader', 'street art', '#2b2d42'));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, on ? m.name : t('invOne')));
    if (on && m.code) b.appendChild(el('p', 'meta', m.code));
    b.appendChild(el('p', 'meta', m.street + ' · ' + INV_XP + ' XP' + (me ? t('away', fmtDist(dist(me, m))) : '')));
    if (!on) b.appendChild(el('p', null, t('invWhere', m.street)));
    if (on) b.appendChild(el('div', 'got-banner', on === 'gps' ? t('invGotGps') : t('invGotHon')));
    else {
      var acts = el('div', 'acts');
      var gps = el('button', 'btn', t('invFound', RADIUS.invader)); gps.type = 'button';
      gps.onclick = function () { nearEnough(m, RADIUS.invader, function () { claimInvader(m, 'gps'); }); };
      var hon = el('button', 'btn alt', t('invSeen', half(INV_XP))); hon.type = 'button';
      hon.onclick = function () { claimInvader(m, 'honneur'); };
      acts.appendChild(gps); acts.appendChild(hon); b.appendChild(acts);
    }
    sheet.appendChild(b); sheet.classList.add('on'); sheet.scrollTop = 0;
  }
  function claimInvader(m, how) {
    st.invaders[m.id] = { d: TODAY, how: how }; save(); track('spot-method/' + how);
    gain(how === 'honneur' ? half(INV_XP) : INV_XP, t('invXp')); draw(); renderAll(); openInvader(m);
  }

  // ── Quests ──
  function quest(root, icon, title, tags, text, done, total, extra, hot) {
    var q = el('div', 'quest' + (hot ? ' hot' : ''));
    var m = el('span', 'qmedal'); m.style.background = tint(icon[1]); m.style.color = icon[1]; m.style.borderColor = icon[1]; m.appendChild(ico(icon[0])); q.appendChild(m);
    var bx = el('div', 'qbody'); bx.appendChild(el('b', null, title)); if (tags.length) bx.appendChild(el('br'));
    tags.forEach(function (x) { bx.appendChild(el('span', 'tag', x)); });
    if (text) bx.appendChild(el('p', null, text));
    if (total) { var pr = el('div', 'prog'), pi = el('i'); pi.style.width = Math.round(100 * Math.min(done, total) / total) + '%'; pr.appendChild(pi); bx.appendChild(pr); bx.appendChild(el('span', 'meta', Math.min(done, total) + ' / ' + total)); }
    q.appendChild(bx);
    if (extra) { var ex = el('div', 'qextra'); ex.appendChild(extra); q.appendChild(ex); }
    root.appendChild(q);
  }
  function renderQuests() {
    var root = $('quests'); root.textContent = '';
    var cats = {}; Object.keys(st.events).forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    root.appendChild(el('h2', null, t('week')));
    var fx = null;
    if (featured) { fx = el('button', 'btn gold', t('qStarBtn')); fx.type = 'button'; fx.onclick = function () { tab('map'); map.setView([featured.lat, featured.lng], 15); openEvent(featured); }; }
    quest(root, ['star', '#b8860b'], t('qStar'), ['+' + FEATURED_XP + ' XP', S.qStarTags[1 + 2 * LI]], featured ? featured.title + ' — ' + featured.place : t('qStarNone'), featured && st.events[featured.id] ? 1 : 0, 1, fx, true);
    quest(root, ['calendar', '#4a5bb8'], t('qWeek'), ['+' + WEEK_XP + ' XP'], t('qWeekTxt', EVENTS.length), weekClaims(), 2);
    quest(root, ['mask', '#b8707d'], t('qCats'), ['+' + ALL_CATS_XP + ' XP'], t('qCatsTxt'), Object.keys(cats).length, 4);
    root.appendChild(el('h2', null, t('always')));
    var filsDone = FILS.filter(function (fl) { return st.sets['fil-' + fl.id]; }).length;
    var head = el('div'), hp = el('div', 'prog'), hi = el('i'); hi.style.width = Math.round(100 * filsDone / FILS.length) + '%'; hp.appendChild(hi); head.appendChild(hp);
    head.appendChild(el('span', 'meta', t('filsDone', filsDone, FILS.length)));
    quest(root, ['book', SETCOL.napoleon], t('qFils'), ['+' + FIL_XP + ' XP'], t('qFilsTxt'), 0, 0, head);
    FILS.forEach(function (fl, k) {
      var list = el('div', 'fsteps');
      fl.steps.forEach(function (id) {
        var p = spotById(id); if (!p) return;
        var got = st.spots[id], done = filStep(id);
        var row = el('button', 'fstep' + (done ? ' done' : got ? ' half' : '')); row.type = 'button';
        var c = el('span', 'fdot'); c.appendChild(ico(done ? 'check' : p.icon)); row.appendChild(c);
        var tx = el('span', 'ftx'); tx.appendChild(el('b', null, p.name));
        tx.appendChild(el('small', null, done ? t('stDone') : got ? t('stHalf') : p.q ? t('stQ') : t('stTodo')));
        row.appendChild(tx);
        row.onclick = function () { tab('map'); map.setView([p.lat, p.lng], 15); openSpot(p); };
        list.appendChild(row);
      });
      quest(root, [fl.icon, fl.color], (k + 1) + '. ' + tr(fl.name), [t('steps', fl.steps.length)], tr(fl.intro), fl.steps.filter(filStep).length, fl.steps.length, list);
    });
    quest(root, ['run', '#6d8bb5'], t('qSport'), ['+' + SPORT_XP + ' XP', t('bSport')], t('qSportTxt'), sportClaims(), SPORT_MIN);
    var climb = SPOTS.filter(function (p) { return p.set === 'grimpe'; });
    quest(root, ['climb', SETCOL.grimpe], t('qClimb'), [], t('qClimbTxt'), climb.filter(function (p) { return st.spots[p.id]; }).length, climb.length);
    quest(root, ['invader', '#2b2d42'], t('qInv'), [t('honour')], t('invLead', INVADERS.length), INVADERS.filter(invGot).length, INVADERS.length);
    var eco = el('button', 'btn soft', st.eco ? t('qEcoDone') : t('qEcoBtn')); eco.type = 'button'; eco.disabled = st.eco;
    eco.onclick = function () { st.eco = true; save(); gain(ECO_XP, t('ecoXp')); renderAll(); };
    quest(root, ['leaf', SETCOL.foret], t('qEco'), [t('honour')], t('qEcoTxt'), st.eco ? 1 : 0, 1, eco);
    var mo = +TODAY.slice(5, 7), dd = +TODAY.slice(8, 10);
    if ((mo === 11 && dd >= 15) || mo === 12 || (mo === 1 && dd <= 6)) {
      root.appendChild(el('h2', null, t('seasonal')));
      var noel = Object.keys(st.events).filter(function (id) { return st.events[id].season; }).length;
      quest(root, ['xmas', '#b3261e'], t('qXmas'), ['+' + SEASON_BONUS + ' XP'], t('qXmasTxt', SEASON.length), noel, 2);
      if (mo === 12 && dd <= 24) quest(root, ['gift', '#b8860b'], t('qAdvent'), [], t('qAdventTxt'), 0, 0, link(t('qAdventBtn'), '/calendrier-de-l-avent/', 'btn soft'));
    }
  }

  // ── Profile ──
  function renderMe() {
    var root = $('me'); root.textContent = '';
    var n = levelOf(st.xp);
    var head = el('div', 'mehead'); head.appendChild(avEl(owned(AVATARS, st.avatar) ? st.avatar : 'user', owned(FRAMES, st.frame) ? st.frame : 'none', 'big'));
    var hx = el('div'); hx.appendChild(el('h2', null, titleOf(n) + ' · ' + t('levelN', n)));
    if (st.mecene) hx.appendChild(el('span', 'tag mec', t('mecene')));
    head.appendChild(hx); root.appendChild(head);
    var stats = el('div', 'stats');
    [[Object.keys(st.spots).length, S.meStats[0][LI]], [Object.keys(st.events).length, S.meStats[1][LI]], [st.xp, 'XP']].forEach(function (x) { var s = el('div', 'stat'); s.appendChild(el('b', null, String(x[0]))); s.appendChild(document.createTextNode(x[1])); stats.appendChild(s); });
    root.appendChild(stats);
    root.appendChild(el('h2', null, t('badges')));
    var bs = el('div', 'cards');
    function inSet(s) { var all = SPOTS.filter(function (p) { return p.set === s; }); return [all.filter(function (p) { return st.spots[p.id]; }).length, all.length]; }
    var evIds = Object.keys(st.events), cats = {};
    evIds.forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    var noel = evIds.filter(function (id) { return st.events[id].season; }).length;
    [['castle', t('bNap'), inSet('napoleon'), SETCOL.napoleon], ['tree', t('bBlue'), inSet('denecourt'), SETCOL.denecourt], ['palette', t('bPaint'), inSet('peintres'), SETCOL.peintres],
      ['star', t('bFirst'), [Math.min(evIds.length, 1), 1], '#b8860b'], ['mask', t('bCats'), [Object.keys(cats).length, 4], '#b8707d'], ['run', t('bSport'), [Math.min(sportClaims(), SPORT_MIN), SPORT_MIN], '#6d8bb5'], ['leaf', t('bEco'), [st.eco ? 1 : 0, 1], SETCOL.foret],
      ['climb', t('bClimb'), inSet('grimpe'), SETCOL.grimpe], ['invader', t('bInv'), [INVADERS.filter(invGot).length, INVADERS.length], '#2b2d42'], ['xmas', t('bXmas'), [Math.min(noel, 2), 2], '#b3261e']]
      // The Mécène badge shows once held, never as a locked target (GDD §12.2)
      .concat(st.mecene ? [['heart', t('mecene'), [1, 1], '#b8707d']] : [])
      .forEach(function (x) {
        var got = x[2][0], need = x[2][1], done = got >= need, c = el('div', 'mtile pmedal' + (done ? '' : ' locked'));
        var rg = el('span', 'pring'); rg.style.background = 'conic-gradient(' + x[3] + ' ' + Math.round(360 * got / need) + 'deg, #e4e1da 0)';
        var m = el('span', 'medal'); m.style.background = tint(x[3]); m.style.color = x[3]; m.appendChild(ico(x[0])); rg.appendChild(m); c.appendChild(rg);
        c.appendChild(el('small', null, x[1])); c.appendChild(el('span', 'target' + (done ? ' done' : ''), done ? t('got') : got + ' / ' + need));
        bs.appendChild(c);
      });
    root.appendChild(bs);
    root.appendChild(el('h2', null, t('titles')));
    var tl = el('div', 'titles');
    S.titlesList.forEach(function (x) {
      var on = n >= x[0], row = el('div', 'trow' + (on ? ' on' : '')), circ = el('span', 'tcirc');
      circ.appendChild(ico(on ? 'check' : 'lock')); row.appendChild(circ);
      var tx = el('span', 'ttx'); tx.appendChild(el('b', null, x[1 + LI])); tx.appendChild(el('small', null, t('levelN', x[0]))); row.appendChild(tx);
      tl.appendChild(row);
    });
    root.appendChild(tl);

    root.appendChild(el('h2', null, t('avatarH')));
    function picker(list, cur, mk, set) {
      var g = el('div', 'pick');
      list.forEach(function (x) {
        var locked = x[3] && !st.pack, b = el('button', locked ? 'locked' : ''); b.type = 'button'; b.setAttribute('aria-pressed', cur === x[0]);
        b.appendChild(mk(x[0])); b.appendChild(el('small', null, x[1 + LI]));
        if (locked) { var lk = el('span', 'lk'); lk.appendChild(ico('lock')); b.appendChild(lk); }
        b.onclick = function () { if (locked) { openPack(); return; } set(x[0]); save(); hud(); renderMe(); };
        g.appendChild(b);
      });
      return g;
    }
    root.appendChild(picker(AVATARS, st.avatar, function (id) { return avEl(id, st.frame); }, function (id) { st.avatar = id; }));
    root.appendChild(el('h3', 'acc-h', t('frameH')));
    root.appendChild(picker(FRAMES, st.frame, function (id) { return avEl(st.avatar, id); }, function (id) { st.frame = id; }));
    if (!st.pack) { var gp = el('button', 'btn soft wide', t('morePack')); gp.type = 'button'; gp.onclick = openPack; root.appendChild(gp); }

    if (!standalone) { // always, once uninstalled too: the card says how on every phone
      root.appendChild(el('h2', null, t('instMe')));
      var ib = el('button', 'btn soft', t('instMeBtn')); ib.type = 'button'; ib.style.width = '100%';
      ib.onclick = function () { installCard(true); }; root.appendChild(ib);
    }
    root.appendChild(el('h2', null, t('lang')));
    var sw = el('div', 'langsw');
    [['fr', 'FR'], ['en', 'EN']].forEach(function (l) {
      var bt = el('button', null, l[1]); bt.type = 'button'; bt.setAttribute('aria-pressed', LANG === l[0]);
      bt.onclick = function () { try { localStorage.setItem('lang', l[0]); } catch (e) {} location.replace(location.pathname + '#profil'); location.reload(); };
      sw.appendChild(bt);
    });
    root.appendChild(sw);

    root.appendChild(el('h2', null, t('saveH')));
    var acc0 = el('div', 'set');
    acc0.appendChild(el('p', null, t('saveLead')));
    var row = el('div', 'row2');
    var cp = el('button', 'btn soft', t('copy')); cp.type = 'button';
    var pa = el('button', 'btn alt', t('paste')); pa.type = 'button';
    var area = el('textarea', 'code'); area.spellcheck = false; area.style.display = 'none';
    var ld = el('button', 'btn', t('load')); ld.type = 'button'; ld.style.display = 'none';
    cp.onclick = function () {
      var c = exportCode(); area.value = c; area.style.display = 'block'; area.select();
      try { navigator.clipboard.writeText(c).then(function () { toast(t('copied')); }, function () {}); } catch (e) {}
    };
    pa.onclick = function () { area.value = ''; area.style.display = 'block'; ld.style.display = 'block'; area.focus(); };
    ld.onclick = function () {
      var s = importCode(area.value); if (!s) { toast(t('badCode')); return; }
      if (!confirm(t('replace'))) return;
      st = s; st.onboarded = true; save(); draw(); renderAll(); toast(t('loaded'));
    };
    row.appendChild(cp); row.appendChild(pa); acc0.appendChild(row); acc0.appendChild(area); acc0.appendChild(ld);
    var rs = el('button', 'btn soft', t('reset')); rs.type = 'button'; rs.style.marginTop = '10px';
    rs.onclick = function () { if (!confirm(t('resetAsk'))) return; st = fresh(); save(); location.replace(location.pathname); location.reload(); };
    acc0.appendChild(rs);
    root.appendChild(acc0);

    var tn = el('p', 'note', t('testNote') + ' ');
    if (D.feedback) tn.appendChild(link(t('report'), D.feedback));
    root.appendChild(tn);
    var fl = el('p', 'foot-links');
    fl.appendChild(link(t('home'), '/')); fl.appendChild(document.createTextNode(' · ')); fl.appendChild(link(t('legal'), '/mentions-legales/'));
    fl.appendChild(document.createTextNode(' · © OpenStreetMap'));
    root.appendChild(fl);
  }

  // ── Entry flow: three screens (GDD §6.1) ──
  var onb = $('onb'), STEPS = ['welcome', 'profile', 'geo'], step = 0, draft = { profile: '' };
  function choice(icon, title, sub, pressed, onclick) {
    var c = el('button', 'choice'); c.type = 'button'; c.setAttribute('aria-pressed', !!pressed);
    c.appendChild(el('span', null, icon)); var x = el('div'); x.appendChild(el('b', null, title)); if (sub) x.appendChild(el('small', null, sub)); c.appendChild(x);
    c.onclick = onclick; return c;
  }
  function renderOnb() {
    onb.textContent = '';
    var N = STEPS.length, last = N - 1, s = STEPS[step], dots = el('div', 'dots');
    for (var i = 0; i < N; i++) dots.appendChild(el('i', i === step ? 'on' : ''));
    onb.appendChild(dots);
    if (step > 0 && step < last) { var sk = el('button', 'skip', t('skip')); sk.type = 'button'; sk.onclick = function () { step = last; renderOnb(); }; onb.appendChild(sk); }
    var inn = el('div', 'in'), foot = el('div', 'foot');
    function next(label, enabled, fn) { var b = el('button', 'btn', label); b.type = 'button'; b.disabled = enabled === false; b.onclick = fn || function () { step++; renderOnb(); }; foot.appendChild(b); return b; }
    if (s === 'welcome') {
      var hero = el('div', 'hero'); hero.appendChild(ico('map')); hero.appendChild(el('b', null, 'Fontainebleau Live Collection')); hero.appendChild(el('small', null, t('onbTag'))); inn.appendChild(hero);
      [['pin', 'onbF1'], ['cards', 'onbF2'], ['live', 'onbF3']].forEach(function (f) { var r = el('div', 'feat'), ic = el('span'); ic.appendChild(ico(f[0])); r.appendChild(ic); r.appendChild(el('div', null, t(f[1]))); inn.appendChild(r); });
      inn.appendChild(el('p', 'meta', t('free')));
      next(t('start'));
    } else if (s === 'profile') {
      inn.appendChild(el('h1', null, t('youCome')));
      S.profiles.forEach(function (p) { inn.appendChild(choice(p[1], p[2 + 2 * LI], p[3 + 2 * LI], draft.profile === p[0], function () { draft.profile = p[0]; renderOnb(); })); });
      foot.appendChild(el('p', 'meta why', t('why')));
      next(t('cont'), !!draft.profile);
    } else {
      var h2 = el('div', 'hero'); h2.appendChild(ico('pin')); inn.appendChild(h2);
      inn.appendChild(el('h1', null, t('geoH')));
      inn.appendChild(el('p', 'lead', t('geoLead')));
      inn.appendChild(el('p', 'meta', t('geoNo')));
      next(t('geoYes'), true, function () { st.geo = 'oui'; finishOnb(); startGeo(); });
      var later = el('button', 'btn soft', t('geoLater')); later.type = 'button'; later.onclick = function () { st.geo = 'non'; finishOnb(); }; foot.appendChild(later);
    }
    onb.appendChild(inn); onb.appendChild(foot);
  }
  function finishOnb() {
    st.onboarded = true; st.profile = draft.profile || 'tout'; save(); track('quest-start');
    onb.classList.remove('on'); tab('map'); renderAll();
    setTimeout(function () { toast(t('touch')); }, 1200);
  }

  // ── Shop (GDD §12.2): support (badge + pack, or the pack without paying), then groups. Folded. ──
  // The support opens unfolded (23/11, project lead): folded, it showed nothing worth a tap
  var SHOP = D.shop, SHOP_OPEN = { mecene: true }, GQ = SHOP.groups[0] ? SHOP.groups[0].id : '', THANKS = null, codeOpen = false;
  function openPack() { SHOP_OPEN.mecene = true; renderShop(); tab('shop'); $('s-shop').scrollTop = 0; }
  function sblock(root, key, icon, color, title, sub, chip) {
    var b = el('div', 'sblock' + (SHOP_OPEN[key] ? ' open' : '')), h = el('button', 'shead'); h.type = 'button'; h.setAttribute('aria-expanded', !!SHOP_OPEN[key]);
    var m = el('span', 'qmedal sm'); m.style.background = tint(color); m.style.color = color; m.style.borderColor = color; m.appendChild(ico(icon)); h.appendChild(m);
    var tx = el('span', 'stx'); tx.appendChild(el('b', null, title)); tx.appendChild(el('small', null, sub)); h.appendChild(tx);
    if (chip) h.appendChild(el('span', 'chip', chip));
    var cv = el('span', 'chev'); cv.appendChild(ico('chevron')); h.appendChild(cv);
    h.onclick = function () { SHOP_OPEN[key] = !SHOP_OPEN[key]; if (SHOP_OPEN[key]) track('shop/open/' + key); renderShop(); };
    b.appendChild(h); root.appendChild(b);
    if (!SHOP_OPEN[key]) return null;
    var body = el('div', 'sbody'); b.appendChild(body); return body;
  }
  function payLink(text, url, key) { var a = link(text, url, 'btn wide'); a.addEventListener('click', function () { track('shop/checkout/' + key); }); return a; }
  function unlockCode(k, sid) { return 'FLC-' + (k === 'pack' ? 'PACK' : 'MEC') + '-' + String(sid).replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase(); }
  function applyPurchase(k, code) {
    // A support code gives the badge and the pack; an FLC-PACK code (never sold) still gives the pack
    st.pack = true; if (k === 'mecene') st.mecene = true;
    save(); THANKS = { k: k, code: code }; SHOP_OPEN[k] = true; track('shop/paid/' + k);
  }
  function renderShop() {
    var root = $('shop'); root.textContent = '';
    if (THANKS) {
      var th = el('div', 'thanks'); th.appendChild(el('b', null, THANKS.k === 'pack' ? t('thxPack') : t('thxMec')));
      th.appendChild(el('p', 'meta', t('thxCode'))); th.appendChild(el('code', null, THANKS.code)); root.appendChild(th);
    }
    // 1. Support, thanked by the Mécène badge and the collector pack; the pack also comes without paying
    var b1 = sblock(root, 'mecene', 'heart', '#b8707d', t('mecT'), t('mecSub'), st.mecene ? '✓' : t('mecChip', SHOP.mecene.suggested));
    if (b1) {
      var strip = el('div', 'strip');
      AVATARS.filter(function (x) { return x[3]; }).forEach(function (x) { var w = el('span', 'fw'); w.appendChild(avEl(x[0], 'none')); w.appendChild(el('small', null, x[1 + LI])); strip.appendChild(w); });
      b1.appendChild(strip); strip = el('div', 'strip'); // avatars on one row, frames on the next
      FRAMES.filter(function (x) { return x[3]; }).forEach(function (x) { var w = el('span', 'fw'); w.appendChild(avEl('user', x[0])); w.appendChild(el('small', null, x[1 + LI])); strip.appendChild(w); });
      b1.appendChild(strip);
      if (st.mecene) b1.appendChild(el('p', 'okline', t('mecHave')));
      else if (st.pack) b1.appendChild(el('p', 'okline', t('packHave')));
      if (st.pack) { var tp = el('button', 'btn soft wide', t('toProfile')); tp.type = 'button'; tp.onclick = function () { tab('me'); }; b1.appendChild(tp); }
      if (st.mecene) { /* already thanked */ }
      else if (!SHOP.mecene.url) b1.appendChild(el('p', 'meta', t('soon')));
      else { b1.appendChild(payLink(t('mecBuy', SHOP.mecene.suggested), SHOP.mecene.url, 'mecene')); b1.appendChild(el('p', 'small', t('stripe'))); }
      if (!st.pack) {
        var fr = el('button', 'linkbtn', t('packFree')); fr.type = 'button';
        fr.onclick = function () { st.pack = true; save(); track('shop/pack-free'); toast(t('packFreeOk')); renderMe(); renderShop(); };
        b1.appendChild(fr);
      }
    }
    // 2. Groups (booked by e-mail until the server exists)
    var minP = SHOP.groupPrices.length ? SHOP.groupPrices[0].price : 0;
    var b2 = sblock(root, 'group', 'team', '#4a5bb8', t('grpT'), t('grpSub'), minP ? t('grpFrom', minP) : '');
    if (b2) {
      b2.appendChild(el('p', 'sh4', t('grp1')));
      var cur = SHOP.groups.filter(function (q) { return q.id === GQ; })[0] || SHOP.groups[0];
      SHOP.groups.forEach(function (q) {
        var c = el('button', 'gq'); c.type = 'button'; c.setAttribute('aria-pressed', q.id === cur.id);
        var m = el('span', 'qmedal'); m.style.background = tint(q.color); m.style.color = q.color; m.style.borderColor = q.color; m.appendChild(ico(q.icon)); c.appendChild(m);
        var bx = el('span', 'gqb'); bx.appendChild(el('b', null, q.name[LANG])); bx.appendChild(el('small', null, q.dur + ' · ' + q.km + ' km'));
        (q.pts[LANG] || []).forEach(function (p) { bx.appendChild(el('span', 'gpt', p)); });
        c.appendChild(bx); c.onclick = function () { GQ = q.id; renderShop(); };
        b2.appendChild(c);
      });
      b2.appendChild(el('p', 'sh4', t('grp2', cur.name[LANG])));
      var tiers = el('div', 'tiers');
      SHOP.groupPrices.forEach(function (g) { var x = el('div', 'tier'); x.appendChild(el('b', null, LANG === 'en' ? '€' + g.price : g.price + ' €')); x.appendChild(el('small', null, t('grpUpTo', g.players))); tiers.appendChild(x); });
      b2.appendChild(tiers);
      b2.appendChild(el('p', 'meta', t('grpMore')));
      var mail = link(t('grpContact'), 'mailto:' + SHOP.email + '?subject=' + encodeURIComponent(t('grpMailS')) + '&body=' + encodeURIComponent(t('grpMailB', cur.name[LANG]).replace(/\n/g, String.fromCharCode(10))), 'btn wide');
      mail.addEventListener('click', function () { track('shop/group-contact/' + cur.id); });
      b2.appendChild(mail);
    }
    // A purchase code (another phone, or the installed game on an iPhone, which has its own storage)
    var cq = el('button', 'linkbtn', t('codeQ')); cq.type = 'button'; cq.onclick = function () { codeOpen = !codeOpen; renderShop(); }; root.appendChild(cq);
    if (codeOpen) {
      var ci = el('div', 'codein'), inp = el('input'); inp.placeholder = 'FLC-MEC-XXXXXXXX'; inp.autocapitalize = 'characters'; ci.appendChild(inp);
      var ok = el('button', 'btn', t('codeOk')); ok.type = 'button';
      ok.onclick = function () {
        var m = /^FLC-(PACK|MEC)-[A-Z0-9]{8}$/.exec(inp.value.trim().toUpperCase());
        if (!m) { toast(t('codeBad')); return; }
        codeOpen = false; applyPurchase(m[1] === 'PACK' ? 'pack' : 'mecene', m[0]); hud(); renderMe(); renderShop();
      };
      ci.appendChild(ok); root.appendChild(ci);
    }
  }

  function renderAll() { renderLive(); renderDex(); renderQuests(); renderMe(); renderShop(); hud(); }
  function tab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.toggle('on', s.id === 's-' + name); });
    closeSheet(); $('lpanel').classList.remove('on');
    if (name === 'map') setTimeout(function () { map.invalidateSize(); }, 50);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { tab(b.getAttribute('data-tab')); }; });
  $('mebtn').onclick = function () { tab('me'); };
  $('back').addEventListener('click', function () { track('back-site'); });
  if (LANG === 'en') $('back').href = '/?lang=en';

  (function () {
    var q = new URLSearchParams(location.search), k = q.get('merci'), sid = q.get('session_id') || '';
    if (k === 'mecene' && /^cs_(live|test)_[A-Za-z0-9]{10,}$/.test(sid)) { applyPurchase(k, unlockCode(k, sid)); if (!st.onboarded) { st.onboarded = true; save(); } }
    if (k) try { history.replaceState(null, '', location.pathname + '#boutique'); } catch (e) {}
  })();
  chrome(); refreshRange(); panel(); liveBar(); draw(); renderAll();
  if (!st.onboarded) { renderOnb(); onb.classList.add('on'); }
  else if (st.geo === 'oui') startGeo();
  // ── Home screen (23/11): Android/Chrome gives a prompt to keep for later; iPhone needs two taps
  // in Safari's Share menu, which a page cannot trigger: there, the card shows them. Offered after
  // the first thing collected, never on arrival; « Plus tard » waits 7 days. Never once installed.
  function canInstall() { return !standalone && (deferred || ios); }
  function instLater() { try { var v = localStorage.getItem(IKEY); return v === 'installed' || (v && Date.now() - (+v) < 7 * 864e5); } catch (e) { return false; } }
  function collected() { return Object.keys(st.spots).length + Object.keys(st.events).length + Object.keys(st.invaders).length; }
  function installCard(force) {
    var box = $('install'); box.textContent = '';
    var img = el('img'); img.src = ICON_192; img.alt = ''; box.appendChild(img);
    box.appendChild(el('b', null, t('instH'))); box.appendChild(el('small', null, t('instSub')));
    var row = el('div', 'row2');
    if (deferred) {
      var add = el('button', 'btn', t('instAdd')); add.type = 'button';
      add.onclick = function () {
        var d = deferred; deferred = null; box.hidden = true; d.prompt();
        if (d.userChoice) d.userChoice.then(function (r) { track('install/' + r.outcome); }, function () {});
      };
      row.appendChild(add);
    } else if (ios) {
      var hint = el('p', 'ios'); hint.appendChild(document.createTextNode(t('instIos1'))); hint.appendChild(ico('share')); hint.appendChild(document.createTextNode(t('instIos2'))); box.appendChild(hint);
    } else {
      box.appendChild(el('p', 'ios', t('instMenu'))); // no prompt from the browser (yet): its own menu does it
    }
    var later = el('button', 'btn soft', t('instLater')); later.type = 'button';
    later.onclick = function () { box.hidden = true; if (!force) { try { localStorage.setItem(IKEY, String(Date.now())); } catch (e) {} track('install/later'); } };
    row.appendChild(later); box.appendChild(row);
    box.hidden = false; track('install/shown');
  }
  function maybeInstall(delay) {
    if (instShown || !st.onboarded || !canInstall() || instLater() || !collected()) return;
    setTimeout(function () {
      if (instShown || luShowing || luQueue.length || $('onb').classList.contains('on')) return;
      instShown = true; closeSheet(); installCard(false);
    }, delay || 3500);
  }
  // The browser offers the install again: the game is not installed (any more). 23/11: after an
  // uninstall the old « installed » note hid the offer for good.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    try { if (localStorage.getItem(IKEY) === 'installed') localStorage.removeItem(IKEY); } catch (x) {}
    renderMe(); maybeInstall(5000);
  });
  window.addEventListener('appinstalled', function () { $('install').hidden = true; deferred = null; try { localStorage.setItem(IKEY, 'installed'); } catch (e) {} track('install/done'); renderMe(); });
  var gain0 = gain; gain = function (xp, why) { gain0(xp, why); maybeInstall(); };
  maybeInstall(6000);
  // Offline: the site's service worker (network first) keeps a copy of the pages one has opened.
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {}); } catch (e) {}

  // Shareable anchors: #carte, #direct, #collection, #quetes, #profil, #lieu-<id> (a place's sheet).
  function fromHash() {
    var h = location.hash.slice(1), tabs = { carte: 'map', direct: 'live', collection: 'dex', quetes: 'quests', profil: 'me', boutique: 'shop' };
    if (tabs[h]) tab(tabs[h]);
    var p = /^lieu-([a-z0-9-]+)$/.exec(h) && spotById(h.slice(5));
    if (p && st.onboarded) { tab('map'); map.setView([p.lat, p.lng], 16); openSpot(p); }
  }
  fromHash(); window.addEventListener('hashchange', fromHash);
})();
`;

module.exports = { JEU_DIR, jeuPage, jeuManifest, jeuEvents, jeuContent };
