#!/usr/bin/env node
'use strict';
/**
 * The forest explorer's booklet (item 107, step 2): 13 A4 pages for children aged 6-11, built
 * from scripts/foret.js and printed to public/foret/carnet-explorateur-foret.pdf.
 *
 * Cover, « Mon expédition », five engravings to colour (Ridinger, CC0), whose tracks? , the walk's
 * bingo, leaf rubbing, which leaf? (03/11), word search, maze and riddles, diploma, answers and credits. The word
 * search and the maze are computed here from a fixed seed: the same booklet every run, and the
 * answers page always matches. Black lines on white, little ink: it prints at home.
 *
 *   node scripts/carnet-pdf.js            writes the print page and prints it with Edge
 *   node scripts/carnet-pdf.js --html     writes the print page only (to check it in a browser)
 *   node scripts/carnet-pdf.js --feuilles  prints only « Quelle est cette feuille ? », in French and
 *                                         in English, footer without page number: since 02/11 the
 *                                         published PDFs are the project lead's (Google Docs, Word),
 *                                         and this page is inserted into them, not rebuilt
 *
 * Like scripts/guides-pdf.js, a tool for the project lead's PC, never run by a workflow (Edge or
 * Chrome in headless mode, found at its usual place or in BROWSER=…). Zero dependencies.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { ANIMALS, LEAVES, RULES, CARNET } = require('./foret');

const ROOT = path.join(__dirname, '..');
const OUT_HTML = path.join(os.tmpdir(), 'fontainebleaulive-carnet');
const LOGO = 'public/assets/img/brand/Icon-FL-pwa-vS.png';
const byKey = Object.fromEntries(ANIMALS.map((a) => [a.key, a]));
const byTree = Object.fromEntries(LEAVES.trees.map((t) => [t.key, t]));

// « Quelle est cette feuille ? » in both languages: the English booklet takes the same page.
const LEAF_TEXT = {
  fr: {
    kicker: 'Atelier nature', title: 'Quelle est cette feuille ?',
    intro: 'Relie chaque feuille au nom de son arbre, puis colorie-la. Indice : regarde bien les bords — des vagues arrondies, des dents pointues, un bord presque lisse… ou des aiguilles !',
    fact: '<b>Le savais-tu ?</b> Chaque arbre a son fruit : le chêne donne le gland, le hêtre la faîne, le châtaignier la châtaigne et le pin des pommes de pin. Cherche-les par terre pendant la balade !',
    draw: 'Dessine une feuille trouvée pendant la balade · son arbre : ……………',
    footer: '<b>Carnet d’explorateur de la forêt</b> · Fontainebleau Live',
    name: (t) => t.name,
  },
  en: {
    kicker: 'Nature workshop', title: 'Which leaf is this?',
    intro: 'Link each leaf to the name of its tree, then colour it in. Clue: look closely at the edges — rounded waves, sharp teeth, an almost smooth edge… or needles!',
    fact: '<b>Did you know?</b> Every tree has its fruit: the oak gives acorns, the beech beechnuts, the sweet chestnut chestnuts and the pine pine cones. Look for them on the ground during your walk!',
    draw: 'Draw a leaf you found on your walk · its tree: ……………',
    footer: '<b>Forest explorer’s booklet</b> · Fontainebleau Live',
    name: (t) => t.en.name,
  },
};

// The game's green leaf, white to colour: our own drawing (public/foret/img/feuilles/).
function leafSvg(key) {
  return fs.readFileSync(path.join(ROOT, byTree[key].leaf.replace(/^\//, '')), 'utf8')
    .replace(/ width="200" height="320"/, '')
    .replace(/fill="#[0-9a-f]{6}"/gi, 'fill="#fff"');
}

function leafPage(lang) {
  const t = LEAF_TEXT[lang];
  return `<div class="kicker">${t.kicker}</div>
<h2>${t.title}</h2>
<p>${t.intro}</p>
<div class="leaves">${LEAVES.order.map((k, i) => `<div><span class="num">${i + 1}</span>${leafSvg(k)}<div class="dot">●</div></div>`).join('')}</div>
<div class="leaves names">${LEAVES.names.map((k) => `<div><div class="dot">●</div>${esc(t.name(byTree[k]))}</div>`).join('')}</div>
<p class="fact">${t.fact}</p>
<div class="frame leaf-draw">${t.draw}</div>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const src = (rel) => pathToFileURL(path.join(ROOT, rel.replace(/^\//, ''))).href;
const img = (key, kind) => `public/foret/img/${kind}-${key}.jpg`;
const scene = (key) => `public/foret/img/${key}-scene.jpg`;

// A small seeded generator (mulberry32): the puzzles never change between two runs.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Word search: right, down and down-right only (no backwards word for this age). */
function wordSearch(words, size = 12, seed = 107) {
  const rand = rng(seed);
  const dirs = [[0, 1], [1, 0], [1, 1]];
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = Array.from({ length: size }, () => Array(size).fill(''));
    const placed = [];
    const ok = [...words].sort((a, b) => b.length - a.length).every((w) => {
      for (let tries = 0; tries < 300; tries++) {
        const [dr, dc] = dirs[Math.floor(rand() * dirs.length)];
        const r0 = Math.floor(rand() * (size - dr * (w.length - 1)));
        const c0 = Math.floor(rand() * (size - dc * (w.length - 1)));
        const cells = [...w].map((_, i) => [r0 + dr * i, c0 + dc * i]);
        if (cells.every(([r, c], i) => !grid[r][c] || grid[r][c] === w[i])) {
          cells.forEach(([r, c], i) => { grid[r][c] = w[i]; });
          placed.push({ word: w, cells });
          return true;
        }
      }
      return false;
    });
    if (!ok) continue;
    const letters = 'ABCDEFGHIJKLMNOPRSTUVE';
    for (const row of grid) for (let c = 0; c < size; c++) if (!row[c]) row[c] = letters[Math.floor(rand() * letters.length)];
    return { grid, placed };
  }
  throw new Error('mots mêlés : placement impossible');
}

