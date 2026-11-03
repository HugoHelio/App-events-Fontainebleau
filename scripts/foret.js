'use strict';
/**
 * « Les animaux de la forêt » (item 107, 02/11): the free mini-game at /foret/ and, later, the
 * printable explorer's booklet it leads to. Hand-written content, never generated.
 *
 * Unlike the guides (scripts/balades.js), these are not the project lead's own route: the facts
 * are general natural history written by Claude, and NOTHING here is published before the
 * project lead has checked it against the ONF and INPN species pages (§9, item 107). Only
 * species living in the Forest of Fontainebleau; no safety advice beyond the plain rules below.
 *
 * Pictures (item 107c, 02/11): `icon` is the picture supplied by the project lead (192 px PNG in
 * public/foret/img/icones/, the 512 px originals in public/foret/icones/); an animal without one
 * keeps its emoji. `iconBy`: author and page of a Flaticon icon (free licence, attribution due:
 * an empty page means our own drawing;
 * credited on /foret/ and in /mentions-legales/, the same day as any new icon).
 *
 * Each animal: a riddle (« Qui suis-je ? »), three choices (the answer and two other keys of this
 * list), and a « Le savais-tu ? » card shown after the answer. The cards are also written into
 * the page itself, so search engines read them and the page works without JavaScript. English
 * (`en`) mirrors the French field by field, swapped in by the FR/EN switch.
 *
 * generate-pages.js renders /foret/ from this file.
 */

