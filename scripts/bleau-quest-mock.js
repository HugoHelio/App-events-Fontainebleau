#!/usr/bin/env node
/**
 * Fontainebleau Live Collection (ex-Bleau Quest) — clickable mock-up (item 116a, GDD: Bleau-Quest-GDD.md).
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
const { ICONS } = require('./bleau-quest-icons');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reports', 'bleau-quest');
const PORT = Number(process.env.PORT) || 8517;
const CONFIRMED = new Set(['site', 'datatourisme', 'openagenda', 'francebillet']);
const CENTRE = { lat: 48.4045, lng: 2.7016 };
const EVENT_KM = 12;     // around the player (21/11: it follows them); beyond, the map is too full to read
const ZONE_KM = 35;      // what the page embeds: the agenda's whole zone (20 km) plus a margin
const EVENT_DAYS = 7;
const SEASON_KM = 15;
const SEASON_DAYS = 40;
const SEASON_RE = /no[eë]l|avent|saint[- ]nicolas|illumination/i;

// Positions: OpenStreetMap (Nominatim, 20-21/11/2026), theatre from venues.json. Texts: placeholders.
const SPOTS = [
  { id: 'cour-des-adieux', name: 'Cour des Adieux', set: 'napoleon', type: 'Monument', rarity: 'commun', lat: 48.40204, lng: 2.69810, icon: 'castle' },
  { id: 'jardin-de-diane', name: 'Jardin de Diane', set: 'chateau', type: 'Jardin', rarity: 'commun', lat: 48.40295, lng: 2.69973, icon: 'fountain' },
  { id: 'theatre', name: 'Théâtre municipal', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', lat: 48.40335, lng: 2.69762, icon: 'mask' },
  { id: 'obelisque', name: 'Obélisque de Marie-Antoinette', set: 'chateau', type: 'Monument', rarity: 'commun', lat: 48.39705, lng: 2.69227, icon: 'obelisk' },
  { id: 'mont-ussy', name: 'Mont Ussy', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'peu commun', lat: 48.42699, lng: 2.69645, icon: 'tree' },
  { id: 'tour-denecourt', name: 'Tour Denecourt', set: 'denecourt', type: 'Belvédère', rarity: 'rare', lat: 48.43382, lng: 2.72621, icon: 'tower' },
  { id: 'rocher-cassepot', name: 'Rocher Cassepot', set: 'denecourt', type: 'Rocher nommé', rarity: 'peu commun', lat: 48.43503, lng: 2.73366, icon: 'rock' },
  { id: 'caverne-augas', name: 'Caverne d’Augas', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'peu commun', lat: 48.42516, lng: 2.71003, icon: 'cave' },
  { id: 'grotte-serment', name: 'Grotte du Serment', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'rare', lat: 48.40225, lng: 2.66493, icon: 'cave' },
  { id: 'grand-veneur', name: 'Croix du Grand Veneur', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', lat: 48.43041, lng: 2.66126, icon: 'cross' },
  { id: 'franchard', name: 'Gorges de Franchard', set: 'foret', type: 'Gorges', rarity: 'rare', lat: 48.40812, lng: 2.62024, icon: 'mountain' },
  { id: 'apremont', name: 'Gorges d’Apremont', set: 'foret', type: 'Gorges', rarity: 'rare', lat: 48.43601, lng: 2.62568, icon: 'mountain' },
  { id: 'musee-barbizon', name: 'Musée de l’École de Barbizon', set: 'peintres', type: 'Maison de peintres', rarity: 'peu commun', lat: 48.44619, lng: 2.60261, icon: 'palette' },
  // « 5 Must Climb » in its family version (21/11): five places to visit and try, not five hard
  // problems. A proposal, to be checked with climbers (116k).
  { id: 'bas-cuvier', name: 'Bas Cuvier', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.44617, lng: 2.63734, icon: 'climb' },
  { id: 'rocher-canon', name: 'Rocher Canon', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.46308, lng: 2.66281, icon: 'climb' },
  { id: 'canche-aux-merciers', name: 'Canche aux Merciers', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.39102, lng: 2.54895, icon: 'climb' },
  { id: 'cul-de-chien', name: 'Cul de Chien', set: 'grimpe', type: 'Site de bloc et sable', rarity: 'rare', lat: 48.37685, lng: 2.52281, icon: 'climb' },
  { id: 'elephant', name: 'L’Éléphant (Larchant)', set: 'grimpe', type: 'Rocher nommé', rarity: 'rare', lat: 48.29379, lng: 2.59458, icon: 'rock' },
];

// Card texts and observation questions: DRAFTS of 21/11 (asked: "il faut qu'on arrive à écrire
// le texte. Des questions."), monuments first. Each fact comes from the source shown; each
// question asks for something one sees on the spot. To be reviewed by the project lead and the
// question checked on site before anything is published (116d). Three choices, as in foret.js.
const CARDS = {
  'cour-des-adieux': {
    text: 'Le 20 avril 1814, avant de partir pour l’île d’Elbe, Napoléon descend l’escalier de cette cour et fait ses adieux à sa Vieille Garde. La cour du Cheval Blanc devient alors la cour des Adieux. L’escalier lui-même est plus ancien : il date de Louis XIII (1632-1634).',
    source: 'Fondation Napoléon, « Les adieux de Fontainebleau à la Vieille Garde » (napoleon.org) ; château de Fontainebleau',
    q: 'Regardez le grand escalier de la façade : quelle forme a-t-il ?', choices: ['En fer à cheval', 'En colimaçon', 'Tout droit'], answer: 0,
  },
  'jardin-de-diane': {
    text: 'Au centre de l’ancien jardin de la Reine, Diane chasseresse. Ce bronze est une fonte des frères Keller (1684), copie d’une statue antique aujourd’hui au Louvre ; il vient du château de Marly. Les chiens et les têtes de cerf du socle sont de Pierre Biard, au début du XVIIᵉ siècle.',
    source: 'Metropolitan Museum of Art (Diane de Barthélemy Prieur, notice) ; musée du Louvre ; à recouper avec le château',
    q: 'Combien de chiens entourent le socle de la fontaine ?', choices: ['Deux', 'Quatre', 'Six'], answer: 1,
  },
  'obelisque': {
    text: 'Haut de 21 mètres, l’obélisque est élevé en 1785-1786 en l’honneur de Marie-Antoinette et de ses enfants, au carrefour où se croisent les grandes routes de la forêt. Des bornes y indiquent les directions ; leurs fleurs de lys sont ôtées en 1793.',
    source: 'Base Mérimée, ministère de la Culture (PA00086970, quatre bornes indicatrices) ; Musée du Patrimoine',
    q: 'Autour de l’obélisque, combien de bornes indiquent les routes ?', choices: ['Deux', 'Quatre', 'Huit'], answer: 1,
  },
  'theatre': {
    text: 'Un concours d’architecture en 1905, un chantier de 1910 à 1912, une inauguration le 9 mars 1912 : le théâtre de Fernand Lucas et Paul Marion est l’un des rares théâtres à l’italienne d’Île-de-France hors de Paris. Il est protégé au titre des monuments historiques.',
    source: 'Inventaire général du patrimoine culturel, Région Île-de-France ; base Mérimée (PA00087345)',
    q: 'De quoi est faite la façade du théâtre ?', choices: ['De brique et de pierre', 'De béton', 'De bois'], answer: 0,
  },
};
SPOTS.forEach(function (p) { if (CARDS[p.id]) Object.assign(p, CARDS[p.id]); });

const SETS = {
  napoleon: 'Napoléon à Fontainebleau',
  chateau: 'Le château et ses jardins',
  ville: 'La ville',
  denecourt: 'Les sentiers bleus',
  foret: 'Grands sites de la forêt',
  peintres: 'Les peintres de Barbizon',
  grimpe: '5 Must Climb, en famille',
};

// Space Invader mosaics (asked for on 21/11). 46 were put up around Fontainebleau in 2023
// (pixel-hunting.com, text read 21/11/2026). The project lead knows where most are; the four of
// the town-centre walk sheet (scripts/balades.js, their own survey) are placed here at the
// **street** (BAN), not the wall: one still looks for them. No photo: the works are Invader's.
const INVADER_TOTAL = 46;
const INVADERS = [
  { id: 'inv-lampe', name: 'Lampe abat-jour', street: 'rue Dénecourt', lat: 48.404255, lng: 2.70013 },
  { id: 'inv-napoleon', name: 'Napoléon et son bicorne', street: 'place de la République', lat: 48.406339, lng: 2.701041 },
  { id: 'inv-alien-rouge', name: 'Alien rouge et son livre', street: 'rue du Conventionnel-Geoffroy', lat: 48.405359, lng: 2.700052 },
  { id: 'inv-alien-bleu', name: 'Alien bleu à lunettes', street: 'rue des Trois-Maillets', lat: 48.404694, lng: 2.699368 },
];

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

// This week's events and the season's (Christmas now), over the whole zone: the page keeps those
// within EVENT_KM (SEASON_KM) of the player, or of the town centre without a position.
function layers(today) {
  const all = confirmedEvents();
  const week = all.filter((e) => e.startDate <= G.addDays(today, EVENT_DAYS - 1) && endOf(e) >= today
    && G.spanDays(e) <= 4 && km(CENTRE, e) <= ZONE_KM).map(slim);
  const seen = new Set(week.map((e) => e.id));
  const season = all.filter((e) => !seen.has(e.id) && SEASON_RE.test(e.title) && endOf(e) >= today
    && e.startDate <= G.addDays(today, SEASON_DAYS) && G.spanDays(e) <= SEASON_DAYS && km(CENTRE, e) <= ZONE_KM).map(slim);
  return { week, season };
}

// JSON inside <script>: no "</script>" or "<!--" can close or confuse it.
const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function page(today, week, season) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fontainebleau Live Collection — maquette</title>
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
.mebtn{width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.15);font-size:18px;cursor:pointer;flex:none}
.cards.mini{grid-template-columns:repeat(6,1fr);gap:6px}.cards.mini .card{aspect-ratio:1;font-size:16px}.cards.mini .card small{font-size:8px;padding:2px}
.ico{display:inline-flex;width:1em;height:1em;vertical-align:-.15em}.ico svg{width:100%;height:100%;display:block}
.pin,.evt,.art,.ev-row .ic{color:#fff}.pin .ico{font-size:16px}.evt .ico{font-size:13px}.evt.star .ico{font-size:16px}.art .ico{font-size:64px}.ev-row .ic .ico{font-size:20px}
.card .ico{font-size:30px;margin-bottom:4px}.lgrid .ico{font-size:20px;display:block;margin:0 auto 2px}.lbtn .ico{font-size:22px;color:var(--ink)}.mebtn .ico{font-size:20px;color:#fff}
.pin.inv{width:26px;height:26px;background:#2b2d42;font-size:14px}.pin.inv .ico{font-size:14px}
.screen{flex:1;position:relative;overflow:auto;display:none}.screen.on{display:block}
#map{position:absolute;inset:0;background:#e8e4da;z-index:0}
.leaflet-fog-pane canvas{position:absolute;left:0;top:0;pointer-events:none}
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
/* 21/11 feedback: small, discreet OpenStreetMap credit */
#map .leaflet-control-attribution{font-size:9px;line-height:1.3;padding:0 4px;background:rgba(255,255,255,.55);color:#6b716d}
#map .leaflet-control-attribution a{color:#6b716d}
.tabs{display:flex;background:#fff;border-top:1px solid var(--line)}
.tabs button{flex:1;font:inherit;font-size:12px;border:0;background:none;padding:8px 0 10px;color:var(--muted);cursor:pointer;position:relative}
.tabs button span{display:flex;justify-content:center;font-size:22px;margin-bottom:2px}.tabs button[aria-selected="true"]{color:var(--ink);font-weight:700}
.tabs .nb{position:absolute;top:4px;left:56%;background:var(--live);color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:0 5px}
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
.q{display:none;gap:6px;margin-top:6px;flex-wrap:wrap}.q.on{display:flex}.q .qtext{flex-basis:100%;margin:0 0 2px;font-weight:600}.q .btn[disabled]{opacity:.45}
.src{font-size:12px;color:var(--muted);font-style:italic;margin:-4px 0 8px}
.sheet-link{font-size:13px}.q input{flex:1;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px}
.pad{padding:14px 14px 24px}
.pad h2{font-size:18px;color:var(--ink);margin:6px 0 10px}
.set{background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;border:1px solid var(--line)}
.set h3{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between;gap:8px}
.prog{height:6px;background:#e9ece6;border-radius:9px;overflow:hidden;margin-bottom:6px}.prog i{display:block;height:100%;background:var(--peu-commun)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.card{aspect-ratio:3/4;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:26px;color:#fff;cursor:pointer;border:0;font-family:inherit}
.card small{font-size:10px;line-height:1.1;text-align:center;padding:4px;color:#fff}
.card.locked{background:#cfd3cc!important;color:#8a8f8b}.card.locked .ico{opacity:.55}.card.locked small{color:#6e746f}
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
.onb .hero b{font-size:30px;letter-spacing:.02em;margin-top:6px;text-align:center;line-height:1.15;padding:0 16px}.onb .hero small{font-size:14px;opacity:.9}
.onb .feat{display:flex;gap:12px;align-items:center;margin:8px 0}.onb .feat span{font-size:24px;width:40px;height:40px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none;border:1px solid var(--line)}
.choice{display:flex;gap:12px;align-items:center;width:100%;text-align:left;font:inherit;background:#fff;border:2px solid var(--line);border-radius:14px;padding:12px;margin-bottom:8px;cursor:pointer}
.choice span{font-size:26px}.choice b{display:block;color:var(--ink)}.choice small{color:var(--muted)}
.choice[aria-pressed="true"]{border-color:var(--ink);background:#eef7dc}
.choice:disabled{opacity:.55;cursor:default}
.onb .foot{padding:10px 22px 22px;display:grid;gap:8px}.onb .foot .why{margin:0 0 4px;text-align:center}
.onb input{font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;width:100%;margin:4px 0 8px}
.firstq{background:#fff;border:2px solid var(--gold);border-radius:18px;padding:16px;text-align:center}
.firstq .big{font-size:52px}.firstq b{display:block;font-size:18px;color:var(--ink);margin:6px 0 2px}
</style></head><body>
<div class="stage">
<div class="notes">
<h1>Fontainebleau Live Collection — maquette M0 (v3)</h1>
<p><b>Ce qui est réel</b> : les positions des lieux (OpenStreetMap) ; la couche <b>Événements</b>, ${week.length} sorties de la semaine du ${G.frDate(today)} dans la zone de l’agenda, montrées à moins de ${EVENT_KM} km <b>du joueur</b> (la portée le suit) ; la couche <b>Saison</b>, ${season.length} rendez-vous de Noël des ${SEASON_DAYS} prochains jours. Toutes confirmées par une source lue, tirées de <code>data.json</code>.</p>
<p><b>Ce qui ne l’est pas</b> : textes, questions, barème d’XP, boutique (rien n’est vendu), style graphique. Les 5 sites de grimpe sont une proposition à valider avec des grimpeurs.</p>
<p><b>Essayer</b> : le parcours d’entrée s’ouvre au premier lancement. Puis le bouton des couches (en haut à droite), le bandeau « en direct », un événement, un lieu ; « Simuler ma position » puis touchez la carte pour essayer le GPS.</p>
<p><button type="button" id="replay">Revoir l’accueil</button><button type="button" id="reset">Tout remettre à zéro</button></p>
<p>Fenêtre étroite (moins de 520 px) : la maquette prend tout l’écran, comme sur un téléphone.</p>
</div>
<div class="phone" id="phone">
<div class="top"><div class="lvl" id="lvl">1</div><div class="who"><b id="title">Promeneur</b><div class="bar"><i id="xpbar"></i></div><span class="xp" id="xptxt"></span></div><span class="teamchip" id="teamchip"></span><button type="button" class="mebtn" id="mebtn" aria-label="Profil"><span data-ico="user"></span></button></div>
<section class="screen on" id="s-map"><div id="map"></div>
<button type="button" class="livebar" id="livebar"><span class="dot"></span><span id="livetxt"></span></button>
<button type="button" class="lbtn" id="lbtn" aria-label="Couches" aria-expanded="false"><span data-ico="layers"></span></button>
<div class="lpanel" id="lpanel">
<h4>Type de carte</h4>
<div class="lgrid" id="bases"></div>
<h4>Couches</h4>
<div class="lgrid" id="overlays"></div>
</div>
</section>
<section class="screen" id="s-live"><div class="pad" id="live"></div></section>
<section class="screen" id="s-dex"><div class="pad" id="dex"></div></section>
<section class="screen" id="s-quests"><div class="pad" id="quests"></div></section>
<section class="screen" id="s-me"><div class="pad" id="me"></div></section>
<section class="screen" id="s-shop"><div class="pad" id="shop"></div></section>
<div class="sheet" id="sheet"></div>
<div class="onb" id="onb"></div>
<div class="toast" id="toast"></div>
<div class="levelup" id="levelup"><div>Niveau</div><div class="n" id="lu-n"></div><div id="lu-t" style="font-size:20px;font-weight:700"></div><p id="lu-p"></p><button type="button" class="btn alt" id="lu-ok">Continuer</button></div>
<nav class="tabs" role="tablist">
<button type="button" role="tab" aria-selected="true" data-tab="map"><span data-ico="map"></span>Carte</button>
<button type="button" role="tab" aria-selected="false" data-tab="live"><span data-ico="live"></span>En direct<em class="nb" id="nb"></em></button>
<button type="button" role="tab" aria-selected="false" data-tab="dex"><span data-ico="cards"></span>Collection</button>
<button type="button" role="tab" aria-selected="false" data-tab="quests"><span data-ico="flag"></span>Quêtes</button>
<button type="button" role="tab" aria-selected="false" data-tab="shop"><span data-ico="bag"></span>Boutique</button>
</nav>
</div>
</div>
<script src="../../vendor/leaflet-1.9.4/leaflet.js"></script>
<script>
var SPOTS = ${inline(SPOTS)};
var SETS = ${inline(SETS)};
var INVADERS = ${inline(INVADERS)};
var INVADER_TOTAL = ${INVADER_TOTAL};
var EVENTS_ALL = ${inline(week)};
var SEASON_ALL = ${inline(season)};
var RANGE = ${inline({ events: EVENT_KM * 1000, season: SEASON_KM * 1000, centre: CENTRE })};
var ICONS = ${inline(ICONS)};
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
  var XP = { 'commun': 40, 'peu commun': 60, 'rare': 100, 'légendaire': 200 };
  var EVENT_XP = 60, FEATURED_XP = 120, SEASON_BONUS = 20, SET_XP = 200, ALL_CATS_XP = 150, FIRST_STEP_XP = 20, ECO_XP = 30;
  var RADIUS = { ville: 100, foret: 150, event: 200 };
  var TITLES = [[1, 'Promeneur'], [3, 'Flâneur'], [5, 'Bellifontain'], [8, 'Bleausard'], [12, 'Peintre de Barbizon'], [20, 'Denecourt']];
  var RCOL = { 'commun': 'var(--commun)', 'peu commun': 'var(--peu-commun)', 'rare': 'var(--rare)', 'légendaire': 'var(--legendaire)' };
  var SETCOL = { napoleon: '#7a3b2e', chateau: '#8f6a25', ville: '#4a5bb8', denecourt: '#2f6f8f', foret: '#3d6b2a', peintres: '#9a5a2a', grimpe: '#6b4a8f' };
  var CATS = { 'Scène & Spectacles': ['mask', '#b8707d', 'Scène'], 'Culture & Ateliers': ['palette', '#9282b5', 'Culture'],
    'Nature & Environnement': ['leaf', '#6f9e80', 'Nature'], 'Sport & Outdoor': ['run', '#6d8bb5', 'Sport'] };
  var CHAPTER = ['cour-des-adieux', 'jardin-de-diane', 'theatre'];
  var KEY = 'bleau-quest-mock-v4'; // v4: new XP scale, older saves start over
  var st = load();
  function fresh() { return { xp: 0, spots: {}, events: {}, plans: {}, sets: {}, eco: false, onboarded: false, profile: '', likes: [], team: '', geo: '' }; }
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY)); return s && s.spots ? s : fresh(); } catch (e) { return fresh(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function $(id) { return document.getElementById(id); }
  // Icons (scripts/bleau-quest-icons.js), drawn for the project. Fixed markup, never from the data.
  function ico(name) {
    var d = ICONS[name] || ICONS.star, sp = document.createElement('span'); sp.className = 'ico';
    sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d.l + '"/></svg>';
    return sp;
  }
  function chrome() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ico]'), function (n) { n.textContent = ''; n.appendChild(ico(n.getAttribute('data-ico'))); });
  }
  function cat(e) { return CATS[e.cat] || ['star', '#555', 'Sortie']; }
  function byId(id) { return EVENTS_ALL.concat(SEASON_ALL).filter(function (x) { return x.id === id; })[0]; }
  function dayShort(d) { return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''); }
  function dayLong(d) { return d === TODAY ? 'Aujourd’hui' : new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function isLive(e) { return e.start <= TODAY && e.end >= TODAY; }
  function firstDay(e) { return e.start < TODAY ? TODAY : e.start; }

  // Event of the day: one of today's events, the same for everyone that day (a stable hash).
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
  // 21/11: the 12 km range follows the player (the town centre without a position).
  var EVENTS = [], SEASON = [], liveNow = [], featured = null;
  function refreshRange() {
    var c = me || RANGE.centre;
    EVENTS = EVENTS_ALL.filter(function (e) { return dist(c, e) <= RANGE.events; });
    SEASON = SEASON_ALL.filter(function (e) { return dist(c, e) <= RANGE.season; });
    liveNow = EVENTS.filter(isLive);
    featured = liveNow.slice().sort(function (a, b) { return hash(a.id + TODAY) - hash(b.id + TODAY); })[0] || null;
  }
  refreshRange();
  function xpOf(e) { return (featured && e.id === featured.id ? FEATURED_XP : EVENT_XP) + (e.season ? SEASON_BONUS : 0); }

  // Level n starts at 20·(n−1)·(2n+1) XP: 100, 280, 540, 880, 1300… up to level 30 (GDD §8).
  // 21/11 feedback: level 2 after one or two events (60 XP each, + 20 "first step"), never at once.
  var MAX_LEVEL = 30;
  function floorOf(n) { return 20 * (n - 1) * (2 * n + 1); }
  function levelOf(xp) { var n = 1; while (n < MAX_LEVEL && floorOf(n + 1) <= xp) n++; return n; }
  function titleOf(n) { var t = TITLES[0][1]; TITLES.forEach(function (x) { if (n >= x[0]) t = x[1]; }); return t; }

  function hud() {
    var n = levelOf(st.xp), a = floorOf(n), b = floorOf(n + 1);
    $('lvl').textContent = n; $('title').textContent = titleOf(n);
    $('xpbar').style.width = Math.round(100 * (st.xp - a) / (b - a)) + '%';
    $('xptxt').textContent = n >= MAX_LEVEL ? st.xp + ' XP · niveau maximum' : st.xp + ' XP · niveau ' + (n + 1) + ' à ' + b;
    var tc = $('teamchip'); tc.textContent = st.team ? '👥 ' + st.team : ''; tc.classList.toggle('on', !!st.team);
  }
  function toast(t) { var x = $('toast'); x.textContent = t; x.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { x.classList.remove('on'); }, 2000); }
  function gain(xp, why) {
    var before = levelOf(st.xp); st.xp += xp; save(); hud(); toast('+' + xp + ' XP · ' + why);
    var after = levelOf(st.xp);
    for (var n = before + 1; n <= after; n++) luQueue.push(n);
    if (luQueue.length && !luShowing && !luTimer) luTimer = setTimeout(nextLevelUp, 900);
  }
  var luQueue = [], luShowing = false, luTimer = 0;
  function nextLevelUp() {
    luTimer = 0; var n = luQueue.shift(); if (!n) return;
    var t = titleOf(n), isNew = titleOf(n - 1) !== t, nx = TITLES.filter(function (x) { return x[0] > n; })[0];
    $('lu-n').textContent = n; $('lu-t').textContent = isNew ? t : '';
    $('lu-p').textContent = isNew ? 'Nouveau titre débloqué' : nx ? 'Prochain titre au niveau ' + nx[0] + ' : ' + nx[1] : '';
    luShowing = true; $('levelup').classList.add('on');
  }
  $('lu-ok').onclick = function () { $('levelup').classList.remove('on'); luShowing = false; if (luQueue.length) luTimer = setTimeout(nextLevelUp, 300); };

  function checkSets() {
    Object.keys(SETS).forEach(function (s) {
      var all = SPOTS.filter(function (p) { return p.set === s; });
      if (!st.sets[s] && all.every(function (p) { return st.spots[p.id]; })) { st.sets[s] = true; gain(SET_XP, 'série complète : ' + SETS[s]); }
    });
    var cats = {}; Object.keys(st.events).forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    if (!st.sets.cats && Object.keys(CATS).every(function (c) { return cats[c]; })) { st.sets.cats = true; gain(ALL_CATS_XP, 'quatre genres de sorties'); }
  }

  // ── Map and layers ──
  var map = L.map('map', { zoomControl: false }).setView([48.408, 2.69], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  var FogLayer = L.Layer.extend({
    initialize: function () { this._holes = []; },
    onAdd: function (m) {
      if (!m.getPane('fog')) { m.createPane('fog').style.zIndex = 350; }
      this._c = L.DomUtil.create('canvas', '', m.getPane('fog'));
      m.on('moveend zoomend resize viewreset', this._redraw, this); m.on('zoomstart', this._hide, this); this._redraw();
    },
    onRemove: function (m) { L.DomUtil.remove(this._c); m.off('moveend zoomend resize viewreset', this._redraw, this); m.off('zoomstart', this._hide, this); },
    clearLayers: function () { this._holes = []; return this; },
    setHoles: function (h) { this._holes = h; if (this._map) this._redraw(); },
    _hide: function () { if (this._c) this._c.style.opacity = 0; },
    _redraw: function () {
      var m = this._map, c = this._c; if (!m || !c) return;
      // Half a screen of margin on each side, so a pan does not reveal unfogged edges
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
    spots: { icon: 'pin', label: 'Lieux', on: true, g: L.layerGroup() },
    events: { icon: 'live', label: 'En direct', on: true, g: L.layerGroup() },
    invaders: { icon: 'invader', label: 'Invaders', on: true, g: L.layerGroup() }, // asked for on the map (21/11)
    // 21/11 feedback: the map opens light (places and live events); the other layers are one tap away
    quests: { icon: 'flag', label: 'Quêtes', on: false, g: L.layerGroup() },
    climb: { icon: 'climb', label: 'Grimpe', on: false, g: L.layerGroup() },
    season: { icon: 'xmas', label: 'Noël', on: false, g: L.layerGroup() },
    fog: { icon: 'fog', label: 'Brouillard', on: true, g: new FogLayer() }, // on by default (21/11): it focuses on what is around
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
      x.appendChild(ico(L0.icon)); x.appendChild(document.createTextNode(L0.label));
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
    m.on('click', function () { if (!arming) openSpot(p); });
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
    m.on('click', function () { if (!arming) openEvent(e); });
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
      mk.on('click', function () { if (!arming) openInvader(v); });
      LAYERS.invaders.g.addLayer(mk);
    });
    CHAPTER.forEach(function (id, i) {
      var p = SPOTS.filter(function (x) { return x.id === id; })[0]; if (!p || st.spots[id]) return;
      var m = L.marker([p.lat, p.lng], { interactive: false, zIndexOffset: 800, icon: L.divIcon({ html: '<div class="qnum">' + (i + 1) + '</div>', className: '', iconSize: [20, 20], iconAnchor: [26, 26] }) });
      LAYERS.quests.g.addLayer(m);
    });
    drawFog();
  }
  // Fog of exploration: the world darkened, with a clearing around what the player has seen.
  function ring(c, r) { return { lat: c.lat, lng: c.lng, r: r }; }
  function drawFog() {
    var holes = [];
    SPOTS.forEach(function (p) { if (st.spots[p.id]) holes.push(ring(p, 700)); });
    Object.keys(st.events).forEach(function (id) { var e = byId(id); if (e) holes.push(ring(e, 500)); });
    INVADERS.forEach(function (v) { if (invGot(v)) holes.push(ring(v, 250)); });
    // Without a position yet, a clearing on the town centre, so the map never opens all dark
    holes.push(me ? ring(me, 400) : ring({ lat: 48.404, lng: 2.698 }, 600));
    LAYERS.fog.g.setHoles(holes);
  }

  var me = null, meMarker = null, arming = false;
  function setMe(lat, lng) {
    me = { lat: lat, lng: lng };
    if (meMarker) map.removeLayer(meMarker);
    meMarker = L.marker([lat, lng], { icon: L.divIcon({ html: '<div class="me"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(map);
    refreshRange(); draw(); liveBar(); renderAll();
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
    $('livetxt').appendChild(document.createTextNode(' aujourd’hui · ' + EVENTS.length + ' cette semaine à 12 km · jusqu’à +' + FEATURED_XP + ' XP'));
    $('nb').textContent = n ? String(n) : '';
  }
  $('livebar').onclick = function () { tab('live'); };

  // ── Sheets ──
  var sheet = $('sheet');
  function closeSheet() { sheet.classList.remove('on'); }
  function header(bg, icon, chip, chipCol) {
    var art = el('div', 'art'); art.style.background = bg; art.appendChild(ico(icon));
    if (chip) { var r = el('span', 'r', chip); r.style.background = chipCol; art.appendChild(r); }
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer'); x.onclick = closeSheet; art.appendChild(x);
    return art;
  }
  function firstStep() { if (st.onboarded && !st.firstStep) { st.firstStep = true; gain(FIRST_STEP_XP, 'premier pas'); } }
  function openSpot(p) {
    firstStep();
    sheet.textContent = '';
    var got = st.spots[p.id];
    sheet.appendChild(header(got ? SETCOL[p.set] : '#cfd3cc', p.icon, p.rarity, RCOL[p.rarity]));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, p.name));
    b.appendChild(el('p', 'meta', p.type + ' · ' + SETS[p.set] + ' · ' + XP[p.rarity] + ' XP' + (me ? ' · à ' + fmtDist(dist(me, p)) : '')));
    if (p.set === 'grimpe') b.appendChild(el('div', 'todo', 'Grimper en famille : on vient voir, on essaie les premiers blocs du circuit enfants, à son niveau. Crash-pad, parade, jamais sur rocher mouillé. Le topo est chez Boolder. Proposition de site à valider avec des grimpeurs (116k).'));
    if (got) {
      b.appendChild(el('div', 'got-banner', '✓ Dans votre collection — ' + ({ gps: 'validé sur place (GPS)', question: 'validé par la question', honneur: 'validé sur l’honneur' })[got]));
      if (p.text) {
        b.appendChild(el('p', null, p.text));
        b.appendChild(el('p', 'src', 'Source : ' + p.source));
        b.appendChild(el('div', 'todo', 'Brouillon du 21/11, à relire par le chef de projet ; question à vérifier sur place (116d).'));
      } else {
        b.appendChild(el('p', null, 'Ici, la carte raconte le lieu : son histoire, une anecdote, la source.'));
        b.appendChild(el('div', 'todo', 'Texte à écrire et sourcer (116d). Aucun fait n’est inventé dans le jeu.'));
      }
    } else {
      b.appendChild(el('p', null, 'Rendez-vous sur place pour débloquer la carte de ce lieu et son histoire.'));
      var acts = el('div', 'acts');
      var gps = el('button', 'btn', '📍 Je suis ici (GPS, rayon ' + radiusOf(p) + ' m)'); gps.type = 'button';
      gps.onclick = function () {
        // Mock: the player is put on site (on a phone, the real position decides)
        if (!me || dist(me, p) > radiusOf(p)) setMe(p.lat, p.lng);
        unlock(p, 'gps');
      };
      var qb = el('button', 'btn alt', '🔎 Répondre à la question d’observation'); qb.type = 'button';
      var q = el('div', 'q');
      if (p.q) {
        q.appendChild(el('p', 'qtext', p.q));
        p.choices.forEach(function (c, i) {
          var cb = el('button', 'btn alt', c); cb.type = 'button';
          cb.onclick = function () { if (i === p.answer) unlock(p, 'question'); else { cb.disabled = true; toast('Pas tout à fait : regardez encore'); } };
          q.appendChild(cb);
        });
      } else {
        var inp = el('input'); inp.placeholder = 'Question à écrire (116d)'; var ok = el('button', 'btn', 'OK'); ok.type = 'button';
        ok.onclick = function () { if (inp.value.trim()) unlock(p, 'question'); else toast('Une réponse, n’importe laquelle (maquette)'); };
        q.appendChild(inp); q.appendChild(ok);
      }
      qb.onclick = function () { q.classList.toggle('on'); };
      var hb = el('button', 'btn soft', '🤝 Sur l’honneur (' + XP[p.rarity] / 2 + ' XP)'); hb.type = 'button';
      hb.onclick = function () { unlock(p, 'honneur'); };
      acts.appendChild(gps); acts.appendChild(qb); acts.appendChild(q); acts.appendChild(hb);
      b.appendChild(acts);
    }
    if (p.set === 'grimpe') { var a = el('a', null, 'Topo sur Boolder'); a.href = 'https://www.boolder.com/fr'; a.target = '_blank'; a.rel = 'noopener'; var pp = el('p', 'sheet-link'); pp.appendChild(a); b.appendChild(pp); }
    sheet.appendChild(b); sheet.classList.add('on');
  }
  function unlock(p, how) {
    st.spots[p.id] = how; save();
    gain(how === 'honneur' ? XP[p.rarity] / 2 : XP[p.rarity], p.name);
    draw(); renderAll(); openSpot(p); checkSets();
  }
  function openEvent(e) {
    firstStep();
    sheet.textContent = '';
    var c = cat(e), live = isLive(e), star = featured && e.id === featured.id, xp = xpOf(e);
    sheet.appendChild(header(c[1], e.season ? 'xmas' : c[0], star ? '★ événement du jour' : live ? 'en direct' : c[2], star ? 'var(--gold)' : live ? 'var(--live)' : 'rgba(0,0,0,.35)'));
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
          if (!me || dist(me, e) > RADIUS.event) setMe(e.lat, e.lng);
          claimEvent(e, 'gps');
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
    if (e.page) { var a = el('a', null, 'Voir la fiche sur Fontainebleau Live'); a.href = 'https://fontainebleaulive.fr' + e.page; a.target = '_blank'; a.rel = 'noopener'; var pp = el('p', 'sheet-link'); pp.appendChild(a); b.appendChild(pp); }
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
    root.appendChild(el('h2', null, 'En direct aujourd’hui et demain'));
    root.appendChild(el('p', 'meta', 'Les sorties de l’agenda deviennent des étapes le jour J : passez-y, gagnez une carte souvenir et de l’XP.'));
    if (featured) {
      var q = el('div', 'quest hot'); q.appendChild(el('span', 'livechip', '★ Événement du jour'));
      q.appendChild(el('p', null, 'XP doublée aujourd’hui, pour tout le monde.'));
      evRow(q, featured); root.appendChild(q);
    }
    var days = {};
    EVENTS.forEach(function (e) { var d = firstDay(e); (days[d] = days[d] || []).push(e); });
    var tomorrow = new Date(TODAY + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow = tomorrow.toISOString().slice(0, 10);
    Object.keys(days).sort().filter(function (d) { return d <= tomorrow; }).forEach(function (d) {
      root.appendChild(el('div', 'day', dayLong(d) + ' · ' + days[d].length));
      days[d].forEach(function (e) { if (!(d === TODAY && featured && e.id === featured.id)) evRow(root, e); });
    });
    var later = EVENTS.filter(function (e) { return firstDay(e) > tomorrow; }).length;
    if (later || SEASON.length) root.appendChild(el('p', 'meta', 'Plus tard : ' + later + ' sorties cette semaine, sur la carte' + (SEASON.length ? ', et ' + SEASON.length + ' rendez-vous de Noël (couche Noël).' : '.')));
  }

  // ── Collection ──
  function renderDex() {
    var root = $('dex'); root.textContent = '';
    var n = Object.keys(st.spots).length;
    root.appendChild(el('h2', null, 'Collection · ' + n + ' / ' + SPOTS.length + ' lieux'));
    var ev = Object.keys(st.events);
    var box = el('div', 'set'); var h0 = el('h3'); h0.appendChild(el('span', null, '★ Cartes souvenirs')); h0.appendChild(el('span', null, String(ev.length))); box.appendChild(h0);
    if (!ev.length) box.appendChild(el('p', 'meta', 'Allez à une sortie de l’agenda, le jour même : vous gagnez sa carte souvenir, avec la date. Une fois l’événement passé, cette carte ne se gagne plus.'));
    else {
      var g = el('div', 'cards');
      ev.forEach(function (id) { var e = byId(id); if (!e) return; var c = el('div', 'card'); c.style.background = cat(e)[1]; c.appendChild(ico(e.season ? 'xmas' : cat(e)[0])); c.appendChild(el('small', null, e.title)); g.appendChild(c); });
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
        c.appendChild(ico(p.icon)); /* locked: the same icon, greyed (21/11) */ c.appendChild(el('small', null, p.name));
        c.onclick = function () { tab('map'); map.setView([p.lat, p.lng], 15); openSpot(p); };
        grid.appendChild(c);
      });
      bx.appendChild(grid); root.appendChild(bx);
    });
    invaderBox(root);
  }

  // ── Invader mosaics: on the map at street level, found by GPS or on one's honour ──
  var INV_XP = 40, INV_RADIUS = 100;
  function invGot(m) { return st.invaders && st.invaders[m.id] && st.invaders[m.id].how; }
  function invaderBox(root) {
    var got = INVADERS.filter(invGot).length;
    var bx = el('div', 'set'), h = el('h3'); h.appendChild(el('span', null, 'Les Space Invaders')); h.appendChild(el('span', null, got + '/' + INVADER_TOTAL));
    bx.appendChild(h);
    bx.appendChild(el('p', 'meta', INVADER_TOTAL + ' mosaïques posées par Invader en 2023 autour de Fontainebleau. La carte montre la rue, pas le mur : à vous de lever les yeux.'));
    var grid = el('div', 'cards');
    INVADERS.forEach(function (m) {
      var on = invGot(m), c = el('button', 'card' + (on ? '' : ' locked')); c.type = 'button'; c.style.background = '#2b2d42';
      c.appendChild(on ? ico('invader') : document.createTextNode('?')); c.appendChild(el('small', null, on ? m.name : m.street));
      c.onclick = function () { tab('map'); map.setView([m.lat, m.lng], 17); openInvader(m); }; grid.appendChild(c);
    });
    var more = el('div', 'card locked'); more.appendChild(document.createTextNode('+' + (INVADER_TOTAL - INVADERS.length))); more.appendChild(el('small', null, 'à relever'));
    grid.appendChild(more); bx.appendChild(grid);
    bx.appendChild(el('div', 'todo', 'Maquette : les 4 mosaïques du parcours à pied du centre-ville. Les autres viendront du relevé du chef de projet (rue et description), et l’état de chacune (détruite ou non) se vérifie sur place.'));
    root.appendChild(bx);
  }
  function openInvader(m) {
    firstStep();
    sheet.textContent = '';
    var on = invGot(m);
    sheet.appendChild(header(on ? '#2b2d42' : '#cfd3cc', 'invader', 'street art', '#2b2d42'));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, on ? m.name : 'Une mosaïque d’Invader'));
    b.appendChild(el('p', 'meta', m.street + ' · ' + INV_XP + ' XP' + (me ? ' · à ' + fmtDist(dist(me, m)) : '')));
    if (!on) b.appendChild(el('p', null, 'Quelque part ' + (/^place/.test(m.street) ? 'sur la ' : 'dans la ') + m.street + ', en hauteur. Trouvez-la pour découvrir son nom.'));
    b.appendChild(el('div', 'todo', 'Pas de photo : l’œuvre est à Invader. Position de la rue (BAN), d’après le parcours à pied du centre-ville.'));
    if (on) b.appendChild(el('div', 'got-banner', '✓ Dans votre collection — ' + (on === 'gps' ? 'trouvée sur place (GPS)' : 'sur l’honneur')));
    else {
      var acts = el('div', 'acts');
      var gps = el('button', 'btn', 'Je l’ai trouvée (GPS, ' + INV_RADIUS + ' m)'); gps.type = 'button';
      gps.onclick = function () { if (!me || dist(me, m) > INV_RADIUS) setMe(m.lat, m.lng); claimInvader(m, 'gps'); };
      var hon = el('button', 'btn alt', 'Je l’ai vue (sur l’honneur, +' + INV_XP / 2 + ' XP)'); hon.type = 'button';
      hon.onclick = function () { claimInvader(m, 'honneur'); };
      acts.appendChild(gps); acts.appendChild(hon); b.appendChild(acts);
    }
    sheet.appendChild(b); sheet.classList.add('on');
  }
  function claimInvader(m, how) {
    st.invaders = st.invaders || {}; st.invaders[m.id] = { d: TODAY, how: how }; save();
    gain(how === 'honneur' ? INV_XP / 2 : INV_XP, 'mosaïque trouvée'); draw(); renderAll(); openInvader(m);
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
    quest(root, '🎭 Quatre genres de sorties', ['+' + ALL_CATS_XP + ' XP', 'Badge'], 'Allez à quatre sorties de l’agenda, une de chaque genre : un spectacle, un atelier ou une expo, une sortie nature, une activité sportive.', Object.keys(cats).length, 4);
    root.appendChild(el('h2', null, '📜 Toujours là'));
    quest(root, '📜 L’enquête — chapitre 1', ['Quête principale', '+300 XP'], 'Le fil rouge historique, en chapitres répartis sur les lieux (numéros dorés sur la carte). Sujet à choisir (GDD §16).', has(CHAPTER), 3);
    quest(root, '🔵 Les sentiers bleus', ['Série', 'Forêt'], 'Sur les pas de Claude-François Denecourt, qui balisa la forêt au XIXᵉ siècle.', has(SPOTS.filter(function (p) { return p.set === 'denecourt'; }).map(function (p) { return p.id; })), 5);
    var cl = el('div'); SPOTS.filter(function (p) { return p.set === 'grimpe'; }).forEach(function (p) { cl.appendChild(el('p', 'meta', (st.spots[p.id] ? '✓ ' : '○ ') + p.name)); });
    quest(root, '🧗 5 Must Climb, en famille', ['Défi', 'Tous niveaux', '+500 XP la série'], 'Cinq sites de bloc à découvrir en famille : venir, essayer les premiers blocs, à son niveau. Aucune cotation exigée.', has(SPOTS.filter(function (p) { return p.set === 'grimpe'; }).map(function (p) { return p.id; })), 5, cl);
    root.appendChild(el('h2', null, '🎄 De saison'));
    quest(root, '🎄 Les marchés de Noël', ['Saison', 'Nov.-déc.', '+50 XP bonus'], 'Deux marchés ou rendez-vous de Noël (' + SEASON.length + ' sur la carte, couche Noël).', Object.keys(st.events).filter(function (id) { var e = byId(id); return e && e.season; }).length, 2);
    var adv = el('a', null, 'Le calendrier de l’Avent du site →'); adv.href = 'https://fontainebleaulive.fr/calendrier-de-l-avent/'; adv.target = '_blank'; adv.rel = 'noopener';
    quest(root, '🦉 Une case par jour', ['Décembre'], 'Le calendrier de l’Avent devient une quête : chaque case ouverte rapporte un peu d’XP.', 0, 0, adv);
    var eco = el('button', 'btn soft', st.eco ? '✓ Fait' : 'J’ai ramassé un déchet'); eco.type = 'button'; eco.disabled = st.eco;
    eco.onclick = function () { st.eco = true; save(); gain(ECO_XP, 'éco-geste'); renderAll(); };
    quest(root, '🌱 Éco-geste', ['Badge', 'Sur l’honneur', 'Toute l’année'], 'Ramasser un déchet en forêt et le rapporter (idée reprise de Tèrra Aventura).', st.eco ? 1 : 0, 1, eco);
    quest(root, '🦌 Le brame', ['Revient en septembre'], 'Écouter le brame depuis un point d’écoute autorisé, en silence. Quête de saison.', 0, 0);
    quest(root, '🍄 Les champignons', ['Revient en octobre'], 'Une sortie mycologique de l’agenda. Jamais de cueillette conseillée par le jeu.', 0, 0);
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
      ['🎭', '4 genres', st.sets.cats], ['🌱', 'Éco-geste', st.eco], ['🧗', '5 Must Climb', st.sets.grimpe], ['🎄', 'Noël', false]]
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

  }

  // ── Shop: in the bottom bar (21/11); what it sells is for a dedicated session ──
  function renderShop() {
    var root = $('shop'); root.textContent = '';
    root.appendChild(el('h2', null, '🛍️ Boutique'));
    root.appendChild(el('div', 'todo', 'Contenu à définir avec le chef de projet, en séance dédiée (21/11 : les offres de la v2 ne correspondaient pas à son idée). Règle gardée : ce qui s’achète ne donne jamais d’XP, de lieu ni d’événement.'));
  }

  // ── Entry flow (onboarding) ──
  // 21/11 feedback: no "what attracts you" screen (everything is offered to everyone), no account
  // screen (play without one; the save code lives in the profile), an "a bit of everything" choice,
  // and no imposed first quest (out of context): the flow ends on the map, around the player.
  var onb = $('onb'), step = 0, draft = null;
  var STEPS = ['welcome', 'profile', 'geo'];
  var PROFILES = [['weekend', '🧳', 'Je viens pour un week-end', 'Le meilleur en deux jours'], ['local', '🏡', 'J’habite dans le coin', 'Tout collectionner, à son rythme'],
    ['etudiant', '🎓', 'J’étudie ici', 'INSEAD, écoles, campus'], ['groupe', '👥', 'Je viens en groupe', 'Séminaire, hôtel, classe : avec un code'],
    ['tout', '✨', 'Un peu de tout', 'Plusieurs à la fois, ou je préfère ne pas répondre']];
  function choice(icon, title, sub, pressed, onclick, disabled) {
    var c = el('button', 'choice'); c.type = 'button'; c.setAttribute('aria-pressed', !!pressed); c.disabled = !!disabled;
    c.appendChild(el('span', null, icon)); var t = el('div'); t.appendChild(el('b', null, title)); if (sub) t.appendChild(el('small', null, sub)); c.appendChild(t);
    c.onclick = onclick; return c;
  }
  function renderOnb() {
    onb.textContent = '';
    var N = STEPS.length, last = N - 1, s = STEPS[step], dots = el('div', 'dots');
    for (var i = 0; i < N; i++) dots.appendChild(el('i', i === step ? 'on' : ''));
    onb.appendChild(dots);
    if (step > 0 && step < last) { var sk = el('button', 'skip', 'Passer'); sk.type = 'button'; sk.onclick = function () { step = last; renderOnb(); }; onb.appendChild(sk); }
    var inn = el('div', 'in'), foot = el('div', 'foot');
    function next(label, enabled, fn) { var b = el('button', 'btn', label); b.type = 'button'; b.disabled = enabled === false; b.onclick = fn || function () { step++; renderOnb(); }; foot.appendChild(b); return b; }
    if (s === 'welcome') {
      var hero = el('div', 'hero', '🗺️'); hero.appendChild(el('b', null, 'Fontainebleau Live Collection')); hero.appendChild(el('small', null, 'Fontainebleau se collectionne')); inn.appendChild(hero);
      [['📍', 'Explorez le château, la ville et la forêt'], ['🃏', 'Collectionnez les lieux, leurs histoires, leurs séries'], ['🔴', 'Vivez les événements du jour : ils rapportent le plus']]
        .forEach(function (f) { var r = el('div', 'feat'); r.appendChild(el('span', null, f[0])); r.appendChild(el('div', null, f[1])); inn.appendChild(r); });
      inn.appendChild(el('p', 'meta', 'Gratuit.'));
      next('Commencer');
    } else if (s === 'profile') {
      inn.appendChild(el('h1', null, 'Vous venez…'));
      PROFILES.forEach(function (p) { inn.appendChild(choice(p[1], p[2], p[3], draft.profile === p[0], function () { draft.profile = p[0]; renderOnb(); })); });
      if (draft.profile === 'groupe') {
        inn.appendChild(el('p', 'meta', 'Code donné par l’organisateur (facultatif) :'));
        var inp = el('input'); inp.placeholder = 'ex. SEMINAIRE-24'; inp.value = draft.team; inp.oninput = function () { draft.team = inp.value.trim().slice(0, 20).toUpperCase(); }; inn.appendChild(inp);
      }
      foot.appendChild(el('p', 'meta why', 'Votre réponse sert seulement à choisir votre première quête. Tout le jeu reste ouvert.'));
      next('Continuer', !!draft.profile);
    } else if (s === 'geo') {
      inn.appendChild(el('div', 'hero', '📍'));
      inn.appendChild(el('h1', null, 'Votre position reste sur ce téléphone'));
      inn.appendChild(el('p', 'lead', 'Elle sert seulement à vérifier que vous êtes devant un lieu. Elle n’est jamais envoyée ni enregistrée ailleurs.'));
      inn.appendChild(el('p', 'meta', 'Sans elle, on joue quand même : une question d’observation sur place, ou sur l’honneur.'));
      next('Autoriser la position', true, function () { draft.geo = 'oui'; setMe(48.40195, 2.69905); finishOnb(); });
      var later = el('button', 'btn soft', 'Plus tard'); later.type = 'button'; later.onclick = function () { draft.geo = 'non'; finishOnb(); }; foot.appendChild(later);
    }
    onb.appendChild(inn); onb.appendChild(foot);
  }
  function finishOnb() {
    st.onboarded = true; st.profile = draft.profile || 'tout'; st.likes = []; st.team = draft.profile === 'groupe' ? draft.team : ''; st.geo = draft.geo || '';
    save(); onb.classList.remove('on'); tab('map'); renderAll();
    if (me) map.setView([me.lat, me.lng], 15); else map.setView([48.404, 2.698], 14);
    // 21/11 feedback: no XP and no level-up when the map appears (it hid the map); a small bonus at
    // the first tap on a place or an event instead, below the level 2 threshold (50 XP).
    setTimeout(function () { toast(me ? 'Touchez un lieu près de vous pour commencer' : 'Touchez un lieu pour commencer'); }, 1200);
  }
  function openOnb() { step = 0; draft = { profile: '', team: '', geo: '' }; renderOnb(); onb.classList.add('on'); }
  $('replay').onclick = openOnb;

  function renderAll() { renderLive(); renderDex(); renderQuests(); renderMe(); renderShop(); hud(); }
  function tab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.toggle('on', s.id === 's-' + name); });
    closeSheet(); $('lpanel').classList.remove('on');
    if (name === 'map') setTimeout(function () { map.invalidateSize(); }, 50);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { tab(b.getAttribute('data-tab')); }; });
  $('mebtn').onclick = function () { tab('me'); };
  $('reset').onclick = function () { st = fresh(); save(); if (meMarker) { map.removeLayer(meMarker); meMarker = null; me = null; } refreshRange(); liveBar(); draw(); renderAll(); closeSheet(); openOnb(); };

  chrome(); panel(); liveBar(); draw(); renderAll();
  if (!st.onboarded && location.hash !== '#carte') openOnb();
  var QT = /[?&]onglet=([a-z]+)/.exec(location.search); if (QT) tab(QT[1]); // ?onglet=dex for screenshots // #carte: straight to the map (screenshots)
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
