'use strict';
/**
 * « Le calendrier de l'Avent de la forêt » (19/11): /calendrier-de-l-avent/, one door a day from
 * 1 to 24 December. Hand-written content, never generated.
 *
 * Twelve animals, each on two days: a riddle (« Qui suis-je ? ») and « En hiver » (what it does
 * in December). The ten riddles of the forest game are reused as they are (scripts/foret.js,
 * already checked); the WINTER texts and the two new animals (green woodpecker, hare) are
 * natural history written by Claude, and like foret.js NOTHING here is published before the
 * project lead has checked it against the ONF and INPN species pages.
 *
 * Pictures: the project lead's (made with an AI), 192 px in public/foret/img/icones/; the green
 * woodpecker is Final/animal-pic-vert.png, the hare Final/lievre.png. The door fronts are
 * Christmas drawings in SVG (DECOR), our own markup, never data.
 *
 * English (`en`) mirrors the French field by field, swapped in by the FR/EN switch.
 */

const { ANIMALS } = require('./foret');

// The two animals that are not in the game, in the same shape as foret.js.
const EXTRA = [
  {
    key: 'pic-vert',
    icon: '/public/foret/img/icones/pic-vert.png',
    name: 'Le pic vert',
    riddle: 'Je suis vert avec une calotte rouge sur la tête. Je cherche ma nourriture surtout par terre, et ma longue langue collante attrape les fourmis.',
    fact: 'Le cri du pic vert ressemble à un grand éclat de rire : on l’appelle parfois le « pic rieur ».',
    en: {
      name: 'The green woodpecker',
      riddle: 'I am green with a red cap on my head. I look for food mostly on the ground, and my long sticky tongue catches ants.',
      fact: 'The green woodpecker’s call sounds like a loud laugh: in French it is sometimes called the « laughing woodpecker ».',
    },
  },
  {
    key: 'lievre',
    icon: '/public/foret/img/icones/lievre.png',
    name: 'Le lièvre',
    riddle: 'J’ai de très longues oreilles au bout noir et de grandes pattes arrière. Je ne creuse pas de terrier : je me cache dans un petit creux, à même le sol.',
    fact: 'Le lièvre peut courir à plus de 60 km/h, et il fait de grands zigzags pour semer un renard.',
    en: {
      name: 'The brown hare',
      riddle: 'I have very long ears with black tips and big back legs. I do not dig a burrow: I hide in a small hollow, right on the ground.',
      fact: 'A hare can run at more than 60 km/h, and it zigzags to shake off a fox.',
    },
  },
];

// « En hiver »: one per animal. To be checked by the project lead before publication.
const WINTER = {
  cerf: {
    fr: 'En hiver, les cerfs vivent entre mâles, en petits groupes, et les biches avec leurs faons de leur côté. Quand l’herbe manque, ils mangent des ronces, des bourgeons et même de l’écorce.',
    en: 'In winter, stags live together in small groups, and the hinds with their fawns on their own. When grass is scarce, they eat brambles, buds and even bark.',
  },
  sanglier: {
    fr: 'Le sanglier ne dort pas tout l’hiver : il retourne la terre avec son groin pour trouver des racines, des glands et des vers. On dit qu’il « vermille ». Les marcassins naissent surtout au printemps.',
    en: 'The wild boar does not sleep through the winter: it turns the soil over with its snout to find roots, acorns and worms. Piglets are mostly born in spring.',
  },
  chevreuil: {
    fr: 'Le chevreuil perd ses bois en automne ou au début de l’hiver. Ils repoussent tout de suite, couverts d’une peau douce qu’on appelle le « velours ». En hiver, son pelage devient gris-brun.',
    en: 'The roe deer sheds its antlers in autumn or early winter. They grow back straight away, covered with a soft skin called « velvet ». In winter its coat turns greyish brown.',
  },
  ecureuil: {
    fr: 'L’écureuil n’hiberne pas. Quand il fait très froid, il reste blotti dans son nid, une boule de brindilles et de mousse en haut d’un arbre. En hiver, ses oreilles portent de jolis pinceaux de poils.',
    en: 'The squirrel does not hibernate. When it is very cold, it stays curled up in its nest, a ball of twigs and moss high up in a tree. In winter, its ears have pretty tufts of hair.',
  },
  renard: {
    fr: 'C’est en plein hiver, de décembre à février, que les renards cherchent un partenaire. La nuit, on peut entendre leurs cris rauques résonner dans la forêt.',
    en: 'It is in the middle of winter, from December to February, that foxes look for a mate. At night, you can hear their hoarse calls ringing through the forest.',
  },
  blaireau: {
    fr: 'Le blaireau n’hiberne pas vraiment, mais quand il gèle, il peut rester plusieurs jours au chaud dans son terrier, tapissé de feuilles sèches et d’herbe. Il vit alors sur la graisse prise à l’automne.',
    en: 'The badger does not really hibernate, but when it freezes it can stay for days in its warm burrow, lined with dry leaves and grass. It then lives on the fat it put on in autumn.',
  },
  hulotte: {
    fr: 'C’est en hiver qu’on entend le plus la chouette hulotte : le mâle chante « hou-hou-hou » pour défendre son territoire et appeler sa femelle. Elle pond souvent dès la fin de l’hiver, dans un trou d’arbre.',
    en: 'Winter is when the tawny owl is heard the most: the male hoots « hoo-hoo-hoo » to defend his territory and call his mate. She often lays her eggs at the end of winter, in a hole in a tree.',
  },
  geai: {
    fr: 'En hiver, le geai va rechercher les glands qu’il a enterrés à l’automne, même sous la neige. Pour les retrouver, il se souvient des repères autour de chaque cachette : un arbre, une pierre.',
    en: 'In winter, the jay goes back for the acorns it buried in autumn, even under snow. To find them, it remembers the landmarks around each hiding place: a tree, a stone.',
  },
  lucane: {
    fr: 'En hiver, pas de lucane en vue : sa larve, un gros ver blanc, grandit cachée dans une vieille souche pendant plusieurs années. L’adulte ne sortira qu’au début de l’été, pour quelques semaines.',
    en: 'No stag beetles in winter: the larva, a big white grub, grows hidden in an old stump for several years. The adult only comes out at the start of summer, for a few weeks.',
  },
  pic: {
    fr: 'Dès la fin de l’hiver, le pic noir tambourine très vite sur les troncs avec son bec. Ce roulement s’entend de très loin et veut dire : « ici, c’est chez moi ».',
    en: 'From the end of winter, the black woodpecker drums very fast on tree trunks with its beak. The drumming can be heard from far away and means: « this is my home ».',
  },
  'pic-vert': {
    fr: 'Quand la neige recouvre le sol, le pic vert creuse des trous dans la neige pour atteindre les fourmilières. Sa langue, très longue, peut sortir de plusieurs centimètres hors de son bec.',
    en: 'When snow covers the ground, the green woodpecker digs holes in it to reach the anthills. Its very long tongue can stick out several centimetres beyond its beak.',
  },
  lievre: {
    fr: 'En hiver, le lièvre passe la journée immobile dans son « gîte », un creux dans l’herbe, les oreilles plaquées sur le dos. Il sort à la nuit pour manger de l’herbe, des bourgeons et de l’écorce.',
    en: 'In winter, the hare spends the day perfectly still in its « form », a hollow in the grass, ears flat on its back. It comes out at nightfall to eat grass, buds and bark.',
  },
};