const ANIMALS = [
  {
    key: 'cerf',
    emoji: '🦌',
    name: 'Le cerf',
    riddle: 'Je suis le plus grand animal sauvage de la forêt. Chaque automne, je pousse un cri très puissant qu’on appelle le brame.',
    choices: ['cerf', 'chevreuil', 'sanglier'],
    fact: 'Les bois du cerf tombent à la fin de l’hiver et repoussent chaque année. Le brame s’entend de mi-septembre à mi-octobre, surtout à la tombée du jour.',
    en: {
      name: 'The red deer',
      riddle: 'I am the largest wild animal in the forest. Every autumn I let out a very loud call, known as the rut bellow.',
      fact: 'A stag’s antlers fall off at the end of winter and grow back every year. The bellowing can be heard from mid-September to mid-October, mostly at dusk.',
    },
  },
  {
    key: 'sanglier',
    emoji: '🐗',
    icon: '/public/foret/img/icones/sanglier.png',
    iconBy: ['Flat Icons', 'https://www.flaticon.com/free-icons/boar'],
    name: 'Le sanglier',
    riddle: 'J’ai un groin pour fouiller la terre, et mes petits portent un pyjama rayé.',
    choices: ['blaireau', 'sanglier', 'renard'],
    fact: 'Les petits du sanglier s’appellent les marcassins. Leurs rayures claires les cachent dans les feuilles mortes ; elles disparaissent au bout de quelques mois.',
    en: {
      name: 'The wild boar',
      riddle: 'I have a snout to dig up the ground, and my babies wear striped pyjamas.',
      fact: 'Baby wild boars are called piglets (marcassins in French). Their pale stripes hide them among dead leaves; the stripes fade after a few months.',
    },
  },
  {
    key: 'chevreuil',
    emoji: '🦌',
    icon: '/public/foret/img/icones/chevreuil.png',
    iconBy: ['kerismaker', 'https://www.flaticon.com/free-icons/deer'],
    name: 'Le chevreuil',
    riddle: 'Je ressemble à un petit cerf, j’ai une tache blanche sur les fesses et, quand j’ai peur, j’aboie !',
    choices: ['renard', 'cerf', 'chevreuil'],
    fact: 'Le chevreuil pousse un cri qui ressemble à un aboiement. La tache blanche de ses fesses s’appelle le miroir : on la voit de loin quand il s’enfuit.',
    en: {
      name: 'The roe deer',
      riddle: 'I look like a small red deer, I have a white patch on my bottom and, when I am scared, I bark!',
      fact: 'The roe deer gives a call that sounds like a dog’s bark. The white patch on its rump is called the mirror: you can see it from far away when it runs off.',
    },
  },
  {
    key: 'ecureuil',
    emoji: '🐿️',
    name: 'L’écureuil roux',
    riddle: 'Je cache des graines et des noisettes pour l’hiver… mais j’oublie souvent où je les ai mises !',
    choices: ['ecureuil', 'geai', 'blaireau'],
    fact: 'Les graines oubliées par l’écureuil peuvent germer : sans le savoir, il plante des arbres. Sa longue queue l’aide à garder l’équilibre quand il saute de branche en branche.',
    en: {
      name: 'The red squirrel',
      riddle: 'I hide seeds and nuts for the winter… but I often forget where I put them!',
      fact: 'The seeds a squirrel forgets can sprout: without knowing it, it plants trees. Its long tail helps it keep its balance as it leaps from branch to branch.',
    },
  },
  {
    key: 'renard',
    emoji: '🦊',
    name: 'Le renard roux',
    riddle: 'Je suis roux, j’ai une grande queue touffue, et je chasse les mulots en faisant des bonds.',
    choices: ['chevreuil', 'renard', 'ecureuil'],
    fact: 'Le renard entend un mulot bouger sous les feuilles. Il saute en l’air et retombe dessus, pattes en avant : on appelle cela le mulotage.',
    en: {
      name: 'The red fox',
      riddle: 'I am reddish, I have a big bushy tail, and I hunt mice by pouncing.',
      fact: 'A fox can hear a mouse moving under the leaves. It leaps into the air and lands on it front paws first: this is called mousing.',
    },
  },
  {
    key: 'blaireau',
    emoji: '🦡',
    name: 'Le blaireau',
    riddle: 'Je porte un masque noir et blanc et je creuse des terriers avec plusieurs entrées.',
    choices: ['sanglier', 'hulotte', 'blaireau'],
    fact: 'Le terrier du blaireau s’appelle une blaireautière. Il sort surtout la nuit, et la même blaireautière peut servir pendant des années, agrandie peu à peu.',
    en: {
      name: 'The badger',
      riddle: 'I wear a black and white mask and I dig burrows with several entrances.',
      fact: 'A badger’s burrow is called a sett. Badgers come out mostly at night, and the same sett can be used for years, made bigger little by little.',
    },
  },
  {
    key: 'pic',
    // The black bird (2022); an older phone shows a bird and a black square, still readable.
    emoji: '🐦‍⬛',
    name: 'Le pic noir',
    riddle: 'Je tambourine sur les troncs avec mon bec. Je suis le plus grand pic d’Europe.',
    choices: ['geai', 'pic', 'hulotte'],
    fact: 'Le pic noir est tout noir avec une calotte rouge. Il creuse son nid dans les grands arbres ; ses anciens trous servent ensuite de maison à d’autres oiseaux.',
    en: {
      name: 'The black woodpecker',
      riddle: 'I drum on tree trunks with my beak. I am the largest woodpecker in Europe.',
      fact: 'The black woodpecker is all black with a red cap. It digs its nest in big trees; its old holes then become homes for other birds.',
    },
  },
  {
    key: 'hulotte',
    emoji: '🦉',
    name: 'La chouette hulotte',
    riddle: 'Je chasse la nuit sans faire de bruit, et on m’entend faire « hou-hou ».',
    choices: ['hulotte', 'pic', 'geai'],
    fact: 'Le bord des plumes de la chouette hulotte est tout doux : il étouffe le bruit de son vol. On l’entend souvent la nuit, surtout en automne et en hiver.',
    en: {
      name: 'The tawny owl',
      riddle: 'I hunt at night without making a sound, and you can hear me go “hoo-hoo”.',
      fact: 'The edges of the tawny owl’s feathers are very soft: they muffle the sound of its flight. It is often heard at night, especially in autumn and winter.',
    },
  },
  {
    key: 'geai',
    emoji: '🪶',
    icon: '/public/foret/img/icones/geai.png',
    iconBy: ['Park Jisun', 'https://www.flaticon.com/free-icons/mockingjay'],
    name: 'Le geai des chênes',
    riddle: 'Je suis un oiseau avec des plumes bleues sur les ailes, et je plante des chênes sans le vouloir.',
    choices: ['pic', 'ecureuil', 'geai'],
    fact: 'En automne, le geai enterre des glands pour l’hiver. Ceux qu’il ne retrouve pas deviennent des chênes : il aide la forêt à pousser. Il sait aussi imiter le cri d’autres oiseaux.',
    en: {
      name: 'The jay',
      riddle: 'I am a bird with blue feathers on my wings, and I plant oak trees without meaning to.',
      fact: 'In autumn, the jay buries acorns for the winter. The ones it never finds grow into oaks: it helps the forest grow. It can also copy the calls of other birds.',
    },
  },
  {
    key: 'lucane',
    emoji: '🪲',
    icon: '/public/foret/img/icones/lucane.png',
    // Redrawn by the project lead in Krita (02/11) from Microsoft's Fluent Emoji beetle (MIT
    // licence, seen on Windows): our drawing, its source named.
    iconBy: ['Fontainebleau Live', '', 'd’après Fluent Emoji (Microsoft, licence MIT)', 'after Microsoft Fluent Emoji (MIT licence)'],
    name: 'Le lucane cerf-volant',
    riddle: 'Je suis un insecte, mais j’ai des « bois » sur la tête, comme le cerf !',
    choices: ['lucane', 'cerf', 'blaireau'],
    fact: 'Le lucane est le plus grand coléoptère d’Europe. Sa larve vit plusieurs années dans le bois mort : c’est une des raisons pour lesquelles on laisse des arbres morts dans certaines parties de la forêt.',
    en: {
      name: 'The stag beetle',
      riddle: 'I am an insect, but I have “antlers” on my head, just like a stag!',
      fact: 'The stag beetle is the largest beetle in Europe. Its larva lives for several years in dead wood: that is one reason why dead trees are left standing in some parts of the forest.',
    },
  },
];

