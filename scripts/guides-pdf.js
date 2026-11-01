#!/usr/bin/env node
'use strict';
/**
 * The English PDF sheets of the guides (item 104 bis, 01/11), built from scripts/balades.js.
 *
 * The French sheets are the project lead's (Google Docs); the English ones are drawn here, on
 * the same layout — header band, facts, map, lettered steps, mini-game, answers upside down — so
 * that a correction made in balades.js reaches the English PDF without retyping anything. Run it
 * after any change to a guide's English text, then commit the PDFs:
 *
 *   node scripts/guides-pdf.js            writes the print pages and prints them with Edge
 *   node scripts/guides-pdf.js --html     writes the print pages only (to check them in a browser)
 *
 * Printing uses Microsoft Edge (or Chrome) in headless mode, found at its usual place or in
 * BROWSER=…; this is a tool for the project lead's PC, never run by a workflow. Zero dependencies.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { GUIDES } = require('./balades');

const ROOT = path.join(__dirname, '..');
const OUT_HTML = path.join(os.tmpdir(), 'fontainebleaulive-guides');
const LOGO = 'public/assets/img/brand/Icon-FL-pwa-vS.png';
const MODE_KICKER = { 'a-pied': 'Walking guide · On foot', 'a-velo': 'Cycling guide · By bike', 'en-voiture': 'Driving guide · By car' };
const ROUTE_WORD = { 'a-velo': 'Ride', 'en-voiture': 'Loop' };
const NOTE = { wc: ['wc', 'WC'], option: ['opt', 'Long option'], astuce: ['tip', 'Tip'], attention: ['warn', 'Careful'], coeur: ['opt', 'Don’t miss'] };
const CHECKED = { 'oct. 2026': 'October 2026', 'nov. 2026': 'November 2026' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const src = (rel) => pathToFileURL(path.join(ROOT, rel.replace(/^\//, ''))).href;
// "Label: text" → the label in bold, as on the French sheets.
// French decimals in a figure (« 0,2 km ») read as English ones.
const num = (t) => esc(t).replace(/(\d),(\d)/g, '$1.$2');
const lead = (t) => esc(t).replace(/^([^:]{2,40}):/, '<b>$1:</b>');

const CSS = `
@page { size: A4; margin: 0; }
:root { --green: #2c4436; --gold: #b5853a; --beige: #f4efe3; --text: #2a2a2a; --blue: #e3ebf5; --sage: #e6efe2; --sand: #fbf1dd; --pink: #f8e1dc; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: var(--text); font: 9pt/1.32 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; padding: 15mm 11.4mm 0; position: relative; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
h1, h2, h3 { font-family: Georgia, 'Times New Roman', serif; color: var(--green); margin: 0; }
header { background: var(--green); color: #fff; padding: 4mm 5mm 3.5mm; border-bottom: 1mm solid var(--gold); display: flex; justify-content: space-between; align-items: center; }
header .kicker { color: var(--gold); font-weight: bold; font-size: 7.5pt; letter-spacing: .04em; text-transform: uppercase; }
header h1 { color: #fff; font-size: 24pt; line-height: 1.1; margin: 1mm 0 .5mm; }
header .sub { font-family: Georgia, serif; font-style: italic; font-size: 11pt; }
header .brand { text-align: center; color: #b8d98a; font-size: 6.5pt; }
header .brand img { width: 15mm; height: 15mm; border-radius: 2mm; display: block; margin: 0 auto 1mm; }
.p2 header h1 { font-size: 19pt; }
.p2 header { padding: 3mm 5mm 2.5mm; }
.p2 header .brand img { width: 11mm; height: 11mm; }
footer { position: absolute; left: 11.4mm; right: 11.4mm; bottom: 6mm; border-top: .4mm solid var(--gold); padding-top: 1.5mm; display: flex; justify-content: space-between; font-size: 6.8pt; color: #555; }
footer b { color: var(--green); }
ul { margin: 0; padding-left: 4mm; }
li { margin: .35mm 0; }
li::marker { color: var(--gold); }
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
td, th { padding: .7mm 1mm; border-bottom: .3mm solid #e8e1d0; text-align: left; vertical-align: top; }
th { color: var(--gold); font-size: 7pt; border-bottom: .5mm solid var(--gold); }
td.n { width: 6mm; font-weight: bold; color: var(--green); }
td.t, th.t { text-align: right; white-space: nowrap; }
td.c, th.c { text-align: center; white-space: nowrap; }
tr.total td { border-top: .6mm solid var(--gold); border-bottom: 0; font-weight: bold; }
.why { font-family: Georgia, serif; font-style: italic; color: #555; font-size: 8pt; line-height: 1.25; margin: 0; }
.why .sig { font-family: Arial, sans-serif; font-style: normal; color: var(--gold); font-weight: bold; font-size: 7.5pt; }
.two { display: flex; gap: 6mm; margin-top: 3mm; font-size: 8.5pt; }
.two > div { flex: 1; }
.two > div:first-child { border-right: .3mm solid #ddd; padding-right: 6mm; }
.two h2 { font-size: 12.5pt; margin-bottom: 1.5mm; }
.note { padding: 1.3mm 2mm; margin-top: 1.2mm; font-size: 8pt; }
.note.wc { background: var(--blue); color: #1f4f8f; }
.note.opt { background: var(--sage); }
.note.tip { background: var(--sand); color: #8a5a1c; }
.note.warn { background: var(--pink); color: #8a2f1f; }
.box { background: var(--beige); padding: 2.2mm 4mm; margin-top: 2mm; }
.box h2 { font-size: 12pt; }
/* walk */
.top { display: flex; gap: 9mm; margin-top: 4.5mm; }
.map { width: 139.7mm; flex: none; }
.map img { width: 100%; display: block; border: .3mm solid #ddd; }
.side { width: 38.4mm; flex: none; display: flex; flex-direction: column; justify-content: space-between; }
.fact { background: var(--beige); text-align: center; padding: 2.4mm 1mm; }
.fact .k { color: var(--gold); font-weight: bold; font-size: 6.5pt; text-transform: uppercase; letter-spacing: .03em; }
.fact .v { color: var(--green); font-weight: bold; font-size: 10pt; margin-top: .5mm; }
.pic { position: relative; }
.pic img { width: 100%; display: block; }
.num { display: inline-flex; align-items: center; justify-content: center; width: 5mm; height: 5mm; border-radius: 50%; background: var(--green); color: #fff; font-weight: bold; font-size: 7.5pt; border: .5mm solid #fff; position: absolute; left: 1.5mm; top: 1.5mm; }
.step { margin-bottom: 1.3mm; font-size: 8.5pt; }
.step h3 { font-size: 11pt; display: flex; align-items: center; gap: 2mm; }
.sq { background: var(--green); color: #fff; font-family: Arial, sans-serif; font-size: 8pt; width: 4.5mm; height: 4.5mm; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.step .where { font-style: italic; color: #666; font-size: 7pt; margin: .3mm 0 .8mm 6.5mm; }
.lead { font-style: italic; color: #666; font-size: 7.5pt; margin: .5mm 0 2mm; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.6mm 3mm; font-size: 8pt; }
.cb::before { content: '☐'; color: var(--gold); margin-right: 1.5mm; }
.grid .lbl { font-style: italic; color: var(--gold); grid-column: 1 / -1; }
.more { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; font-size: 8pt; margin-top: 2mm; }
.more b { color: var(--gold); display: block; }
.small { font-size: 7pt; color: #555; margin-top: 2mm; }
/* routes */
.facts { display: flex; gap: 3mm; margin-top: 3mm; }
.facts .fact { flex: 1; padding: 1.6mm 1mm; }
.facts .fact .v { font-size: 9pt; }
.glance h2 { font-size: 12.5pt; margin: 3mm 0 1mm; }
.band { display: flex; align-items: stretch; margin-top: 3.5mm; background: var(--beige); }
.band .bn { background: var(--green); color: #fff; font-weight: bold; font-size: 13pt; width: 10mm; display: flex; align-items: center; justify-content: center; flex: none; }
.band div { padding: 1.5mm 3mm; }
.band h2 { font-size: 13pt; }
.band .bs { font-style: italic; color: #666; font-size: 7.5pt; }
.rt { display: flex; gap: 5mm; margin-top: 2.5mm; align-items: flex-start; }
.rmap { flex: none; border: .5mm dashed var(--gold); padding: 1.5mm; }
.rmap img { width: 100%; display: block; }
.rsteps { flex: 1; }
.rsteps td.n { color: var(--gold); width: 5mm; }
.game { display: flex; background: var(--beige); margin-top: 2mm; padding: 2.2mm 4mm; gap: 5mm; font-size: 8pt; }
.game > div:first-child { flex: 1.2; }
.game > div:last-child { flex: 1; border-left: .3mm solid #ddd; padding-left: 5mm; }
.game h3 { font-size: 10.5pt; margin-bottom: 1.2mm; }
.game h3 span { font-family: Arial, sans-serif; font-size: 8pt; color: var(--gold); }
.game .ck { display: grid; grid-template-columns: 1fr 1fr; gap: .8mm 3mm; }
.game .rq { color: var(--green); font-weight: bold; margin-top: 1mm; }
.game .rh { font-style: italic; color: #666; font-size: 7pt; }
.game .rt-k { font-style: italic; color: var(--gold); font-weight: bold; font-size: 8pt; margin-bottom: 1mm; }
.ifs { display: flex; gap: 0; margin-top: 2.5mm; }
.ifs > div { flex: 1; background: var(--beige); padding: 2.2mm 4mm; font-size: 8pt; }
.ifs > div + div { border-left: .3mm solid #ddd; }
.ifs .k { color: var(--gold); font-weight: bold; font-size: 7.5pt; }
.ifs h3 { font-size: 11pt; margin: .5mm 0; }
.ans { background: var(--beige); margin-top: 2.5mm; padding: 2mm 4mm; font-size: 7.5pt; }
.ans .k { font-style: italic; color: #666; }
.ans .r { transform: rotate(180deg); text-align: center; margin-top: 1.5mm; font-size: 8pt; }
/* Second pages carry two routes: a little tighter. */
.p2 .band { margin-top: 2mm; }
.p2 .rt { margin-top: 1.8mm; }
.p2 .note { margin-top: .8mm; padding: 1mm 2mm; }
.p2 .game { padding: 1.6mm 4mm; margin-top: 1.5mm; }
.p2 .ans { margin-top: 2mm; padding: 1.5mm 4mm; }
`;

function header(g, sub, p2 = false) {
  return `<header>
  <div>
    <div class="kicker">Fontainebleau Live · ${esc(MODE_KICKER[g.key])} · No. ${g.num}</div>
    <h1>${esc(g.en.title)}</h1>
    <div class="sub">${esc(sub)}</div>
  </div>
  <div class="brand"><img src="${src(LOGO)}" alt="">FontainebleauLive.fr</div>
</header>`;
}

function footer(g) {
  return `<footer><span><b>Fontainebleau Live</b> · fontainebleaulive.fr · A local’s personal route</span><span>For guidance only, checked ${esc(CHECKED[g.checked] || g.checked)}</span></footer>`;
}

const notes = (list = [], enList = []) => list.map(([kind], i) => {
  const [cls, label] = NOTE[kind] || ['tip', kind];
  return `<div class="note ${cls}"><b>${esc(label)}:</b> ${esc(enList[i])}</div>`;
}).join('');

const glanceRow = (s) => { const m = /^(\d+)\.\s*(.*)$/.exec(s); return m ? [m[1], m[2]] : ['', s]; };

/** Before you go + Why: the two columns under the table of the first page. */
function beforeWhy(g, many) {
  const e = g.en;
  return `<div>
    <h2>Before you go</h2>
    <ul>${e.before.map((b) => `<li>${lead(b)}</li>`).join('')}</ul>
  </div>
  <div>
    <h2>Why ${many ? 'these routes' : 'this walk'}?</h2>
    <p class="why">${esc(e.why)} <span class="sig">– Hugues, a Fontainebleau local</span></p>
  </div>`;
}

function walkSheet(g) {
  const e = g.en;
  const r = g.routes[0], re = e.routes[0];
  const pics = r.steps.filter((st) => st.img);
  const step = (st, i) => {
    const se = re.steps[r.steps.indexOf(st)];
    return `<div class="step">
  <h3><span class="sq">${esc(st.k)}</span>${esc(se.title)}</h3>
  <div class="where">${esc(se.sub)}</div>
  <ul>${se.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>${notes(st.notes, se.notes)}
</div>`;
  };
  const left = r.steps.slice(0, 5), right = r.steps.slice(5);
  const game = re.game;
  return `<section class="page">
${header(g, e.subtitle)}
<div class="top">
  <div class="map"><img src="${src(r.map.src)}" alt=""></div>
  <div class="side">
    ${e.facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('\n    ')}
    ${pics.map((st) => `<div class="pic"><img src="${src(st.img.src)}" alt=""><span class="num">${esc(st.k)}</span></div>`).join('\n    ')}
  </div>
</div>
<div class="two">
  <div>
    <h2>The route at a glance</h2>
    <table>${e.overview.rows.map((row) => { const [n, label] = glanceRow(row[0]); return `<tr><td class="n">${n}</td><td>${esc(label)}</td><td class="t">${esc(row[1])}</td></tr>`; }).join('')}
      <tr class="total"><td></td><td>${esc(e.overview.total[0])}</td><td class="t">${esc(e.overview.total[1])}</td></tr></table>
  </div>
  <div>
    <h2>Before you go</h2>
    <ul>${e.before.map((b) => `<li>${lead(b)}</li>`).join('')}</ul>
    <h2 style="margin-top:2.2mm">Why this walk?</h2>
    <p class="why">${esc(e.why)} <span class="sig">– Hugues, a Fontainebleau local</span></p>
  </div>
</div>
${footer(g)}
</section>
<section class="page p2">
${header(g, e.subtitle2, true)}
<div class="two"><div>${left.map(step).join('')}</div><div>${right.map(step).join('')}</div></div>
<div class="box">
  <h2>${esc(game.title)}</h2>
  <div class="lead">${esc(game.intro)}</div>
  <div class="grid">${game.items.map((it) => `<span class="cb">${esc(it)}</span>`).join('')}
    <span class="lbl">${esc(game.extra.title)}</span>${game.extra.items.map((it) => `<span class="cb">${esc(it)}</span>`).join('')}</div>
</div>
<div class="box">
  <h2>${esc(e.more.title)}</h2>
  <div class="more">${e.more.items.map(([n, t], i) => `<div><b>${i + 1}. ${esc(n)}</b>${esc(t)}</div>`).join('')}</div>
  <div class="small">${lead(e.more.note)}</div>
</div>
${footer(g)}
</section>`;
}

function routeBlock(g, i, mapWidth) {
  const r = g.routes[i], re = g.en.routes[i];
  const rows = r.steps.map((st, j) => {
    const se = re.steps[j];
    return `<tr><td class="n">${esc(st.k)}</td><td>${esc(se.text)}</td><td class="c">${num(se.dist || st.dist)}</td><td class="t">${esc(st.time)}</td></tr>`;
  }).join('');
  const total = r.total ? `<tr class="total"><td></td><td>${esc(re.total)}</td><td class="c">${num(r.total[1])}</td><td class="t">${esc(r.total[2])}</td></tr>` : '';
  const game = re.game;
  return `<div class="band"><span class="bn">${r.num}</span><div><h2>${esc(re.title)}</h2><div class="bs">${esc(re.sub)}</div></div></div>
<div class="rt">
  <div class="rmap" style="width:${mapWidth}mm"><img src="${src(r.map.src)}" alt=""></div>
  <div class="rsteps"><table>${rows}${total}</table></div>
</div>
${notes(r.notes, re.notes)}
<div class="game">
  <div><h3><span>Mini-game · </span>${esc(game.title.replace(/^Mini-game · /, ''))}</h3><div class="ck">${game.items.map((it) => `<span class="cb">${esc(it)}</span>`).join('')}</div></div>
  <div><div class="rt-k">The riddle</div>${game.riddles.map(([q, h]) => `<div class="rq">${esc(q)}</div><div class="rh">${esc(h)}</div>`).join('')}</div>
</div>`;
}

function glanceTable(g) {
  const e = g.en;
  const head = e.overview.head;
  const numeric = (j) => j > 0 && !(g.key === 'a-velo' && j === 1);
  return `<div class="glance"><h2>The ${g.routes.length} ${g.key === 'a-velo' ? 'rides' : 'loops'} at a glance</h2>
<table><tr><th></th>${head.map((h, j) => `<th class="${numeric(j) ? 'c' : ''}">${esc(h)}</th>`).join('')}</tr>${e.overview.rows.map((row) => { const [n, label] = glanceRow(row[0]); return `<tr><td class="n">${n}</td><td><b>${esc(label)}</b></td>${row.slice(1).map((c, j) => `<td class="${numeric(j + 1) ? 'c' : ''}">${esc(c)}</td>`).join('')}</tr>`; }).join('')}</table></div>`;
}

function answers(g) {
  const word = ROUTE_WORD[g.key];
  const list = g.en.routes.map((r, i) => `<b>${word} ${i + 1}:</b> ${esc(r.game.answer)}`).join('&nbsp;&nbsp;&nbsp;&nbsp;');
  return `<div class="ans"><div class="k">Answers for the grown-ups, read upside down:</div><div class="r">${list}</div></div>`;
}

function routesSheet(g, layout) {
  const e = g.en;
  const more = e.more ? `<div class="ifs">${e.more.items.map(([n, t]) => { const [k, title] = n.split(/:\s*/); return `<div><div class="k">If you have time… ${esc(k.toLowerCase())}</div><h3>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h3>${esc(t)}</div>`; }).join('')}</div>` : '';
  return `<section class="page">
${header(g, e.subtitle)}
<div class="facts">${e.facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
${glanceTable(g)}
<div class="two">${beforeWhy(g, true)}</div>
${routeBlock(g, 0, layout[0])}
${footer(g)}
</section>
<section class="page p2">
${header(g, e.subtitle2, true)}
${g.routes.slice(1).map((r, i) => routeBlock(g, i + 1, layout[i + 1])).join('\n')}
${more}
${answers(g)}
${footer(g)}
</section>`;
}

// Map widths (mm) per route, chosen so that each sheet holds on two A4 pages.
const LAYOUT = { 'a-velo': [92, 50, 66], 'en-voiture': [80, 84] };

function sheet(g) {
  const body = g.key === 'a-pied' ? walkSheet(g) : routesSheet(g, LAYOUT[g.key]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(g.en.title)} — Fontainebleau Live guide No. ${g.num}</title>
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c));
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitForFile(file, ms) {
  let last = -1;
  for (let t = 0; t < ms; t += 500) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === last) return;
    last = size;
    sleep(500);
  }
}

function main() {
  const htmlOnly = process.argv.includes('--html');
  fs.mkdirSync(OUT_HTML, { recursive: true });
  const browser = htmlOnly ? null : findBrowser();
  if (!htmlOnly && !browser) throw new Error('Edge ou Chrome introuvable (BROWSER=… pour l’indiquer)');
  for (const g of GUIDES) {
    const html = path.join(OUT_HTML, `${g.slug}-en.html`);
    fs.writeFileSync(html, sheet(g));
    if (htmlOnly) { console.log(`page : ${html}`); continue; }
    const pdf = path.join(ROOT, g.pdfEn.replace(/^\//, ''));
    // msedge.exe may return before its child process has written the PDF: wait for the file to
    // appear and stop growing. One profile per sheet, and up to three tries.
    fs.rmSync(pdf, { force: true });
    let res;
    for (let attempt = 1; attempt <= 3 && !fs.existsSync(pdf); attempt++) {
      res = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${path.join(OUT_HTML, `profile-${g.key}-${attempt}`)}`, `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { encoding: 'utf8', timeout: 120000 });
      waitForFile(pdf, 30000);
    }
    if (!fs.existsSync(pdf)) throw new Error(`impression ratée : ${g.slug} (${res.status}) ${(res.error && res.error.message) || String(res.stderr || '').slice(-300)}`);
    console.log(`PDF : ${path.relative(ROOT, pdf)} (${Math.round(fs.statSync(pdf).size / 1024)} Ko)`);
  }
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error('❌ guides-pdf:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

module.exports = { sheet };
