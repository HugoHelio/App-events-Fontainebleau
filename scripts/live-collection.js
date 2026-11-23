'use strict';
/**
 * Fontainebleau Live Collection — the game's content (item 116d, GDD: Live-Collection-GDD.md).
 * WRITTEN BY HAND, never generated. One file for the mock-up today and the /jeu/ page tomorrow.
 *
 *   node scripts/live-collection.js   prints what is left to do before publication (read only)
 *
 * Rules (GDD §4, §9, design doc §5):
 * - Every fact in a text comes from a source listed under it; the AI never writes a fact or a step.
 *   A place without a sure source is a plain point to collect: no text, no question.
 * - Names stay in French, as on the signs (the site's rule for event titles). Texts, questions and
 *   choices are FR/EN; the English is a translation of the French, nothing added.
 * - A question asks for something one SEES on the spot, three choices, `answer` = index of the right one.
 * - `check` tracks publication: `sources` (every fact cross-checked, a link for each source),
 *   `site` (question checked on the spot), `lead` (read and approved by the project lead).
 *   Nothing is published on /jeu/ until all three are true.
 * - `zone` sets the GPS radius: 'ville' 100 m, 'foret' 150 m (GDD §9).
 */

// The seven series of M1 (frozen on 23/11 with the 37 places).
const SETS = {
  napoleon: { fr: 'Napoléon à Fontainebleau', en: 'Napoleon in Fontainebleau' },
  chateau: { fr: 'Le château et ses jardins', en: 'The château and its gardens' },
  ville: { fr: 'La ville', en: 'The town' },
  denecourt: { fr: 'Les sentiers bleus', en: 'The blue trails' },
  foret: { fr: 'Grands sites de la forêt', en: 'Great forest sites' },
  peintres: { fr: 'Les peintres de Barbizon', en: 'The Barbizon painters' },
  grimpe: { fr: '5 Must Climb, en famille', en: '5 Must Climb, for families' },
};

const TYPES = {
  'Monument': 'Monument', 'Jardin': 'Garden', 'Patrimoine urbain': 'Town heritage', 'Église': 'Church',
  'Monument historique': 'Listed monument', 'Parc': 'Park', 'Peinture murale': 'Mural',
  'Site des sentiers bleus': 'Blue-trail site', 'Belvédère': 'Lookout tower', 'Point de vue': 'Viewpoint',
  'Carrefour historique': 'Historic crossroads', 'Gorges': 'Gorge', 'Grotte': 'Cave', 'Mare': 'Pond',
  'Futaie': 'Old-growth woodland', 'Village': 'Village', 'Maison de peintres': 'Painters’ house',
  'Site de bloc': 'Bouldering site', 'Site de bloc et sable': 'Bouldering site and sand', 'Rocher nommé': 'Named rock',
};

// Base Mérimée / Muséofile notices on the culture ministry's POP platform (link by reference).
const pop = (base, ref) => `https://pop.culture.gouv.fr/notice/${base}/${ref}`;
const WALK_SHEET = { label: 'Fiche « Fontainebleau à pied », Fontainebleau Live', url: 'https://fontainebleaulive.fr/balades/' };