// « Quel arbre ? » (03/11, project lead): one leaf question in each game, at a random place, the
// tree drawn at random; three choices (the answer and two other trees). Also a page of the
// booklet (« Quelle est cette feuille ? »), where the four leaves are to be linked to their
// names, listed in `names` order. Drawings: our own SVGs in public/foret/img/feuilles/ (green
// for the game; the booklet prints the same outlines, white, to colour). Same review rule as
// the animals: nothing published before the project lead has checked the facts.
const LEAVES = {
  riddle: 'Regarde bien sa forme et ses bords : de quel arbre vient cette feuille ?',
  riddleEn: 'Look closely at its shape and its edges: which tree does this leaf come from?',
  // The booklet page: leaves in this order, names in the other.
  order: ['chataignier', 'chene', 'pin', 'hetre'],
  names: ['chene', 'hetre', 'chataignier', 'pin'],
  trees: [
    {
      key: 'chene',
      name: 'Le chêne',
      fact: 'La feuille du chêne a des bords qui font des vagues arrondies. Son fruit est le gland, que mangent le geai, l’écureuil et le sanglier. C’est l’arbre le plus répandu de la forêt de Fontainebleau.',
      en: {
        name: 'The oak',
        fact: 'The oak leaf has rounded, wavy edges. Its fruit is the acorn, eaten by jays, squirrels and wild boars. It is the most common tree in the Forest of Fontainebleau.',
      },
    },
    {
      key: 'hetre',
      name: 'Le hêtre',
      fact: 'La feuille du hêtre est ovale, avec des nervures bien droites et un bord presque lisse. Son fruit s’appelle la faîne. Son tronc est lisse et gris, comme la peau d’un éléphant.',
      en: {
        name: 'The beech',
        fact: 'The beech leaf is oval, with very straight veins and an almost smooth edge. Its fruit is called beechnut. Its trunk is smooth and grey, like an elephant’s skin.',
      },
    },
    {
      key: 'chataignier',
      name: 'Le châtaignier',
      fact: 'La feuille du châtaignier est longue, avec une dent pointue au bout de chaque nervure. Son fruit, la châtaigne, se cache dans une bogue couverte de piquants.',
      en: {
        name: 'The sweet chestnut',
        fact: 'The sweet chestnut leaf is long, with a sharp tooth at the end of every vein. Its fruit, the chestnut, hides in a husk covered in prickles.',
      },
    },
    {
      key: 'pin',
      name: 'Le pin sylvestre',
      fact: 'Le pin sylvestre a des aiguilles à la place des feuilles, toujours par deux, et il les garde en hiver. Son fruit est la pomme de pin. On le reconnaît de loin : en bas, son écorce est grise et crevassée ; en haut du tronc et sur les branches, elle devient orange.',
      en: {
        name: 'The Scots pine',
        fact: 'The Scots pine has needles instead of leaves, always in pairs, and keeps them in winter. Its fruit is the pine cone. You can spot it from afar: low down, its bark is grey and cracked; higher up the trunk and on the branches, it turns orange.',
      },
    },
  ].map((t) => ({ ...t, emoji: '🌳', leaf: `/public/foret/img/feuilles/${t.key}.svg` })),
};