/** Maze: depth-first carving; returns the open walls and the path from the entrance to the exit. */
function maze(cols = 13, rows = 9, seed = 1107) {
  const rand = rng(seed);
  const id = (c, r) => r * cols + c;
  const open = new Set(); // "a-b" with a < b
  const link = (a, b) => open.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  const isOpen = (a, b) => open.has(a < b ? `${a}-${b}` : `${b}-${a}`);
  const seen = new Set([0]);
  const stack = [[0, 0]];
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const next = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]
      .filter(([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows && !seen.has(id(x, y)));
    if (!next.length) { stack.pop(); continue; }
    const [x, y] = next[Math.floor(rand() * next.length)];
    link(id(c, r), id(x, y));
    seen.add(id(x, y));
    stack.push([x, y]);
  }
  // Breadth-first search for the answers page.
  const goal = id(cols - 1, rows - 1);
  const prev = new Map([[0, -1]]);
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    const c = cur % cols, r = Math.floor(cur / cols);
    for (const [x, y] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
      const n = id(x, y);
      if (x >= 0 && y >= 0 && x < cols && y < rows && !prev.has(n) && isOpen(cur, n)) { prev.set(n, cur); queue.push(n); }
    }
  }
  const route = [];
  for (let n = goal; n !== -1; n = prev.get(n)) route.unshift([n % cols, Math.floor(n / cols)]);
  return { cols, rows, isOpen, id, route };
}

