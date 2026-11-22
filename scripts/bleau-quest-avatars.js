/**
 * Collector pack of the Fontainebleau Live Collection mock-up (item 116, shop, 22/11).
 * 22/11 feedback: « les cosmétiques ne sont pas top… plus vivant et de vrais dessins », so the pack
 * avatars are coloured drawings (forest animals and local emblems), not the line icons, and the
 * frames are ornaments drawn around the avatar (laurel, leaves, engraving, sandstone).
 * Drawn for this project. Fixed markup, never from the data.
 */

// Avatars: viewBox 0 0 64 64, drawn inside a round clip on the `bg` colour.
const AVATAR_ART = {
  renard: { bg: '#bfdcea', svg: // 22/11: a sky background, the cream one hid the fox's white cheeks
    '<path d="M12 64Q32 44 52 64Z" fill="#d9692b"/><path d="M24 64Q32 55 40 64Z" fill="#fff7ec"/>' +
    '<path d="M13 12L25 25L11 31Z" fill="#d9692b"/><path d="M15 17L21.5 25L13.5 28Z" fill="#3a2a22"/>' +
    '<path d="M51 12L39 25L53 31Z" fill="#d9692b"/><path d="M49 17L42.5 25L50.5 28Z" fill="#3a2a22"/>' +
    '<path d="M11 29Q32 13 53 29L45 45Q32 56 19 45Z" fill="#e8823f"/>' +
    '<path d="M11 29L24 40L32 54L19 47Z" fill="#fff7ec"/><path d="M53 29L40 40L32 54L45 47Z" fill="#fff7ec"/>' +
    '<path d="M27 26Q32 22 37 26L34 38H30Z" fill="#f29a5a"/>' +
    '<ellipse cx="24" cy="33" rx="2.2" ry="2.8" fill="#2b211c"/><ellipse cx="40" cy="33" rx="2.2" ry="2.8" fill="#2b211c"/>' +
    '<circle cx="24.8" cy="32" r=".8" fill="#fff"/><circle cx="40.8" cy="32" r=".8" fill="#fff"/>' +
    '<ellipse cx="32" cy="51" rx="3" ry="2.3" fill="#2b211c"/>' },
  chouette: { bg: '#2f3d5c', svg:
    // 22/11: no moon, it merged with the right ear tuft
    '<circle cx="10" cy="12" r=".9" fill="#fff"/><circle cx="32" cy="7" r=".8" fill="#fff"/><circle cx="55" cy="22" r=".8" fill="#fff"/><circle cx="8" cy="32" r=".7" fill="#fff"/>' +
    '<path d="M2 56Q32 50 62 55" stroke="#6b4a2b" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<path d="M18 26L19 13L27 21Z" fill="#8c5e3b"/><path d="M46 26L45 13L37 21Z" fill="#8c5e3b"/>' +
    '<ellipse cx="32" cy="38" rx="15" ry="17" fill="#9a6a43"/>' +
    '<ellipse cx="32" cy="44" rx="9" ry="9.5" fill="#ecd9b6"/>' +
    '<path d="M27 41l2 2 2-2M33 41l2 2 2-2M30 46l2 2 2-2" stroke="#9a6a43" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="25.5" cy="31" r="6.5" fill="#f2e6cf"/><circle cx="38.5" cy="31" r="6.5" fill="#f2e6cf"/>' +
    '<circle cx="25.5" cy="31" r="4" fill="#f2b632"/><circle cx="38.5" cy="31" r="4" fill="#f2b632"/>' +
    '<circle cx="25.5" cy="31" r="2" fill="#1f1a17"/><circle cx="38.5" cy="31" r="2" fill="#1f1a17"/>' +
    '<circle cx="26.3" cy="30.2" r=".8" fill="#fff"/><circle cx="39.3" cy="30.2" r=".8" fill="#fff"/>' +
    '<path d="M30 35H34L32 39.5Z" fill="#e08a2c"/>' +
    '<path d="M26 53.5v2M28 53.5v2M36 53.5v2M38 53.5v2" stroke="#e08a2c" stroke-width="1.6" stroke-linecap="round"/>' },
  ecureuil: { bg: '#f4ead8', svg:
    '<path d="M0 59Q32 53 64 59V64H0Z" fill="#8fb36b"/>' +
    '<path d="M38 58C60 56 64 30 52 17C45 10 36 15 41 23C47 32 49 44 37 50Z" fill="#c4552b"/>' +
    '<path d="M44 22C50 28 52 38 47 46" stroke="#e2804f" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="28" cy="46" rx="11" ry="12.5" fill="#d0662f"/><ellipse cx="26" cy="48" rx="6" ry="8" fill="#f6e3c8"/>' +
    '<path d="M17 21L16 10L23 18Z" fill="#c4552b"/><path d="M27 19L30 9L32 19Z" fill="#c4552b"/>' +
    '<circle cx="24" cy="28" r="10" fill="#d0662f"/><ellipse cx="18" cy="31" rx="5" ry="4" fill="#f6e3c8"/>' +
    '<circle cx="21.5" cy="26.5" r="2.3" fill="#1b1410"/><circle cx="22.3" cy="25.7" r=".8" fill="#fff"/>' +
    '<circle cx="14.6" cy="30" r="1.6" fill="#3a2a22"/>' +
    '<ellipse cx="19" cy="42.5" rx="3.6" ry="4.4" fill="#a8763e"/><path d="M15.3 40.5Q19 35 22.7 40.5Z" fill="#6b4a2b"/><path d="M19 36.5v-1.8" stroke="#6b4a2b" stroke-width="1.2" stroke-linecap="round"/>' },
  cepe: { bg: '#e2eedb', svg:
    '<path d="M0 51Q32 45 64 51V64H0Z" fill="#7aa356"/>' +
    '<path d="M6 54l2-5 1 5M56 53l2-6 1 6M14 57l1.5-4 1.5 4" stroke="#5c8a3c" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
    '<path d="M24 55Q21 39 27 30H37Q43 39 40 55Z" fill="#efe3c6"/><path d="M35 31Q40 40 38 55H40Q43 39 37 30Z" fill="#d9c9a3"/>' +
    '<path d="M9 32Q11 11 32 10Q53 11 55 32Q32 38 9 32Z" fill="#8a4b25"/>' +
    '<path d="M17 23Q25 14 36 14" stroke="#b9743f" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<path d="M46 55q-1.2-6 1.5-8h3q2.5 2 1.5 8Z" fill="#efe3c6"/><path d="M43 47.5q5.5-8.5 11 0Z" fill="#9a5a2c"/>' +
    '<path d="M50 58q5-6 10-2q-4 6-10 2Z" fill="#d98a2b"/>' },
  bicorne: { bg: '#dbe3f3', svg: // v2 (22/11): symmetric face, hair at the temples and the forelock
    '<path d="M6 64Q8 50 32 49Q56 50 58 64Z" fill="#2e4fa3"/><path d="M26 50L32 60L38 50Z" fill="#fff"/>' +
    '<path d="M8 56Q13 50 21 51L19 56ZM56 56Q51 50 43 51L45 56Z" fill="#d4a72c"/>' +
    '<path d="M21.5 33Q20 41 23 46L25.5 36ZM42.5 33Q44 41 41 46L38.5 36Z" fill="#3a2a22"/>' +
    '<path d="M23.5 34Q23.5 49 32 50Q40.5 49 40.5 34Z" fill="#f1d3b3"/>' +
    '<path d="M24 34Q28 37.5 31 34.5Q30 38.5 32.5 40Q32 36.5 34 35Q37 37 40 34Z" fill="#3a2a22"/>' +
    '<path d="M26.5 39.6H30M34 39.6H37.5" stroke="#3a2a22" stroke-width="1.1" stroke-linecap="round"/>' +
    '<circle cx="28.3" cy="42" r="1.4" fill="#2b211c"/><circle cx="35.7" cy="42" r="1.4" fill="#2b211c"/>' +
    '<path d="M29.8 46.6Q32 47.6 34.2 46.6" stroke="#b0806a" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M4 35Q32 1 60 35Q32 27 4 35Z" fill="#1f2430"/>' +
    '<path d="M4 35Q32 27 60 35" stroke="#d4a72c" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '<circle cx="41" cy="22" r="5.5" fill="#2e4fa3"/><circle cx="41" cy="22" r="3.6" fill="#fff"/><circle cx="41" cy="22" r="1.8" fill="#c0392b"/>' },
  bloc: { bg: '#d7e8f3', svg: // v2 (22/11): a climber on the boulder, the crash-pad below
    '<circle cx="52" cy="12" r="5" fill="#f5d76e"/>' +
    '<path d="M-2 46L5 30L12 46ZM7 46L14 26L21 46ZM46 46L53 28L60 46ZM56 46L62 34L68 46Z" fill="#5f8f6e"/>' +
    '<path d="M0 50H64V64H0Z" fill="#eadfc4"/>' +
    '<path d="M14 57C12 42 19 27 33 23C47 20 59 30 59 44C59 50 58 54 57 57Z" fill="#d6c6a4"/>' +
    '<path d="M42 21.5C53 24 59 33 59 44C59 50 58 54 57 57H46C50 45 49 31 42 21.5Z" fill="#bda986"/>' +
    '<path d="M18 46Q28 43 38 45M21 36Q29 33 37 35M30 28Q36 26 42 28" stroke="#a8977a" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
    '<circle cx="38.5" cy="28.5" r="1.4" fill="#fff"/><circle cx="36" cy="35.5" r="1.2" fill="#fff"/><circle cx="45" cy="38" r="1.2" fill="#fff"/>' +
    '<g transform="translate(10 -2)"><g stroke-linecap="round" stroke-linejoin="round" fill="none">' +
    '<path d="M19 40L23 44L22.5 48.5M19 40L17 45L19 49" stroke="#2e4fa3" stroke-width="2.6"/>' +
    '<path d="M18.5 33L19 40" stroke="#c0392b" stroke-width="4.2"/>' +
    '<path d="M19 33.5L25 30L28.5 30.5M18.5 34.5L23.5 38L26 37.5" stroke="#f1d3b3" stroke-width="2"/></g>' +
    '<circle cx="17.5" cy="29.5" r="2.7" fill="#f1d3b3"/><path d="M15 29Q15.5 26 18 26.4Q20 26.8 20 28.4Q18 27.6 15 29Z" fill="#3a2a22"/></g>' +
    '<rect x="14" y="53" width="30" height="6" rx="2" fill="#2e7d4f"/><path d="M14 56H44" stroke="#56a173" stroke-width="1.2"/>' },
};

// Frames: viewBox 0 0 100 100 drawn around the avatar, whose circle has a radius of about 34.7
// in these units (the frame box overflows the avatar by 22 % on each side).
function ring(r, color, w) { return '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + w + '"/>'; }
function leaf(a, r, rx, ry, fill, stroke, tilt) {
  const x = 50 + r * Math.cos(a * Math.PI / 180), y = 50 + r * Math.sin(a * Math.PI / 180);
  return '<ellipse cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' +
    (stroke ? ' stroke="' + stroke + '" stroke-width=".7"' : '') + ' transform="rotate(' + (a + 90 + tilt).toFixed(1) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ')"/>';
}
function laurel() {
  let s = ring(38, '#d4a72c', 2.2);
  for (let a = 100; a <= 250; a += 15) { s += leaf(a, 43.5, 6.2, 2.6, '#e0b53d', '#9a6b00', -28); s += leaf(a + 7, 39.5, 5, 2.1, '#c99a22', '#9a6b00', 28); }
  for (let a = 80; a >= -70; a -= 15) { s += leaf(a, 43.5, 6.2, 2.6, '#e0b53d', '#9a6b00', 28); s += leaf(a - 7, 39.5, 5, 2.1, '#c99a22', '#9a6b00', -28); }
  s += '<path d="M42 92l8-6 8 6-8 3Z" fill="#c0392b"/><circle cx="50" cy="88.5" r="2.6" fill="#a02a1e"/>';
  return s;
}
function foliage() {
  const cols = ['#5f8f2f', '#8fc06a', '#6f9e80', '#d98a2b'];
  let s = ring(39, '#5f8f2f', 2.5);
  for (let i = 0; i < 16; i++) s += leaf(i * 22.5, 43.5, 6.5, 3, cols[i % 4], '#3f6b20', i % 2 ? 25 : -25);
  for (let i = 0; i < 8; i++) { const a = (i * 45 + 11) * Math.PI / 180; s += '<circle cx="' + (50 + 39 * Math.cos(a)).toFixed(2) + '" cy="' + (50 + 39 * Math.sin(a)).toFixed(2) + '" r="1.8" fill="#c0392b"/>'; }
  return s;
}
function engraving() {
  let s = '<path d="M50 3a47 47 0 1 0 .01 0ZM50 13a37 37 0 1 1-.01 0Z" fill="#f7f3ea" fill-rule="evenodd"/>' + ring(37, '#1f2622', 1.4) + ring(47, '#1f2622', 1.4) + ring(44.5, '#1f2622', .5);
  for (let a = 0; a < 360; a += 7.5) {
    const c = Math.cos(a * Math.PI / 180), d = Math.sin(a * Math.PI / 180), r1 = a % 45 ? 38.5 : 37, r2 = a % 45 ? 43 : 44.5;
    s += '<path d="M' + (50 + r1 * c).toFixed(2) + ' ' + (50 + r1 * d).toFixed(2) + 'L' + (50 + r2 * c).toFixed(2) + ' ' + (50 + r2 * d).toFixed(2) + '" stroke="#1f2622" stroke-width="' + (a % 45 ? .7 : 1.4) + '"/>';
  }
  [0, 90, 180, 270].forEach((a) => { s += '<path d="M50 1.5l3 4.5-3 4.5-3-4.5Z" fill="#1f2622" transform="rotate(' + a + ' 50 50)"/>'; });
  return s;
}
function sandstone() {
  const cols = ['#cdbf9f', '#b9ab8b', '#d9cdb0', '#c2b391', '#ab9c7c'];
  let s = '';
  for (let i = 0; i < 14; i++) {
    const a0 = (i * 360 / 14 + 1.2) * Math.PI / 180, a1 = ((i + 1) * 360 / 14 - 1.2) * Math.PI / 180, ri = 37.5, ro = 47 - (i % 3);
    const p = (r, a) => (50 + r * Math.cos(a)).toFixed(2) + ' ' + (50 + r * Math.sin(a)).toFixed(2);
    s += '<path d="M' + p(ri, a0) + 'L' + p(ro, a0) + 'A' + ro + ' ' + ro + ' 0 0 1 ' + p(ro, a1) + 'L' + p(ri, a1) + 'A' + ri + ' ' + ri + ' 0 0 0 ' + p(ri, a0) + 'Z" fill="' + cols[i % 5] + '" stroke="#8f8370" stroke-width=".8"/>';
    s += '<circle cx="' + (50 + 42 * Math.cos(a0 + .12)).toFixed(2) + '" cy="' + (50 + 42 * Math.sin(a0 + .12)).toFixed(2) + '" r=".9" fill="#8f8370"/>';
  }
  s += '<path d="M78 14q3-5 8-3-1 5-8 3Z" fill="#6f9e80"/><path d="M82 13q1-4 5-6" stroke="#5f8f2f" stroke-width=".8" fill="none"/>';
  return s;
}
const FRAME_ART = { or: laurel(), feuillage: foliage(), gravure: engraving(), gres: sandstone() };

module.exports = { AVATAR_ART, FRAME_ART };
