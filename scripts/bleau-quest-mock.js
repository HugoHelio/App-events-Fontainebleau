#!/usr/bin/env node
/**
 * Bleau Quest — clickable mock-up (item 116a, GDD: Bleau-Quest-GDD.md).
 *
 *   node scripts/bleau-quest-mock.js            writes reports/bleau-quest/maquette.html, serves it on
 *                                               http://localhost:8517/ and opens it (Ctrl+C to stop)
 *   node scripts/bleau-quest-mock.js --no-open  same, without opening the browser
 *   node scripts/bleau-quest-mock.js --file     writes the page only (the map stays grey: see below)
 *
 * Why a local server: OpenStreetMap refuses tile requests without a Referer, and a page opened from
 * file:// sends none (« Access blocked », 21/11). Served from localhost, the browser sends one.
 * The server only serves this page and vendor/, on 127.0.0.1.
 *
 * A mock-up, not the game: one local page (never committed, reports/ is ignored), French only,
 * the site's colours, no art direction yet (GDD §10). What is real:
 *   - the places' positions (OpenStreetMap, looked up on 20-21/11; the theatre from venues.json);
 *   - the events layer: events from data.json confirmed by a source we read (never Gemini alone,
 *     the carousel's rule), placed where data.json places them.
 * What is NOT real: the cards' texts, the questions, the XP scale, the shop. The five climbing
 * sites are a proposal to check with climbers (116k). Nothing here may be published as is.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const G = require('./generate-pages');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reports', 'bleau-quest');
const PORT = Number(process.env.PORT) || 8517;
const CONFIRMED = new Set(['site', 'datatourisme', 'openagenda', 'francebillet']);
const CENTRE = { lat: 48.4045, lng: 2.7016 };
const EVENT_KM = 12;     // beyond, the map is too full to read on a phone
const EVENT_DAYS = 7;
const SEASON_KM = 15;
const SEASON_DAYS = 40;
const SEASON_RE = /no[eë]l|avent|saint[- ]nicolas|illumination/i;

// Positions: OpenStreetMap (Nominatim, 20-21/11/2026), theatre from venues.json. Texts: placeholders.
const SPOTS = [
  { id: 'cour-des-adieux', name: 'Cour des Adieux', set: 'napoleon', type: 'Monument', rarity: 'commun', lat: 48.40204, lng: 2.69810, icon: '🏰' },
  { id: 'jardin-de-diane', name: 'Jardin de Diane', set: 'chateau', type: 'Jardin', rarity: 'commun', lat: 48.40295, lng: 2.69973, icon: '⛲' },
  { id: 'theatre', name: 'Théâtre municipal', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', lat: 48.40335, lng: 2.69762, icon: '🎭' },
  { id: 'obelisque', name: 'Obélisque de Marie-Antoinette', set: 'chateau', type: 'Monument', rarity: 'commun', lat: 48.39705, lng: 2.69227, icon: '🗿' },
  { id: 'mont-ussy', name: 'Mont Ussy', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'peu commun', lat: 48.42699, lng: 2.69645, icon: '🌳' },
  { id: 'tour-denecourt', name: 'Tour Denecourt', set: 'denecourt', type: 'Belvédère', rarity: 'rare', lat: 48.43382, lng: 2.72621, icon: '🗼' },
  { id: 'rocher-cassepot', name: 'Rocher Cassepot', set: 'denecourt', type: 'Rocher nommé', rarity: 'peu commun', lat: 48.43503, lng: 2.73366, icon: '🪨' },
  { id: 'grand-veneur', name: 'Croix du Grand Veneur', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', lat: 48.43041, lng: 2.66126, icon: '✝️' },
  { id: 'franchard', name: 'Gorges de Franchard', set: 'foret', type: 'Gorges', rarity: 'rare', lat: 48.40812, lng: 2.62024, icon: '⛰️' },
  { id: 'apremont', name: 'Gorges d’Apremont', set: 'foret', type: 'Gorges', rarity: 'rare', lat: 48.43601, lng: 2.62568, icon: '⛰️' },
  { id: 'musee-barbizon', name: 'Musée de l’École de Barbizon', set: 'peintres', type: 'Maison de peintres', rarity: 'peu commun', lat: 48.44619, lng: 2.60261, icon: '🎨' },
  // « 5 Must Climb » in its family version (21/11): five places to visit and try, not five hard
  // problems. A proposal, to be checked with climbers (116k).
  { id: 'bas-cuvier', name: 'Bas Cuvier', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.44617, lng: 2.63734, icon: '🧗' },
  { id: 'rocher-canon', name: 'Rocher Canon', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.46308, lng: 2.66281, icon: '🧗' },
  { id: 'canche-aux-merciers', name: 'Canche aux Merciers', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.39102, lng: 2.54895, icon: '🧗' },
  { id: 'cul-de-chien', name: 'Cul de Chien', set: 'grimpe', type: 'Site de bloc et sable', rarity: 'rare', lat: 48.37685, lng: 2.52281, icon: '🏖️' },
  { id: 'elephant', name: 'L’Éléphant (Larchant)', set: 'grimpe', type: 'Rocher nommé', rarity: 'rare', lat: 48.29379, lng: 2.59458, icon: '🐘' },
];

const SETS = {
  napoleon: 'Napoléon à Fontainebleau',
  chateau: 'Le château et ses jardins',
  ville: 'La ville',
  denecourt: 'Les sentiers bleus',
  foret: 'Grands sites de la forêt',
  peintres: 'Les peintres de Barbizon',
  grimpe: '5 Must Climb, en famille',
};

function km(a, b) {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

function confirmedEvents() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.events || [];
  return list.filter((e) => e && e.id && e.title && CONFIRMED.has(e.source) && Number.isFinite(e.lat) && Number.isFinite(e.lng));
}
const endOf = (e) => (/^\d{4}-\d{2}-\d{2}$/.test(String(e.endDate || '')) ? e.endDate : e.startDate);
const slim = (e) => ({ id: e.id, title: e.title, cat: e.category || '', city: e.city, place: e.locationName || e.city,
  lat: e.lat, lng: e.lng, start: e.startDate, end: endOf(e), when: G.dateLabel(e), schedule: e.schedule || '',
  page: e.pageUrl || '', season: SEASON_RE.test(e.title) });

// This week's events near the centre, and the season's (Christmas now) a little further and longer.
function layers(today) {
  const all = confirmedEvents();
  const week = all.filter((e) => e.startDate <= G.addDays(today, EVENT_DAYS - 1) && endOf(e) >= today
    && G.spanDays(e) <= 4 && km(CENTRE, e) <= EVENT_KM).map(slim);
  const seen = new Set(week.map((e) => e.id));
  const season = all.filter((e) => !seen.has(e.id) && SEASON_RE.test(e.title) && endOf(e) >= today
    && e.startDate <= G.addDays(today, SEASON_DAYS) && G.spanDays(e) <= SEASON_DAYS && km(CENTRE, e) <= SEASON_KM).map(slim);
  return { week, season };
}

// JSON inside <script>: no "</script>" or "<!--" can close or confuse it.
const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function page(today, week, season) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bleau Quest — maquette</title>
<link rel="stylesheet" href="../../vendor/leaflet-1.9.4/leaflet.css">
<style>
:root{--ink:#1d3b29;--accent:#afe14f;--paper:#fff;--bg:#f4f3ef;--line:#e6e2da;--muted:#5b645e;--live:#e0262f;--gold:#e3a51a;
--commun:#8a8f8b;--peu-commun:#2f8f5b;--rare:#2f63b8;--legendaire:#c28a14}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#d9d6cd;font:15px/1.4 "Segoe UI",-apple-system,Roboto,Arial,sans-serif;color:#1f2622}
.stage{display:flex;gap:28px;justify-content:center;align-items:flex-start;padding:20px 16px;flex-wrap:wrap}
.notes{max-width:360px;font-size:14px;color:#333}.notes h1{font-size:20px;margin:0 0 6px}.notes code{background:#eee;padding:0 4px;border-radius:3px}
.notes button{font:inherit;font-size:13px;margin:2px 4px 2px 0}
.phone{position:relative;width:390px;height:800px;background:var(--bg);border:12px solid #111;border-radius:40px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column}
@media (max-width:520px){.stage{padding:0}.notes{display:none}.phone{width:100vw;height:100vh;height:100dvh;border:0;border-radius:0}}
.top{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--ink);color:#fff}
.lvl{width:38px;height:38px;border-radius:50%;background:var(--accent);color:var(--ink);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
.who{flex:1;min-width:0}.who b{display:block;font-size:14px}.bar{height:7px;background:rgba(255,255,255,.25);border-radius:9px;overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:var(--accent);width:0;transition:width .6s}
.xp{font-size:12px;opacity:.85}.teamchip{font-size:11px;font-weight:700;background:rgba(255,255,255,.15);padding:3px 8px;border-radius:999px;display:none}.teamchip.on{display:inline-block}
.screen{flex:1;position:relative;overflow:auto;display:none}.screen.on{display:block}
#map{position:absolute;inset:0;background:#e8e4da}
#map.doux .leaflet-tile-pane{filter:saturate(.4) sepia(.25) brightness(1.05)}
#map.nuit .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9)}
.livebar{position:absolute;z-index:500;top:10px;left:10px;right:62px;display:flex;align-items:center;gap:8px;background:#fff;border:0;border-radius:14px;padding:8px 12px;box-shadow:0 1px 6px rgba(0,0,0,.25);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.livebar b{color:var(--live)}.livebar .dot{width:10px;height:10px;border-radius:50%;background:var(--live);flex:none;animation:blink 1.4s infinite}
@keyframes blink{50%{opacity:.3}}
.lbtn{position:absolute;z-index:500;top:10px;right:10px;width:44px;height:44px;border-radius:12px;border:0;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25);font-size:20px;cursor:pointer}
.lpanel{position:absolute;z-index:950;top:60px;right:10px;left:10px;background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.3);padding:12px 14px;display:none}
.lpanel.on{display:block}.lpanel h4{margin:4px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.lgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.lgrid button{font:inherit;font-size:12px;border:2px solid transparent;background:#f3f4f1;border-radius:12px;padding:8px 4px;cursor:pointer;color:var(--ink)}
.lgrid button span{display:block;font-size:22px;margin-bottom:2px}
.lgrid button[aria-pressed="true"]{border-color:var(--ink);background:#eef7dc;font-weight:700}
.lgrid .thumb{height:34px;border-radius:8px;margin-bottom:4px}
.sim{position:absolute;z-index:500;bottom:12px;left:10px;right:10px;font:inherit;font-size:13px;font-weight:600;padding:8px;background:#fffbe6;border:1px dashed #c28a14;border-radius:12px;text-align:center;cursor:pointer}
.sim.armed{background:#c28a14;color:#fff}
.tabs{display:flex;background:#fff;border-top:1px solid var(--line)}
.tabs button{flex:1;font:inherit;font-size:12px;border:0;background:none;padding:8px 0 10px;color:var(--muted);cursor:pointer;position:relative}
.tabs button span{display:block;font-size:20px}.tabs button[aria-selected="true"]{color:var(--ink);font-weight:700}
.tabs .nb{position:absolute;top:4px;left:56%;background:var(--live);color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:0 5px}
.pin{width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.4);position:relative}
.pin.locked{filter:grayscale(1);opacity:.8}
.pin.got::after{content:"✓";position:absolute;right:-6px;top:-6px;width:16px;height:16px;border-radius:50%;background:var(--accent);color:var(--ink);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
.qnum{width:20px;height:20px;border-radius:50%;background:var(--gold);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.evt{position:relative;width:30px;height:30px;border-radius:8px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.4)}
.evt i{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-style:normal;font-size:10px;font-weight:800;background:#fff;color:var(--ink);border-radius:6px;padding:0 4px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.evt.live{border-color:var(--live);box-shadow:0 0 0 0 rgba(224,38,47,.7);animation:pulse 1.8s infinite}
.evt.live i{background:var(--live);color:#fff}
.evt.star{width:38px;height:38px;font-size:19px;border:3px solid var(--gold)}
.evt.star::before{content:"★";position:absolute;top:-10px;right:-10px;font-size:15px;color:var(--gold);text-shadow:0 0 2px #fff,0 0 2px #fff}
.evt.got{filter:grayscale(.7);opacity:.7}
.evt.season{border-color:#1d7a43}
@keyframes pulse{70%{box-shadow:0 0 0 12px rgba(224,38,47,0)}100%{box-shadow:0 0 0 0 rgba(224,38,47,0)}}
.me{width:18px;height:18px;border-radius:50%;background:#2f7cf6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(47,124,246,.25)}
.sheet{position:absolute;z-index:900;left:0;right:0;bottom:0;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.25);transform:translateY(105%);transition:transform .3s;max-height:88%;overflow:auto}
.sheet.on{transform:none}
.art{height:140px;display:flex;align-items:center;justify-content:center;font-size:60px;position:relative}
.art .r{position:absolute;left:12px;top:12px;font-size:12px;font-weight:700;color:#fff;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.art .x,.close{position:absolute;right:10px;top:8px;font-size:24px;background:rgba(255,255,255,.85);border:0;border-radius:50%;width:34px;height:34px;cursor:pointer;line-height:1}
.body{padding:14px 16px 20px;position:relative}
.body h2{margin:0;font-size:20px;color:var(--ink);padding-right:30px}
.meta{color:var(--muted);font-size:13px;margin:2px 0 10px}
.todo{background:#fff6e0;border:1px dashed #d7a640;border-radius:8px;padding:8px 10px;font-size:13px;color:#6b4a12;margin:8px 0}
.acts{display:grid;gap:8px;margin-top:12px}
.btn{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px;cursor:pointer;background:var(--ink);color:#fff}
.btn.alt{background:#fff;color:var(--ink);border:1.5px solid var(--ink)}
.btn.soft{background:#eef0ec;color:var(--ink)}
.btn.live{background:var(--live)}
.btn:disabled{opacity:.45;cursor:default}
.got-banner{background:var(--accent);color:var(--ink);font-weight:700;border-radius:10px;padding:8px 12px;margin-top:10px}
.xpchip{display:inline-block;font-size:12px;font-weight:800;background:var(--accent);color:var(--ink);border-radius:999px;padding:2px 8px;white-space:nowrap}
.xpchip.gold{background:var(--gold);color:#fff}
.livechip{display:inline-block;font-size:11px;font-weight:800;background:var(--live);color:#fff;border-radius:999px;padding:2px 8px;text-transform:uppercase}
.q{display:none;gap:6px;margin-top:6px}.q.on{display:flex}.q input{flex:1;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px}
.pad{padding:14px 14px 24px}
.pad h2{font-size:18px;color:var(--ink);margin:6px 0 10px}
.set{background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;border:1px solid var(--line)}
.set h3{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between;gap:8px}
.prog{height:6px;background:#e9ece6;border-radius:9px;overflow:hidden;margin-bottom:6px}.prog i{display:block;height:100%;background:var(--peu-commun)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.card{aspect-ratio:3/4;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:26px;color:#fff;cursor:pointer;border:0;font-family:inherit}
.card small{font-size:10px;line-height:1.1;text-align:center;padding:4px;color:#fff}
.card.locked{background:#cfd3cc!important;color:#8a8f8b}.card.locked small{color:#6e746f}
.ev-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;background:#fff;border:0;border-bottom:1px solid var(--line);padding:10px 2px;cursor:pointer}
.ev-row .ic{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}
.ev-row .tx{flex:1;min-width:0}.ev-row .tx b{display:block;font-size:14px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ev-row .tx span{font-size:12px;color:var(--muted)}
.day{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 2px}
.quest{background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;border:1px solid var(--line)}
.quest b{color:var(--ink)}.quest p{margin:4px 0 8px;font-size:13px;color:var(--muted)}
.quest.hot{border:2px solid var(--live)}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef0ec;color:var(--ink);margin-right:4px}
.badges{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.badge{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 4px;text-align:center;font-size:24px}
.badge small{display:block;font-size:10px;color:var(--muted)}.badge.off{filter:grayscale(1);opacity:.4}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.stat{background:#fff;border-radius:12px;padding:10px;text-align:center;border:1px solid var(--line)}.stat b{display:block;font-size:20px;color:var(--ink)}
.offer{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:8px}
.offer .ic{font-size:24px}.offer b{color:var(--ink)}.offer p{margin:2px 0 0;font-size:13px;color:var(--muted)}.offer .price{margin-left:auto;font-weight:800;color:var(--ink);white-space:nowrap}
.toast{position:absolute;z-index:1200;left:50%;top:70px;transform:translate(-50%,-20px);background:var(--ink);color:#fff;padding:10px 16px;border-radius:999px;font-weight:700;opacity:0;transition:.3s;pointer-events:none;white-space:nowrap}
.toast.on{opacity:1;transform:translate(-50%,0)}
.levelup{position:absolute;inset:0;z-index:1100;background:rgba(29,59,41,.92);color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
.levelup.on{display:flex}.levelup .n{font-size:72px;font-weight:900;color:var(--accent)}
/* Entry flow */
.onb{position:absolute;inset:0;z-index:1150;background:var(--bg);display:none;flex-direction:column}
.onb.on{display:flex}
.onb .dots{display:flex;gap:6px;justify-content:center;padding:14px 0 0}.onb .dots i{width:7px;height:7px;border-radius:50%;background:#cfd3cc}.onb .dots i.on{background:var(--ink);width:20px;border-radius:9px}
.onb .skip{position:absolute;right:14px;top:8px;font:inherit;font-size:13px;border:0;background:none;color:var(--muted);cursor:pointer}
.onb .in{flex:1;overflow:auto;padding:18px 22px 10px;display:flex;flex-direction:column}
.onb h1{font-size:26px;color:var(--ink);margin:10px 0 6px;line-height:1.15}.onb .lead{color:var(--muted);margin:0 0 16px}
.onb .hero{height:210px;border-radius:22px;background:linear-gradient(160deg,#1d3b29,#2f6b44 60%,#afe14f);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:64px;margin-top:8px}
.onb .hero b{font-size:30px;letter-spacing:.02em;margin-top:6px}.onb .hero small{font-size:14px;opacity:.9}
.onb .feat{display:flex;gap:12px;align-items:center;margin:8px 0}.onb .feat span{font-size:24px;width:40px;height:40px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none;border:1px solid var(--line)}
.choice{display:flex;gap:12px;align-items:center;width:100%;text-align:left;font:inherit;background:#fff;border:2px solid var(--line);border-radius:14px;padding:12px;margin-bottom:8px;cursor:pointer}
.choice span{font-size:26px}.choice b{display:block;color:var(--ink)}.choice small{color:var(--muted)}
.choice[aria-pressed="true"]{border-color:var(--ink);background:#eef7dc}
.choice:disabled{opacity:.55;cursor:default}
.onb .foot{padding:10px 22px 22px;display:grid;gap:8px}
.onb input{font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;width:100%;margin:4px 0 8px}
.firstq{background:#fff;border:2px solid var(--gold);border-radius:18px;padding:16px;text-align:center}
.firstq .big{font-size:52px}.firstq b{display:block;font-size:18px;color:var(--ink);margin:6px 0 2px}
</style></head><body>
<div class="stage">
<div class="notes">
<h1>Bleau Quest — maquette M0 (v2)</h1>
<p><b>Ce qui est réel</b> : les positions des lieux (OpenStreetMap) ; la couche <b>Événements</b>, ${week.length} sorties de la semaine du ${G.frDate(today)} à moins de ${EVENT_KM} km ; la couche <b>Saison</b>, ${season.length} rendez-vous de Noël des ${SEASON_DAYS} prochains jours. Toutes confirmées par une source lue, tirées de <code>data.json</code>.</p>
<p><b>Ce qui ne l’est pas</b> : textes, questions, barème d’XP, boutique (rien n’est vendu), style graphique. Les 5 sites de grimpe sont une proposition à valider avec des grimpeurs.</p>
<p><b>Essayer</b> : le parcours d’entrée s’ouvre au premier lancement. Puis le bouton des couches (en haut à droite), le bandeau « en direct », un événement, un lieu ; « Simuler ma position » puis touchez la carte pour essayer le GPS.</p>
<p><button type="button" id="replay">Revoir l’accueil</button><button type="button" id="reset">Tout remettre à zéro</button></p>
<p>Fenêtre étroite (moins de 520 px) : la maquette prend tout l’écran, comme sur un téléphone.</p>
</div>
<div class="phone" id="phone">
<div class="top"><div class="lvl" id="lvl">1</div><div class="who"><b id="title">Promeneur</b><div class="bar"><i id="xpbar"></i></div><span class="xp" id="xptxt"></span></div><span class="teamchip" id="teamchip"></span></div>
<section class="screen on" id="s-map"><div id="map"></div>
<button type="button" class="livebar" id="livebar"><span class="dot"></span><span id="livetxt"></span></button>
<button type="button" class="lbtn" id="lbtn" aria-label="Couches" aria-expanded="false">🗂️</button>
<div class="lpanel" id="lpanel">
<h4>Type de carte</h4>
<div class="lgrid" id="bases"></div>
<h4>Couches</h4>
<div class="lgrid" id="overlays"></div>
</div>
<button type="button" class="sim" id="sim">🎯 Simuler ma position (touchez la carte ensuite)</button></section>
<section class="screen" id="s-live"><div class="pad" id="live"></div></section>
<section class="screen" id="s-dex"><div class="pad" id="dex"></div></section>
<section class="screen" id="s-quests"><div class="pad" id="quests"></div></section>
<section class="screen" id="s-me"><div class="pad" id="me"></div></section>
<div class="sheet" id="sheet"></div>
<div class="onb" id="onb"></div>
<div class="toast" id="toast"></div>
<div class="levelup" id="levelup"><div>Niveau</div><div class="n" id="lu-n"></div><div id="lu-t" style="font-size:20px;font-weight:700"></div><p>Nouveau titre débloqué</p><button type="button" class="btn alt" id="lu-ok">Continuer</button></div>
<nav class="tabs" role="tablist">
<button type="button" role="tab" aria-selected="true" data-tab="map"><span>🗺️</span>Carte</button>
<button type="button" role="tab" aria-selected="false" data-tab="live"><span>🔴</span>En direct<em class="nb" id="nb"></em></button>
<button type="button" role="tab" aria-selected="false" data-tab="dex"><span>🃏</span>Collection</button>
<button type="button" role="tab" aria-selected="false" data-tab="quests"><span>📜</span>Quêtes</button>
<button type="button" role="tab" aria-selected="false" data-tab="me"><span>👤</span>Profil</button>
</nav>
</div>
</div>
<script src="../../vendor/leaflet-1.9.4/leaflet.js"></script>
<script>
var SPOTS = ${inline(SPOTS)};
var SETS = ${inline(SETS)};
var EVENTS = ${inline(week)};
var SEASON = ${inline(season)};
var TODAY = ${inline(today)};
${CLIENT}
</script>
</body></html>
`;
}

// The page's own script. Every text from the data goes through textContent (frontend rule);
// innerHTML only ever receives fixed markup written here.
const CLIENT = String.raw`
(function () {
  var XP = { 'commun': 50, 'peu commun': 100, 'rare': 200, 'légendaire': 500 };
  var EVENT_XP = 150, FEATURED_XP = 300, SEASON_BONUS = 50, SET_XP = 500, ALL_CATS_XP = 300, WELCOME_XP = 50;
  var RADIUS = { ville: 100, foret: 150, event: 200 };
  var TITLES = [[1, 'Promeneur'], [3, 'Flâneur'], [5, 'Bellifontain'], [8, 'Bleausard'], [12, 'Peintre de Barbizon'], [20, 'Denecourt']];
  var RCOL = { 'commun': 'var(--commun)', 'peu commun': 'var(--peu-commun)', 'rare': 'var(--rare)', 'légendaire': 'var(--legendaire)' };
  var SETCOL = { napoleon: '#7a3b2e', chateau: '#8f6a25', ville: '#4a5bb8', denecourt: '#2f6f8f', foret: '#3d6b2a', peintres: '#9a5a2a', grimpe: '#6b4a8f' };
  var CATS = { 'Scène & Spectacles': ['🎭', '#c2334d', 'Scène'], 'Culture & Ateliers': ['🎨', '#7b4fb0', 'Culture'],
    'Nature & Environnement': ['🌿', '#2f8f5b', 'Nature'], 'Sport & Outdoor': ['🏃', '#2f63b8', 'Sport'] };
  var CHAPTER = ['cour-des-adieux', 'jardin-de-diane', 'theatre'];
  var KEY = 'bleau-quest-mock-v2';
  var st = load();
  function fresh() { return { xp: 0, spots: {}, events: {}, plans: {}, sets: {}, eco: false, onboarded: false, profile: '', likes: [], team: '', geo: '' }; }
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY)); return s && s.spots ? s : fresh(); } catch (e) { return fresh(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function $(id) { return document.getElementById(id); }
  function cat(e) { return CATS[e.cat] || ['★', '#555', 'Sortie']; }
  function byId(id) { return EVENTS.concat(SEASON).filter(function (x) { return x.id === id; })[0]; }
  function dayShort(d) { return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''); }
  function dayLong(d) { return d === TODAY ? 'Aujourd’hui' : new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function isLive(e) { return e.start <= TODAY && e.end >= TODAY; }
  function firstDay(e) { return e.start < TODAY ? TODAY : e.start; }

  // Event of the day: one of today's events, the same for everyone that day (a stable hash).
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
  var liveNow = EVENTS.filter(isLive);
  var featured = liveNow.slice().sort(function (a, b) { return hash(a.id + TODAY) - hash(b.id + TODAY); })[0] || null;
  function xpOf(e) { return (featured && e.id === featured.id ? FEATURED_XP : EVENT_XP) + (e.season ? SEASON_BONUS : 0); }

  // Level n needs 50·n·(n−1)/2 XP: 50, 150, 300, 500… (gentle start, GDD §8)
  function levelOf(xp) { var n = 1; while (50 * (n + 1) * n / 2 <= xp) n++; return n; }
  function floorOf(n) { return 50 * n * (n - 1) / 2; }
  function titleOf(n) { var t = TITLES[0][1]; TITLES.forEach(function (x) { if (n >= x[0]) t = x[1]; }); return t; }

  function hud() {
    var n = levelOf(st.xp), a = floorOf(n), b = floorOf(n + 1);
    $('lvl').textContent = n; $('title').textContent = titleOf(n);
    $('xpbar').style.width = Math.round(100 * (st.xp - a) / (b - a)) + '%';
    $('xptxt').textContent = st.xp + ' XP · niveau ' + (n + 1) + ' à ' + b;
    var tc = $('teamchip'); tc.textContent = st.team ? '👥 ' + st.team : ''; tc.classList.toggle('on', !!st.team);
  }
  function toast(t) { var x = $('toast'); x.textContent = t; x.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { x.classList.remove('on'); }, 2000); }
  function gain(xp, why) {
    var before = levelOf(st.xp); st.xp += xp; save(); hud(); toast('+' + xp + ' XP · ' + why);
    var after = levelOf(st.xp);
    if (after > before) { $('lu-n').textContent = after; $('lu-t').textContent = titleOf(after); setTimeout(function () { $('levelup').classList.add('on'); }, 900); }
  }
  $('lu-ok').onclick = function () { $('levelup').classList.remove('on'); };

  function checkSets() {
    Object.keys(SETS).forEach(function (s) {
      var all = SPOTS.filter(function (p) { return p.set === s; });
      if (!st.sets[s] && all.every(function (p) { return st.spots[p.id]; })) { st.sets[s] = true; gain(SET_XP, 'série complète : ' + SETS[s]); }
    });
    var cats = {}; Object.keys(st.events).forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    if (!st.sets.cats && Object.keys(CATS).every(function (c) { return cats[c]; })) { st.sets.cats = true; gain(ALL_CATS_XP, 'toutes les scènes'); }
  }

  // ── Map and layers ──
  var map = L.map('map', { zoomControl: false }).setView([48.408, 2.69], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  var LAYERS = {
    spots: { icon: '📍', label: 'Lieux', on: true, g: L.layerGroup() },
    events: { icon: '🔴', label: 'En direct', on: true, g: L.layerGroup() },
    quests: { icon: '📜', label: 'Quêtes', on: true, g: L.layerGroup() },
    climb: { icon: '🧗', label: 'Grimpe', on: true, g: L.layerGroup() },
    season: { icon: '🎄', label: 'Noël', on: true, g: L.layerGroup() },
    fog: { icon: '🌫️', label: 'Brouillard', on: false, g: L.layerGroup() },
  };
  var BASES = [['plan', 'Plan', '#e9e5dc'], ['doux', 'Doux', '#ece3cf'], ['nuit', 'Nuit', '#2b3540']];
  var base = 'plan';
  Object.keys(LAYERS).forEach(function (k) { if (LAYERS[k].on) LAYERS[k].g.addTo(map); });
  function panel() {
    var bs = $('bases'); bs.textContent = '';
    BASES.forEach(function (b) {
      var x = el('button'); x.type = 'button'; x.setAttribute('aria-pressed', base === b[0]);
      var t = el('div', 'thumb'); t.style.background = b[2]; x.appendChild(t); x.appendChild(document.createTextNode(b[1]));
      x.onclick = function () { base = b[0]; $('map').className = b[0] === 'plan' ? '' : b[0]; panel(); };
      bs.appendChild(x);
    });
    var ov = $('overlays'); ov.textContent = '';
    Object.keys(LAYERS).forEach(function (k) {
      var L0 = LAYERS[k], x = el('button'); x.type = 'button'; x.setAttribute('aria-pressed', L0.on);
      x.appendChild(el('span', null, L0.icon)); x.appendChild(document.createTextNode(L0.label));
      x.onclick = function () { L0.on = !L0.on; if (L0.on) L0.g.addTo(map); else map.removeLayer(L0.g); panel(); };
      ov.appendChild(x);
    });
  }
  $('lbtn').onclick = function () { var p = $('lpanel'), on = !p.classList.contains('on'); p.classList.toggle('on', on); this.setAttribute('aria-expanded', on); };
  map.on('movestart', function () { $('lpanel').classList.remove('on'); });

  function pinMarker(p, layer) {
    var got = !!st.spots[p.id];
    var m = L.marker([p.lat, p.lng], { icon: L.divIcon({ html: '<div class="pin' + (got ? ' got' : ' locked') + '" style="background:' + RCOL[p.rarity] + '"></div>', className: '', iconSize: [30, 30], iconAnchor: [15, 15] }) });
    m.on('add', function () { m.getElement().querySelector('.pin').textContent = p.icon; });
    m.on('click', function () { if (!arming) openSpot(p); });
    layer.addLayer(m);
  }
  function evtMarker(e, layer) {
    var live = isLive(e), star = featured && e.id === featured.id, got = !!st.events[e.id];
    var cls = 'evt' + (live ? ' live' : '') + (star ? ' star' : '') + (got ? ' got' : '') + (e.season ? ' season' : '');
    var size = star ? 38 : 30;
    var m = L.marker([e.lat, e.lng], { zIndexOffset: star ? 1000 : live ? 500 : 0,
      icon: L.divIcon({ html: '<div class="' + cls + '"><b></b><i></i></div>', className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) });
    m.on('add', function () {
      var d = m.getElement().querySelector('.evt'); d.style.background = cat(e)[1];
      d.querySelector('b').textContent = e.season ? '🎄' : cat(e)[0];
      d.querySelector('i').textContent = live ? 'LIVE' : dayShort(firstDay(e));
    });
    m.on('click', function () { if (!arming) openEvent(e); });
    layer.addLayer(m);
  }
  function draw() {
    Object.keys(LAYERS).forEach(function (k) { LAYERS[k].g.clearLayers(); });
    SPOTS.forEach(function (p) { pinMarker(p, p.set === 'grimpe' ? LAYERS.climb.g : LAYERS.spots.g); });
    EVENTS.forEach(function (e) { evtMarker(e, e.season ? LAYERS.season.g : LAYERS.events.g); });
    SEASON.forEach(function (e) { evtMarker(e, LAYERS.season.g); });
    CHAPTER.forEach(function (id, i) {
      var p = SPOTS.filter(function (x) { return x.id === id; })[0]; if (!p || st.spots[id]) return;
      var m = L.marker([p.lat, p.lng], { interactive: false, zIndexOffset: 800, icon: L.divIcon({ html: '<div class="qnum">' + (i + 1) + '</div>', className: '', iconSize: [20, 20], iconAnchor: [26, 26] }) });
      LAYERS.quests.g.addLayer(m);
    });
    drawFog();
  }
  // Fog of exploration: the world darkened, with a clearing around what the player has seen.
  function ring(c, r) { var pts = []; for (var i = 0; i < 28; i++) { var a = i / 28 * 2 * Math.PI; pts.push([c.lat + r / 111320 * Math.sin(a), c.lng + r / (111320 * Math.cos(c.lat * Math.PI / 180)) * Math.cos(a)]); } return pts; }
  function drawFog() {
    var holes = [];
    SPOTS.forEach(function (p) { if (st.spots[p.id]) holes.push(ring(p, 700)); });
    Object.keys(st.events).forEach(function (id) { var e = byId(id); if (e) holes.push(ring(e, 500)); });
    if (me) holes.push(ring(me, 400));
    LAYERS.fog.g.addLayer(L.polygon([[[49.2, 1.6], [49.2, 3.8], [47.6, 3.8], [47.6, 1.6]]].concat(holes), { stroke: false, fillColor: '#24302a', fillOpacity: .55, interactive: false }));
  }

  var me = null, meMarker = null, arming = false;
  $('sim').onclick = function () { arming = !arming; this.classList.toggle('armed', arming); this.textContent = arming ? '🎯 Touchez la carte là où vous êtes' : '🎯 Simuler ma position (touchez la carte ensuite)'; };
  map.on('click', function (ev) {
    if (!arming) return;
    setMe(ev.latlng.lat, ev.latlng.lng); arming = false; $('sim').classList.remove('armed'); $('sim').textContent = '🎯 Position simulée — touchez un lieu ou un événement';
  });
  function setMe(lat, lng) {
    me = { lat: lat, lng: lng };
    if (meMarker) map.removeLayer(meMarker);
    meMarker = L.marker([lat, lng], { icon: L.divIcon({ html: '<div class="me"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(map);
    LAYERS.fog.g.clearLayers(); drawFog();
  }
  function dist(a, b) {
    var r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
  }
  function radiusOf(p) { return /forêt|sentiers|grimpe|gorges/i.test(SETS[p.set] + p.type + p.set) ? RADIUS.foret : RADIUS.ville; }
  function fmtDist(d) { return d > 1500 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'; }

  function liveBar() {
    var n = liveNow.length;
    $('livetxt').textContent = '';
    var b = el('b', null, n + ' en direct'); $('livetxt').appendChild(b);
    $('livetxt').appendChild(document.createTextNode(' aujourd’hui · ' + EVENTS.length + ' cette semaine · jusqu’à +' + FEATURED_XP + ' XP'));
    $('nb').textContent = n ? String(n) : '';
  }
  $('livebar').onclick = function () { tab('live'); };

  // ── Sheets ──
  var sheet = $('sheet');
  function closeSheet() { sheet.classList.remove('on'); }
  function header(bg, icon, chip, chipCol) {
    var art = el('div', 'art'); art.style.background = bg; art.appendChild(document.createTextNode(icon));
    if (chip) { var r = el('span', 'r', chip); r.style.background = chipCol; art.appendChild(r); }
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer'); x.onclick = closeSheet; art.appendChild(x);
    return art;
  }
  function openSpot(p) {
    sheet.textContent = '';
    var got = st.spots[p.id];
    sheet.appendChild(header(got ? SETCOL[p.set] : '#cfd3cc', p.icon, p.rarity, RCOL[p.rarity]));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, p.name));
    b.appendChild(el('p', 'meta', p.type + ' · ' + SETS[p.set] + ' · ' + XP[p.rarity] + ' XP' + (me ? ' · à ' + fmtDist(dist(me, p)) : '')));
    if (p.set === 'grimpe') b.appendChild(el('div', 'todo', 'Grimper en famille : on vient voir, on essaie les premiers blocs du circuit enfants, à son niveau. Crash-pad, parade, jamais sur rocher mouillé. Le topo est chez Boolder. Proposition de site à valider avec des grimpeurs (116k).'));
    if (got) {
      b.appendChild(el('div', 'got-banner', '✓ Dans votre collection — ' + ({ gps: 'validé sur place (GPS)', question: 'validé par la question', honneur: 'validé sur l’honneur' })[got]));
      b.appendChild(el('p', null, 'Ici, la carte raconte le lieu : son histoire, une anecdote, la source.'));
      b.appendChild(el('div', 'todo', 'Texte provisoire — le vrai texte sera écrit et sourcé par le chef de projet (116d). Aucun fait n’est inventé dans le jeu.'));
    } else {
      b.appendChild(el('p', null, 'Rendez-vous sur place pour débloquer la carte de ce lieu et son histoire.'));
      var acts = el('div', 'acts');
      var gps = el('button', 'btn', '📍 Je suis ici (GPS, rayon ' + radiusOf(p) + ' m)'); gps.type = 'button';
      gps.onclick = function () {
        if (!me) { toast('Simulez d’abord votre position'); return; }
        var dd = dist(me, p);
        if (dd <= radiusOf(p)) unlock(p, 'gps'); else toast('Encore ' + fmtDist(dd - radiusOf(p)) + '… ou la question');
      };
      var qb = el('button', 'btn alt', '🔎 Répondre à la question d’observation'); qb.type = 'button';
      var q = el('div', 'q'); var inp = el('input'); inp.placeholder = 'Question à écrire sur place (116d)'; var ok = el('button', 'btn', 'OK'); ok.type = 'button';
      ok.onclick = function () { if (inp.value.trim()) unlock(p, 'question'); else toast('Une réponse, n’importe laquelle (maquette)'); };
      q.appendChild(inp); q.appendChild(ok);
      qb.onclick = function () { q.classList.toggle('on'); inp.focus(); };
      var hb = el('button', 'btn soft', '🤝 Sur l’honneur (' + XP[p.rarity] / 2 + ' XP)'); hb.type = 'button';
      hb.onclick = function () { unlock(p, 'honneur'); };
      acts.appendChild(gps); acts.appendChild(qb); acts.appendChild(q); acts.appendChild(hb);
      b.appendChild(acts);
    }
    if (p.set === 'grimpe') { var a = el('a', null, 'Topo sur Boolder →'); a.href = 'https://www.boolder.com/fr'; a.target = '_blank'; a.rel = 'noopener'; var pp = el('p'); pp.appendChild(a); b.appendChild(pp); }
    sheet.appendChild(b); sheet.classList.add('on');
  }
  function unlock(p, how) {
    st.spots[p.id] = how; save();
    gain(how === 'honneur' ? XP[p.rarity] / 2 : XP[p.rarity], p.name);
    draw(); renderAll(); openSpot(p); checkSets();
  }
  function openEvent(e) {
    sheet.textContent = '';
    var c = cat(e), live = isLive(e), star = featured && e.id === featured.id, xp = xpOf(e);
    sheet.appendChild(header(c[1], e.season ? '🎄' : c[0], star ? '★ événement du jour' : live ? 'en direct' : c[2], star ? 'var(--gold)' : live ? 'var(--live)' : 'rgba(0,0,0,.35)'));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, e.title));
    b.appendChild(el('p', 'meta', e.when + ' · ' + e.place + (e.schedule ? ' · ' + e.schedule : '') + (me ? ' · à ' + fmtDist(dist(me, e)) : '')));
    var line = el('p'); var chip = el('span', 'xpchip' + (star ? ' gold' : ''), '+' + xp + ' XP'); line.appendChild(chip);
    line.appendChild(document.createTextNode(star ? '  Événement du jour : XP doublée.' : e.season ? '  Bonus de saison compris.' : '  Une carte souvenir datée.'));
    b.appendChild(line);
    b.appendChild(el('p', 'meta', 'Passer le jour J suffit : on n’exige jamais un billet.'));
    if (st.events[e.id]) b.appendChild(el('div', 'got-banner', '✓ Carte souvenir obtenue le ' + st.events[e.id].d));
    else {
      var acts = el('div', 'acts');
      if (live) {
        var go = el('button', 'btn live', '📍 J’y suis (GPS, ' + RADIUS.event + ' m)'); go.type = 'button';
        go.onclick = function () {
          if (!me) { toast('Simulez d’abord votre position'); return; }
          var dd = dist(me, e); if (dd <= RADIUS.event) claimEvent(e, 'gps'); else toast('Encore ' + fmtDist(dd - RADIUS.event));
        };
        var hon = el('button', 'btn soft', '🤝 Sur l’honneur (' + xp / 2 + ' XP)'); hon.type = 'button'; hon.onclick = function () { claimEvent(e, 'honneur'); };
        acts.appendChild(go); acts.appendChild(hon);
      } else {
        var plan = el('button', 'btn alt', st.plans[e.id] ? '🔔 Prévu — rappel le jour J' : '🔔 J’y vais (rappel le jour J)'); plan.type = 'button';
        plan.onclick = function () { if (st.plans[e.id]) delete st.plans[e.id]; else st.plans[e.id] = 1; save(); renderAll(); openEvent(e); };
        acts.appendChild(plan);
        acts.appendChild(el('p', 'meta', 'La carte souvenir se gagne le ' + dayLong(firstDay(e)) + '.'));
      }
      var sim = el('button', 'btn soft', 'Maquette : simuler le jour J sur place'); sim.type = 'button'; sim.onclick = function () { claimEvent(e, 'gps'); };
      acts.appendChild(sim); b.appendChild(acts);
    }
    if (e.page) { var a = el('a', null, 'Voir la fiche sur Fontainebleau Live →'); a.href = 'https://fontainebleaulive.fr' + e.page; a.target = '_blank'; a.rel = 'noopener'; var pp = el('p'); pp.appendChild(a); b.appendChild(pp); }
    sheet.appendChild(b); sheet.classList.add('on');
  }
  function claimEvent(e, how) {
    var xp = how === 'honneur' ? xpOf(e) / 2 : xpOf(e);
    st.events[e.id] = { d: TODAY, how: how, cat: e.cat }; delete st.plans[e.id]; save();
    gain(xp, 'carte souvenir'); draw(); renderAll(); openEvent(e); checkSets();
  }

  // ── En direct: the site's strength, its own tab ──
  function evRow(root, e) {
    var c = cat(e), r = el('button', 'ev-row'); r.type = 'button';
    var ic = el('span', 'ic', e.season ? '🎄' : c[0]); ic.style.background = c[1]; r.appendChild(ic);
    var tx = el('span', 'tx'); tx.appendChild(el('b', null, e.title)); tx.appendChild(el('span', null, e.place + (e.schedule ? ' · ' + e.schedule : '')));
    r.appendChild(tx);
    if (st.events[e.id]) r.appendChild(el('span', 'xpchip', '✓'));
    else { if (st.plans[e.id]) r.appendChild(el('span', null, '🔔')); r.appendChild(el('span', 'xpchip' + (featured && e.id === featured.id ? ' gold' : ''), '+' + xpOf(e))); }
    r.onclick = function () { tab('map'); map.setView([e.lat, e.lng], 15); openEvent(e); };
    root.appendChild(r);
  }
  function renderLive() {
    var root = $('live'); root.textContent = '';
    root.appendChild(el('h2', null, 'En direct cette semaine'));
    root.appendChild(el('p', 'meta', 'Les sorties de l’agenda deviennent des étapes le jour J : passez-y, gagnez une carte souvenir et de l’XP.'));
    if (featured) {
      var q = el('div', 'quest hot'); q.appendChild(el('span', 'livechip', '★ Événement du jour'));
      q.appendChild(el('p', null, 'XP doublée aujourd’hui, pour tout le monde.'));
      evRow(q, featured); root.appendChild(q);
    }
    var days = {};
    EVENTS.forEach(function (e) { var d = firstDay(e); (days[d] = days[d] || []).push(e); });
    Object.keys(days).sort().forEach(function (d) {
      root.appendChild(el('div', 'day', dayLong(d) + ' · ' + days[d].length));
      days[d].forEach(function (e) { if (!(d === TODAY && featured && e.id === featured.id)) evRow(root, e); });
    });
    if (SEASON.length) {
      root.appendChild(el('div', 'day', '🎄 Noël, les semaines suivantes · ' + SEASON.length));
      SEASON.forEach(function (e) { evRow(root, e); });
    }
  }

  // ── Collection ──
  function renderDex() {
    var root = $('dex'); root.textContent = '';
    var n = Object.keys(st.spots).length;
    root.appendChild(el('h2', null, 'Collection · ' + n + ' / ' + SPOTS.length + ' lieux'));
    var ev = Object.keys(st.events);
    var box = el('div', 'set'); var h0 = el('h3'); h0.appendChild(el('span', null, '★ Cartes souvenirs')); h0.appendChild(el('span', null, String(ev.length))); box.appendChild(h0);
    if (!ev.length) box.appendChild(el('p', 'meta', 'Passez à un événement de l’agenda le jour J : chaque carte est datée, on ne la retrouvera jamais.'));
    else {
      var g = el('div', 'cards');
      ev.forEach(function (id) { var e = byId(id); if (!e) return; var c = el('div', 'card'); c.style.background = cat(e)[1]; c.appendChild(document.createTextNode(e.season ? '🎄' : cat(e)[0])); c.appendChild(el('small', null, e.title)); g.appendChild(c); });
      box.appendChild(g);
    }
    root.appendChild(box);
    Object.keys(SETS).forEach(function (s) {
      var all = SPOTS.filter(function (p) { return p.set === s; }), got = all.filter(function (p) { return st.spots[p.id]; }).length;
      var bx = el('div', 'set'), h = el('h3'); h.appendChild(el('span', null, SETS[s])); h.appendChild(el('span', null, got + '/' + all.length));
      bx.appendChild(h);
      var pr = el('div', 'prog'), pi = el('i'); pi.style.width = Math.round(100 * got / all.length) + '%'; pr.appendChild(pi); bx.appendChild(pr);
      var grid = el('div', 'cards');
      all.forEach(function (p) {
        var c = el('button', 'card' + (st.spots[p.id] ? '' : ' locked')); c.type = 'button'; c.style.background = SETCOL[s];
        c.appendChild(document.createTextNode(st.spots[p.id] ? p.icon : '?')); c.appendChild(el('small', null, p.name));
        c.onclick = function () { tab('map'); map.setView([p.lat, p.lng], 15); openSpot(p); };
        grid.appendChild(c);
      });
      bx.appendChild(grid); root.appendChild(bx);
    });
  }

  // ── Quests ──
  function quest(root, title, tags, text, done, total, extra, hot) {
    var q = el('div', 'quest' + (hot ? ' hot' : '')); q.appendChild(el('b', null, title)); q.appendChild(el('br'));
    tags.forEach(function (t) { q.appendChild(el('span', 'tag', t)); });
    q.appendChild(el('p', null, text));
    if (total) { var pr = el('div', 'prog'), pi = el('i'); pi.style.width = Math.round(100 * Math.min(done, total) / total) + '%'; pr.appendChild(pi); q.appendChild(pr); q.appendChild(el('span', 'meta', Math.min(done, total) + ' / ' + total)); }
    if (extra) q.appendChild(extra);
    root.appendChild(q);
  }
  function renderQuests() {
    var root = $('quests'); root.textContent = '';
    var has = function (ids) { return ids.filter(function (i) { return st.spots[i]; }).length; };
    var evN = Object.keys(st.events).length;
    var cats = {}; Object.keys(st.events).forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    if (st.team) {
      root.appendChild(el('h2', null, '👥 Équipe ' + st.team));
      var t = el('div', 'quest hot'); t.appendChild(el('b', null, 'Classement de la session (maquette)'));
      [['Vous', st.xp], ['Équipe B', 640], ['Équipe C', 410]].sort(function (a, b) { return b[1] - a[1]; }).forEach(function (r, i) { t.appendChild(el('p', null, (i + 1) + '. ' + r[0] + ' — ' + r[1] + ' XP')); });
      t.appendChild(el('div', 'todo', 'Le mode équipe demande un serveur (classement partagé) : M3, produit vendu aux séminaires, écoles et hôtels.'));
      root.appendChild(t);
    }
    root.appendChild(el('h2', null, '🔴 Cette semaine'));
    var fx = null;
    if (featured) { fx = el('button', 'btn live', 'Voir l’événement du jour'); fx.type = 'button'; fx.onclick = function () { tab('map'); map.setView([featured.lat, featured.lng], 15); openEvent(featured); }; }
    quest(root, '★ L’événement du jour', ['+' + FEATURED_XP + ' XP', 'Change chaque jour'], featured ? featured.title + ' — ' + featured.place : 'Pas d’événement aujourd’hui à moins de 12 km.', featured && st.events[featured.id] ? 1 : 0, 1, fx, true);
    quest(root, '📅 La quête de la semaine', ['Annoncée le jeudi', '+200 XP'], 'Passez à deux sorties de l’agenda d’ici dimanche (' + EVENTS.length + ' sur la carte).', evN, 2);
    quest(root, '🎭 Toutes les scènes', ['+' + ALL_CATS_XP + ' XP', 'Badge'], 'Un spectacle, un atelier, une sortie nature, du sport : une carte souvenir de chaque.', Object.keys(cats).length, 4);
    root.appendChild(el('h2', null, '🎄 De saison'));
    quest(root, '🎄 Les marchés de Noël', ['Saison', 'Nov.-déc.', '+50 XP bonus'], 'Deux marchés ou rendez-vous de Noël (' + SEASON.length + ' sur la carte, couche Noël).', Object.keys(st.events).filter(function (id) { var e = byId(id); return e && e.season; }).length, 2);
    var adv = el('a', null, 'Le calendrier de l’Avent du site →'); adv.href = 'https://fontainebleaulive.fr/calendrier-de-l-avent/'; adv.target = '_blank'; adv.rel = 'noopener';
    quest(root, '🦉 Une case par jour', ['Décembre'], 'Le calendrier de l’Avent devient une quête : chaque case ouverte rapporte un peu d’XP.', 0, 0, adv);
    var eco = el('button', 'btn soft', st.eco ? '✓ Fait' : 'J’ai ramassé un déchet'); eco.type = 'button'; eco.disabled = st.eco;
    eco.onclick = function () { st.eco = true; save(); gain(50, 'éco-geste'); renderAll(); };
    quest(root, '🌱 Éco-geste', ['Badge', 'Sur l’honneur', 'Toute l’année'], 'Ramasser un déchet en forêt et le rapporter (idée reprise de Tèrra Aventura).', st.eco ? 1 : 0, 1, eco);
    quest(root, '🦌 Le brame', ['Revient en septembre'], 'Écouter le brame depuis un point d’écoute autorisé, en silence. Quête de saison.', 0, 0);
    quest(root, '🍄 Les champignons', ['Revient en octobre'], 'Une sortie mycologique de l’agenda. Jamais de cueillette conseillée par le jeu.', 0, 0);
    root.appendChild(el('h2', null, '📜 Toujours là'));
    quest(root, '📜 L’enquête — chapitre 1', ['Quête principale', '+300 XP'], 'Le fil rouge historique, en chapitres répartis sur les lieux (numéros dorés sur la carte). Sujet à choisir (GDD §16).', has(CHAPTER), 3);
    var cl = el('div'); SPOTS.filter(function (p) { return p.set === 'grimpe'; }).forEach(function (p) { cl.appendChild(el('p', 'meta', (st.spots[p.id] ? '✓ ' : '○ ') + p.name)); });
    quest(root, '🧗 5 Must Climb, en famille', ['Défi', 'Tous niveaux', '+500 XP la série'], 'Cinq sites de bloc à découvrir en famille : venir, essayer les premiers blocs, à son niveau. Aucune cotation exigée.', has(SPOTS.filter(function (p) { return p.set === 'grimpe'; }).map(function (p) { return p.id; })), 5, cl);
    quest(root, '🔵 Les sentiers bleus', ['Série', 'Forêt'], 'Sur les pas de Claude-François Denecourt, qui balisa la forêt au XIXᵉ siècle.', has(['mont-ussy', 'tour-denecourt', 'rocher-cassepot']), 3);
  }

  // ── Profile: account and (future) shop ──
  function renderMe() {
    var root = $('me'); root.textContent = '';
    var n = levelOf(st.xp);
    root.appendChild(el('h2', null, titleOf(n) + ' · niveau ' + n));
    var stats = el('div', 'stats');
    [[Object.keys(st.spots).length, 'lieux'], [Object.keys(st.events).length, 'souvenirs'], [st.xp, 'XP']].forEach(function (x) { var s = el('div', 'stat'); s.appendChild(el('b', null, String(x[0]))); s.appendChild(document.createTextNode(x[1])); stats.appendChild(s); });
    root.appendChild(stats);
    root.appendChild(el('h2', null, 'Badges'));
    var bs = el('div', 'badges');
    [['🏰', 'Napoléon', st.sets.napoleon], ['🔵', 'Sentiers bleus', st.sets.denecourt], ['🎨', 'Peintres', st.sets.peintres], ['★', '1er souvenir', Object.keys(st.events).length > 0],
      ['🎭', 'Toutes les scènes', st.sets.cats], ['🌱', 'Éco-geste', st.eco], ['🧗', '5 Must Climb', st.sets.grimpe], ['🎄', 'Noël', false]]
      .forEach(function (x) { var b = el('div', 'badge' + (x[2] ? '' : ' off')); b.appendChild(document.createTextNode(x[0])); b.appendChild(el('small', null, x[1])); bs.appendChild(b); });
    root.appendChild(bs);
    root.appendChild(el('h2', null, 'Titres'));
    TITLES.forEach(function (t) { root.appendChild(el('p', n >= t[0] ? null : 'meta', (n >= t[0] ? '✓ ' : '🔒 ') + t[1] + ' — niveau ' + t[0])); });

    root.appendChild(el('h2', null, 'Ma sauvegarde'));
    var acc = el('div', 'set');
    acc.appendChild(el('p', null, 'Sans compte : tout reste sur ce téléphone, votre position aussi.'));
    var code = el('button', 'btn soft', '🔑 Copier mon code de sauvegarde'); code.type = 'button'; code.onclick = function () { toast('Maquette : un code ou un QR à scanner sur le nouveau téléphone'); };
    acc.appendChild(code);
    acc.appendChild(el('p', 'meta', 'Plus tard, un compte facultatif (e-mail, sans mot de passe) : changer de téléphone, jouer en équipe, retrouver ses achats.'));
    root.appendChild(acc);

    root.appendChild(el('h2', null, 'Boutique (plus tard)'));
    root.appendChild(el('div', 'todo', 'Maquette : rien n’est vendu. Ce qui s’achète un jour ne donne jamais d’XP, de lieu ni d’événement.'));
    [['📜', 'L’enquête complète', 'Le chapitre 1 reste gratuit ; les chapitres 2 à 5 en un achat.', '4,99 €'],
      ['👥', 'Session d’équipe', 'Séminaires, écoles, hôtels : un code, un classement, un récapitulatif pour l’organisateur.', 'sur devis'],
      ['🎁', 'Le coffret souvenir', 'Vos cartes d’une série complète, imprimées, ou le pin’s de la série.', '12 €'],
      ['🎨', 'Un autre style de cartes', 'Gravure, aquarelle de Barbizon, pixel : le même jeu, un autre regard.', '1,99 €'],
      ['💚', 'Soutenir le projet', 'Prix libre, comme les fiches balades.', 'libre']]
      .forEach(function (o) { var x = el('div', 'offer'); x.appendChild(el('span', 'ic', o[0])); var t = el('div'); t.appendChild(el('b', null, o[1])); t.appendChild(el('p', null, o[2])); x.appendChild(t); x.appendChild(el('span', 'price', o[3])); root.appendChild(x); });
  }

  // ── Entry flow (onboarding) ──
  var onb = $('onb'), step = 0, draft = null;
  var PROFILES = [['weekend', '🧳', 'Je viens pour un week-end', 'Le meilleur en deux jours'], ['local', '🏡', 'J’habite dans le coin', 'Tout collectionner, à son rythme'],
    ['etudiant', '🎓', 'J’étudie ici', 'INSEAD, écoles, campus'], ['groupe', '👥', 'Je viens en groupe', 'Séminaire, hôtel, classe : avec un code']];
  var LIKES = [['histoire', '🏰', 'Histoire et château'], ['foret', '🌳', 'Forêt et balades'], ['grimpe', '🧗', 'Grimpe'], ['sorties', '★', 'Sorties et événements'], ['peintres', '🎨', 'Peintres et villages']];
  function firstQuest() {
    var L0 = draft.likes;
    if (L0.indexOf('sorties') >= 0 && featured) return { icon: '★', title: featured.title, text: 'L’événement du jour, à ' + featured.place + '. XP doublée aujourd’hui.', xp: FEATURED_XP, go: function () { map.setView([featured.lat, featured.lng], 15); openEvent(featured); } };
    var pick = L0.indexOf('histoire') >= 0 ? 'cour-des-adieux' : L0.indexOf('grimpe') >= 0 ? 'bas-cuvier' : L0.indexOf('foret') >= 0 ? 'tour-denecourt' : L0.indexOf('peintres') >= 0 ? 'musee-barbizon' : 'cour-des-adieux';
    var p = SPOTS.filter(function (x) { return x.id === pick; })[0];
    return { icon: p.icon, title: p.name, text: 'Votre première carte. ' + SETS[p.set] + '.', xp: XP[p.rarity], go: function () { map.setView([p.lat, p.lng], 15); openSpot(p); } };
  }
  function choice(icon, title, sub, pressed, onclick, disabled) {
    var c = el('button', 'choice'); c.type = 'button'; c.setAttribute('aria-pressed', !!pressed); c.disabled = !!disabled;
    c.appendChild(el('span', null, icon)); var t = el('div'); t.appendChild(el('b', null, title)); if (sub) t.appendChild(el('small', null, sub)); c.appendChild(t);
    c.onclick = onclick; return c;
  }
  function renderOnb() {
    onb.textContent = '';
    var N = 6, dots = el('div', 'dots'); for (var i = 0; i < N; i++) dots.appendChild(el('i', i === step ? 'on' : ''));
    onb.appendChild(dots);
    if (step > 0 && step < 5) { var sk = el('button', 'skip', 'Passer'); sk.type = 'button'; sk.onclick = function () { step = 5; renderOnb(); }; onb.appendChild(sk); }
    var inn = el('div', 'in'), foot = el('div', 'foot');
    function next(label, enabled, fn) { var b = el('button', 'btn', label); b.type = 'button'; b.disabled = enabled === false; b.onclick = fn || function () { step++; renderOnb(); }; foot.appendChild(b); return b; }
    if (step === 0) {
      var hero = el('div', 'hero', '🗺️'); hero.appendChild(el('b', null, 'Bleau Quest')); hero.appendChild(el('small', null, 'Fontainebleau se collectionne')); inn.appendChild(hero);
      [['📍', 'Explorez le château, la ville et la forêt'], ['🃏', 'Collectionnez les lieux, leurs histoires, leurs séries'], ['🔴', 'Vivez les événements du jour : ils rapportent le plus']]
        .forEach(function (f) { var r = el('div', 'feat'); r.appendChild(el('span', null, f[0])); r.appendChild(el('div', null, f[1])); inn.appendChild(r); });
      inn.appendChild(el('p', 'meta', 'Gratuit, sans compte, sans publicité.'));
      next('Commencer');
      var c2 = el('button', 'btn soft', 'J’ai un code de sauvegarde'); c2.type = 'button'; c2.onclick = function () { toast('Maquette : reprendre une partie depuis un autre téléphone'); }; foot.appendChild(c2);
    } else if (step === 1) {
      inn.appendChild(el('h1', null, 'Vous venez…')); inn.appendChild(el('p', 'lead', 'Pour vous proposer la bonne première quête.'));
      PROFILES.forEach(function (p) { inn.appendChild(choice(p[1], p[2], p[3], draft.profile === p[0], function () { draft.profile = p[0]; renderOnb(); })); });
      if (draft.profile === 'groupe') {
        inn.appendChild(el('p', 'meta', 'Code donné par l’organisateur (facultatif) :'));
        var inp = el('input'); inp.placeholder = 'ex. SEMINAIRE-24'; inp.value = draft.team; inp.oninput = function () { draft.team = inp.value.trim().slice(0, 20).toUpperCase(); }; inn.appendChild(inp);
      }
      next('Continuer', !!draft.profile);
    } else if (step === 2) {
      inn.appendChild(el('h1', null, 'Ce qui vous attire')); inn.appendChild(el('p', 'lead', 'Plusieurs choix possibles. Tout reste ouvert ensuite.'));
      LIKES.forEach(function (l) { var on = draft.likes.indexOf(l[0]) >= 0; inn.appendChild(choice(l[1], l[2], '', on, function () { if (on) draft.likes.splice(draft.likes.indexOf(l[0]), 1); else draft.likes.push(l[0]); renderOnb(); })); });
      next('Continuer', draft.likes.length > 0);
    } else if (step === 3) {
      inn.appendChild(el('div', 'hero', '📍'));
      inn.appendChild(el('h1', null, 'Votre position reste sur ce téléphone'));
      inn.appendChild(el('p', 'lead', 'Elle sert seulement à vérifier que vous êtes devant un lieu. Elle n’est jamais envoyée ni enregistrée ailleurs.'));
      inn.appendChild(el('p', 'meta', 'Sans elle, on joue quand même : une question d’observation sur place, ou sur l’honneur.'));
      next('Autoriser la position', true, function () { draft.geo = 'oui'; setMe(48.40195, 2.69905); step++; renderOnb(); });
      var later = el('button', 'btn soft', 'Plus tard'); later.type = 'button'; later.onclick = function () { draft.geo = 'non'; step++; renderOnb(); }; foot.appendChild(later);
    } else if (step === 4) {
      inn.appendChild(el('h1', null, 'Un compte ? Pas besoin.'));
      inn.appendChild(el('p', 'lead', 'Vous jouez tout de suite. Un code de sauvegarde, dans le profil, suffit pour changer de téléphone.'));
      inn.appendChild(choice('▶️', 'Jouer sans compte', 'Recommandé · rien à remplir', true, function () {}));
      inn.appendChild(choice('✉️', 'Créer un compte (plus tard)', 'E-mail sans mot de passe : plusieurs appareils, équipes, achats retrouvés', false, null, true));
      next('Continuer');
    } else {
      var fq = firstQuest();
      inn.appendChild(el('h1', null, 'Votre première quête'));
      var box = el('div', 'firstq'); box.appendChild(el('div', 'big', fq.icon)); box.appendChild(el('b', null, fq.title)); box.appendChild(el('p', 'meta', fq.text));
      box.appendChild(el('span', 'xpchip gold', '+' + fq.xp + ' XP')); inn.appendChild(box);
      inn.appendChild(el('p', 'meta', 'Et ' + WELCOME_XP + ' XP de bienvenue, tout de suite.'));
      next('Voir la carte', true, function () {
        st.onboarded = true; st.profile = draft.profile || 'weekend'; st.likes = draft.likes; st.team = draft.profile === 'groupe' ? draft.team : ''; st.geo = draft.geo || '';
        save(); onb.classList.remove('on'); tab('map'); renderAll(); gain(WELCOME_XP, 'bienvenue'); fq.go();
      });
    }
    onb.appendChild(inn); onb.appendChild(foot);
  }
  function openOnb() { step = 0; draft = { profile: '', likes: [], team: '', geo: '' }; renderOnb(); onb.classList.add('on'); }
  $('replay').onclick = openOnb;

  function renderAll() { renderLive(); renderDex(); renderQuests(); renderMe(); hud(); }
  function tab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.toggle('on', s.id === 's-' + name); });
    closeSheet(); $('lpanel').classList.remove('on');
    if (name === 'map') setTimeout(function () { map.invalidateSize(); }, 50);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { tab(b.getAttribute('data-tab')); }; });
  $('reset').onclick = function () { st = fresh(); save(); if (meMarker) { map.removeLayer(meMarker); meMarker = null; me = null; } draw(); renderAll(); closeSheet(); openOnb(); };

  panel(); liveBar(); draw(); renderAll();
  if (!st.onboarded && location.hash !== '#carte') openOnb(); // #carte: straight to the map (screenshots)
})();
`;

// Serves the mock-up and vendor/ only, on the loopback interface.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(open) {
  const allowed = [OUT, path.join(ROOT, 'vendor')].map((d) => d + path.sep);
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { rel = '/'; }
    if (rel === '/') { res.writeHead(302, { Location: '/reports/bleau-quest/maquette.html' }); return res.end(); }
    const file = path.normalize(path.join(ROOT, rel));
    if (!allowed.some((d) => file.startsWith(d)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} déjà pris : relancez avec PORT=8518 node scripts/bleau-quest-mock.js` : e.message);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}/reports/bleau-quest/maquette.html`;
    console.log(`Servie sur ${url} — Ctrl+C pour arrêter`);
    if (open && process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  });
}

function main() {
  const today = process.env.TODAY || G.parisToday();
  const { week, season } = layers(today);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'maquette.html');
  fs.writeFileSync(file, page(today, week, season));
  console.log(`Maquette : ${file} (${SPOTS.length} lieux, ${week.length} événements de la semaine, ${season.length} de Noël)`);
  if (!process.argv.includes('--file')) serve(!process.argv.includes('--no-open'));
}

if (require.main === module) main();