/** The maze as SVG: walls only; with `solution`, the route drawn over it. */
function mazeSvg(m, { cell = 12, solution = false, stroke = 0.9 } = {}) {
  const w = m.cols * cell, h = m.rows * cell;
  const lines = [];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const x = c * cell, y = r * cell;
      if (c + 1 < m.cols && !m.isOpen(m.id(c, r), m.id(c + 1, r))) lines.push(`M${x + cell} ${y}v${cell}`);
      if (r + 1 < m.rows && !m.isOpen(m.id(c, r), m.id(c, r + 1))) lines.push(`M${x} ${y + cell}h${cell}`);
    }
  }
  // Outer wall, open at the top-left (entrance) and the bottom-right (exit).
  lines.push(`M${cell} 0H${w}V${h}`, `M${w - cell} ${h}H0V0`);
  const route = solution
    ? `<polyline points="${m.route.map(([c, r]) => `${c * cell + cell / 2},${r * cell + cell / 2}`).join(' ')}" fill="none" stroke="#b5853a" stroke-width="${cell / 3}" stroke-linecap="round" stroke-linejoin="round"/>`
    : '';
  return `<svg viewBox="-1 -1 ${w + 2} ${h + 2}" xmlns="http://www.w3.org/2000/svg">${route}<path d="${lines.join('')}" fill="none" stroke="#222" stroke-width="${stroke}" stroke-linecap="square"/></svg>`;
}

