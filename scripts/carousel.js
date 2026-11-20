#!/usr/bin/env node
/**
 * Social carousel engine (20/11, §3.AC): the coming weekend as ready-to-post slides.
 *
 * Every Thursday the project lead posts « Ce week-end autour de Fontainebleau » on Instagram and
 * Facebook. This script writes the slides and the caption from data.json, so the post takes the
 * time of an upload; the person stays the channel (no API, no bot, nothing posted from here).
 *
 *   node scripts/carousel.js             coming weekend, 1080×1350 (Instagram / Facebook feed)
 *   node scripts/carousel.js --story     1080×1920 (stories, Reels cover)
 *   node scripts/carousel.js --html      HTML slides only, no browser needed
 *   TODAY=2026-11-26 node scripts/carousel.js     as if run that day (Paris date)
 *   PICK=ACT_014,EVT_123 node scripts/carousel.js  these events, in this order (the editor's choice;
 *                                                   the confirmed-source rule still applies)
 *
 * Output (never committed, reports/ is ignored): reports/carrousel/<saturday>[-story]/
 *   slide-1.png … slide-N.png, legende-facebook.txt and legende-instagram.txt (caption to paste +
 *   alt text of each slide; Instagram's points to the bio link, as caption links never work there).
 *
 * Rules that are not obvious from the code:
 *   - Only events confirmed by a source we read (never Gemini alone), with a verified link —
 *     or a Fnac Spectacles date, whose pages refuse robots but whose feed is the ticket seller's
 *     own record. A post travels without its context: a wrong date there cannot be corrected.
 *   - Nearest first (20/11): rings of 3, 8 and 15 km around the town centre, then the ranking of
 *     « À ne pas manquer » on /ce-week-end/ (picksOf) inside a ring; then variety: at most two
 *     slides per category; up to three in Fontainebleau, one per other commune (project lead,
 *     20/11: « une Barbizon, une Samois… »). RAYON=8 drops the rest.
 *   - Not what is always there (20/11): an outing whose title comes back on 4 weekends or more
 *     (petit train, weekly museum tours) is a standing offer, not this weekend's news; nor
 *     anything in NOT_NEWS. Still on /ce-week-end/, just not in the post.
 *   - apercu.html in the output folder shows the post as on a phone (swipe, caption), opened at
 *     the end unless --no-open: look before posting.
 *   - No event picture: 11 % of events carry one (item 67), and a photo whose rights we do not
 *     hold has no place in a post. The slides are typography and the four category colours.
 *   - Printed by Edge (or Chrome) in headless mode, like guides-pdf.js: local machine only.
 *
 * Zero dependencies.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const G = require('./generate-pages');

const ROOT = path.join(__dirname, '..');
const SITE = 'fontainebleaulive.fr';
// The rule lives in generate-pages.js (item 115 bis): the site's strips show the same cards.
const MAX_SLIDES = G.CAROUSEL_MAX;
const MIN_SLIDES = G.CAROUSEL_MIN;
const catOf = G.carouselCat;
const esc = G.esc;

function loadEvents() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  return Array.isArray(raw) ? raw : raw.events || [];
}

const endOf = (e) => (/^\d{4}-\d{2}-\d{2}$/.test(String(e.endDate || '')) ? e.endDate : e.startDate);

const kmFrom = G.kmFromCentre;
const byKm = (list) => list.slice().sort((a, b) => kmFrom(a) - kmFrom(b));

function select(events, today, pick = [], maxKm = Infinity) {
  const { sat, sun } = G.weekendOf(today);
  // build()'s own filter first: a record without an id, a title or a town has no page.
  const open = events.filter((e) => e && G.idToken(e) && e.title && e.city && G.slugify(e.city, 50) && e.startDate <= sun && endOf(e) >= sat && endOf(e) >= today);
  // The count the post announces is the weekend page's own (outings of up to a week, every source):
  // the visitor who follows the link must find that number there.
  const total = open.filter((e) => G.spanDays(e) <= G.FEED_MAX_DAYS).length;
  const on = G.carouselPool(open, events);
  if (pick.length) {
    const chosen = pick.map((id) => on.find((e) => e.id === id) || id);
    const refused = chosen.filter((x) => typeof x === 'string');
    if (refused.length) throw new Error(`PICK : ${refused.join(', ')} absent(s) du week-end, non confirmé(s) par une source lue ou de plus de 4 jours`);
    return { sat, sun, picks: chosen.slice(0, MAX_SLIDES), total, candidates: byKm(on) };
  }
  const out = G.carouselPicks(open, events, { maxKm });
  // Slides follow the weekend: Saturday first, then by time.
  const day = (e) => (e.startDate > sat ? e.startDate : sat);
  out.sort((a, b) => day(a).localeCompare(day(b)) || G.timeKey(a) - G.timeKey(b));
  return { sat, sun, picks: out, total, candidates: byKm(on) };
}

const whenOf = (e, sat, sun) => G.carouselWhen(e, { sat, sun });
const priceOf = G.carouselPrice;

function rangeLabel(sat, sun) {
  const a = G.dayName(sat), b = G.dayName(sun); // « samedi 21 novembre »
  const sameMonth = sat.slice(5, 7) === sun.slice(5, 7);
  return `${sameMonth ? a.replace(/ \S+$/, '') : a} et ${b}`;
}

const titleSize = (t, story) => {
  const n = t.length, k = story ? 1.1 : 1;
  return Math.round((n <= 28 ? 96 : n <= 50 ? 80 : n <= 75 ? 66 : 56) * k);
};

function style(w, h) {
  return `*{box-sizing:border-box;margin:0}
html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:"Segoe UI",-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#1d3b29;background:#f4f3ef}
.nw{white-space:nowrap}
.s{position:relative;width:${w}px;height:${h}px;display:flex;flex-direction:column;padding:${h > 1500 ? 140 : 84}px 84px 72px}
.dark{background:linear-gradient(155deg,#2d543c 0%,#1d3b29 55%,#142a1d 100%);color:#fff}
.brand{display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700}
.brand img{width:64px;height:64px;border-radius:14px}
.kicker{font-size:34px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#afe14f}
.big{font-size:104px;line-height:1.02;font-weight:800;letter-spacing:-.02em}
.sub{font-size:44px;line-height:1.3;opacity:.92}
.grow{flex:1}
.hint{font-size:32px;font-weight:600;opacity:.85}
.band{position:absolute;left:0;top:0;bottom:0;width:22px}
.top{display:flex;justify-content:space-between;align-items:center}
.chip{display:inline-block;padding:10px 26px;border-radius:999px;color:#fff;font-size:32px;font-weight:700}
.num{font-size:32px;font-weight:700;color:#4a544e}
h1{font-weight:800;line-height:1.08;letter-spacing:-.015em;margin-top:40px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.when{margin-top:40px;font-size:44px;font-weight:700}
.where{margin-top:14px;font-size:38px;color:#2b322d}
.badges{margin-top:30px;display:flex;flex-wrap:wrap;gap:14px}
.badge{padding:8px 22px;border-radius:12px;font-size:32px;font-weight:700;background:#fff;border:2px solid #e6e2da}
.badge.free{background:#afe14f;border-color:#afe14f;color:#1d3b29}
.desc{margin-top:40px;font-size:36px;line-height:1.45;color:#2b322d;display:-webkit-box;-webkit-line-clamp:${h > 1500 ? 7 : 4};-webkit-box-orient:vertical;overflow:hidden}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:30px;color:#4a544e;border-top:2px solid #e6e2da;padding-top:28px}
.foot b{color:#1d3b29}
.url{display:inline-block;margin-top:36px;padding:18px 34px;border-radius:999px;background:#afe14f;color:#1d3b29;font-size:42px;font-weight:800}
.small{font-size:30px;opacity:.85;line-height:1.4}`;
}

function page(w, h, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${style(w, h)}</style></head><body>${body}</body></html>`;
}

function slides(sel, story) {
  const { sat, sun, picks, total } = sel;
  const icon = pathToFileURL(path.join(ROOT, 'public/assets/img/brand/Icon-FL-pwa-vS.png')).href;
  const brand = `<div class="brand"><img src="${icon}" alt="">Fontainebleau Live</div>`;
  const range = rangeLabel(sat, sun);
  const n = picks.length;
  const out = [];

  out.push({
    html: `<div class="s dark">${brand}<div class="grow"></div>
<p class="kicker">Ce <span class="nw">week-end</span></p>
<p class="big" style="margin-top:24px">${esc(range[0].toUpperCase() + range.slice(1))}</p>
<p class="sub" style="margin-top:36px">${n} idées de sorties autour de Fontainebleau, parmi les ${total} du programme</p>
<div class="grow"></div><p class="hint">Faites défiler →</p></div>`,
    alt: `Ce week-end autour de Fontainebleau, ${range} : ${n} idées de sorties parmi les ${total} du programme.`,
  });

  picks.forEach((e, i) => {
    const c = catOf(e), price = priceOf(e);
    const family = G.FAMILY.test(String(`${e.title} ${e.description || ''}`).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    const where = G.place(e);
    out.push({
      html: `<div class="s"><span class="band" style="background:${c.color}"></span>
<div class="top"><span class="chip" style="background:${c.color}">${esc(c.label)}</span><span class="num">${i + 1} / ${n}</span></div>
<div class="grow"></div>
<h1 style="font-size:${titleSize(e.title, story)}px">${esc(e.title)}</h1>
<p class="when">${esc(whenOf(e, sat, sun))}</p>
<p class="where">📍 ${esc(where)}</p>
<div class="badges">${price ? `<span class="badge${price === 'Gratuit' ? ' free' : ''}">${esc(price)}</span>` : ''}${family ? '<span class="badge">En famille</span>' : ''}</div>
${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
<div class="grow" style="flex:2"></div>
<div class="foot"><span>Fontainebleau Live</span><b>${SITE}/ce-week-end</b></div></div>`,
      alt: `${c.label} : ${e.title}. ${whenOf(e, sat, sun)}, ${where}.${price ? ` ${price}.` : ''}`,
    });
  });

  out.push({
    html: `<div class="s dark">${brand}<div class="grow"></div>
<p class="kicker">Et ce n’est pas tout</p>
<p class="big" style="margin-top:24px;font-size:88px">${total} sorties ce <span class="nw">week-end</span></p>
<p class="sub" style="margin-top:28px">Sport, nature, spectacles et ateliers, sur la carte et dans votre agenda.</p>
<span class="url">${SITE}/ce-week-end</span>
<div class="grow"></div>
<p class="small">Agenda collecté automatiquement et vérifié. Confirmez auprès de l’organisateur avant de vous déplacer.</p></div>`,
    alt: `${total} sorties ce week-end autour de Fontainebleau : tout le programme sur ${SITE}/ce-week-end.`,
  });
  return out;
}

const HASHTAG = (s) => `#${s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))}`;

// Instagram never makes a caption link clickable (20/11): there the line points to the bio link,
// which the project lead sets to /ce-week-end/. Facebook keeps the plain link.
function caption(sel, platform = 'facebook') {
  const { sat, sun, picks, total } = sel;
  const lines = [`Ce week-end autour de Fontainebleau : ${rangeLabel(sat, sun)} 🌿`, ''];
  picks.forEach((e, i) => {
    const price = priceOf(e);
    lines.push(`${i + 1}. ${e.title} — ${whenOf(e, sat, sun).toLowerCase()}, ${G.place(e)}${price ? ` · ${price}` : ''}`);
  });
  lines.push('', platform === 'instagram'
    ? `Les ${total} sorties du week-end, sur la carte : lien en bio 👆 (${SITE}/ce-week-end)`
    : `Les ${total} sorties du week-end, sur la carte : https://${SITE}/ce-week-end/`,
    'Agenda vérifié, mais les programmes changent : confirmez auprès de l’organisateur avant de partir.', '');
  const towns = [...new Set(picks.map((e) => e.city).filter(Boolean))].filter((t) => t !== 'Fontainebleau');
  lines.push(['#Fontainebleau', ...towns.map(HASHTAG), '#SeineEtMarne', '#ForetDeFontainebleau', '#SortiesEnFamille', '#CeWeekEnd'].join(' '));
  return lines.join('\n');
}

function findBrowser() {
  return [
    process.env.BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).find((c) => fs.existsSync(c));
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitForFile(file, ms) {
  let last = -1;
  for (let t = 0; t < ms; t += 300) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === last) return;
    last = size;
    sleep(300);
  }
}

function shoot(browser, html, png, w, h, dir) {
  fs.rmSync(png, { force: true });
  let res;
  for (let attempt = 1; attempt <= 3 && !fs.existsSync(png); attempt++) {
    res = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${w},${h}`, `--user-data-dir=${path.join(dir, `.profile-${attempt}`)}`,
      `--screenshot=${png}`, pathToFileURL(html).href], { encoding: 'utf8', timeout: 60000 });
    waitForFile(png, 15000);
  }
  if (!fs.existsSync(png)) throw new Error(`capture ratée : ${path.basename(png)} (${res.status}) ${String(res.stderr || '').slice(-300)}`);
}

function main() {
  const story = process.argv.includes('--story');
  const htmlOnly = process.argv.includes('--html');
  const [w, h] = story ? [1080, 1920] : [1080, 1350];
  const today = process.env.TODAY || G.parisToday();
  const pick = String(process.env.PICK || '').split(',').map((x) => x.trim()).filter(Boolean);
  const maxKm = Number(process.env.RAYON) > 0 ? Number(process.env.RAYON) : Infinity;
  const sel = select(loadEvents(), today, pick, maxKm);
  if (sel.picks.length < MIN_SLIDES) {
    console.log(`Seulement ${sel.picks.length} sortie(s) confirmée(s) pour le week-end du ${sel.sat} : pas de carrousel.`);
    return;
  }
  const dir = path.join(ROOT, 'reports', 'carrousel', `${sel.sat}${story ? '-story' : ''}`);
  // Empty the folder rather than remove it: Windows refuses to delete a folder that a shell or the
  // preview's browser tab is still using.
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const browser = htmlOnly ? null : findBrowser();
  if (!htmlOnly && !browser) throw new Error('Edge ou Chrome introuvable (BROWSER=… pour l’indiquer, ou --html)');

  const list = slides(sel, story);
  list.forEach((s, i) => {
    const html = path.join(dir, `slide-${i + 1}.html`);
    fs.writeFileSync(html, page(w, h, s.html));
    if (!htmlOnly) shoot(browser, html, path.join(dir, `slide-${i + 1}.png`), w, h, dir);
  });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('.profile-')) fs.rmSync(path.join(dir, f), { recursive: true, force: true });

  const alts = list.map((s, i) => `Image ${i + 1} : ${s.alt}`).join('\n');
  const text = caption(sel, 'instagram');
  const altBlock = `\n\n--- Texte alternatif (Instagram : « Accessibilité » ; Facebook : « Modifier tout », puis chaque image) ---\n${alts}\n`;
  fs.writeFileSync(path.join(dir, 'legende-facebook.txt'), caption(sel, 'facebook') + altBlock);
  fs.writeFileSync(path.join(dir, 'legende-instagram.txt'), text + altBlock);
  fs.rmSync(path.join(dir, 'legende.txt'), { force: true });
  const preview = path.join(dir, 'apercu.html');
  fs.writeFileSync(preview, previewPage(sel, list.length, text, { w, h, htmlOnly, pick }));
  console.log(`${list.length} images, week-end du ${sel.sat} (${sel.picks.length} sorties sur ${sel.total}) → ${path.relative(ROOT, dir)}`);
  sel.picks.forEach((e) => console.log(`  · ${e.title} (${e.city}, ${Math.round(kmFrom(e))} km, ${e.source})`));
  console.log(`Aperçu : ${preview}`);
  if (!process.argv.includes('--no-open') && process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', preview], { stdio: 'ignore' });
}

/**
 * The post as it will look on a phone: slides to swipe, the caption under them, then every slide
 * side by side and the other confirmed outings of the weekend with their id, to choose with PICK.
 * Local file only; nothing in it is published.
 */
