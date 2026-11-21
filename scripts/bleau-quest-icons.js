/**
 * Icons of the Fontainebleau Live Collection mock-up (item 116, 21/11: "les icônes ne sont pas top").
 * Line icons on a 24×24 grid (stroke, round caps), in the site's style. (A pixel-art version was
 * tried and dropped on 21/11 with the pixel-art direction.)
 * Drawn for this project (no third-party icon set). Fixed markup, never from the data.
 */

const SET = {
  castle: { l: 'M3 21h18M5 21V8h3v2h2V8h4v2h2V8h3v13M10 21v-4a2 2 0 0 1 4 0v4M5 8V5M19 8V5' },
  fountain: { l: 'M12 3v7M8.5 6.5C9 5 10.5 4 12 4s3 1 3.5 2.5M4 13h16M5 13l1.5 6h11L19 13M12 10c-2.5 0-4.5 1-5.5 3M12 10c2.5 0 4.5 1 5.5 3M9 21h6' },
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
};

const ICONS = {};
for (const [k, v] of Object.entries(SET)) ICONS[k] = { l: v.l };

module.exports = { ICONS };