const CSS = `
@page { size: A4; margin: 0; }
:root { --green: #2c4436; --gold: #b5853a; --text: #222; --line: #999; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: var(--text); font: 11pt/1.4 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; padding: 14mm 14mm 0; position: relative; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
h1, h2, h3 { font-family: Georgia, 'Times New Roman', serif; color: var(--green); margin: 0; }
h2 { font-size: 22pt; border-bottom: .7mm solid var(--gold); padding-bottom: 1.5mm; margin-bottom: 4mm; }
h3 { font-size: 15pt; margin: 0 0 2mm; }
p { margin: 0 0 2.5mm; }
.kicker { color: var(--gold); font-weight: bold; font-size: 9pt; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 1mm; }
footer { position: absolute; left: 14mm; right: 14mm; bottom: 7mm; border-top: .3mm solid var(--gold); padding-top: 1.5mm; display: flex; justify-content: space-between; font-size: 8pt; color: #555; }
footer b { color: var(--green); }
.fill { display: inline-block; border-bottom: .3mm solid #444; min-width: 80mm; height: 7mm; vertical-align: bottom; }
.box { border: .5mm solid var(--green); border-radius: 3mm; padding: 4mm 5mm; }
.fact { border-left: 1mm solid var(--gold); padding: 2mm 4mm; background: #f6f1e4; font-size: 10.5pt; }
.fact b { color: var(--green); }
.engraving { display: block; width: 100%; border: .4mm solid #888; }
/* cover */
.cover { padding-top: 12mm; text-align: center; }
.cover .brand { display: flex; align-items: center; justify-content: center; gap: 3mm; color: var(--green); font-weight: bold; font-size: 11pt; }
.cover .brand img { width: 10mm; height: 10mm; border-radius: 2mm; }
.cover h1 { font-size: 34pt; line-height: 1.05; margin: 6mm 0 2mm; }
.cover .sub { font-family: Georgia, serif; font-style: italic; font-size: 16pt; color: var(--gold); margin-bottom: 6mm; }
.cover .engraving { width: 165mm; margin: 0 auto 6mm; }
.cover .owner { font-size: 14pt; text-align: left; margin: 0 auto; width: 165mm; }
.cover .owner .fill { min-width: 105mm; }
.cover .ages { margin-top: 5mm; font-size: 10pt; color: #555; }
/* expedition */
.form p { font-size: 13pt; margin-bottom: 5mm; }
.weather { display: flex; gap: 5mm; margin: 1mm 0 6mm; }
.weather span { flex: 1; border: .4mm solid var(--line); border-radius: 3mm; text-align: center; padding: 2mm 0; font-size: 22pt; line-height: 1.1; }
.weather small { display: block; font-size: 9pt; }
.draw { height: 82mm; margin-bottom: 6mm; position: relative; }
.draw .kicker { position: absolute; top: 3mm; left: 5mm; }
ul.rules { margin: 0; padding-left: 6mm; font-size: 12pt; }
ul.rules li { margin-bottom: 1.5mm; }
/* colouring */
.colour-full .engraving { margin: 2mm 0 4mm; }
.colour-half { margin-bottom: 4mm; }
.colour-half .fact { margin-bottom: 0; }
.colour-half .engraving { width: 104mm; margin: 0 auto 2.5mm; }
.colour-half h3 { text-align: center; }
/* tracks */
.tracks { display: grid; grid-template-columns: 90mm 8mm 1fr; row-gap: 5mm; align-items: center; margin-top: 4mm; }
.tracks img { max-height: 36mm; max-width: 82mm; border: .3mm solid #bbb; }
.tracks > div:first-child, .tracks .pic { display: flex; align-items: center; justify-content: flex-end; }
.tracks .dot { font-size: 18pt; color: var(--green); text-align: center; }
.tracks .name { font-size: 14pt; font-weight: bold; color: var(--green); padding-left: 32mm; }
.tracks .name::before { content: '● '; color: var(--green); font-size: 12pt; }
.tracks .num { display: inline-block; width: 7mm; font-weight: bold; color: var(--gold); }
/* bingo */
table.bingo { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 3mm; }
table.bingo td { border: .5mm solid var(--green); height: 53mm; padding: 3mm; vertical-align: top; text-align: center; font-size: 12.5pt; font-weight: bold; color: var(--green); position: relative; }
table.bingo td::after { content: ''; position: absolute; left: 50%; bottom: 4mm; width: 9mm; height: 9mm; margin-left: -4.5mm; border: .5mm solid var(--gold); border-radius: 50%; }
/* leaves */
.frames { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin-top: 3mm; }
.frame { border: .5mm dashed var(--green); border-radius: 3mm; height: 92mm; padding: 3mm; font-size: 10pt; color: #555; }
.frame.wide { grid-column: 1 / 3; height: 82mm; }
ol.steps { margin: 0 0 2mm; padding-left: 6mm; font-size: 11.5pt; }
/* which leaf? */
.leaves { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 6mm; text-align: center; }
.leaves svg { display: block; height: 72mm; width: auto; margin: 2mm auto 0; }
.leaves .num { font: bold 16pt Georgia, serif; color: var(--gold); }
.leaves .dot { font-size: 18pt; color: var(--green); }
.leaf-draw { height: 52mm; margin-top: 5mm; }
.leaves.names { margin: 30mm 0 8mm; font-size: 14pt; font-weight: bold; color: var(--green); }
/* word search */
table.ws { border-collapse: collapse; margin: 3mm auto 5mm; }
table.ws td { width: 12.5mm; height: 12.5mm; border: .3mm solid #aaa; text-align: center; vertical-align: middle; font: bold 17pt Arial, sans-serif; color: #222; }
.wordlist { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2mm 4mm; font-size: 12pt; font-weight: bold; color: var(--green); }
.wordlist span::before { content: '☐ '; color: var(--gold); }
/* maze & riddles */
.maze { width: 150mm; margin: 2mm auto 2mm; position: relative; }
.maze svg { display: block; width: 100%; }
.maze-labels { display: flex; justify-content: space-between; font-weight: bold; color: var(--green); font-size: 11pt; width: 150mm; margin: 0 auto; }
.riddles { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 3mm; }
.riddle { border: .4mm solid var(--line); border-radius: 3mm; padding: 3mm 4mm; font-size: 11pt; }
.riddle .fill { min-width: 0; width: 100%; margin-top: 2mm; }
/* diploma */
.diploma { height: 255mm; border: 2mm double var(--gold); border-radius: 4mm; padding: 14mm 14mm; text-align: center; display: flex; flex-direction: column; justify-content: center; }
.diploma h1 { font-size: 36pt; margin-bottom: 4mm; }
.diploma .sub { font-family: Georgia, serif; font-style: italic; font-size: 15pt; color: var(--gold); margin-bottom: 12mm; }
.diploma p { font-size: 14pt; margin-bottom: 8mm; }
.diploma .fill { min-width: 120mm; }
.diploma .seal { margin: 4mm auto 0; width: 34mm; height: 34mm; border: .7mm solid var(--green); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30pt; }
.diploma .sign { display: flex; justify-content: space-between; margin-top: 10mm; font-size: 11pt; }
.diploma .sign span { width: 70mm; border-top: .3mm solid #444; padding-top: 2mm; }
/* answers */
.answers { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; font-size: 10pt; }
.answers h3 { font-size: 12.5pt; }
table.ws.small td { width: 5.6mm; height: 5.6mm; font-size: 8pt; border-color: #ccc; }
table.ws.small td.hit { background: #f1dfb8; color: #000; }
.answers .maze { width: 80mm; margin: 0; }
.credits { font-size: 8.5pt; color: #444; margin-top: 4mm; border-top: .3mm solid #ccc; padding-top: 2mm; }
`;