function previewPage(sel, n, text, { w, h, htmlOnly, pick }) {
  const scale = 360 / w;
  const slide = (i) => (htmlOnly
    ? `<div class="frame" style="height:${Math.round(h * scale)}px"><iframe src="slide-${i}.html" width="${w}" height="${h}" style="transform:scale(${scale})" tabindex="-1"></iframe></div>`
    : `<img src="slide-${i}.png" alt="">`);
  const idx = Array.from({ length: n }, (_, i) => i + 1);
  const chosen = new Set(sel.picks.map((e) => e.id));
  const others = sel.candidates.filter((e) => !chosen.has(e.id));
  const row = (e) => `<tr><td><code>${esc(e.id)}</code></td><td>${Math.round(kmFrom(e))} km</td><td>${esc(e.city)}</td><td>${esc(e.title)}</td><td>${esc(whenOf(e, sel.sat, sel.sun))}</td></tr>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aperçu du carrousel — ${esc(sel.sat)}</title>
<style>
body{margin:0;padding:24px 16px 48px;background:#e9e7e1;font:15px/1.45 "Segoe UI",-apple-system,Roboto,Arial,sans-serif;color:#222}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:40px 0 12px}
.note{color:#555;margin:0 0 20px}
.wrap{display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start}
.phone{width:360px;background:#fff;border-radius:28px;box-shadow:0 8px 30px rgba(0,0,0,.18);overflow:hidden;border:10px solid #111}
.bar{display:flex;align-items:center;gap:10px;padding:10px 12px;font-weight:600}
.bar span{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#2d543c,#afe14f)}
.track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.track::-webkit-scrollbar{display:none}
.track>*{flex:0 0 360px;scroll-snap-align:start}
.track img{width:360px;display:block}
.frame{width:360px;overflow:hidden;position:relative}.frame iframe{border:0;transform-origin:0 0;position:absolute;top:0;left:0;pointer-events:none}
.dots{display:flex;justify-content:center;gap:5px;padding:10px}.dots i{width:6px;height:6px;border-radius:50%;background:#ccc}.dots i.on{background:#3897f0}
.nav{display:flex;justify-content:space-between;padding:0 12px}.nav button{border:1px solid #ccc;background:#fff;border-radius:999px;padding:4px 12px;cursor:pointer}
.cap{padding:8px 12px 16px;white-space:pre-wrap;font-size:14px}.cap b{margin-right:4px}
.grid{display:flex;flex-wrap:wrap;gap:12px}.grid img{width:200px;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,.15)}
.grid .frame{width:200px}
table{border-collapse:collapse;background:#fff;font-size:14px}td{padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top}td:nth-child(-n+2){white-space:nowrap}
code{background:#f1efe9;padding:1px 5px;border-radius:4px}
.side{max-width:560px}
pre{white-space:pre-wrap;background:#fff;padding:12px;border-radius:8px}
</style></head><body>
<h1>Carrousel du week-end du ${esc(sel.sat)}${pick.length ? ' (sélection PICK)' : ''}</h1>
<p class="note">Aperçu local : rien n’est publié. Faites glisser les images comme sur Instagram. Pour changer la sélection : <code>PICK=id1,id2,id3 node scripts/carousel.js</code> (ids ci-dessous).</p>
<div class="wrap">
<div class="phone">
<div class="bar"><span></span>fontainebleaulive</div>
<div class="track" id="t">${idx.map(slide).join('')}</div>
<div class="nav"><button type="button" id="p">‹</button><div class="dots" id="d">${idx.map((i) => `<i${i === 1 ? ' class="on"' : ''}></i>`).join('')}</div><button type="button" id="n">›</button></div>
<div class="cap"><b>fontainebleaulive</b>${esc(text)}</div>
</div>
<div class="side">
<h2 style="margin-top:0">Autres sorties confirmées ce week-end (${others.length})</h2>
<table>${others.map(row).join('') || '<tr><td>Aucune</td></tr>'}</table>
</div>
</div>
<h2>Toutes les images</h2>
<div class="grid">${idx.map((i) => (htmlOnly ? slide(i).replace(`width:360px`, '') : `<img src="slide-${i}.png" alt="Image ${i}">`)).join('')}</div>
<script>
(function () {
  var t = document.getElementById('t'), dots = document.querySelectorAll('#d i');
  function go(k) { t.scrollTo({ left: k * 360, behavior: 'smooth' }); }
  function cur() { return Math.round(t.scrollLeft / 360); }
  t.addEventListener('scroll', function () { var k = cur(); dots.forEach(function (d, i) { d.className = i === k ? 'on' : ''; }); });
  document.getElementById('p').onclick = function () { go(Math.max(0, cur() - 1)); };
  document.getElementById('n').onclick = function () { go(Math.min(dots.length - 1, cur() + 1)); };
})();
</script>
</body></html>
`;
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error('❌ carousel:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

module.exports = { select, caption, slides };