// The rules shown under the game: plain good manners in a forest, nothing site-specific.
const RULES = [
  ['On observe de loin et en silence : les animaux sont chez eux.', 'Watch from a distance and quietly: the animals are at home.'],
  ['On ne nourrit pas les animaux sauvages.', 'Never feed wild animals.'],
  ['On reste sur les chemins et on remporte ses déchets.', 'Stay on the paths and take your litter home.'],
];

// The printable booklet (item 107, step 2): 12 A4 pages drawn by scripts/carnet-pdf.js. The
// engravings are J. E. Ridinger's « Spuhren und Fahrten der Tiere » (1740s-1750s), Rijksmuseum
// prints released as CC0 on Wikimedia Commons: each plate shows an animal and its tracks. The
// scenes are cropped and lightened for colouring, the tracks cropped as they are, by hand, into
// public/foret/img/ (the project lead may retouch them in Krita: same file names).
const CARNET = {
  // Both languages: exports of the project lead's two Word files (03/11, kept outside the repo,
  // Fiches\CarnetExplorateur-Jeux\Derniere-version-2026-11-03), his reworked booklet of 02/11
  // with the leaf page. They are the source now, not scripts/carnet-pdf.js.
  pdf: '/public/foret/carnet-explorateur-foret.pdf',
  pdfEn: '/public/foret/carnet-explorateur-foret-en.pdf',
  url: 'fontainebleaulive.fr/foret',
  // Coloured pages, in order: the first takes a whole page, the others two per page.
  colouring: ['cerf', 'sanglier', 'chevreuil', 'renard', 'blaireau'],
  // « Qui a laissé cette trace ? »: the names are listed in this other order, to be linked.
  tracks: ['cerf', 'sanglier', 'renard', 'blaireau', 'ecureuil'],
  trackNames: ['renard', 'ecureuil', 'cerf', 'blaireau', 'sanglier'],
  // « Qui suis-je ? »: the animals that have no colouring page.
  riddles: ['hulotte', 'pic', 'geai', 'lucane'],
  bingo: [
    'Un gland', 'Une feuille de chêne', 'Une pomme de pin', 'Une plume',
    'De la mousse', 'Une fougère', 'De la bruyère', 'Du sable',
    'Un champignon (on regarde, on ne touche pas !)', 'Un gros rocher', 'Un rocher qui ressemble à un animal', 'Un trou dans un tronc',
    'Une toile d’araignée', 'Un oiseau qui chante', 'Une empreinte dans la boue', 'Un arbre plus large que tes bras',
  ],
  // Word search: capitals without accents, as children write them in a grid.
  words: ['CERF', 'SANGLIER', 'CHEVREUIL', 'ECUREUIL', 'RENARD', 'BLAIREAU', 'HULOTTE', 'GEAI', 'LUCANE', 'PIC'],
  credits: {
    cerf: { plate: 'Hert met spoor', id: 'RP-P-OB-53.706' },
    sanglier: { plate: 'Wild zwijn met spoor', id: 'RP-P-OB-53.704' },
    chevreuil: { plate: 'Reebok met spoor', id: 'RP-P-OB-53.701' },
    renard: { plate: 'Vos met spoor', id: 'RP-P-OB-53.696' },
    blaireau: { plate: 'Das met spoor', id: 'RP-P-OB-53.695' },
    ecureuil: { plate: 'Bunzing en eekhoorn met hun sporen', id: 'RP-P-OB-53.692' },
  },
};

module.exports = { ANIMALS, LEAVES, RULES, CARNET };