function footer(n) {
  return `<footer><span><b>Carnet d’explorateur de la forêt</b> · Fontainebleau Live</span><span>${esc(CARNET.url)} · ${n}</span></footer>`;
}

function pages() {
  const ws = wordSearch(CARNET.words);
  const mz = maze();
  const out = [];
  const page = (body, cls = '') => out.push(`<section class="page ${cls}">${body}${footer(out.length + 1)}</section>`);
  const factBox = (k) => `<p class="fact"><b>Le savais-tu ?</b> ${esc(byKey[k].fact)}</p>`;
  const [first, ...rest] = CARNET.colouring;

  // 1. Cover
  page(`<div class="cover">
<div class="brand"><img src="${src(LOGO)}" alt="">Fontainebleau Live</div>
<h1>Carnet d’explorateur</h1>
<div class="sub">de la forêt de Fontainebleau</div>
<img class="engraving" src="${src(scene(first))}" alt="">
<p class="owner">Ce carnet appartient à : <span class="fill"></span></p>
<p class="ages">De 6 à 11 ans · coloriages, traces d’animaux, bingo de la balade, jeux et diplôme</p>
</div>`);

  // 2. My expedition
  page(`<div class="kicker">Avant de partir</div>
<h2>Mon expédition</h2>
<div class="form">
<p>Date : <span class="fill" style="min-width:60mm"></span></p>
<p>J’explore avec : <span class="fill" style="min-width:120mm"></span></p>
<p>Où : <span class="fill" style="min-width:140mm"></span></p>
</div>
<p><b>La météo du jour</b> (entoure-la) :</p>
<div class="weather"><span>☀<small>Soleil</small></span><span>⛅<small>Nuages</small></span><span>☂<small>Pluie</small></span><span>❄<small>Froid</small></span><span>🍂<small>Vent</small></span></div>
<div class="box draw"><div class="kicker">Dessine ce que tu as vu de plus beau</div></div>
<h3>Les règles de l’explorateur</h3>
<ul class="rules">${RULES.map(([fr]) => `<li>${esc(fr)}</li>`).join('')}<li>On garde ce carnet et un crayon dans son sac : on coche le bingo pendant la balade.</li></ul>`);

  // 3. One full-page engraving
  page(`<div class="kicker">Colorie la gravure</div>
<h2>${esc(byKey[first].name)}</h2>
<img class="engraving" src="${src(scene(first))}" alt="">
${factBox(first)}
<p style="font-size:9.5pt;color:#555">Cette image est une gravure de plus de 250 ans. Choisis tes couleurs : brun, roux, vert… ou les couleurs de ton imagination !</p>`, 'colour-full');

  // 4-5. Two engravings per page
  for (let i = 0; i < rest.length; i += 2) {
    page(`<div class="kicker">Colorie la gravure</div>
${rest.slice(i, i + 2).map((k) => `<div class="colour-half"><h3>${esc(byKey[k].name)}</h3><img class="engraving" src="${src(scene(k))}" alt="">${factBox(k)}</div>`).join('\n')}`);
  }

  // 6. Whose tracks?
  page(`<div class="kicker">Mène l’enquête</div>
<h2>Qui a laissé cette trace ?</h2>
<p>Relie chaque empreinte au nom de l’animal. Indice : le cerf et le sanglier marchent sur deux grands sabots ; le renard, le blaireau et l’écureuil laissent des doigts et des griffes.</p>
<div class="tracks">${CARNET.tracks.map((k, i) => `<div class="pic"><span class="num">${i + 1}</span><img src="${src(img(k, 'trace'))}" alt=""></div><div class="dot">●</div><div class="name">${esc(byKey[CARNET.trackNames[i]].name)}</div>`).join('')}</div>
<p style="margin-top:5mm;font-size:10pt;color:#555">En vrai : après la pluie, cherche les empreintes dans la boue des chemins. Les dessins sont tirés de gravures anciennes de Johann Elias Ridinger.</p>`);

  // 7. Bingo
  const cells = CARNET.bingo;
  page(`<div class="kicker">Pendant la balade</div>
<h2>Le bingo de la forêt</h2>
<p>Coche une case chaque fois que tu trouves quelque chose. Une ligne complète : bingo !</p>
<table class="bingo">${[0, 1, 2, 3].map((r) => `<tr>${cells.slice(r * 4, r * 4 + 4).map((t) => `<td>${esc(t)}</td>`).join('')}</tr>`).join('')}</table>`);

  // 8. Leaves
  page(`<div class="kicker">Atelier nature</div>
<h2>Le frottage de feuilles</h2>
<ol class="steps"><li>Ramasse une feuille tombée par terre (on ne l’arrache pas à l’arbre).</li><li>Pose-la sous cette page, nervures vers le haut.</li><li>Frotte doucement par-dessus avec le côté d’un crayon de couleur : la feuille apparaît !</li></ol>
<div class="frames"><div class="frame">Feuille n° 1 · son arbre : ……………</div><div class="frame">Feuille n° 2 · son arbre : ……………</div><div class="frame wide">Colle ici ta plus belle feuille (ou dessine-la)</div></div>
<p style="margin-top:3mm;font-size:10pt;color:#555">Dans la forêt de Fontainebleau, tu trouveras surtout des feuilles de chêne et de hêtre, et des aiguilles de pin.</p>`);

  // 9. Which leaf?
  page(leafPage('fr'));

  // 10. Word search
  page(`<div class="kicker">Jeu</div>
<h2>Les mots mêlés de la forêt</h2>
<p>Retrouve les dix animaux. Les mots se lisent de gauche à droite, de haut en bas ou en diagonale.</p>
<table class="ws">${ws.grid.map((row) => `<tr>${row.map((ch) => `<td>${ch}</td>`).join('')}</tr>`).join('')}</table>
<div class="wordlist">${CARNET.words.map((w) => `<span>${w}</span>`).join('')}</div>`);

  // 11. Maze and riddles
  page(`<div class="kicker">Jeux</div>
<h2>Le labyrinthe de l’écureuil</h2>
<p>Aide l’écureuil (en haut à gauche) à retrouver la noisette qu’il a cachée (en bas à droite).</p>
<div class="maze-labels"><span>🐿️ Départ</span><span></span></div>
<div class="maze">${mazeSvg(mz)}</div>
<div class="maze-labels"><span></span><span>Arrivée 🌰</span></div>
<h3 style="margin-top:4mm">Qui suis-je ?</h3>
<div class="riddles">${CARNET.riddles.map((k) => `<div class="riddle">${esc(byKey[k].riddle)}<br><span class="fill"></span></div>`).join('')}</div>`);

  // 12. Diploma
  page(`<div class="diploma">
<div class="kicker">Fontainebleau Live</div>
<h1>Diplôme</h1>
<div class="sub">d’explorateur de la forêt de Fontainebleau</div>
<p>Ce diplôme est remis à</p>
<p><span class="fill"></span></p>
<p>qui a observé la forêt, reconnu ses animaux<br>et respecté les règles de l’explorateur.</p>
<p>Le <span class="fill" style="min-width:60mm"></span></p>
<div class="seal">🦌</div>
<div class="sign"><span>Signature de l’explorateur</span><span>Signature du chef d’expédition</span></div>
</div>`);

  // 13. Answers and credits
  const hits = new Set(ws.placed.flatMap((p) => p.cells.map(([r, c]) => `${r}-${c}`)));
  page(`<div class="kicker">Pour les parents</div>
<h2>Les réponses</h2>
<div class="answers">
<div><h3>Qui a laissé cette trace ?</h3><p>${CARNET.tracks.map((k, i) => `${i + 1} : ${esc(byKey[k].name.toLowerCase())}`).join(' · ')}.</p>
<h3>Qui suis-je ?</h3><p>${CARNET.riddles.map((k) => esc(byKey[k].name)).join(' · ')}.</p>
<h3>Quelle est cette feuille ?</h3><p>${LEAVES.order.map((k, i) => `${i + 1} : ${esc(byTree[k].name.toLowerCase())}`).join(' · ')}.</p>
<h3>Le labyrinthe</h3><div class="maze">${mazeSvg(mz, { solution: true, stroke: 1.2 })}</div></div>
<div><h3>Les mots mêlés</h3><table class="ws small">${ws.grid.map((row, r) => `<tr>${row.map((ch, c) => `<td${hits.has(`${r}-${c}`) ? ' class="hit"' : ''}>${ch}</td>`).join('')}</tr>`).join('')}</table>
<h3>Encore plus de jeux</h3><p>Le jeu « Qui suis-je ? » des animaux de la forêt, sur le téléphone : <b>${esc(CARNET.url)}</b>. Et les balades en famille : <b>fontainebleaulive.fr/balades</b>.</p></div>
</div>
<div class="credits"><b>Images.</b> Gravures de Johann Elias Ridinger, série « Spuhren und Fahrten der Tiere » (Augsbourg, vers 1740-1750), Rijksmuseum Amsterdam (${Object.values(CARNET.credits).map((c) => c.id).join(', ')}), domaine public (CC0), via Wikimedia Commons ; recadrées et éclaircies pour le coloriage. <b>Textes et dessins des feuilles</b> : Fontainebleau Live. Carnet gratuit à imprimer pour un usage personnel ou en classe  ; s’il vous a plu, vous pouvez le payer le prix de votre choix sur ${esc(CARNET.url)}.</div>`);
  return out;
}

