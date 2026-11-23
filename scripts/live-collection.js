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
 *   23/11: the project lead launched /jeu/ before every check was done (« le jeu est bien, mets-le
 *   en ligne »); the profile says « bêta ». The checks still gate a place's text being called final.
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
  'Salle du château': 'Château room', 'Manège': 'Merry-go-round', 'Site de bloc': 'Bouldering site', 'Site de bloc et sable': 'Bouldering site and sand', 'Rocher nommé': 'Named rock',
};

// Base Mérimée / Muséofile notices on the culture ministry's POP platform (link by reference).
const pop = (base, ref) => `https://pop.culture.gouv.fr/notice/${base}/${ref}`;
const WALK_SHEET = { label: 'Fiche « Fontainebleau à pied », Fontainebleau Live', url: 'https://fontainebleaulive.fr/balades/' };

// The places of M1: 37 frozen on 23/11, then 40 (carousel, English garden, throne room, same day) (GDD §7.1). Positions: OpenStreetMap, the fresco and the
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
      fr: 'Au centre de l’ancien jardin de la Reine se dresse Diane chasseresse, en bronze. Autour du socle, quatre chiens et quatre têtes de cerf, œuvre du sculpteur Pierre Biard.',
      en: 'At the centre of the former Queen’s Garden stands Diana the Huntress, in bronze. Around the base, four hounds and four stag heads, the work of the sculptor Pierre Biard.',
    },
    // 23/11: the Keller cast of 1684 and Marly were not confirmed, dropped.
    sources: [{ label: 'Metropolitan Museum of Art, « Diana with a Hound » (Barthélemy Prieur, notice)', url: 'https://www.metmuseum.org/art/collection/search/191166' }],
    q: {
      fr: 'Combien de chiens entourent le socle de la fontaine ?', en: 'How many dogs surround the base of the fountain?',
      choices: { fr: ['Deux', 'Quatre', 'Six'], en: ['Two', 'Four', 'Six'] }, answer: 1,
    },
    check: { sources: true, site: false, lead: true },
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
      { label: 'Château de Fontainebleau, « Le palais médiéval »', url: 'https://www.chateaudefontainebleau.fr/en/?p=16251' },
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
    // 23/11: no source found for the mural (author, date): a plain point, rue de Ferrare.
    check: { sources: true, site: false, lead: false },
  },
  // 23/11, asked by the project lead: two more Napoleonic places (two were not enough for a set).
  {
    id: 'jardin-anglais', name: 'Jardin anglais', set: 'napoleon', type: 'Jardin', rarity: 'commun', zone: 'ville',
    lat: 48.39922, lng: 2.69615, icon: 'park',
    text: {
      fr: 'Sous Napoléon, l’architecte Hurtault dessine ce jardin à l’anglaise, en 1810-1812 : des arbres rares, des allées sinueuses, une rivière artificielle. Dans un recoin se cache la fontaine Belle-Eau, qui a donné son nom au château.',
      en: 'Under Napoleon, the architect Hurtault designed this English-style garden in 1810-1812: rare trees, winding paths, an artificial river. Tucked away in a corner is the Belle-Eau fountain, which gave the château its name.',
    },
    sources: [
      { label: 'Château de Fontainebleau, cartes interactives (« Jardin anglais »)', url: 'https://www.chateaudefontainebleau.fr/en/?p=16445' },
      { label: 'Wikipedia, « Maximilien Joseph Hurtault »', url: 'https://en.wikipedia.org/wiki/Maximilien_Joseph_Hurtault' },
    ],
    q: {
      fr: 'Qu’est-ce qui traverse le jardin ?', en: 'What runs through the garden?',
      choices: { fr: ['Une rivière', 'Une voie ferrée', 'Une route'], en: ['A river', 'A railway', 'A road'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    // Inside the château (paid visit), placed on the main wing, like the gallery.
    id: 'salle-du-trone', name: 'Salle du Trône', set: 'napoleon', type: 'Salle du château', rarity: 'rare', zone: 'ville',
    lat: 48.40250, lng: 2.70010, icon: 'throne',
    text: {
      fr: 'Napoléon n’aimait pas le décor de l’ancienne chambre du roi : en 1808, il en fait sa salle du Trône, l’une des rares de l’Empire. Le trône, fabriqué en 1804 pour Saint-Cloud, y est installé la même année.',
      en: 'Napoleon disliked the décor of the former king’s bedchamber: in 1808 he made it his throne room, one of the few of the Empire. The throne, made in 1804 for Saint-Cloud, was installed here that same year.',
    },
    // 23/11: « the only Napoleonic throne room preserved in the world » left out: sources disagree.
    sources: [
      { label: 'Château de Fontainebleau, « Napoleon I at Fontainebleau: 10 things you need to know »', url: 'https://www.chateaudefontainebleau.fr/en/?p=88436' },
      { label: 'Google Arts & Culture, « Napoleon’s throne chair » (château de Fontainebleau)', url: 'https://artsandculture.google.com/asset/napoleon-s-throne-chair/PAH2fxTN5-tLyw' },
    ],
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'grand-ferrare', name: 'Porte de l’hôtel du Grand Ferrare', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', zone: 'ville',
    lat: 48.40435, lng: 2.69802, icon: 'door',
    text: {
      fr: 'Ce portail est tout ce qui reste du Grand Ferrare, le palais que l’architecte italien Sebastiano Serlio bâtit pour le cardinal Hippolyte d’Este, dit le cardinal de Ferrare. Le palais devait rester modeste, pour ne pas rivaliser avec le château du roi, juste en face.',
      en: 'This gateway is all that remains of the Grand Ferrare, the palace the Italian architect Sebastiano Serlio built for Cardinal Ippolito d’Este, known as the Cardinal of Ferrara. The palace had to stay modest, so as not to rival the king’s château just opposite.',
    },
    sources: [
      { label: 'C. L. Frommel, essai sur Serlio, Digital Serlio, Columbia University', url: 'https://library.columbia.edu/libraries/avery/digitalserlio/essays/frommel.html' },
      { label: 'Base Mérimée, PA00086971 (caserne Boufflers et ancien hôtel de Ferrare)', url: pop('merimee', 'PA00086971') },
    ],
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'aigle-noir', name: 'Place Napoléon-Bonaparte et l’Aigle Noir', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', zone: 'ville',
    lat: 48.404064, lng: 2.698841, icon: 'mansion', // 23/11: at its address (BAN, 27 place Napoléon-Bonaparte); the square's centre is the carousel's
    text: {
      fr: 'La place et son carrousel. En face, l’hôtel de l’Aigle Noir, demeure des seigneurs de Retz de 1555 à 1677, rebaptisée L’Aigle Noir en 1810, sous l’Empire.',
      en: 'The square and its merry-go-round. Opposite, the Hôtel de l’Aigle Noir, home of the lords of Retz from 1555 to 1677, renamed the Black Eagle in 1810, under the Empire.',
    },
    sources: [
      WALK_SHEET,
      { label: 'Paris Zigzag, « Hôtel L’Aigle Noir, Fontainebleau »', url: 'https://www.pariszigzag.fr/sortir-paris/balade-paris/hotel-l-aigle-noir-fontainebleau/' },
    ],
    q: {
      fr: 'Qu’est-ce qui tourne sur la place ?', en: 'What goes round and round on the square?',
      choices: { fr: ['Un carrousel', 'Une grande roue', 'Une fontaine'], en: ['A merry-go-round', 'A Ferris wheel', 'A fountain'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  // 23/11, asked by the project lead: the carousel of the walk sheet, a place to find (a plain point).
  { id: 'carrousel', name: 'Le carrousel', set: 'ville', type: 'Manège', rarity: 'commun', zone: 'ville', lat: 48.40367, lng: 2.69914, icon: 'carousel', check: { sources: true, site: false, lead: false } },
  {
    id: 'saint-louis', name: 'Église Saint-Louis', set: 'ville', type: 'Église', rarity: 'commun', zone: 'ville',
    lat: 48.40565, lng: 2.70145, icon: 'church',
    text: {
      fr: 'L’église de la ville, bâtie au début du XVIIᵉ siècle sous Louis XIII, à deux pas du château. Avant elle, les habitants allaient à la messe à Avon.',
      en: 'The town’s church, built in the early 17th century under Louis XIII, a stone’s throw from the château. Before it, the townspeople went to mass in Avon.',
    },
    sources: [
      { label: 'Office de tourisme du Pays de Fontainebleau, « Église Saint-Louis »', url: 'https://www.fontainebleau-tourisme.com/en/fiche/4686996/saint-louis-church' },
      { label: 'Base Mérimée, PA00086976', url: pop('merimee', 'PA00086976') },
    ],
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'hotel-de-ville', name: 'Hôtel de ville', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', zone: 'ville',
    lat: 48.40474, lng: 2.70104, icon: 'townhall',
    text: {
      fr: 'Au 44 rue Grande, la mairie, reconstruite en 1864, sous Napoléon III.',
      en: 'At 44 rue Grande, the town hall, rebuilt in 1864, under Napoleon III.',
    },
    sources: [
      WALK_SHEET,
      { label: 'Office de tourisme du Pays de Fontainebleau, « Architectural Heritage: First and Second Empire »', url: 'https://www.fontainebleau-tourisme.com/en/discover-the-region/art-of-living/fontainebleau-between-chateau-and-forest/fontainebleau-ville-imperiale/architectural-heritage-first-and-second-empire/' },
    ],
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'ancienne-prison', name: 'Ancienne maison d’arrêt', set: 'ville', type: 'Monument historique', rarity: 'peu commun', zone: 'ville',
    lat: 48.40981, lng: 2.70368, icon: 'prison',
    text: {
      fr: 'Bâtie au milieu du XIXᵉ siècle, l’ancienne maison d’arrêt a ensuite abrité le Musée national des prisons. Avec ses cours de promenade et son mur d’enceinte, elle est monument historique depuis 1996.',
      en: 'Built in the mid-19th century, the former jail later housed the National Prison Museum. With its exercise yards and outer wall, it has been a listed monument since 1996.',
    },
    sources: [
      { label: 'Base Mérimée, PA77000003', url: pop('merimee', 'PA77000003') },
      { label: 'Monumentum, « Ancienne maison d’arrêt à Fontainebleau »', url: 'https://monumentum.fr/monument-historique/pa77000003/fontainebleau-ancienne-maison-darret' },
    ],
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'bel-ebat', name: 'Parc de Bel-Ébat (Avon)', set: 'ville', type: 'Parc', rarity: 'commun', zone: 'ville',
    lat: 48.41200, lng: 2.73277, icon: 'park',
    text: {
      fr: 'Son nom viendrait de la meute de chasse d’Henri IV. Ce domaine privé autour d’un manoir a été donné à la ville d’Avon en 1979 par sa dernière propriétaire, Lola Dommange. Des ânes y paissent.',
      en: 'Its name is said to come from Henri IV’s hunting pack. This private estate around a manor house was given to the town of Avon in 1979 by its last owner, Lola Dommange. Donkeys graze here.',
    },
    sources: [
      { label: 'Sortiraparis.com, « Bel Ebat Park »', url: 'https://www.sortiraparis.com/en/what-to-visit-in-paris/walks/articles/344941-bel-ebat-park-a-beautiful-green-space-with-grazing-donkeys-in-avon-77' },
      { label: 'Office de tourisme du Pays de Fontainebleau, brochure', url: 'https://www.fontainebleau-tourisme.com/wp-content/uploads/2022/06/Brochure-finale-Francaise.pdf' },
    ],
    q: {
      fr: 'Quels animaux paissent dans le parc ?', en: 'Which animals graze in the park?',
      choices: { fr: ['Des ânes', 'Des moutons', 'Des chèvres'], en: ['Donkeys', 'Sheep', 'Goats'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },

  // ── Denecourt and the blue trails ──────────────────────────────────────────────────────────
  {
    id: 'mont-ussy', name: 'Mont Ussy', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'peu commun', zone: 'foret',
    lat: 48.42699, lng: 2.69645, icon: 'tree',
    text: {
      fr: 'Le premier sentier bleu de Denecourt serpente ici entre rochers, grottes et arbres remarquables. Denecourt y baptisait encore des rochers en 1874, quelques mois avant sa mort, le 24 mars 1875.',
      en: 'Denecourt’s first blue trail winds here between rocks, caves and remarkable trees. Denecourt was still naming rocks here in 1874, a few months before his death on 24 March 1875.',
    },
    sources: [
      { label: 'Association des Amis de la forêt de Fontainebleau, comptes rendus de promenade au mont Ussy (2022-2023)', url: null },
      { label: 'AAFF, bulletin du centenaire de la mort de Denecourt (1976)', url: 'https://www.aaff.fr/wp-content/uploads/2023/12/vf1976.pdf' },
    ],
    q: {
      fr: 'De quelle couleur sont les marques peintes du sentier Denecourt ?', en: 'What colour are the painted marks of the Denecourt trail?',
      choices: { fr: ['Bleu', 'Rouge', 'Jaune'], en: ['Blue', 'Red', 'Yellow'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'tour-denecourt', name: 'Tour Denecourt', set: 'denecourt', type: 'Belvédère', rarity: 'rare', zone: 'foret',
    lat: 48.43382, lng: 2.72621, icon: 'tower',
    text: {
      fr: 'Denecourt, l’inventeur des sentiers bleus, fait bâtir cette tour, inaugurée en 1853 par Napoléon III sous le nom de Fort l’Empereur. Montée sans mortier, elle s’écroule en 1878 ; reconstruite, elle prend en 1882 le nom de son créateur.',
      en: 'Denecourt, the inventor of the blue trails, had this tower built; Napoleon III opened it in 1853 as the Fort l’Empereur. Built without mortar, it collapsed in 1878; rebuilt, it took its creator’s name in 1882.',
    },
    sources: [
      { label: 'Office de tourisme du Pays de Fontainebleau, sentier de la tour Denecourt à la croix du Calvaire', url: 'https://www.fontainebleau-tourisme.com/en/fiche/6367855/sentier-de-la-tour-denecourt-a-la-croix-du-calvaire/' },
      { label: 'Fondation Napoléon, F. Houdecek, « Fontainebleau, une forêt très napoléonienne »', url: 'https://www.napoleon.org/histoire-des-2-empires/articles/une-chronique-de-francois-houdecek-fontainebleau-une-foret-tres-napoleonienne/' },
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
      fr: 'Critiqué pour ses travaux, Denecourt promet en 1853 de ne plus creuser qu’une grotte : celle-ci, sous un plafond fait d’un seul énorme rocher. Il y grave « D.F.D. », Dernière Folie Denecourt. Il ne tient pas parole : plus loin, il creuse la grotte du Parjure.',
      en: 'Criticised for his works, Denecourt promised in 1853 to dig only one more cave: this one, under a ceiling made of a single huge rock. He carved “D.F.D.” into it: Dernière Folie Denecourt, Denecourt’s Last Folly. He did not keep his word: further on, he dug the Cave of Perjury.',
    },
    // 23/11: corrected, the letters are not his initials but « Dernière Folie Denecourt ».
    sources: [
      { label: 'Smithsonian Magazine, « The Evolution of Art Techniques »', url: 'https://www.smithsonianmag.com/arts-culture/the-evolution-of-art-techniques-180974592/' },
      { label: 'Visorando, « La grotte du Serment »', url: 'https://www.visorando.com/randonnee-grotte-du-serment.html' },
    ],
    q: {
      fr: 'Quelle année est gravée sur le rocher ?', en: 'Which year is carved on the rock?',
      choices: { fr: ['1853', '1789', '1907'], en: ['1853', '1789', '1907'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },

  // ── Great forest sites ─────────────────────────────────────────────────────────────────────
  {
    // 22/11: the Caverne d'Augas is gone (sanded in 1972, collapsed 1986); the cross replaces it.
    id: 'croix-d-augas', name: 'Croix d’Augas', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', zone: 'foret',
    lat: 48.42490, lng: 2.70897, icon: 'cross',
    text: {
      fr: 'Une croix de carrefour, déjà sur le plan de la forêt de 1624. Tout près s’ouvrait la caverne d’Augas, la plus vaste grotte de la forêt selon Denecourt ; ensablée en 1972, elle s’est effondrée en 1986.',
      en: 'A crossroads cross, already on the 1624 map of the forest. Close by opened the Augas cavern, the largest cave in the forest according to Denecourt; filled with sand in 1972, it collapsed in 1986.',
    },
    // 23/11: « highest point, 146 m » not confirmed at the cross (it is the survey chimney's), dropped.
    sources: [
      { label: 'Fontainebleau-photo.fr, « La croix d’Augas » (2023), d’après Denecourt et Colinet', url: null },
      { label: 'AAFF, « L’effondrement de la caverne d’Augas »', url: null },
      { label: 'AAFF, compte rendu de la promenade Augas, Béhourdière, Cassepot (23/09/2023)', url: 'https://www.aaff.fr/wp-content/uploads/2023/12/cr_2023_09_23_promenade-abc.pdf' },
    ],
    // 23/11, project lead: the brick survey tower is not really visible from the cross; new question.
    todo: 'Sur place : confirmer que la croix est en pierre.',
    q: {
      fr: 'De quoi est faite la croix ?', en: 'What is the cross made of?',
      choices: { fr: ['De pierre', 'De bois', 'De métal'], en: ['Stone', 'Wood', 'Metal'] }, answer: 0,
    },
    check: { sources: true, site: false, lead: false },
  },
  {
    id: 'grand-veneur', name: 'Croix du Grand Veneur', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', zone: 'foret',
    lat: 48.43041, lng: 2.66126, icon: 'cross',
    text: {
      fr: 'Le grand veneur commandait les chasses du roi. La croix porte déjà son nom sur le plan de la forêt de 1624 ; elle se dresse aujourd’hui au milieu d’un rond-point.',
      en: 'The Grand Huntsman commanded the king’s hunts. The cross already bears his name on the 1624 map of the forest; today it stands in the middle of a roundabout.',
    },
    // 23/11: repair dates (1827, 1846, 1919, 1926, 2000) only on Wikipedia, dropped.
    sources: [{ label: 'Wikipédia, « Croix du Grand-Veneur » (d’après Tendron, 2018)', url: null }],
    todo: 'Source unique (Wikipédia) : le lien, ou une seconde source pour le plan de 1624.',
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
      fr: 'Des ermites vivent ici dès le XIIᵉ siècle ; la fontaine des Ermites garde leur souvenir. L’ermitage, devenu un repaire de brigands, est rasé au XVIIIᵉ siècle ; la maison forestière date de Louis-Philippe.',
      en: 'Hermits lived here from the 12th century; the Hermits’ Fountain keeps their memory. The hermitage, by then a robbers’ den, was razed in the 18th century; the forester’s house dates from Louis-Philippe.',
    },
    sources: [
      { label: 'Office de tourisme du Pays de Fontainebleau, sentier des gorges de Franchard', url: null },
      { label: 'AAFF, « Autour de Franchard »', url: 'https://www.aaff.fr/wp-content/uploads/2023/12/autour-de-franchard-1.pdf' },
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
      fr: 'Révoltés par les coupes de vieux chênes, Théodore Rousseau et les peintres de Barbizon obtiennent en 1853 que des parties de la forêt soient laissées à la nature, dont les gorges d’Apremont : la « réserve artistique ».',
      en: 'Outraged by the felling of old oaks, Théodore Rousseau and the Barbizon painters won in 1853 that parts of the forest be left to nature, the Apremont gorge among them: the “artistic reserve”.',
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
    steps: ['cour-des-adieux', 'salle-du-trone', 'jardin-anglais', 'fresque-napoleon', 'aigle-noir', 'tour-denecourt'],
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

// The shop (GDD §12.2, opened on 23/11 by the project lead): services and cosmetics, never content;
// what is bought never gives XP, a place or an event. Stripe Payment Links of the « Fontainebleau
// Live » account, pasted here by hand; an empty link shows « Bientôt » and sells nothing.
// Each link's « After payment » redirect must be:
//   https://fontainebleaulive.fr/jeu/?merci=<key>&session_id={CHECKOUT_SESSION_ID}
// Without a server an unlock is not a lock (GDD §12.2): accepted for a low, honest price.
const SHOP = {
  pack: { url: '', price: { fr: '2,99 €', en: '€2.99' } }, // fixed price: terms of sale and withdrawal waiver (/conditions-de-vente/)
  mecene: { url: '', suggested: 4, min: 2 },               // pay what you want, like the guides: a support, no terms of sale
  email: 'heliosoconsulting@gmail.com',
  // Group session (shown with its prices, 23/11): booked by e-mail until the server exists.
  groupPrices: [
    { players: 10, price: 29 },
    { players: 30, price: 59 },
  ],
  // Three ready quests; their steps are never shown (they are what a group buys).
  groups: [
    { id: 'ville', icon: 'castle', color: '#9247a0', dur: '2 h 30',
      name: { fr: 'Le centre-ville, à pied', en: 'The town centre, on foot' },
      pts: { fr: ['7 étapes de la fiche « Fontainebleau à pied »', '6 mosaïques d’Invader en bonus'], en: ['7 stops of the “Fontainebleau on foot” guide', '6 Invader mosaics as a bonus'] },
      steps: ['cour-des-adieux', 'aigle-noir', 'theatre', 'fresque-napoleon', 'grand-ferrare', 'saint-louis', 'hotel-de-ville'] },
    { id: 'foret', icon: 'tower', color: '#27503a', dur: '3 h',
      name: { fr: 'La forêt, hauteurs de la Solle', en: 'The forest, the Solle heights' },
      pts: { fr: ['5 étapes sur les sentiers bleus de Denecourt', 'Au nord de la ville'], en: ['5 stops on Denecourt’s blue trails', 'North of the town'] },
      steps: ['mont-ussy', 'croix-d-augas', 'croix-du-calvaire', 'tour-denecourt', 'rocher-cassepot'] },
    { id: 'barbizon', icon: 'palette', color: '#b8707d', dur: '2 h 30',
      name: { fr: 'Barbizon et ses peintres', en: 'Barbizon and its painters' },
      pts: { fr: ['5 étapes, du musée aux gorges d’Apremont', 'Sur les pas des peintres'], en: ['5 stops, from the museum to the Apremont gorge', 'In the painters’ footsteps'] },
      steps: ['musee-barbizon', 'medaillon-millet-rousseau', 'bas-breau', 'caverne-des-brigands', 'apremont'] },
  ],
};

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
  for (const g of SHOP.groups) for (const id of g.steps) if (!ids.has(id)) out.push(`quête de groupe ${g.id} : lieu inconnu « ${id} »`);
  for (const k of ['pack', 'mecene']) if (SHOP[k].url && !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/.test(SHOP[k].url)) out.push(`boutique : lien Stripe « ${k} » mal formé`);
  return out;
}

module.exports = { SETS, TYPES, SPOTS, FILS, INVADERS, SHOP, problems };

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
