/**
 * Icons of the Fontainebleau Live Collection mock-up (item 116, 21/11: "les icônes ne sont pas top").
 * Line icons on a 24×24 grid (stroke, round caps), in the site's style. (A pixel-art version was
 * tried and dropped on 21/11 with the pixel-art direction.)
 * Drawn for this project (no third-party icon set). Fixed markup, never from the data.
 */

const SET = {
  castle: { l: 'M2 21h20M4 21V11h5V7.5l3-3 3 3V11h5v10M7 11V8M17 11V8M8.5 21c0-2.6 1.6-4.5 3.5-4.5s3.5 1.9 3.5 4.5M6.5 14h.01M17.5 14h.01M12 11v.01' }, // 22/11: façade, chimneys, horseshoe stair (option C)
  mask: { l: 'M4 4h16v7a8 8 0 0 1-16 0zM8.5 9h2M13.5 9h2M9 14.5c1.7 1.4 4.3 1.4 6 0' },
  obelisk: { l: 'M12 2l2 3v14h-4V5zM7 22h10M8.5 19h7' },
  tree: { l: 'M12 2l5 7h-3l4 6H6l4-6H7zM12 15v7M9 22h6' },
  tower: { l: 'M8 22l1.5-12h5L16 22M7 22h10M8 10h8M8.5 4h7v6h-7zM10.5 4V2.5M13.5 4V2.5M11 16h2' },
  rock: { l: 'M2 20l3-7 4-4 5 1 4 4 4 6zM9 9l1 4M14 10l-1 4' },
  cave: { l: 'M2 20c1.5-8 5.5-13 10-13s8.5 5 10 13zM8 20c0-3.5 1.8-6 4-6s4 2.5 4 6' },
  cross: { l: 'M12 3v18M7 8h10M8 21h8' },
  mountain: { l: 'M2 20L8.5 9l3.5 6 2.5-4L22 20zM6.5 12.5L8.5 14l2-1.5' },
  palette: { l: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-2 0-1.5-1-1.8-1-3s1-2 2.5-2H18a3 3 0 0 0 3-3c0-4.4-4-8-9-8zM7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01M17 11h.01' },
  climb: { l: 'M3 21c0-7 3.5-13 9.5-15 5 1.5 8.5 7 8.5 15zM10 12h.01M14 9.5h.01M15.5 14h.01M11 17h.01' },
  leaf: { l: 'M5 20c-1-9 5-15 15-15 0 10-6 16-15 15zM5 20l8-8' },
  run: { l: 'M13 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M6 21l4-5.5M10 15.5l3 2V21M7 11l3-3 3.5 1 2 3h3M10.5 8L12 15' },
  xmas: { l: 'M12 2l4 5h-2l4 5h-2.5l4.5 6H4l4.5-6H6l4-5H8zM12 18v4' },
  star: { l: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z' },
  invader: { l: 'M8 4l2 3M16 4l-2 3M5 7h14v7H5zM5 14l-2 4M19 14l2 4M9 14v4M15 14v4M9 10.5h.01M15 10.5h.01' },
  map: { l: 'M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20' },
  live: { l: 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2' },
  cards: { l: 'M4 7h11v14H4zM8 7V3h12v14h-5' },
  flag: { l: 'M5 21V3M5 4h12l-2.5 4L17 12H5' },
  bag: { l: 'M5 8h14l-1.2 13H6.2zM9 8V6a3 3 0 0 1 6 0v2' },
  user: { l: 'M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5' },
  layers: { l: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5' },
  fog: { l: 'M3 9h12M6 13h15M3 17h13M18 9h3' },
  pin: { l: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM10 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0' },
  // Added 22/11 with the town and forest places of the walk sheets.
  church: { l: 'M3 21h18M8 21V10l4-4 4 4v11M12 6V2M10.5 3.5h3M8 13l-4 2v6M16 13l4 2v6M10.5 21v-3a1.5 1.5 0 0 1 3 0v3M11 11h2' },
  townhall: { l: 'M3 21h18M5 21V11h14v10M4 11l8-4.5 8 4.5M12 6.5V2.5l3 1-3 1M9 21v-4h6v4M10.5 13.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0' },
  prison: { l: 'M3 21h18M4 21V6l2-2h12l2 2v15M8 9h8v7H8zM10.7 9v7M13.3 9v7M10 21v-2h4v2' },
  fresco: { l: 'M3 4h18v16H3zM6 16h12M6 16c1.6-.6 2.2-5 6-5s4.4 4.4 6 5M13.5 13h.01' },
  mansion: { l: 'M3 21h18M5 21V10h14v11M4 10l3-4h10l3 4M10 21v-4a2 2 0 0 1 4 0v4M7.5 13h1M15.5 13h1M12 6V4' },
  door: { l: 'M3 21h18M5 21V10a7 7 0 0 1 14 0v11M12 3v18M8.5 21V11a3.5 3.5 0 0 1 7 0v10M10.5 14h.01M13.5 14h.01' },
  park: { l: 'M8 3a4 4 0 0 0-4 4c0 2.2 1.8 4 4 4s4-1.8 4-4-1.8-4-4-4zM8 11v10M13 16h8M14 16v5M20 16v5M13 19h8M4 21h5' },
  view: { l: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0' },
  pond: { l: 'M3 16c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M7 12V4M10 12V7M7 6.5c-1.2.8-2 2.3-2 4M17 12a2 2 0 1 0 0-.01' },
  // 22/11: the Jardin de Diane is drawn as a stag (Diana's hunt), chosen over three fountains.
  stag: { l: 'M9 13l3 7 3-7M9 13c0-1.6 1.3-2.7 3-2.7s3 1.1 3 2.7M9.5 10.8C7.3 9.5 6 7.3 6 4M6 7.3L3.8 6.2M7.6 9.3l-2.6.4M14.5 10.8c2.2-1.3 3.5-3.5 3.5-6.8M18 7.3l2.2-1.1M16.4 9.3l2.6.4' },
};

// The place icons on one page (reports/bleau-quest/icones.html), chosen on 22/11 by the project lead.
const PROPOSALS = [
  { place: 'Monuments et ville', icons: [['castle', 'Château (Cour des Adieux)'], ['stag', 'Jardin de Diane'], ['mask', 'Théâtre'], ['obelisk', 'Obélisque'], ['church', 'Église Saint-Louis'], ['townhall', 'Hôtel de ville'], ['prison', 'Ancienne prison'], ['fresco', 'Fresque de Napoléon'], ['door', 'Porte du Grand Ferrare'], ['mansion', 'Aigle Noir'], ['park', 'Parc']] },
  { place: 'Forêt', icons: [['tower', 'Belvédère'], ['view', 'Point de vue'], ['tree', 'Site'], ['rock', 'Rocher'], ['cave', 'Grotte'], ['cross', 'Croix'], ['mountain', 'Gorges'], ['pond', 'Mare'], ['climb', 'Bloc'], ['palette', 'Peintres']] },
];

const ICONS = {};
for (const [k, v] of Object.entries(SET)) ICONS[k] = { l: v.l };

module.exports = { ICONS, PROPOSALS };