// The door order: each riddle before its winter day; the red deer, the forest's emblem, last.
const ORDER = [
  ['ecureuil', 'riddle'], ['renard', 'riddle'], ['hulotte', 'riddle'], ['ecureuil', 'winter'],
  ['sanglier', 'riddle'], ['geai', 'riddle'], ['renard', 'winter'], ['lievre', 'riddle'],
  ['chevreuil', 'riddle'], ['hulotte', 'winter'], ['pic-vert', 'riddle'], ['blaireau', 'riddle'],
  ['geai', 'winter'], ['lucane', 'riddle'], ['sanglier', 'winter'], ['pic', 'riddle'],
  ['lievre', 'winter'], ['chevreuil', 'winter'], ['blaireau', 'winter'], ['pic-vert', 'winter'],
  ['lucane', 'winter'], ['pic', 'winter'], ['cerf', 'riddle'], ['cerf', 'winter'],
];

// Christmas drawings for the door fronts, 40×40, our own SVG.
const DECOR = {
  houx: '<path d="M20 21c-3-6-9-8-15-6 3 1 3 4 2 6 3-1 5 1 5 3 3-2 6-3 8-3z" fill="#2f7a3e"/><path d="M20 21c3-6 9-8 15-6-3 1-3 4-2 6-3-1-5 1-5 3-3-2-6-3-8-3z" fill="#24603a"/><circle cx="17" cy="24" r="3.2" fill="#c8202f"/><circle cx="23" cy="24" r="3.2" fill="#c8202f"/><circle cx="20" cy="28.5" r="3.2" fill="#a51a27"/>',
  sapin: '<path d="M20 4l7 10h-4l6 9h-4l7 10H8l7-10h-4l6-9h-4z" fill="#2f7a3e"/><rect x="18" y="33" width="4" height="5" fill="#7a4a24"/><circle cx="20" cy="4" r="2.5" fill="#e9b949"/><circle cx="16" cy="20" r="1.6" fill="#c8202f"/><circle cx="24" cy="26" r="1.6" fill="#e9b949"/><circle cx="17" cy="29" r="1.6" fill="#c8202f"/>',
  etoile: '<path d="M20 4l4.7 10.2 11.1 1.2-8.3 7.5 2.3 11L20 28.3l-9.8 5.6 2.3-11-8.3-7.5 11.1-1.2z" fill="#e9b949" stroke="#c99a2e" stroke-width="1"/>',
  boule: '<rect x="17" y="5" width="6" height="5" rx="1" fill="#c99a2e"/><circle cx="20" cy="23" r="13" fill="#c8202f"/><path d="M8 21c8 3 16 3 24 0" stroke="#e9b949" stroke-width="2.5" fill="none"/><circle cx="15" cy="17" r="3" fill="#fff" opacity=".35"/>',
  flocon: '<g stroke="#4f86b8" stroke-width="2.4" stroke-linecap="round"><path d="M20 4v32M6 12l28 16M6 28l28-16"/><path d="M16 7l4 4 4-4M16 33l4-4 4 4M7 17l5-1-2-5M33 23l-5 1 2 5M7 23l5 1-2 5M33 17l-5-1 2-5"/></g>',
  bougie: '<rect x="15" y="16" width="10" height="20" rx="2" fill="#f4efe2" stroke="#c8202f" stroke-width="1.5"/><path d="M20 4c3 4 4 7 0 10-4-3-3-6 0-10z" fill="#e9b949"/><path d="M20 8c1.5 2 1.5 4 0 5-1.5-1-1.5-3 0-5z" fill="#d9632b"/><path d="M12 34h16" stroke="#2f7a3e" stroke-width="3"/>',
  cadeau: '<rect x="7" y="16" width="26" height="20" rx="2" fill="#2f7a3e"/><rect x="5" y="12" width="30" height="7" rx="2" fill="#24603a"/><rect x="18" y="12" width="4" height="24" fill="#c8202f"/><path d="M20 12c-4-7-11-5-8-1 2 2 5 1 8 1zm0 0c4-7 11-5 8-1-2 2-5 1-8 1z" fill="#c8202f"/>',
  sucre: '<path d="M24 36V14a6 6 0 0 0-12 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M24 36V14a6 6 0 0 0-12 0" fill="none" stroke="#c8202f" stroke-width="6" stroke-linecap="round" stroke-dasharray="3 4"/>',
  cloche: '<path d="M20 6c-7 0-10 6-10 13v6l-3 5h26l-3-5v-6c0-7-3-13-10-13z" fill="#e9b949" stroke="#c99a2e" stroke-width="1"/><circle cx="20" cy="33" r="3" fill="#c99a2e"/><path d="M14 6c2-3 10-3 12 0" stroke="#c8202f" stroke-width="2.5" fill="none"/>',
  gui: '<path d="M20 6v14M20 20l-9 8M20 20l9 8M20 14l-7 2M20 14l7 2" stroke="#6d8f3a" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="11" cy="29" rx="5" ry="2.6" transform="rotate(-35 11 29)" fill="#8aab4a"/><ellipse cx="29" cy="29" rx="5" ry="2.6" transform="rotate(35 29 29)" fill="#8aab4a"/><circle cx="18" cy="23" r="2.2" fill="#f4f1e6" stroke="#cfc8b0"/><circle cx="22" cy="23" r="2.2" fill="#f4f1e6" stroke="#cfc8b0"/><circle cx="20" cy="26" r="2.2" fill="#f4f1e6" stroke="#cfc8b0"/>',
  pomme: '<path d="M20 4c8 4 12 13 9 22-2 6-6 10-9 10s-7-4-9-10C8 17 12 8 20 4z" fill="#8a5a2b"/><g stroke="#5e3b1a" stroke-width="1.4" fill="none"><path d="M12 14c5 3 11 3 16 0M10 20c6 3 14 3 20 0M11 26c5 3 13 3 18 0M13 31c4 2 10 2 14 0"/></g><path d="M20 4v-2" stroke="#2f7a3e" stroke-width="2"/>',
  bonnet: '<path d="M8 30c2-12 9-20 18-22 3 6 4 13 6 22z" fill="#c8202f"/><rect x="5" y="28" width="30" height="7" rx="3.5" fill="#f4efe2"/><circle cx="27" cy="7" r="4" fill="#f4efe2"/>',
};
const DECOR_ORDER = ['houx', 'sapin', 'etoile', 'boule', 'flocon', 'bougie', 'cadeau', 'sucre', 'cloche', 'gui', 'pomme', 'bonnet'];

// The doors on the page are not in order 1-24, as on a real calendar. Fixed, so it never moves.
const LAYOUT = [7, 15, 2, 21, 11, 18, 4, 23, 9, 1, 16, 13, 20, 6, 24, 3, 12, 19, 8, 22, 14, 5, 17, 10];

const byKey = new Map([...ANIMALS, ...EXTRA].map((a) => [a.key, a]));

/** The 24 days, ready to render. */
const DAYS = ORDER.map(([key, kind], i) => {
  const a = byKey.get(key);
  if (!a) throw new Error(`avent: unknown animal ${key}`);
  if (kind === 'winter' && !WINTER[key]) throw new Error(`avent: no winter text for ${key}`);
  return {
    day: i + 1,
    key,
    kind,
    icon: a.icon,
    name: a.name,
    decor: DECOR_ORDER[i % DECOR_ORDER.length],
    riddle: a.riddle,
    fact: a.fact,
    winter: WINTER[key] ? WINTER[key].fr : '',
    en: { name: a.en.name, riddle: a.en.riddle, fact: a.en.fact, winter: WINTER[key] ? WINTER[key].en : '' },
  };
});

module.exports = { DAYS, DECOR, LAYOUT, EXTRA, WINTER };