// The 37 places of M1, frozen on 23/11 (GDD §7.1). Positions: OpenStreetMap, the fresco and the
// prison at the street (BAN); all to be checked on the spot.
const SPOTS = [
  // ── The château and the town ──────────────────────────────────────────────────────────────
  {
    id: 'cour-des-adieux', name: 'Cour des Adieux', set: 'napoleon', type: 'Monument', rarity: 'commun', zone: 'ville',
    lat: 48.40204, lng: 2.69810, icon: 'castle',
    text: {
      fr: 'Le 20 avril 1814, avant de partir pour l’île d’Elbe, Napoléon descend l’escalier de cette cour et fait ses adieux à sa Vieille Garde. La cour du Cheval Blanc devient alors la cour des Adieux. L’escalier lui-même est plus ancien : il date de Louis XIII (1632-1634).',
      en: 'On 20 April 1814, before leaving for Elba, Napoleon came down the staircase of this courtyard and bade farewell to his Old Guard. The White Horse Courtyard then became the Courtyard of Farewells. The staircase itself is older: it dates from Louis XIII (1632-1634).',
    },
    sources: [
      { label: 'Fondation Napoléon, « Les adieux de Fontainebleau à la Vieille Garde »', url: null },
      { label: 'Château de Fontainebleau', url: null },
    ],
    q: {
      fr: 'Regardez le grand escalier de la façade : quelle forme a-t-il ?', en: 'Look at the great staircase on the façade: what shape is it?',
      choices: { fr: ['En fer à cheval', 'En colimaçon', 'Tout droit'], en: ['Horseshoe', 'Spiral', 'Straight'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: true },
  },
  {
    id: 'jardin-de-diane', name: 'Jardin de Diane', set: 'chateau', type: 'Jardin', rarity: 'commun', zone: 'ville',
    lat: 48.40295, lng: 2.69973, icon: 'stag',
    text: {
      fr: 'Au centre de l’ancien jardin de la Reine, Diane chasseresse. Ce bronze est une fonte des frères Keller (1684), copie d’une statue antique aujourd’hui au Louvre ; il vient du château de Marly. Les chiens et les têtes de cerf du socle sont de Pierre Biard, au début du XVIIᵉ siècle.',
      en: 'At the centre of the former Queen’s Garden stands Diana the Huntress. This bronze was cast by the Keller brothers (1684), a copy of an ancient statue now in the Louvre; it came from the château of Marly. The dogs and stag heads on the base are by Pierre Biard, from the early 17th century.',
    },
    sources: [
      { label: 'Metropolitan Museum of Art (Diane de Barthélemy Prieur, notice)', url: null },
      { label: 'Musée du Louvre', url: null },
    ],
    todo: 'Recouper avec le château de Fontainebleau (fonte Keller, provenance de Marly).',
    q: {
      fr: 'Combien de chiens entourent le socle de la fontaine ?', en: 'How many dogs surround the base of the fountain?',
      choices: { fr: ['Deux', 'Quatre', 'Six'], en: ['Two', 'Four', 'Six'] }, answer: 1,
    },
    check: { sources: false, site: false, lead: true },
  },
  {
    id: 'theatre', name: 'Théâtre municipal', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', zone: 'ville',
    lat: 48.40335, lng: 2.69762, icon: 'mask',
    text: {
      fr: 'Un concours d’architecture en 1905, un chantier de 1910 à 1912, une inauguration le 9 mars 1912 : le théâtre de Fernand Lucas et Paul Marion est l’un des rares théâtres à l’italienne d’Île-de-France hors de Paris. Il est protégé au titre des monuments historiques.',
      en: 'An architecture competition in 1905, building work from 1910 to 1912, an opening night on 9 March 1912: Fernand Lucas and Paul Marion’s theatre is one of the few Italian-style theatres in the Paris region outside Paris itself. It is a listed historic monument.',
    },
    sources: [
      { label: 'Inventaire général du patrimoine culturel, Région Île-de-France', url: null },
      { label: 'Base Mérimée, PA00087345', url: pop('merimee', 'PA00087345') },
    ],
    q: {
      fr: 'De quoi est faite la façade du théâtre ?', en: 'What is the theatre’s façade made of?',
      choices: { fr: ['De brique et de pierre', 'De béton', 'De bois'], en: ['Brick and stone', 'Concrete', 'Wood'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: true },
  },
  {
    id: 'obelisque', name: 'Obélisque de Marie-Antoinette', set: 'chateau', type: 'Monument', rarity: 'commun', zone: 'ville',
    lat: 48.39705, lng: 2.69227, icon: 'obelisk',
    text: {
      fr: 'Haut de 21 mètres, l’obélisque est élevé en 1785-1786 en l’honneur de Marie-Antoinette et de ses enfants, au carrefour où se croisent les grandes routes de la forêt. Des bornes y indiquent les directions ; leurs fleurs de lys sont ôtées en 1793.',
      en: 'Twenty-one metres high, the obelisk was raised in 1785-1786 in honour of Marie-Antoinette and her children, at the crossroads where the forest’s main roads meet. Milestones show the directions; their fleurs-de-lis were removed in 1793.',
    },
    sources: [
      { label: 'Base Mérimée, PA00086970 (quatre bornes indicatrices)', url: pop('merimee', 'PA00086970') },
      { label: 'Musée du Patrimoine', url: null },
    ],
    q: {
      fr: 'Autour de l’obélisque, combien de bornes indiquent les routes ?', en: 'Around the obelisk, how many milestones show the roads?',
      choices: { fr: ['Deux', 'Quatre', 'Huit'], en: ['Two', 'Four', 'Eight'] }, answer: 1,
    },
    check: { sources: true, site: false, lead: true },
  },
  {
    id: 'donjon', name: 'Le donjon (cour Ovale)', set: 'chateau', type: 'Monument', rarity: 'peu commun', zone: 'ville',
    lat: 48.40222, lng: 2.70104, icon: 'keep',
    text: {
      fr: 'Au cœur de la cour Ovale se dresse la grosse tour carrée du donjon, la partie la plus ancienne du château : une charte de Louis VII l’atteste dès 1137. En 1528, François Ier fait abattre presque tout le château médiéval et reconstruire sur ses fondations, mais il garde le donjon.',
      en: 'At the heart of the Oval Courtyard rises the keep’s great square tower, the oldest part of the château: a charter of Louis VII records it as early as 1137. In 1528, François I had almost all of the medieval castle pulled down and rebuilt on its foundations, but he kept the keep.',
    },
    sources: [
      { label: 'Château de Fontainebleau, « Le palais médiéval »', url: null },
      { label: 'Encyclopædia Universalis', url: null },
    ],
    q: {
      fr: 'Quelle forme a la vieille tour du donjon ?', en: 'What shape is the old tower of the keep?',
      choices: { fr: ['Carrée', 'Ronde', 'Octogonale'], en: ['Square', 'Round', 'Octagonal'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    // Inside the château (paid visit), placed on the wing.
    id: 'galerie-francois-1er', name: 'Galerie François Ier', set: 'chateau', type: 'Monument', rarity: 'rare', zone: 'ville',
    lat: 48.40255, lng: 2.69905, icon: 'gallery',
    text: {
      fr: 'Commencée vers 1528 pour relier les appartements de François Ier à la chapelle, la galerie mesure environ 61 mètres sur 6. Le peintre florentin Rosso Fiorentino et son atelier la décorent de 1533 à 1539 : fresques et stucs mêlés, une première en France.',
      en: 'Begun around 1528 to link François I’s apartments to the chapel, the gallery is about 61 metres long and 6 wide. The Florentine painter Rosso Fiorentino and his workshop decorated it from 1533 to 1539: frescoes and stucco combined, a first in France.',
    },
    sources: [
      { label: 'Vassar College, catalogue Rosso Fiorentino (E. Carroll), « The Gallery of Francis I »', url: null },
      { label: 'Château de Fontainebleau', url: null },
    ],
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'fresque-napoleon', name: 'Fresque de Napoléon', set: 'napoleon', type: 'Peinture murale', rarity: 'commun', zone: 'ville',
    lat: 48.40340, lng: 2.69724, icon: 'fresco',
    text: {
      fr: 'Rue de Ferrare, en venant du parking du château, une grande fresque représente Napoléon.',
      en: 'On rue de Ferrare, coming from the château car park, a large mural shows Napoleon.',
    },
    sources: [WALK_SHEET],
    todo: 'Texte d’itinéraire, pas d’histoire : trouver l’auteur et la date de la fresque, ou en faire un simple point.',
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'grand-ferrare', name: 'Porte de l’hôtel du Grand Ferrare', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', zone: 'ville',
    lat: 48.40435, lng: 2.69802, icon: 'door',
    text: {
      fr: 'Juste après la fresque, rue de Ferrare, la porte de l’hôtel du Grand Ferrare.',
      en: 'Just after the mural, on rue de Ferrare, the gateway of the Hôtel du Grand Ferrare.',
    },
    sources: [WALK_SHEET],
    todo: 'Texte d’itinéraire : chercher l’histoire de l’hôtel (cardinal de Ferrare, Serlio ?) dans Mérimée ou l’Inventaire.',
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'aigle-noir', name: 'Place Napoléon-Bonaparte et l’Aigle Noir', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', zone: 'ville',
    lat: 48.40367, lng: 2.69914, icon: 'mansion',
    text: {
      fr: 'La place et son carrousel, que les enfants adorent. En face, l’hôtel de l’Aigle Noir : une demeure du XVIᵉ siècle, l’ancien hôtel de Retz, rebaptisée L’Aigle Noir sous l’Empire.',
      en: 'The square and its merry-go-round, which children love. Opposite, the Hôtel de l’Aigle Noir: a 16th-century mansion, formerly the Hôtel de Retz, renamed the Black Eagle under the Empire.',
    },
    sources: [WALK_SHEET],
    todo: 'Recouper hôtel de Retz et date du changement de nom.',
    q: {
      fr: 'Qu’est-ce qui tourne sur la place ?', en: 'What goes round and round on the square?',
      choices: { fr: ['Un carrousel', 'Une grande roue', 'Une fontaine'], en: ['A merry-go-round', 'A Ferris wheel', 'A fountain'] }, answer: 0,
    },
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'saint-louis', name: 'Église Saint-Louis', set: 'ville', type: 'Église', rarity: 'commun', zone: 'ville',
    lat: 48.40565, lng: 2.70145, icon: 'church',
    text: {
      fr: 'Au bout de la rue de la Paroisse, l’église Saint-Louis, joyau du XVIIᵉ siècle bâti sous Louis XIII.',
      en: 'At the end of rue de la Paroisse, the church of Saint-Louis, a 17th-century jewel built under Louis XIII.',
    },
    sources: [WALK_SHEET],
    todo: 'Recouper la date de construction (Mérimée ou paroisse) ; ajouter une question (façade, clocher).',
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'hotel-de-ville', name: 'Hôtel de ville', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', zone: 'ville',
    lat: 48.40474, lng: 2.70104, icon: 'townhall',
    text: {
      fr: 'Au 44 rue Grande, la mairie, reconstruite sous le Second Empire, en 1864.',
      en: 'At 44 rue Grande, the town hall, rebuilt under the Second Empire, in 1864.',
    },
    sources: [WALK_SHEET],
    todo: 'Recouper la date (ville de Fontainebleau) ; ajouter une question.',
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'ancienne-prison', name: 'Ancienne maison d’arrêt', set: 'ville', type: 'Monument historique', rarity: 'peu commun', zone: 'ville',
    lat: 48.40981, lng: 2.70368, icon: 'prison',
    text: {
      fr: 'Bâtie vers le milieu du XIXᵉ siècle, rue du Sergent-Perrier, l’ancienne maison d’arrêt a ensuite abrité le Musée national des prisons. Le bâtiment, ses cours de promenade et son mur d’enceinte sont protégés monument historique depuis 1996.',
      en: 'Built around the middle of the 19th century on rue du Sergent-Perrier, the former jail later housed the National Prison Museum. The building, its exercise yards and its outer wall have been a listed historic monument since 1996.',
    },
    sources: [
      { label: 'Base Mérimée, PA77000003', url: pop('merimee', 'PA77000003') },
      { label: 'Musée du Patrimoine', url: null },
    ],
    todo: 'Recouper les dates (construction, musée, protection).',
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'bel-ebat', name: 'Parc de Bel-Ébat (Avon)', set: 'ville', type: 'Parc', rarity: 'commun', zone: 'ville',
    lat: 48.41200, lng: 2.73277, icon: 'park',
    text: {
      fr: 'Selon la tradition, son nom viendrait des chiens de chasse d’Henri IV, qui venaient s’y ébattre près des sources. Ancien domaine privé autour d’un manoir, il a été donné à la ville d’Avon en 1979 par sa dernière propriétaire, Lola Dommange. Des ânes y paissent.',
      en: 'Tradition has it that the name comes from Henri IV’s hunting dogs, which came to frolic here by the springs. Once a private estate around a manor house, it was given to the town of Avon in 1979 by its last owner, Lola Dommange. Donkeys graze here.',
    },
    sources: [
      { label: 'Sortiraparis.com, « Parc de Bel Ébat »', url: null },
      { label: 'Journées du patrimoine, manoir de Bel Ébat', url: null },
    ],
    todo: 'Recouper avec la ville d’Avon (don de 1979, Lola Dommange).',
    q: {
      fr: 'Quels animaux paissent dans le parc ?', en: 'Which animals graze in the park?',
      choices: { fr: ['Des ânes', 'Des moutons', 'Des chèvres'], en: ['Donkeys', 'Sheep', 'Goats'] }, answer: 0,
    },
    check: { sources: false, site: false, lead: false },
  },

  // ── Denecourt and the blue trails ──────────────────────────────────────────────────────────
  {
    id: 'mont-ussy', name: 'Mont Ussy', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'peu commun', zone: 'foret',
    lat: 48.42699, lng: 2.69645, icon: 'tree',
    text: {
      fr: 'Le premier sentier bleu de Denecourt serpente ici entre les rochers, les grottes et les arbres remarquables. Denecourt y baptise encore des rochers en 1874, comme la Chaise à Marie. L’année suivante, le jour de sa mort, il faisait encore dégager la grotte des Montussiennes.',
      en: 'Denecourt’s first blue trail winds here between rocks, caves and remarkable trees. In 1874 Denecourt was still naming rocks here, such as the Chaise à Marie. The following year, on the day he died, he was still having the Montussiennes cave cleared.',
    },
    sources: [{ label: 'Association des Amis de la forêt de Fontainebleau, comptes rendus de promenade au mont Ussy (2022-2023)', url: null }],
    todo: 'Date de la mort de Denecourt (mars ou mai 1875) ; « le jour de sa mort » à confirmer.',
    q: {
      fr: 'De quelle couleur sont les marques peintes du sentier Denecourt ?', en: 'What colour are the painted marks of the Denecourt trail?',
      choices: { fr: ['Bleu', 'Rouge', 'Jaune'], en: ['Blue', 'Red', 'Yellow'] }, answer: 0,
    },
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'tour-denecourt', name: 'Tour Denecourt', set: 'denecourt', type: 'Belvédère', rarity: 'rare', zone: 'foret',
    lat: 48.43382, lng: 2.72621, icon: 'tower',
    text: {
      fr: 'Claude-François Denecourt, l’inventeur des sentiers bleus, fait bâtir cette tour sur le rocher Cassepot ; Napoléon III et l’impératrice Eugénie l’inaugurent en 1853 sous le nom de Fort l’Empereur. Montée sans mortier, elle s’écroule le 28 janvier 1878. Reconstruite grâce à une souscription de Charles Colinet, plus haute d’un mètre, elle prend en 1882 le nom de son créateur.',
      en: 'Claude-François Denecourt, the inventor of the blue trails, had this tower built on the Cassepot rock; Napoleon III and Empress Eugénie opened it in 1853 as the Fort l’Empereur. Built without mortar, it collapsed on 28 January 1878. Rebuilt thanks to a subscription raised by Charles Colinet, one metre taller, it took its creator’s name in 1882.',
    },
    sources: [
      { label: 'Office de tourisme du Pays de Fontainebleau, itinéraire de la tour Denecourt', url: null },
      { label: 'Fondation Napoléon, F. Houdecek, « Fontainebleau, une forêt très napoléonienne »', url: null },
    ],
    q: {
      fr: 'En haut de la tour, qu’est-ce qui aide à reconnaître le paysage ?', en: 'At the top of the tower, what helps you recognise the landscape?',
      choices: { fr: ['Une table d’orientation', 'Une longue-vue', 'Des photos anciennes'], en: ['A viewpoint indicator', 'A telescope', 'Old photographs'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'rocher-cassepot', name: 'Rocher Cassepot', set: 'denecourt', type: 'Point de vue', rarity: 'peu commun', zone: 'foret',
    lat: 48.43503, lng: 2.73366, icon: 'view',
    check: { sources: true, site: false, lead: false }, // a plain point (22/11)
  },
  {
    id: 'grotte-serment', name: 'Grotte du Serment', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'rare', zone: 'foret',
    lat: 48.40225, lng: 2.66493, icon: 'cave',
    text: {
      fr: 'Critiqué pour ses travaux dans la forêt, Denecourt promet en 1853 de ne plus creuser qu’une seule grotte : ce sera celle-ci, sa « dernière folie », sous un plafond fait d’un seul énorme rocher. Il grave ses initiales et la date dans la pierre. Il ne tient pas parole : la grotte qu’il creuse ensuite, tout près, s’appelle la grotte du Parjure.',
      en: 'Criticised for his works in the forest, Denecourt promised in 1853 to dig only one more cave: this one, his “last folly”, under a ceiling made of a single huge rock. He carved his initials and the date into the stone. He did not keep his word: the cave he dug next, close by, is called the Cave of Perjury.',
    },
    sources: [
      { label: 'Smithsonian Magazine', url: null },
      { label: 'Comptes rendus d’excursion', url: null },
    ],
    todo: 'Sources faibles : recouper (AAFF, Denecourt lui-même, Colinet) ; la date gravée se vérifie sur place.',
    q: {
      fr: 'Quelle année est gravée sur le rocher ?', en: 'Which year is carved on the rock?',
      choices: { fr: ['1853', '1789', '1907'], en: ['1853', '1789', '1907'] }, answer: 0,
    },
    check: { sources: false, site: false, lead: false },
  },

  // ── Great forest sites ─────────────────────────────────────────────────────────────────────
  {
    // 22/11: the Caverne d'Augas is gone (sanded in 1972, collapsed 1986); the cross replaces it.
    id: 'croix-d-augas', name: 'Croix d’Augas', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', zone: 'foret',
    lat: 48.42490, lng: 2.70897, icon: 'cross',
    text: {
      fr: 'Déjà sur le plan de la forêt de 1624, sous le nom de « Croix Dogast », la croix se dresse au point le plus haut de la forêt, à 146 mètres. Brisée à la Révolution, refaite en pierre en 1827, abattue par une tempête en 1899, elle a été remise à neuf en 2016. Tout près s’ouvrait la caverne d’Augas, la plus vaste grotte de la forêt selon Denecourt ; ensablée en 1972, elle s’effondre en 1986.',
      en: 'Already on the 1624 map of the forest, as the “Croix Dogast”, the cross stands at the forest’s highest point, 146 metres. Broken during the Revolution, remade in stone in 1827, felled by a storm in 1899, it was restored in 2016. Close by opened the Augas cavern, the largest cave in the forest according to Denecourt; filled with sand in 1972, it collapsed in 1986.',
    },
    sources: [
      { label: 'Fontainebleau-photo.fr, « La croix d’Augas » (2023), d’après Denecourt et Colinet', url: null },
      { label: 'AAFF, « L’effondrement de la caverne d’Augas »', url: null },
    ],
    todo: 'Source principale : un blog. Recouper (AAFF, ONF) ; « point le plus haut, 146 m » surtout.',
    q: {
      fr: 'Quelle haute tour de brique se dresse près de la croix ?', en: 'What tall brick tower stands near the cross?',
      choices: { fr: ['Une tour géodésique', 'Un château d’eau', 'Un clocher'], en: ['A survey tower', 'A water tower', 'A bell tower'] }, answer: 0,
    },
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'grand-veneur', name: 'Croix du Grand Veneur', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', zone: 'foret',
    lat: 48.43041, lng: 2.66126, icon: 'cross',
    text: {
      fr: 'La croix porte déjà son nom sur le plus ancien plan de la forêt, celui de Nicolas Picart (1624) : le grand veneur commandait les chasses du roi. Refaite en bois en 1827, puis en grès en 1846, elle est brisée par une charrette de paille en 1919 et renversée par une camionnette en 1926. Depuis 2000, elle se dresse au centre du rond-point.',
      en: 'The cross already bears its name on the oldest map of the forest, Nicolas Picart’s (1624): the Grand Huntsman commanded the king’s hunts. Remade in wood in 1827, then in sandstone in 1846, it was broken by a hay cart in 1919 and knocked over by a van in 1926. Since 2000 it has stood in the middle of the roundabout.',
    },
    sources: [{ label: 'Wikipédia, « Croix du Grand-Veneur » (d’après Tendron, 2018)', url: null }],
    todo: 'Wikipédia seule : remonter à Tendron (2018) ou à l’AAFF.',
    q: {
      fr: 'Où se dresse la croix aujourd’hui ?', en: 'Where does the cross stand today?',
      choices: { fr: ['Au milieu d’un rond-point', 'Au sommet d’un rocher', 'Devant une chapelle'], en: ['In the middle of a roundabout', 'On top of a rock', 'In front of a chapel'] }, answer: 0,
    },
    check: { sources: false, site: false, lead: false },
  },
  {
    id: 'franchard', name: 'Gorges de Franchard', set: 'foret', type: 'Gorges', rarity: 'rare', zone: 'foret',
    lat: 48.40812, lng: 2.62024, icon: 'mountain',
    text: {
      fr: 'Des ermites vivent ici dès le XIIᵉ siècle ; la fontaine des Ermites, nourrie par l’eau qui s’infiltre dans le plateau, garde leur souvenir. Louis XIV confie les ruines aux Mathurins de Fontainebleau, puis l’ermitage, devenu un repaire de brigands, est rasé au XVIIIᵉ siècle. Sous Louis-Philippe, on bâtit la maison forestière qui est toujours là.',
      en: 'Hermits lived here from the 12th century; the Hermits’ Fountain, fed by water seeping through the plateau, keeps their memory. Louis XIV entrusted the ruins to the Mathurin friars of Fontainebleau; later the hermitage, by then a robbers’ den, was razed in the 18th century. Under Louis-Philippe, the forester’s house that still stands was built.',
    },
    sources: [
      { label: 'Office de tourisme du Pays de Fontainebleau, sentier des gorges de Franchard', url: null },
      { label: 'AAFF, « Autour de Franchard »', url: null },
    ],
    q: {
      fr: 'Quel bâtiment se dresse aujourd’hui près de l’ancien ermitage ?', en: 'What building stands near the old hermitage today?',
      choices: { fr: ['Une maison forestière', 'Une église', 'Un moulin'], en: ['A forester’s house', 'A church', 'A mill'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'apremont', name: 'Gorges d’Apremont', set: 'foret', type: 'Gorges', rarity: 'rare', zone: 'foret',
    lat: 48.43601, lng: 2.62568, icon: 'mountain',
    text: {
      fr: 'Révoltés par les coupes de vieux chênes, Théodore Rousseau et les peintres de Barbizon obtiennent en 1853 que des parties de la forêt soient laissées à la nature, dont les gorges d’Apremont : la « réserve artistique ». Un décret de 1861 la porte à 1 097 hectares. Rousseau avait peint ici son « Groupe de chênes, Apremont », exposé au Salon de 1852.',
      en: 'Outraged by the felling of old oaks, Théodore Rousseau and the Barbizon painters won in 1853 that parts of the forest be left to nature, the Apremont gorge among them: the “artistic reserve”. An 1861 decree extended it to 1,097 hectares. Rousseau had painted his “Group of Oaks, Apremont” here, shown at the 1852 Salon.',
    },
    sources: [
      { label: 'Metropolitan Museum of Art, « The Barbizon School »', url: null },
      { label: 'Fondation Napoléon (notice du tableau)', url: null },
      { label: 'Hérodote.net', url: null },
    ],
    q: {
      fr: 'De quoi sont faits les gros blocs du chaos d’Apremont ?', en: 'What are the big boulders of the Apremont rock field made of?',
      choices: { fr: ['De grès', 'De granit', 'De calcaire'], en: ['Sandstone', 'Granite', 'Limestone'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'gorges-du-houx', name: 'Gorges du Houx, les abris de carriers', set: 'foret', type: 'Gorges', rarity: 'rare', zone: 'foret',
    lat: 48.40800, lng: 2.64271, icon: 'hut',
    text: {
      fr: 'Le long des gorges du Houx, les carriers ont laissé un vrai « village » d’abris : de petites cabanes en pierres sèches, souvent montées contre un rocher, où ils rangeaient leurs habits, leur repas et leurs outils. Il en reste des centaines dans la forêt.',
      en: 'Along the Houx gorge, the quarrymen left a real “village” of shelters: small dry-stone huts, often built against a rock, where they kept their clothes, their meals and their tools. Hundreds remain in the forest.',
    },
    sources: [{ label: 'Association des Amis de la forêt de Fontainebleau, « Les carriers »', url: null }],
    todo: 'Ajouter une question (forme d’un abri, matériau).',
    check: { sources: true, site: false, lead: false },
  },
  // 22/11, asked by the project lead: more forest points to collect, no text where we have no source.
  { id: 'croix-du-calvaire', name: 'Croix du Calvaire', set: 'foret', type: 'Point de vue', rarity: 'commun', zone: 'foret', lat: 48.41966, lng: 2.71470, icon: 'cross', check: { sources: true, site: false, lead: false } },
  { id: 'croix-de-toulouse', name: 'Croix de Toulouse', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', zone: 'foret', lat: 48.44395, lng: 2.71838, icon: 'cross', check: { sources: true, site: false, lead: false } },
  { id: 'antre-des-druides', name: 'Antre des Druides', set: 'foret', type: 'Grotte', rarity: 'peu commun', zone: 'foret', lat: 48.40660, lng: 2.62242, icon: 'cave', check: { sources: true, site: false, lead: false } },
  { id: 'caverne-des-brigands', name: 'Caverne des Brigands', set: 'foret', type: 'Grotte', rarity: 'peu commun', zone: 'foret', lat: 48.43817, lng: 2.63030, icon: 'cave', check: { sources: true, site: false, lead: false } },
  { id: 'mare-aux-evees', name: 'Mare aux Évées', set: 'foret', type: 'Mare', rarity: 'peu commun', zone: 'foret', lat: 48.47568, lng: 2.65855, icon: 'pond', check: { sources: true, site: false, lead: false } },
  { id: 'mare-aux-fees', name: 'Mare aux Fées', set: 'foret', type: 'Mare', rarity: 'rare', zone: 'foret', lat: 48.35824, lng: 2.71054, icon: 'pond', check: { sources: true, site: false, lead: false } },

  // ── The Barbizon painters ──────────────────────────────────────────────────────────────────
  {
    id: 'musee-barbizon', name: 'Musée de l’École de Barbizon', set: 'peintres', type: 'Maison de peintres', rarity: 'peu commun', zone: 'ville',
    lat: 48.44619, lng: 2.60261, icon: 'palette',
    text: {
      fr: 'Vers 1820, la famille Ganne tient une épicerie à Barbizon et loge les artistes venus peindre la forêt : l’auberge devient le rendez-vous des peintres de l’École de Barbizon. Ils y peignent les meubles et les murs de leurs chambres, et ces décors sont toujours là. La maison est aujourd’hui le musée départemental des peintres de Barbizon.',
      en: 'Around 1820, the Ganne family ran a grocery in Barbizon and put up the artists who came to paint the forest: the inn became the meeting place of the Barbizon School painters. They painted the furniture and the walls of their rooms, and those decorations are still there. The house is now the departmental museum of the Barbizon painters.',
    },
    sources: [
      { label: 'Office de tourisme du Pays de Fontainebleau, « Barbizon, village de peintres »', url: null },
      { label: 'Paris Region', url: null },
      { label: 'Muséofile, ministère de la Culture (M0370)', url: pop('museo', 'M0370') },
    ],
    q: {
      fr: 'Dans l’auberge, qu’ont peint les artistes, en plus de leurs tableaux ?', en: 'In the inn, what did the artists paint besides their canvases?',
      choices: { fr: ['Les meubles et les murs', 'Les vitraux', 'Les volets de la rue'], en: ['The furniture and the walls', 'The stained glass', 'The street shutters'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    // OSM « Monument Millet-Rousseau », at the end of the Grande Rue (walk sheet by car).
    id: 'medaillon-millet-rousseau', name: 'Médaillon de Millet et Rousseau', set: 'peintres', type: 'Monument', rarity: 'peu commun', zone: 'foret',
    lat: 48.44161, lng: 2.61211, icon: 'medallion',
    text: {
      fr: 'Au bout de la Grande Rue de Barbizon, un médaillon de bronze du sculpteur Henri Chapu est scellé dans un rocher. Il honore Jean-François Millet et Théodore Rousseau ; les peintres de Barbizon l’ont payé par souscription, et il est inauguré en avril 1884.',
      en: 'At the end of Barbizon’s Grande Rue, a bronze medallion by the sculptor Henri Chapu is set into a rock. It honours Jean-François Millet and Théodore Rousseau; the Barbizon painters paid for it by subscription, and it was unveiled in April 1884.',
    },
    sources: [
      { label: 'Wikimedia Commons, « Rousseau and Millet by Henri Chapu »', url: null },
      { label: 'Office de tourisme, sentier des peintres', url: null },
      { label: 'Fiche « Fontainebleau en voiture », Fontainebleau Live', url: 'https://fontainebleaulive.fr/balades/' },
    ],
    q: {
      fr: 'Quels peintres honore le médaillon ?', en: 'Which painters does the medallion honour?',
      choices: { fr: ['Millet et Rousseau', 'Corot et Daubigny', 'Monet et Renoir'], en: ['Millet and Rousseau', 'Corot and Daubigny', 'Monet and Renoir'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'bas-breau', name: 'Le Bas-Bréau', set: 'peintres', type: 'Futaie', rarity: 'peu commun', zone: 'foret',
    lat: 48.44099, lng: 2.62430, icon: 'tree',
    text: {
      fr: 'Un canton de la forêt célèbre pour ses chênes immenses, peints par Corot vers 1832-1833 et par bien d’autres. En 1853, le Bas-Bréau fait partie des 624 hectares de vieilles futaies et de rochers que l’on soustrait aux coupes, à la demande des peintres.',
      en: 'A part of the forest famous for its huge oaks, painted by Corot around 1832-1833 and by many others. In 1853, the Bas-Bréau was among the 624 hectares of old woodland and rocks spared from felling, at the painters’ request.',
    },
    sources: [
      { label: 'Metropolitan Museum of Art (Corot, « Le Bas-Bréau », étude)', url: null },
      { label: 'Wikipédia, « Forêt de Fontainebleau »', url: null },
    ],
    todo: 'Ajouter une question (ce qu’on voit : vieux chênes, panneau).',
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'chailly', name: 'Chailly-en-Bière, le village des peintres', set: 'peintres', type: 'Village', rarity: 'peu commun', zone: 'ville',
    lat: 48.47127, lng: 2.60807, icon: 'church',
    text: {
      fr: 'Jean-François Millet et Théodore Rousseau reposent au cimetière de Chailly-en-Bière, avec d’autres peintres de Barbizon. Au village, l’auberge du Cheval Blanc, où venaient les peintres, est protégée depuis 1984 : ses façades et la salle du restaurant avec son décor.',
      en: 'Jean-François Millet and Théodore Rousseau are buried in the Chailly-en-Bière cemetery, with other Barbizon painters. In the village, the Cheval Blanc inn, where the painters used to come, has been listed since 1984: its façades and the restaurant room with its decoration.',
    },
    sources: [
      { label: 'Office de tourisme du Pays de Fontainebleau, « Chailly-en-Bière, village de caractère »', url: null },
      { label: 'Base Mérimée, PA00086849', url: pop('merimee', 'PA00086849') },
    ],
    todo: 'Ajouter une question.',
    check: { sources: true, site: false, lead: false },
  },

  // ── 5 Must Climb, for families (validated by the project lead, 23/11: keep as is) ───────────
  // Plain points for M1: one visits, nothing is climbed for the game. Topo: Boolder.
  { id: 'bas-cuvier', name: 'Bas Cuvier', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', zone: 'foret', lat: 48.44617, lng: 2.63734, icon: 'climb', check: { sources: true, site: false, lead: true } },
  { id: 'rocher-canon', name: 'Rocher Canon', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', zone: 'foret', lat: 48.46308, lng: 2.66281, icon: 'climb', check: { sources: true, site: false, lead: true } },
  { id: 'canche-aux-merciers', name: 'Canche aux Merciers', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', zone: 'foret', lat: 48.39102, lng: 2.54895, icon: 'climb', check: { sources: true, site: false, lead: true } },
  { id: 'cul-de-chien', name: 'Cul de Chien', set: 'grimpe', type: 'Site de bloc et sable', rarity: 'rare', zone: 'foret', lat: 48.37685, lng: 2.52281, icon: 'climb', check: { sources: true, site: false, lead: true } },
  { id: 'elephant', name: 'L’Éléphant (Larchant)', set: 'grimpe', type: 'Rocher nommé', rarity: 'rare', zone: 'foret', lat: 48.29379, lng: 2.59458, icon: 'rock', check: { sources: true, site: false, lead: true } },
];

// The five threads of history (GDD §7.3, 22/11): places to collect with their question, no story.
const FILS = [
  {
    id: 'rois', icon: 'castle', color: '#0f8f9e',
    name: { fr: 'Les rois à Fontainebleau', en: 'The kings at Fontainebleau' },
    intro: {
      fr: 'Du donjon du XIIᵉ siècle à l’obélisque de Marie-Antoinette : François Ier et les rois après lui, au château, en ville et dans la forêt de leurs chasses.',
      en: 'From the 12th-century keep to Marie-Antoinette’s obelisk: François I and the kings after him, in the château, in town and in the forest where they hunted.',
    },
    steps: ['donjon', 'galerie-francois-1er', 'jardin-de-diane', 'saint-louis', 'cour-des-adieux', 'grand-veneur', 'obelisque'],
  },
  {
    id: 'napoleon', icon: 'fresco', color: '#4a5bb8',
    name: { fr: 'Les Napoléon', en: 'The Napoleons' },
    intro: {
      fr: 'Napoléon Ier, qui fait ses adieux à sa Vieille Garde en 1814, et Napoléon III, qui inaugure le Fort l’Empereur en 1853.',
      en: 'Napoleon I, who bade farewell to his Old Guard in 1814, and Napoleon III, who opened the Fort l’Empereur in 1853.',
    },
    steps: ['cour-des-adieux', 'fresque-napoleon', 'aigle-noir', 'tour-denecourt'],
  },
  {
    id: 'denecourt', icon: 'tree', color: '#27503a',
    name: { fr: 'Denecourt, le Sylvain', en: 'Denecourt, the Sylvan' },
    intro: {
      fr: 'L’homme qui a tracé les sentiers bleus, creusé des grottes et fait bâtir une tour, au XIXᵉ siècle.',
      en: 'The man who marked out the blue trails, dug caves and had a tower built, in the 19th century.',
    },
    steps: ['mont-ussy', 'grotte-serment', 'tour-denecourt', 'rocher-cassepot', 'croix-d-augas'],
  },
  {
    id: 'peintres', icon: 'palette', color: '#b8707d',
    name: { fr: 'Les peintres de Barbizon', en: 'The Barbizon painters' },
    // Corot 1827: Office de tourisme, « The Artists Trail » (to link in the sources pass).
    intro: {
      fr: 'Camille Corot découvre Barbizon en 1827 et ouvre la voie : Théodore Rousseau, Jean-François Millet et les autres viennent peindre la forêt, et obtiennent sa protection en 1853.',
      en: 'Camille Corot discovered Barbizon in 1827 and led the way: Théodore Rousseau, Jean-François Millet and others came to paint the forest, and won its protection in 1853.',
    },
    steps: ['musee-barbizon', 'medaillon-millet-rousseau', 'bas-breau', 'apremont', 'chailly'],
  },
  {
    id: 'carriers', icon: 'pick', color: '#6b6257',
    name: { fr: 'Le grès et les carriers', en: 'Sandstone and the quarrymen' },
    intro: {
      fr: 'Pendant des siècles et jusqu’en 1907, on a taillé le grès de la forêt : des pavés pour les routes et pour Paris, des pierres pour le château. Fronts de taille, routes pavées et abris de carriers sont encore là.',
      en: 'For centuries and until 1907, the forest’s sandstone was cut: paving stones for the roads and for Paris, blocks for the château. Quarry faces, paved roads and quarrymen’s shelters are still there.',
    },
    steps: ['mont-ussy', 'croix-d-augas', 'franchard', 'gorges-du-houx', 'apremont'],
  },
];

// Space Invader mosaics (GDD §7.1 bis). Only those still up; the project lead's street list of
// 23/11 is complete. Placed at the **street** (BAN), not the wall: one still looks for them.
// Names are ours (four from the walk sheet); no photo and no fan-site text: the works are Invader's.
const INVADERS = [
  { id: 'inv-lampe', code: 'FTBL_08', name: 'Lampe abat-jour', street: 'rue Dénecourt', lat: 48.404255, lng: 2.70013 },
  { id: 'inv-napoleon', code: 'FTBL_44', name: 'Napoléon et son bicorne', street: 'angle place du Marché et rue Grande', lat: 48.406339, lng: 2.701041 },
  { id: 'inv-alien-rouge', code: 'FTBL_43', name: 'Alien rouge et son livre', street: 'rue du Conventionnel-Geoffroy', lat: 48.405359, lng: 2.700052 },
  { id: 'inv-alien-bleu', code: 'FTBL_07', name: 'Alien bleu à lunettes', street: 'angle rue de la Corne et rue des Trois-Maillets', lat: 48.404694, lng: 2.699368 },
  { id: 'inv-chateau', code: 'FTBL_04', name: 'Château aux tours pointues', street: 'rue du Château', lat: 48.405527, lng: 2.70263 },
  { id: 'inv-alien-vert', code: 'FTBL_13', name: 'Alien vert aux yeux blancs', street: 'rue Saint-Merry', lat: 48.405281, lng: 2.694189 },
];

// Read-only self-check, run by the CLI and usable by generate-pages.js before publishing.
function problems() {
  const out = [];
  const ids = new Set();
  for (const s of SPOTS) {
    if (ids.has(s.id)) out.push(`${s.id} : id en double`);
    ids.add(s.id);
    if (!SETS[s.set]) out.push(`${s.id} : série inconnue « ${s.set} »`);
    if (!TYPES[s.type]) out.push(`${s.id} : type sans traduction « ${s.type} »`);
    if (s.zone !== 'ville' && s.zone !== 'foret') out.push(`${s.id} : zone « ${s.zone} »`);
    if (s.text && (!s.text.fr || !s.text.en)) out.push(`${s.id} : texte sans FR ou sans EN`);
    if (s.text && !(s.sources && s.sources.length)) out.push(`${s.id} : texte sans source`);
    if (s.q) {
      const c = s.q.choices || {};
      if (!s.q.fr || !s.q.en) out.push(`${s.id} : question sans FR ou sans EN`);
      if (!(c.fr && c.en && c.fr.length === 3 && c.en.length === 3)) out.push(`${s.id} : il faut trois choix FR et EN`);
      if (!(s.q.answer >= 0 && s.q.answer < 3)) out.push(`${s.id} : réponse hors des choix`);
      if (!s.text) out.push(`${s.id} : question sans texte`);
    }
  }
  for (const f of FILS) for (const id of f.steps) if (!ids.has(id)) out.push(`fil ${f.id} : lieu inconnu « ${id} »`);
  return out;
}

module.exports = { SETS, TYPES, SPOTS, FILS, INVADERS, problems };

if (require.main === module) {
  const errs = problems();
  const withText = SPOTS.filter((s) => s.text);
  const ready = SPOTS.filter((s) => s.check.sources && s.check.site && s.check.lead);
  console.log(`${SPOTS.length} lieux : ${withText.length} avec texte, ${SPOTS.filter((s) => s.q).length} avec question, ${SPOTS.length - withText.length} simples points ; ${INVADERS.length} Invaders ; ${FILS.length} fils.`);
  console.log(`Prêts à publier (sources, sur place, relu) : ${ready.length} / ${SPOTS.length}.`);
  if (errs.length) { console.log('\nErreurs :'); errs.forEach((e) => console.log('  ✗ ' + e)); }
  const todo = SPOTS.filter((s) => s.todo || !s.check.sources);
  console.log(`\nÀ faire (${todo.length}) :`);
  todo.forEach((s) => console.log(`  - ${s.id}${s.todo ? ' : ' + s.todo : ''}`));
  const noUrl = SPOTS.filter((s) => (s.sources || []).some((x) => !x.url)).length;
  console.log(`\nLieux dont une source n’a pas encore de lien : ${noUrl}.`);
  const noQ = withText.filter((s) => !s.q).map((s) => s.id);
  console.log(`Textes sans question (${noQ.length}) : ${noQ.join(', ')}.`);
  console.log(`Questions à vérifier sur place : ${SPOTS.filter((s) => s.q && !s.check.site).length}.`);
  console.log(`À relire par le chef de projet : ${SPOTS.filter((s) => !s.check.lead).length}.`);
  if (errs.length) process.exitCode = 1;
}