function html() {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Carnet d’explorateur de la forêt de Fontainebleau</title>
<style>${CSS}</style>
</head>
<body>
${pages().join('\n')}
</body>
</html>
`;
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
  for (let t = 0; t < ms; t += 500) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === last) return;
    last = size;
    sleep(500);
  }
}

function printPdf(page, pdf) {
  const browser = findBrowser();
  if (!browser) throw new Error('Edge ou Chrome introuvable (BROWSER=… pour l’indiquer)');
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  fs.rmSync(pdf, { force: true });
  // msedge.exe may return before its child process has written the PDF (see guides-pdf.js).
  let res;
  for (let attempt = 1; attempt <= 3 && !fs.existsSync(pdf); attempt++) {
    res = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${path.join(OUT_HTML, `profile-${attempt}`)}`, `--print-to-pdf=${pdf}`, pathToFileURL(page).href], { encoding: 'utf8', timeout: 120000 });
    waitForFile(pdf, 30000);
  }
  if (!fs.existsSync(pdf)) throw new Error(`impression ratée (${res.status}) ${(res.error && res.error.message) || String(res.stderr || '').slice(-300)}`);
  console.log(`PDF : ${pdf} (${Math.round(fs.statSync(pdf).size / 1024)} Ko)`);
}

function main() {
  fs.mkdirSync(OUT_HTML, { recursive: true });
  if (process.argv.includes('--feuilles')) {
    for (const lang of ['fr', 'en']) {
      const page = path.join(OUT_HTML, `feuilles-${lang}.html`);
      fs.writeFileSync(page, `<!doctype html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<style>${CSS}</style>\n</head>\n<body>\n<section class="page">${leafPage(lang)}<footer><span>${LEAF_TEXT[lang].footer} · ${esc(CARNET.url)}</span></footer></section>\n</body>\n</html>\n`);
      printPdf(page, path.join(OUT_HTML, `feuilles-${lang}.pdf`));
    }
    return;
  }
  const page = path.join(OUT_HTML, 'carnet.html');
  fs.writeFileSync(page, html());
  if (process.argv.includes('--html')) { console.log(`page : ${page}`); return; }
  printPdf(page, path.join(ROOT, CARNET.pdf.replace(/^\//, '')));
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error('❌ carnet-pdf:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

module.exports = { wordSearch, maze, mazeSvg, pages, leafPage };
