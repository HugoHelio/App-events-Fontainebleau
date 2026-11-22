#!/usr/bin/env node
/**
 * Fontainebleau Live Collection (ex-Bleau Quest) — clickable mock-up (item 116a, GDD: Bleau-Quest-GDD.md).
 *
 *   node scripts/bleau-quest-mock.js            writes reports/bleau-quest/maquette.html, serves it on
 *                                               http://localhost:8517/ and opens it (Ctrl+C to stop)
 *   node scripts/bleau-quest-mock.js --no-open  same, without opening the browser
 *   node scripts/bleau-quest-mock.js --file     writes the page only (the map stays grey: see below)
 *
 * Why a local server: OpenStreetMap refuses tile requests without a Referer, and a page opened from
 * file:// sends none (« Access blocked », 21/11). Served from localhost, the browser sends one.
 * The server only serves this page and vendor/, on 127.0.0.1.
 *
 * A mock-up, not the game: one local page (never committed, reports/ is ignored), French only,
 * the site's colours, no art direction yet (GDD §10). What is real:
 *   - the places' positions (OpenStreetMap, looked up on 20-21/11; the theatre from venues.json);
 *   - the events layer: events from data.json confirmed by a source we read (never Gemini alone,
 *     the carousel's rule), placed where data.json places them.
 * What is NOT real: the cards' texts, the questions, the XP scale, the shop. The five climbing
 * sites are a proposal to check with climbers (116k). Nothing here may be published as is.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const G = require('./generate-pages');
const { ICONS, PROPOSALS } = require('./bleau-quest-icons');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reports', 'bleau-quest');
const PORT = Number(process.env.PORT) || 8517;
const CONFIRMED = new Set(['site', 'datatourisme', 'openagenda', 'francebillet']);
const CENTRE = { lat: 48.4045, lng: 2.7016 };
const EVENT_KM = 12;     // around the player (21/11: it follows them); beyond, the map is too full to read
const ZONE_KM = 35;      // what the page embeds: the agenda's whole zone (20 km) plus a margin
const EVENT_DAYS = 7;
const SEASON_KM = 15;
const SEASON_DAYS = 40;
const SEASON_RE = /no[eë]l|avent|saint[- ]nicolas|illumination/i;

// Positions: OpenStreetMap (Nominatim, 20-21/11/2026), theatre from venues.json. Texts: placeholders.
const SPOTS = [
  { id: 'cour-des-adieux', name: 'Cour des Adieux', set: 'napoleon', type: 'Monument', rarity: 'commun', lat: 48.40204, lng: 2.69810, icon: 'castle' },
  { id: 'jardin-de-diane', name: 'Jardin de Diane', set: 'chateau', type: 'Jardin', rarity: 'commun', lat: 48.40295, lng: 2.69973, icon: 'stag' },
  { id: 'theatre', name: 'Théâtre municipal', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', lat: 48.40335, lng: 2.69762, icon: 'mask' },
  { id: 'obelisque', name: 'Obélisque de Marie-Antoinette', set: 'chateau', type: 'Monument', rarity: 'commun', lat: 48.39705, lng: 2.69227, icon: 'obelisk' },
  { id: 'mont-ussy', name: 'Mont Ussy', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'peu commun', lat: 48.42699, lng: 2.69645, icon: 'tree' },
  { id: 'tour-denecourt', name: 'Tour Denecourt', set: 'denecourt', type: 'Belvédère', rarity: 'rare', lat: 48.43382, lng: 2.72621, icon: 'tower' },
  { id: 'rocher-cassepot', name: 'Rocher Cassepot', set: 'denecourt', type: 'Point de vue', rarity: 'peu commun', lat: 48.43503, lng: 2.73366, icon: 'view' },
  // 22/11: the Caverne d'Augas is gone (sanded in 1972, collapsed 1986); the cross next to it replaces it.
  { id: 'croix-d-augas', name: 'Croix d’Augas', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', lat: 48.42490, lng: 2.70897, icon: 'cross' },
  { id: 'grotte-serment', name: 'Grotte du Serment', set: 'denecourt', type: 'Site des sentiers bleus', rarity: 'rare', lat: 48.40225, lng: 2.66493, icon: 'cave' },
  { id: 'grand-veneur', name: 'Croix du Grand Veneur', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', lat: 48.43041, lng: 2.66126, icon: 'cross' },
  { id: 'franchard', name: 'Gorges de Franchard', set: 'foret', type: 'Gorges', rarity: 'rare', lat: 48.40812, lng: 2.62024, icon: 'mountain' },
  { id: 'apremont', name: 'Gorges d’Apremont', set: 'foret', type: 'Gorges', rarity: 'rare', lat: 48.43601, lng: 2.62568, icon: 'mountain' },
  // 22/11, asked by the project lead: more forest points, to collect (no text where we have no source).
  { id: 'croix-du-calvaire', name: 'Croix du Calvaire', set: 'foret', type: 'Point de vue', rarity: 'commun', lat: 48.41966, lng: 2.71470, icon: 'cross' },
  { id: 'croix-de-toulouse', name: 'Croix de Toulouse', set: 'foret', type: 'Carrefour historique', rarity: 'peu commun', lat: 48.44395, lng: 2.71838, icon: 'cross' },
  { id: 'antre-des-druides', name: 'Antre des Druides', set: 'foret', type: 'Grotte', rarity: 'peu commun', lat: 48.40660, lng: 2.62242, icon: 'cave' },
  { id: 'caverne-des-brigands', name: 'Caverne des Brigands', set: 'foret', type: 'Grotte', rarity: 'peu commun', lat: 48.43817, lng: 2.63030, icon: 'cave' },
  { id: 'mare-aux-evees', name: 'Mare aux Évées', set: 'foret', type: 'Mare', rarity: 'peu commun', lat: 48.47568, lng: 2.65855, icon: 'pond' },
  { id: 'mare-aux-fees', name: 'Mare aux Fées', set: 'foret', type: 'Mare', rarity: 'rare', lat: 48.35824, lng: 2.71054, icon: 'pond' },
  // 22/11: the town stops of the walk sheet « Fontainebleau à pied » (scripts/balades.js), the old
  // prison, and Avon's park. Positions: OSM; the fresco and the prison at the street (BAN).
  { id: 'fresque-napoleon', name: 'Fresque de Napoléon', set: 'napoleon', type: 'Peinture murale', rarity: 'commun', lat: 48.40340, lng: 2.69724, icon: 'fresco' },
  { id: 'grand-ferrare', name: 'Porte de l’hôtel du Grand Ferrare', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', lat: 48.40435, lng: 2.69802, icon: 'door' },
  { id: 'aigle-noir', name: 'Place Napoléon-Bonaparte et l’Aigle Noir', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', lat: 48.40367, lng: 2.69914, icon: 'mansion' },
  { id: 'saint-louis', name: 'Église Saint-Louis', set: 'ville', type: 'Église', rarity: 'commun', lat: 48.40565, lng: 2.70145, icon: 'church' },
  { id: 'hotel-de-ville', name: 'Hôtel de ville', set: 'ville', type: 'Patrimoine urbain', rarity: 'commun', lat: 48.40474, lng: 2.70104, icon: 'townhall' },
  { id: 'ancienne-prison', name: 'Ancienne maison d’arrêt', set: 'ville', type: 'Monument historique', rarity: 'peu commun', lat: 48.40981, lng: 2.70368, icon: 'prison' },
  { id: 'bel-ebat', name: 'Parc de Bel-Ébat (Avon)', set: 'ville', type: 'Parc', rarity: 'commun', lat: 48.41200, lng: 2.73277, icon: 'park' },
  // 22/11, the threads of history (project lead): the château's oldest and François Ier's parts,
  // the painters' places, the quarrymen. Gallery: inside the château (paid visit), placed on the
  // wing; medallion: OSM « Monument Millet-Rousseau », at the end of the Grande Rue (walk sheet by car).
  { id: 'donjon', name: 'Le donjon (cour Ovale)', set: 'chateau', type: 'Monument', rarity: 'peu commun', lat: 48.40222, lng: 2.70104, icon: 'keep' },
  { id: 'galerie-francois-1er', name: 'Galerie François Ier', set: 'chateau', type: 'Monument', rarity: 'rare', lat: 48.40255, lng: 2.69905, icon: 'gallery' },
  { id: 'medaillon-millet-rousseau', name: 'Médaillon de Millet et Rousseau', set: 'peintres', type: 'Monument', rarity: 'peu commun', lat: 48.44161, lng: 2.61211, icon: 'medallion' },
  { id: 'bas-breau', name: 'Le Bas-Bréau', set: 'peintres', type: 'Futaie', rarity: 'peu commun', lat: 48.44099, lng: 2.62430, icon: 'tree' },
  { id: 'chailly', name: 'Chailly-en-Bière, le village des peintres', set: 'peintres', type: 'Village', rarity: 'peu commun', lat: 48.47127, lng: 2.60807, icon: 'church' },
  { id: 'gorges-du-houx', name: 'Gorges du Houx, les abris de carriers', set: 'foret', type: 'Gorges', rarity: 'rare', lat: 48.40800, lng: 2.64271, icon: 'hut' },
  { id: 'musee-barbizon', name: 'Musée de l’École de Barbizon', set: 'peintres', type: 'Maison de peintres', rarity: 'peu commun', lat: 48.44619, lng: 2.60261, icon: 'palette' },
  // « 5 Must Climb » in its family version (21/11): five places to visit and try, not five hard
  // problems. A proposal, to be checked with climbers (116k).
  { id: 'bas-cuvier', name: 'Bas Cuvier', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.44617, lng: 2.63734, icon: 'climb' },
  { id: 'rocher-canon', name: 'Rocher Canon', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.46308, lng: 2.66281, icon: 'climb' },
  { id: 'canche-aux-merciers', name: 'Canche aux Merciers', set: 'grimpe', type: 'Site de bloc', rarity: 'peu commun', lat: 48.39102, lng: 2.54895, icon: 'climb' },
  { id: 'cul-de-chien', name: 'Cul de Chien', set: 'grimpe', type: 'Site de bloc et sable', rarity: 'rare', lat: 48.37685, lng: 2.52281, icon: 'climb' },
  { id: 'elephant', name: 'L’Éléphant (Larchant)', set: 'grimpe', type: 'Rocher nommé', rarity: 'rare', lat: 48.29379, lng: 2.59458, icon: 'rock' },
];

// Card texts and observation questions: DRAFTS of 21/11 (asked: "il faut qu'on arrive à écrire
// le texte. Des questions."), monuments first. Each fact comes from the source shown; each
// question asks for something one sees on the spot. To be reviewed by the project lead and the
// question checked on site before anything is published (116d). Three choices, as in foret.js.
const CARDS = {
  'cour-des-adieux': {
    text: 'Le 20 avril 1814, avant de partir pour l’île d’Elbe, Napoléon descend l’escalier de cette cour et fait ses adieux à sa Vieille Garde. La cour du Cheval Blanc devient alors la cour des Adieux. L’escalier lui-même est plus ancien : il date de Louis XIII (1632-1634).',
    source: 'Fondation Napoléon, « Les adieux de Fontainebleau à la Vieille Garde » (napoleon.org) ; château de Fontainebleau',
    q: 'Regardez le grand escalier de la façade : quelle forme a-t-il ?', choices: ['En fer à cheval', 'En colimaçon', 'Tout droit'], answer: 0,
  },
  'jardin-de-diane': {
    text: 'Au centre de l’ancien jardin de la Reine, Diane chasseresse. Ce bronze est une fonte des frères Keller (1684), copie d’une statue antique aujourd’hui au Louvre ; il vient du château de Marly. Les chiens et les têtes de cerf du socle sont de Pierre Biard, au début du XVIIᵉ siècle.',
    source: 'Metropolitan Museum of Art (Diane de Barthélemy Prieur, notice) ; musée du Louvre',
    q: 'Combien de chiens entourent le socle de la fontaine ?', choices: ['Deux', 'Quatre', 'Six'], answer: 1,
  },
  'obelisque': {
    text: 'Haut de 21 mètres, l’obélisque est élevé en 1785-1786 en l’honneur de Marie-Antoinette et de ses enfants, au carrefour où se croisent les grandes routes de la forêt. Des bornes y indiquent les directions ; leurs fleurs de lys sont ôtées en 1793.',
    source: 'Base Mérimée, ministère de la Culture (PA00086970, quatre bornes indicatrices) ; Musée du Patrimoine',
    q: 'Autour de l’obélisque, combien de bornes indiquent les routes ?', choices: ['Deux', 'Quatre', 'Huit'], answer: 1,
  },
  'theatre': {
    text: 'Un concours d’architecture en 1905, un chantier de 1910 à 1912, une inauguration le 9 mars 1912 : le théâtre de Fernand Lucas et Paul Marion est l’un des rares théâtres à l’italienne d’Île-de-France hors de Paris. Il est protégé au titre des monuments historiques.',
    source: 'Inventaire général du patrimoine culturel, Région Île-de-France ; base Mérimée (PA00087345)',
    q: 'De quoi est faite la façade du théâtre ?', choices: ['De brique et de pierre', 'De béton', 'De bois'], answer: 0,
  },
  // Second batch (22/11): the forest, Barbizon. Weaker sources than the monuments (tourism office,
  // AAFF, Wikipedia); each is flagged in the GDD §9 table, to be cross-checked before 116d.
  'tour-denecourt': {
    text: 'Claude-François Denecourt, l’inventeur des sentiers bleus, fait bâtir cette tour sur le rocher Cassepot ; Napoléon III et l’impératrice Eugénie l’inaugurent en 1853 sous le nom de Fort l’Empereur. Montée sans mortier, elle s’écroule le 28 janvier 1878. Reconstruite grâce à une souscription de Charles Colinet, plus haute d’un mètre, elle prend en 1882 le nom de son créateur.',
    source: 'Office de tourisme du Pays de Fontainebleau (itinéraire de la tour Denecourt) ; Fondation Napoléon, F. Houdecek, « Fontainebleau, une forêt très napoléonienne »',
    q: 'En haut de la tour, qu’est-ce qui aide à reconnaître le paysage ?', choices: ['Une table d’orientation', 'Une longue-vue', 'Des photos anciennes'], answer: 0,
  },
  'grotte-serment': {
    text: 'Critiqué pour ses travaux dans la forêt, Denecourt promet en 1853 de ne plus creuser qu’une seule grotte : ce sera celle-ci, sa « dernière folie », sous un plafond fait d’un seul énorme rocher. Il grave ses initiales et la date dans la pierre. Il ne tient pas parole : la grotte qu’il creuse ensuite, tout près, s’appelle la grotte du Parjure.',
    source: 'Smithsonian Magazine ; comptes rendus d’excursion',
    q: 'Quelle année est gravée sur le rocher ?', choices: ['1853', '1789', '1907'], answer: 0,
  },
  'mont-ussy': {
    text: 'Le premier sentier bleu de Denecourt serpente ici entre les rochers, les grottes et les arbres remarquables. Denecourt y baptise encore des rochers en 1874, comme la Chaise à Marie. L’année suivante, le jour de sa mort, il faisait encore dégager la grotte des Montussiennes.',
    source: 'Association des Amis de la forêt de Fontainebleau (comptes rendus de promenade au mont Ussy, 2022-2023)',
    q: 'De quelle couleur sont les marques peintes du sentier Denecourt ?', choices: ['Bleu', 'Rouge', 'Jaune'], answer: 0,
  },
  'donjon': {
    text: 'Au cœur de la cour Ovale se dresse la grosse tour carrée du donjon, la partie la plus ancienne du château : une charte de Louis VII l’atteste dès 1137. En 1528, François Ier fait abattre presque tout le château médiéval et reconstruire sur ses fondations, mais il garde le donjon.',
    source: 'Château de Fontainebleau, « Le palais médiéval » (chateaudefontainebleau.fr) ; Encyclopædia Universalis',
    q: 'Quelle forme a la vieille tour du donjon ?', choices: ['Carrée', 'Ronde', 'Octogonale'], answer: 0,
  },
  'galerie-francois-1er': {
    text: 'Commencée vers 1528 pour relier les appartements de François Ier à la chapelle, la galerie mesure environ 61 mètres sur 6. Le peintre florentin Rosso Fiorentino et son atelier la décorent de 1533 à 1539 : fresques et stucs mêlés, une première en France.',
    source: 'Vassar College, catalogue Rosso Fiorentino (E. Carroll), « The Gallery of Francis I » ; château de Fontainebleau',
  },
  'medaillon-millet-rousseau': {
    text: 'Au bout de la Grande Rue de Barbizon, un médaillon de bronze du sculpteur Henri Chapu est scellé dans un rocher. Il honore Jean-François Millet et Théodore Rousseau ; les peintres de Barbizon l’ont payé par souscription, et il est inauguré en avril 1884.',
    source: 'Wikimedia Commons, « Rousseau and Millet by Henri Chapu » ; Office de tourisme (sentier des peintres) ; fiche « Fontainebleau en voiture », Fontainebleau Live',
    q: 'Quels peintres honore le médaillon ?', choices: ['Millet et Rousseau', 'Corot et Daubigny', 'Monet et Renoir'], answer: 0,
  },
  'bas-breau': {
    text: 'Un canton de la forêt célèbre pour ses chênes immenses, peints par Corot vers 1832-1833 et par bien d’autres. En 1853, le Bas-Bréau fait partie des 624 hectares de vieilles futaies et de rochers que l’on soustrait aux coupes, à la demande des peintres.',
    source: 'Metropolitan Museum of Art (Corot, « Le Bas-Bréau », étude) ; Wikipédia, « Forêt de Fontainebleau »',
  },
  'chailly': {
    text: 'Jean-François Millet et Théodore Rousseau reposent au cimetière de Chailly-en-Bière, avec d’autres peintres de Barbizon. Au village, l’auberge du Cheval Blanc, où venaient les peintres, est protégée depuis 1984 : ses façades et la salle du restaurant avec son décor.',
    source: 'Office de tourisme du Pays de Fontainebleau (« Chailly-en-Bière, village de caractère ») ; base Mérimée (PA00086849)',
  },
  'gorges-du-houx': {
    text: 'Le long des gorges du Houx, les carriers ont laissé un vrai « village » d’abris : de petites cabanes en pierres sèches, souvent montées contre un rocher, où ils rangeaient leurs habits, leur repas et leurs outils. Il en reste des centaines dans la forêt.',
    source: 'Association des Amis de la forêt de Fontainebleau, « Les carriers »',
  },
  'croix-d-augas': {
    text: 'Déjà sur le plan de la forêt de 1624, sous le nom de « Croix Dogast », la croix se dresse au point le plus haut de la forêt, à 146 mètres. Brisée à la Révolution, refaite en pierre en 1827, abattue par une tempête en 1899, elle a été remise à neuf en 2016. Tout près s’ouvrait la caverne d’Augas, la plus vaste grotte de la forêt selon Denecourt ; ensablée en 1972, elle s’effondre en 1986.',
    source: 'Fontainebleau-photo.fr, « La croix d’Augas » (2023), d’après Denecourt et Colinet ; AAFF, « L’effondrement de la caverne d’Augas »',
    q: 'Quelle haute tour de brique se dresse près de la croix ?', choices: ['Une tour géodésique', 'Un château d’eau', 'Un clocher'], answer: 0,
  },
  // Town stops: the project lead's own walk sheet (« Fontainebleau à pied », scripts/balades.js),
  // their survey; no question where the sheet gives nothing to look for.
  'fresque-napoleon': {
    text: 'Rue de Ferrare, en venant du parking du château, une grande fresque représente Napoléon.',
    source: 'Fiche « Fontainebleau à pied », Fontainebleau Live',
  },
  'grand-ferrare': {
    text: 'Juste après la fresque, rue de Ferrare, la porte de l’hôtel du Grand Ferrare.',
    source: 'Fiche « Fontainebleau à pied », Fontainebleau Live',
  },
  'aigle-noir': {
    text: 'La place et son carrousel, que les enfants adorent. En face, l’hôtel de l’Aigle Noir : une demeure du XVIᵉ siècle, l’ancien hôtel de Retz, rebaptisée L’Aigle Noir sous l’Empire.',
    source: 'Fiche « Fontainebleau à pied », Fontainebleau Live',
    q: 'Qu’est-ce qui tourne sur la place ?', choices: ['Un carrousel', 'Une grande roue', 'Une fontaine'], answer: 0,
  },
  'saint-louis': {
    text: 'Au bout de la rue de la Paroisse, l’église Saint-Louis, joyau du XVIIᵉ siècle bâti sous Louis XIII.',
    source: 'Fiche « Fontainebleau à pied », Fontainebleau Live',
  },
  'hotel-de-ville': {
    text: 'Au 44 rue Grande, la mairie, reconstruite sous le Second Empire, en 1864.',
    source: 'Fiche « Fontainebleau à pied », Fontainebleau Live',
  },
  'ancienne-prison': {
    text: 'Bâtie vers le milieu du XIXᵉ siècle, rue du Sergent-Perrier, l’ancienne maison d’arrêt a ensuite abrité le Musée national des prisons. Le bâtiment, ses cours de promenade et son mur d’enceinte sont protégés monument historique depuis 1996.',
    source: 'Base Mérimée, ministère de la Culture (PA77000003) ; Musée du Patrimoine',
  },
  'bel-ebat': {
    text: 'Selon la tradition, son nom viendrait des chiens de chasse d’Henri IV, qui venaient s’y ébattre près des sources. Ancien domaine privé autour d’un manoir, il a été donné à la ville d’Avon en 1979 par sa dernière propriétaire, Lola Dommange. Des ânes y paissent.',
    source: 'Sortiraparis.com (« Parc de Bel Ébat ») ; Journées du patrimoine, manoir de Bel Ébat',
    q: 'Quels animaux paissent dans le parc ?', choices: ['Des ânes', 'Des moutons', 'Des chèvres'], answer: 0,
  },
  'grand-veneur': {
    text: 'La croix porte déjà son nom sur le plus ancien plan de la forêt, celui de Nicolas Picart (1624) : le grand veneur commandait les chasses du roi. Refaite en bois en 1827, puis en grès en 1846, elle est brisée par une charrette de paille en 1919 et renversée par une camionnette en 1926. Depuis 2000, elle se dresse au centre du rond-point.',
    source: 'Wikipédia, « Croix du Grand-Veneur » (d’après Tendron, 2018)',
    q: 'Où se dresse la croix aujourd’hui ?', choices: ['Au milieu d’un rond-point', 'Au sommet d’un rocher', 'Devant une chapelle'], answer: 0,
  },
  'franchard': {
    text: 'Des ermites vivent ici dès le XIIᵉ siècle ; la fontaine des Ermites, nourrie par l’eau qui s’infiltre dans le plateau, garde leur souvenir. Louis XIV confie les ruines aux Mathurins de Fontainebleau, puis l’ermitage, devenu un repaire de brigands, est rasé au XVIIIᵉ siècle. Sous Louis-Philippe, on bâtit la maison forestière qui est toujours là.',
    source: 'Office de tourisme du Pays de Fontainebleau (sentier des gorges de Franchard) ; AAFF, « Autour de Franchard »',
    q: 'Quel bâtiment se dresse aujourd’hui près de l’ancien ermitage ?', choices: ['Une maison forestière', 'Une église', 'Un moulin'], answer: 0,
  },
  'apremont': {
    text: 'Révoltés par les coupes de vieux chênes, Théodore Rousseau et les peintres de Barbizon obtiennent en 1853 que des parties de la forêt soient laissées à la nature, dont les gorges d’Apremont : la « réserve artistique ». Un décret de 1861 la porte à 1 097 hectares. Rousseau avait peint ici son « Groupe de chênes, Apremont », exposé au Salon de 1852.',
    source: 'Metropolitan Museum of Art, « The Barbizon School » ; Fondation Napoléon (notice du tableau) ; Hérodote.net',
    q: 'De quoi sont faits les gros blocs du chaos d’Apremont ?', choices: ['De grès', 'De granit', 'De calcaire'], answer: 0,
  },
  'musee-barbizon': {
    text: 'Vers 1820, la famille Ganne tient une épicerie à Barbizon et loge les artistes venus peindre la forêt : l’auberge devient le rendez-vous des peintres de l’École de Barbizon. Ils y peignent les meubles et les murs de leurs chambres, et ces décors sont toujours là. La maison est aujourd’hui le musée départemental des peintres de Barbizon.',
    source: 'Office de tourisme du Pays de Fontainebleau (« Barbizon, village de peintres ») ; Paris Region ; Muséofile, ministère de la Culture (M0370)',
    q: 'Dans l’auberge, qu’ont peint les artistes, en plus de leurs tableaux ?', choices: ['Les meubles et les murs', 'Les vitraux', 'Les volets de la rue'], answer: 0,
  },
};
SPOTS.forEach(function (p) { if (CARDS[p.id]) Object.assign(p, CARDS[p.id]); });

const SETS = {
  napoleon: 'Napoléon à Fontainebleau',
  chateau: 'Le château et ses jardins',
  ville: 'La ville',
  denecourt: 'Les sentiers bleus',
  foret: 'Grands sites de la forêt',
  peintres: 'Les peintres de Barbizon',
  grimpe: '5 Must Climb, en famille',
};

// Space Invader mosaics (asked for on 21/11). 46 were put up around Fontainebleau in 2023
// (pixel-hunting.com, text read 21/11/2026). The project lead knows where most are; the four of
// the town-centre walk sheet (scripts/balades.js, their own survey) are placed here at the
// **street** (BAN), not the wall: one still looks for them. No photo: the works are Invader's.
const INVADER_TOTAL = 46;
const INVADERS = [
  { id: 'inv-lampe', name: 'Lampe abat-jour', street: 'rue Dénecourt', lat: 48.404255, lng: 2.70013 },
  { id: 'inv-napoleon', name: 'Napoléon et son bicorne', street: 'place de la République', lat: 48.406339, lng: 2.701041 },
  { id: 'inv-alien-rouge', name: 'Alien rouge et son livre', street: 'rue du Conventionnel-Geoffroy', lat: 48.405359, lng: 2.700052 },
  { id: 'inv-alien-bleu', name: 'Alien bleu à lunettes', street: 'rue des Trois-Maillets', lat: 48.404694, lng: 2.699368 },
];

function km(a, b) {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

function confirmedEvents() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.events || [];
  return list.filter((e) => e && e.id && e.title && CONFIRMED.has(e.source) && Number.isFinite(e.lat) && Number.isFinite(e.lng));
}
const endOf = (e) => (/^\d{4}-\d{2}-\d{2}$/.test(String(e.endDate || '')) ? e.endDate : e.startDate);
const slim = (e) => ({ id: e.id, title: e.title, cat: e.category || '', city: e.city, place: e.locationName || e.city,
  lat: e.lat, lng: e.lng, start: e.startDate, end: endOf(e), when: G.dateLabel(e), schedule: e.schedule || '',
  page: e.pageUrl || '', season: SEASON_RE.test(e.title) });

// This week's events and the season's (Christmas now), over the whole zone: the page keeps those
// within EVENT_KM (SEASON_KM) of the player, or of the town centre without a position.
function layers(today) {
  const all = confirmedEvents();
  const week = all.filter((e) => e.startDate <= G.addDays(today, EVENT_DAYS - 1) && endOf(e) >= today
    && G.spanDays(e) <= 4 && km(CENTRE, e) <= ZONE_KM).map(slim);
  const seen = new Set(week.map((e) => e.id));
  const season = all.filter((e) => !seen.has(e.id) && SEASON_RE.test(e.title) && endOf(e) >= today
    && e.startDate <= G.addDays(today, SEASON_DAYS) && G.spanDays(e) <= SEASON_DAYS && km(CENTRE, e) <= ZONE_KM).map(slim);
  return { week, season };
}

// JSON inside <script>: no "</script>" or "<!--" can close or confuse it.
const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function page(today, week, season) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fontainebleau Live Collection — maquette</title>
<link rel="stylesheet" href="../../vendor/leaflet-1.9.4/leaflet.css">
<style>
:root{--ink:#1d3b29;--accent:#afe14f;--paper:#fff;--bg:#f4f3ef;--line:#e6e2da;--muted:#5b645e;--live:#e0262f;--gold:#e3a51a;
--commun:#8a8f8b;--peu-commun:#2f8f5b;--rare:#2f63b8;--legendaire:#c28a14}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#d9d6cd;font:15px/1.4 "Segoe UI",-apple-system,Roboto,Arial,sans-serif;color:#1f2622}
.stage{display:flex;gap:28px;justify-content:center;align-items:flex-start;padding:20px 16px;flex-wrap:wrap}
.notes{max-width:360px;font-size:14px;color:#333}.notes h1{font-size:20px;margin:0 0 6px}.notes code{background:#eee;padding:0 4px;border-radius:3px}
.notes button{font:inherit;font-size:13px;margin:2px 4px 2px 0}
.phone{position:relative;width:390px;height:800px;background:var(--bg);border:12px solid #111;border-radius:40px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column}
@media (max-width:520px){.stage{padding:0}.notes{display:none}.phone{width:100vw;height:100vh;height:100dvh;border:0;border-radius:0}}
.top{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--ink);color:#fff}
.lvl{width:38px;height:38px;border-radius:50%;background:var(--accent);color:var(--ink);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
.who{flex:1;min-width:0}.who b{display:block;font-size:14px}.bar{height:7px;background:rgba(255,255,255,.25);border-radius:9px;overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:var(--accent);width:0;transition:width .6s}
.xp{font-size:12px;opacity:.85}.teamchip{font-size:11px;font-weight:700;background:rgba(255,255,255,.15);padding:3px 8px;border-radius:999px;display:none}.teamchip.on{display:inline-block}
.mebtn{width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.15);font-size:18px;cursor:pointer;flex:none}
.cards.mini{grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}.cards.mini .card{aspect-ratio:1;font-size:16px}.cards.mini .card small{font-size:8px;padding:2px}
.ico{display:inline-flex;width:1em;height:1em;vertical-align:-.15em}.ico svg{width:100%;height:100%;display:block}
.pin,.evt,.art,.ev-row .ic{color:#fff}.pin .ico{font-size:16px}.evt .ico{font-size:13px}.evt.star .ico{font-size:16px}.art .ico{font-size:64px}.ev-row .ic .ico{font-size:20px}
.card .ico{font-size:30px;margin-bottom:4px}.lgrid .ico{font-size:20px;display:block;margin:0 auto 2px}.lbtn .ico{font-size:22px;color:var(--ink)}.mebtn .ico{font-size:20px;color:#fff}
.pin.inv{width:26px;height:26px;background:#2b2d42;font-size:14px}.pin.inv .ico{font-size:14px}
.screen{flex:1;position:relative;overflow:auto;display:none}.screen.on{display:block}
#map{position:absolute;inset:0;background:#e8e4da;z-index:0}
.leaflet-fog-pane canvas{position:absolute;left:0;top:0;pointer-events:none}
#map.doux .leaflet-tile-pane{filter:saturate(.4) sepia(.25) brightness(1.05)}
#map.nuit .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9)}
.livebar{position:absolute;z-index:500;top:10px;left:10px;right:62px;display:flex;align-items:center;gap:8px;background:#fff;border:0;border-radius:14px;padding:8px 12px;box-shadow:0 1px 6px rgba(0,0,0,.25);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.livebar b{color:var(--live)}.livebar .dot{width:10px;height:10px;border-radius:50%;background:var(--live);flex:none;animation:blink 1.4s infinite}
@keyframes blink{50%{opacity:.3}}
.lbtn{position:absolute;z-index:500;top:10px;right:10px;width:44px;height:44px;border-radius:12px;border:0;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25);font-size:20px;cursor:pointer}
.lpanel{position:absolute;z-index:950;top:60px;right:10px;left:10px;background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.3);padding:12px 14px;display:none}
.lpanel.on{display:block}.lpanel h4{margin:4px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.lgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.lgrid button{font:inherit;font-size:12px;border:2px solid transparent;background:#f3f4f1;border-radius:12px;padding:8px 4px;cursor:pointer;color:var(--ink)}
.lgrid button span{display:block;font-size:22px;margin-bottom:2px}
.lgrid button[aria-pressed="true"]{border-color:var(--ink);background:#eef7dc;font-weight:700}
.lgrid .thumb{height:34px;border-radius:8px;margin-bottom:4px}
/* 21/11 feedback: small, discreet OpenStreetMap credit */
#map .leaflet-control-attribution{font-size:9px;line-height:1.3;padding:0 4px;background:rgba(255,255,255,.55);color:#6b716d}
#map .leaflet-control-attribution a{color:#6b716d}
.tabs{display:flex;background:#fff;border-top:1px solid var(--line)}
.tabs button{flex:1;font:inherit;font-size:12px;border:0;background:none;padding:8px 0 10px;color:var(--muted);cursor:pointer;position:relative}
.tabs button span{display:flex;justify-content:center;font-size:22px;margin-bottom:2px}.tabs button[aria-selected="true"]{color:var(--ink);font-weight:700}
.tabs .nb{position:absolute;top:4px;left:56%;background:var(--live);color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:0 5px}
.pin{width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 5px rgba(0,0,0,.4);position:relative}
.pin.locked{filter:grayscale(1);opacity:.8}
.pin.got::after{content:"✓";position:absolute;right:-6px;top:-6px;width:16px;height:16px;border-radius:50%;background:var(--accent);color:var(--ink);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
.qnum{width:20px;height:20px;border-radius:50%;background:var(--gold);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.evt{position:relative;width:24px;height:24px;border-radius:7px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.3);opacity:.9}
.evt i{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-style:normal;font-size:10px;font-weight:800;background:#fff;color:var(--ink);border-radius:6px;padding:0 4px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.evt.live{opacity:1;box-shadow:0 0 0 0 rgba(175,225,79,.8);animation:pulse 2.6s infinite}
.evt.live i{background:var(--live);color:#fff}
.evt.star{width:30px;height:30px;font-size:15px;border:2px solid var(--gold);opacity:1}
.evt.star::before{content:"★";position:absolute;top:-10px;right:-10px;font-size:15px;color:var(--gold);text-shadow:0 0 2px #fff,0 0 2px #fff}
.evt.got{filter:grayscale(.7);opacity:.7}
.evt.season{border-color:#1d7a43}
@keyframes pulse{70%{box-shadow:0 0 0 9px rgba(175,225,79,0)}100%{box-shadow:0 0 0 0 rgba(175,225,79,0)}}
.me{width:18px;height:18px;border-radius:50%;background:#2f7cf6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(47,124,246,.25)}
.sheet{position:absolute;z-index:900;left:0;right:0;bottom:0;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.25);transform:translateY(105%);transition:transform .3s;max-height:88%;overflow:auto}
.sheet.on{transform:none}
.art{height:140px;display:flex;align-items:center;justify-content:center;font-size:60px;position:relative}
.art .r{position:absolute;left:12px;top:12px;font-size:12px;font-weight:700;color:#fff;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.art .x,.close{position:absolute;right:10px;top:8px;font-size:24px;background:rgba(255,255,255,.85);border:0;border-radius:50%;width:34px;height:34px;cursor:pointer;line-height:1}
.body{padding:14px 16px 20px;position:relative}
.body h2{margin:0;font-size:20px;color:var(--ink);padding-right:30px}
.meta{color:var(--muted);font-size:13px;margin:2px 0 10px}
.todo{background:#fff6e0;border:1px dashed #d7a640;border-radius:8px;padding:8px 10px;font-size:13px;color:#6b4a12;margin:8px 0}
.acts{display:grid;gap:8px;margin-top:12px}
.btn{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px;cursor:pointer;background:var(--ink);color:#fff}
.btn.alt{background:#fff;color:var(--ink);border:1.5px solid var(--ink)}
.btn.soft{background:#eef0ec;color:var(--ink)}
.btn.live{background:var(--live)}
.btn:disabled{opacity:.45;cursor:default}
.got-banner{background:var(--accent);color:var(--ink);font-weight:700;border-radius:10px;padding:8px 12px;margin-top:10px}
.xpchip{display:inline-block;font-size:12px;font-weight:800;background:var(--accent);color:var(--ink);border-radius:999px;padding:2px 8px;white-space:nowrap}
.xpchip.gold{background:var(--gold);color:#fff}
.livechip{display:inline-block;font-size:11px;font-weight:800;background:var(--live);color:#fff;border-radius:999px;padding:2px 8px;text-transform:uppercase}
.q{display:none;gap:6px;margin-top:6px;flex-wrap:wrap}.q.on{display:flex}.q .qtext{flex-basis:100%;margin:0 0 2px;font-weight:600}.q .btn[disabled]{opacity:.45}.q .btn.right{background:#e3f1e8;border-color:#3d8b5a;color:#1f5f38;font-weight:600}.q .btn.wrong{background:#fbe9e7;border-color:#c0392b;color:#a02a1e;opacity:1}.qmsg{flex-basis:100%;margin:4px 0 0;font-weight:700;font-size:15px;min-height:0}.qmsg:empty{display:none}.qmsg.ok{color:#1f7a3f}.qmsg.ko{color:#b3261e}.qlead{margin:10px 0 0;font-size:14px;color:#5b625d}
.src{font-size:12px;color:var(--muted);font-style:italic;margin:-4px 0 8px}
.sheet-link{font-size:13px}.q input{flex:1;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px}
.pad{padding:14px 14px 24px}
.pad h2{font-size:18px;color:var(--ink);margin:6px 0 10px}
.set{background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;border:1px solid var(--line)}
.set h3{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between;gap:8px}
.prog{height:6px;background:#e9ece6;border-radius:9px;overflow:hidden;margin-bottom:6px}.prog i{display:block;height:100%;background:var(--peu-commun)}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.card{aspect-ratio:3/4;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:26px;color:#fff;cursor:pointer;border:0;font-family:inherit}
.card{min-width:0;overflow:hidden}.card small{font-size:10px;line-height:1.1;text-align:center;padding:4px;color:var(--ink);font-weight:600;max-width:100%;overflow-wrap:anywhere;hyphens:auto}
.view-sw{display:flex;gap:4px;background:#eceae4;border-radius:999px;padding:3px;margin:0 0 12px;width:max-content}.view-sw button{border:0;background:none;font:inherit;font-size:13px;font-weight:600;padding:6px 14px;border-radius:999px;cursor:pointer;color:var(--muted,#5b625d)}.view-sw button[aria-pressed=true]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.15)}
.cards.medals{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 6px}
.mtile{min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:0;padding:0;font:inherit;cursor:pointer;color:inherit}
.mtile .medal{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;border:3px solid currentColor;box-shadow:0 0 0 3px #fff,0 0 0 5px var(--ring,transparent),0 2px 6px rgba(0,0,0,.18);position:relative}
.mtile .medal::after{content:'';position:absolute;inset:4px;border-radius:50%;border:1px dashed currentColor;opacity:.35}
.mtile small{font-size:10.5px;line-height:1.15;text-align:center;font-weight:600;color:var(--ink);max-width:100%;overflow-wrap:anywhere;hyphens:auto;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mtile.locked .medal{background:#f1efea!important;color:#a3a7a2!important;border-style:dashed;box-shadow:none}.mtile.locked .medal .ico{opacity:.5}.mtile.locked .medal::after{display:none}.mtile.locked small{color:#7b807b;font-weight:500}
.pmedal .pring{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center}.pmedal .medal{width:58px;height:58px;box-shadow:0 0 0 2px #fff}.pmedal .medal::after{display:none}.pmedal.locked .medal{border-style:solid;border-color:#d6d2ca}.target{font-size:11px;font-weight:700;color:var(--muted,#5b625d);background:#eceae4;border-radius:999px;padding:1px 8px}.target.done{background:#e3f1e8;color:#1f7a3f}.titles{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.trow{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 10px}.tcirc{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;background:#eceae4;color:#8a8f8b;flex:none}.trow.on .tcirc{background:#2e7d4f;color:#fff}.ttx b{display:block;font-size:14px;color:var(--ink)}.ttx small{font-size:12px;color:var(--muted,#5b625d)}.trow:not(.on) .ttx b{color:#7b807b}.acc-h{font-size:14px;margin:14px 0 6px}.acc-mail{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px}.acc-acts{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.acc-acts .btn{flex:1}
.mtile.dark .medal{background:#2b2d42!important;color:#fff!important;border-color:#8b8fb0}
.card.locked{background:#eeeae3!important;color:#8a8f8b!important}.card.locked .ico{opacity:.55}.card.locked small{color:#6e746f}
.ev-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;background:#fff;border:0;border-bottom:1px solid var(--line);padding:10px 2px;cursor:pointer}
.ev-row .ic{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}
.ev-row .tx{flex:1;min-width:0}.ev-row .tx b{display:block;font-size:14px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ev-row .tx span{font-size:12px;color:var(--muted)}
.day{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 2px}
.quest{background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;border:1px solid var(--line)}
.quest b{color:var(--ink)}.quest p{margin:4px 0 8px;font-size:13px;color:var(--muted)}
.quest{display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:12px;align-items:start}.qmedal{width:44px;height:44px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;font-size:22px}.qbody{min-width:0}.qextra{grid-column:1 / -1;margin-top:6px}.fils-head p{margin:0 0 8px;font-size:13px;color:var(--muted)}.fsteps{display:flex;flex-direction:column;gap:6px}.fstep{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;background:#f7f6f2;border:1px solid var(--line);border-radius:10px;padding:6px 8px;cursor:pointer}.fdot{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;background:#eceae4;color:#8a8f8b;flex:none}.fstep.half .fdot{background:#fff4d6;color:#9a6b00}.fstep.done .fdot{background:#2e7d4f;color:#fff}.ftx{min-width:0}.ftx b{display:block;font-size:13px;color:var(--ink)}.ftx small{font-size:11.5px;color:var(--muted)}.ftodo{margin:4px 0 0;font-size:12px;color:#7a5a00;font-style:italic}
.quest.hot{border:2px solid #d4a72c;background:#fffaf0}.btn.gold{display:block;margin:4px auto 0;background:#fff;color:#7a5a00;border:1.5px solid #d4a72c}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef0ec;color:var(--ink);margin-right:4px}
.badges{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.badge{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 4px;text-align:center;font-size:24px}
.badge small{display:block;font-size:10px;color:var(--muted)}.badge.off{filter:grayscale(1);opacity:.4}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.stat{background:#fff;border-radius:12px;padding:10px;text-align:center;border:1px solid var(--line)}.stat b{display:block;font-size:20px;color:var(--ink)}
.offer{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:8px}
.offer .ic{font-size:24px}.offer b{color:var(--ink)}.offer p{margin:2px 0 0;font-size:13px;color:var(--muted)}.offer .price{margin-left:auto;font-weight:800;color:var(--ink);white-space:nowrap}
.toast{position:absolute;z-index:1200;left:50%;top:70px;transform:translate(-50%,-20px);background:var(--ink);color:#fff;padding:10px 16px;border-radius:999px;font-weight:700;opacity:0;transition:.3s;pointer-events:none;white-space:nowrap}
.toast.on{opacity:1;transform:translate(-50%,0)}
.levelup{position:absolute;inset:0;z-index:1100;background:rgba(29,59,41,.92);color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
.levelup.on{display:flex}.levelup .n{font-size:72px;font-weight:900;color:var(--accent)}
/* Entry flow */
.onb{position:absolute;inset:0;z-index:1150;background:var(--bg);display:none;flex-direction:column}
.onb.on{display:flex}
.onb .dots{display:flex;gap:6px;justify-content:center;padding:14px 0 0}.onb .dots i{width:7px;height:7px;border-radius:50%;background:#cfd3cc}.onb .dots i.on{background:var(--ink);width:20px;border-radius:9px}
.onb .skip{position:absolute;right:14px;top:8px;font:inherit;font-size:13px;border:0;background:none;color:var(--muted);cursor:pointer}
.onb .in{flex:1;overflow:auto;padding:18px 22px 10px;display:flex;flex-direction:column}
.onb h1{font-size:26px;color:var(--ink);margin:10px 0 6px;line-height:1.15}.onb .lead{color:var(--muted);margin:0 0 16px}
.onb .hero{height:210px;border-radius:22px;background:linear-gradient(160deg,#1d3b29,#2f6b44 60%,#afe14f);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:64px;margin-top:8px}
.onb .hero b{font-size:30px;letter-spacing:.02em;margin-top:6px;text-align:center;line-height:1.15;padding:0 16px}.onb .hero small{font-size:14px;opacity:.9}
.onb .feat{display:flex;gap:12px;align-items:center;margin:8px 0}.onb .feat span{font-size:24px;width:40px;height:40px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none;border:1px solid var(--line)}
.choice{display:flex;gap:12px;align-items:center;width:100%;text-align:left;font:inherit;background:#fff;border:2px solid var(--line);border-radius:14px;padding:12px;margin-bottom:8px;cursor:pointer}
.choice span{font-size:26px}.choice b{display:block;color:var(--ink)}.choice small{color:var(--muted)}
.choice[aria-pressed="true"]{border-color:var(--ink);background:#eef7dc}
.choice:disabled{opacity:.55;cursor:default}
.onb .foot{padding:10px 22px 22px;display:grid;gap:8px}.onb .foot .why{margin:0 0 4px;text-align:center}
.onb input{font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;width:100%;margin:4px 0 8px}
.firstq{background:#fff;border:2px solid var(--gold);border-radius:18px;padding:16px;text-align:center}
.firstq .big{font-size:52px}.firstq b{display:block;font-size:18px;color:var(--ink);margin:6px 0 2px}
</style></head><body>
<div class="stage">
<div class="notes">
<h1>Fontainebleau Live Collection — maquette M0 (v3)</h1>
<p><b>Ce qui est réel</b> : les positions des lieux (OpenStreetMap) ; la couche <b>Événements</b>, ${week.length} sorties de la semaine du ${G.frDate(today)} dans la zone de l’agenda, montrées à moins de ${EVENT_KM} km <b>du joueur</b> (la portée le suit) ; la couche <b>Saison</b>, ${season.length} rendez-vous de Noël des ${SEASON_DAYS} prochains jours. Toutes confirmées par une source lue, tirées de <code>data.json</code>.</p>
<p><b>Ce qui ne l’est pas</b> : textes, questions, barème d’XP, boutique (rien n’est vendu), style graphique. Les 5 sites de grimpe sont une proposition à valider avec des grimpeurs.</p>
<p><b>Essayer</b> : le parcours d’entrée s’ouvre au premier lancement. Puis le bouton des couches (en haut à droite), le bandeau « en direct », un événement, un lieu ; « Simuler ma position » puis touchez la carte pour essayer le GPS.</p>
<p><button type="button" id="replay">Revoir l’accueil</button><button type="button" id="reset">Tout remettre à zéro</button></p>
<p>Fenêtre étroite (moins de 520 px) : la maquette prend tout l’écran, comme sur un téléphone.</p>
</div>
<div class="phone" id="phone">
<div class="top"><div class="lvl" id="lvl">1</div><div class="who"><b id="title">Promeneur</b><div class="bar"><i id="xpbar"></i></div><span class="xp" id="xptxt"></span></div><span class="teamchip" id="teamchip"></span><button type="button" class="mebtn" id="mebtn" aria-label="Profil"><span data-ico="user"></span></button></div>
<section class="screen on" id="s-map"><div id="map"></div>
<button type="button" class="livebar" id="livebar"><span class="dot"></span><span id="livetxt"></span></button>
<button type="button" class="lbtn" id="lbtn" aria-label="Couches" aria-expanded="false"><span data-ico="layers"></span></button>
<div class="lpanel" id="lpanel">
<h4>Type de carte</h4>
<div class="lgrid" id="bases"></div>
<h4>Couches</h4>
<div class="lgrid" id="overlays"></div>
</div>
</section>
<section class="screen" id="s-live"><div class="pad" id="live"></div></section>
<section class="screen" id="s-dex"><div class="pad" id="dex"></div></section>
<section class="screen" id="s-quests"><div class="pad" id="quests"></div></section>
<section class="screen" id="s-me"><div class="pad" id="me"></div></section>
<section class="screen" id="s-shop"><div class="pad" id="shop"></div></section>
<div class="sheet" id="sheet"></div>
<div class="onb" id="onb"></div>
<div class="toast" id="toast"></div>
<div class="levelup" id="levelup"><div>Niveau</div><div class="n" id="lu-n"></div><div id="lu-t" style="font-size:20px;font-weight:700"></div><p id="lu-p"></p><button type="button" class="btn alt" id="lu-ok">Continuer</button></div>
<nav class="tabs" role="tablist">
<button type="button" role="tab" aria-selected="true" data-tab="map"><span data-ico="map"></span>Carte</button>
<button type="button" role="tab" aria-selected="false" data-tab="live"><span data-ico="live"></span>En direct<em class="nb" id="nb"></em></button>
<button type="button" role="tab" aria-selected="false" data-tab="dex"><span data-ico="cards"></span>Collection</button>
<button type="button" role="tab" aria-selected="false" data-tab="quests"><span data-ico="flag"></span>Quêtes</button>
<button type="button" role="tab" aria-selected="false" data-tab="shop"><span data-ico="bag"></span>Boutique</button>
</nav>
</div>
</div>
<script src="../../vendor/leaflet-1.9.4/leaflet.js"></script>
<script>
var SPOTS = ${inline(SPOTS)};
var SETS = ${inline(SETS)};
var INVADERS = ${inline(INVADERS)};
var INVADER_TOTAL = ${INVADER_TOTAL};
var EVENTS_ALL = ${inline(week)};
var SEASON_ALL = ${inline(season)};
var RANGE = ${inline({ events: EVENT_KM * 1000, season: SEASON_KM * 1000, centre: CENTRE })};
var ICONS = ${inline(ICONS)};
var TODAY = ${inline(today)};
${CLIENT}
</script>
</body></html>
`;
}

// The page's own script. Every text from the data goes through textContent (frontend rule);
// innerHTML only ever receives fixed markup written here.
const CLIENT = String.raw`
(function () {
  // 21/11 (4th round): a much smaller scale; no single gain may be worth more than one level.
  var XP = { 'commun': 15, 'peu commun': 20, 'rare': 30, 'légendaire': 60 };
  var EVENT_XP = 20, FEATURED_XP = 40, SEASON_BONUS = 5, SET_XP = 40, ALL_CATS_XP = 50, FIRST_STEP_XP = 5, ECO_XP = 10;
  function half(x) { return Math.round(x / 2); }
  var QUESTION_XP = 5; // 21/11: the question opens the story, even after a GPS check-in
  var SET_MIN_PLACES = 3; // 21/11: the mock's one-place sets gave +40 with the first answer
  var RADIUS = { ville: 100, foret: 150, event: 200 };
  var TITLES = [[1, 'Promeneur'], [3, 'Flâneur'], [5, 'Bellifontain'], [8, 'Bleausard'], [12, 'Peintre de Barbizon'], [20, 'Denecourt']];
  var RCOL = { 'commun': 'var(--commun)', 'peu commun': 'var(--peu-commun)', 'rare': 'var(--rare)', 'légendaire': 'var(--legendaire)' };
  // 21/11: the site's palette (index.html categories and brand), no more browns
  var SETCOL = { napoleon: '#4a5bb8', chateau: '#0f8f9e', ville: '#9247a0', denecourt: '#27503a', foret: '#5f8f2f', peintres: '#b8707d', grimpe: '#6b6257' };
  function tint(c) { return 'color-mix(in srgb, ' + c + ' 14%, #fff)'; }
  var CATS = { 'Scène & Spectacles': ['mask', '#b8707d', 'Scène'], 'Culture & Ateliers': ['palette', '#9282b5', 'Culture'],
    'Nature & Environnement': ['leaf', '#6f9e80', 'Nature'], 'Sport & Outdoor': ['run', '#6d8bb5', 'Sport'] };
  // 22/11, project lead: no investigation ("ça fait un peu jeu de rôle"), no content for sale.
  // Instead five threads of history, in the order of history: each links real places; a step is
  // done when the place is collected AND its question answered. Any order; a thread completed:
  // +FIL_XP and its badge. First draft: only places and facts already on the cards; a missing step
  // is said, never made up.
  var FIL_XP = 60;
  var FILS = [
    { id: 'rois', name: 'Les rois à Fontainebleau', icon: 'castle', color: '#0f8f9e',
      intro: 'Du donjon du XIIᵉ siècle à l’obélisque de Marie-Antoinette : François Ier et les rois après lui, au château, en ville et dans la forêt de leurs chasses.',
      steps: ['donjon', 'galerie-francois-1er', 'jardin-de-diane', 'saint-louis', 'cour-des-adieux', 'grand-veneur', 'obelisque'] },
    { id: 'napoleon', name: 'Les Napoléon', icon: 'fresco', color: '#4a5bb8',
      intro: 'Napoléon Ier, qui fait ses adieux à sa Vieille Garde en 1814, et Napoléon III, qui inaugure le Fort l’Empereur en 1853.',
      steps: ['cour-des-adieux', 'fresque-napoleon', 'aigle-noir', 'tour-denecourt'] },
    { id: 'denecourt', name: 'Denecourt, le Sylvain', icon: 'tree', color: '#27503a',
      intro: 'L’homme qui a tracé les sentiers bleus, creusé des grottes et fait bâtir une tour, au XIXᵉ siècle.',
      steps: ['mont-ussy', 'grotte-serment', 'tour-denecourt', 'rocher-cassepot', 'croix-d-augas'] },
    { id: 'peintres', name: 'Les peintres de Barbizon', icon: 'palette', color: '#b8707d',
      intro: 'Camille Corot découvre Barbizon en 1827 et ouvre la voie : Théodore Rousseau, Jean-François Millet et les autres viennent peindre la forêt, et obtiennent sa protection en 1853.', // Corot 1827: Office de tourisme, « The Artists Trail »
      steps: ['musee-barbizon', 'medaillon-millet-rousseau', 'bas-breau', 'apremont', 'chailly'] },
    { id: 'carriers', name: 'Le grès et les carriers', icon: 'pick', color: '#6b6257',
      intro: 'Pendant des siècles et jusqu’en 1907, on a taillé le grès de la forêt : des pavés pour les routes et pour Paris, des pierres pour le château. Fronts de taille, routes pavées et abris de carriers sont encore là.',
      steps: ['mont-ussy', 'croix-d-augas', 'franchard', 'gorges-du-houx', 'apremont'] },
  ];
  var CHAPTER = FILS[0].steps; // numbered gold steps on the map (« Quêtes » layer): the first thread
  function filStep(id) { var p = SPOTS.filter(function (x) { return x.id === id; })[0]; return p && st.spots[id] && (!p.q || st.answered[id]); }
  var KEY = 'bleau-quest-mock-v5'; // v5: smaller XP scale (21/11), older saves start over
  var st = load(); st.answered = st.answered || {}; st.invaders = st.invaders || {};
  // Every field the game reads: after « Tout remettre à zéro » (22/11) a missing one made each
  // question throw, silently.
  function fresh() { return { xp: 0, spots: {}, answered: {}, invaders: {}, events: {}, plans: {}, sets: {}, eco: false, onboarded: false, profile: '', likes: [], team: '', geo: '' }; }
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY)); return s && s.spots ? s : fresh(); } catch (e) { return fresh(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function $(id) { return document.getElementById(id); }
  // Icons (scripts/bleau-quest-icons.js), drawn for the project. Fixed markup, never from the data.
  function ico(name) {
    var d = ICONS[name] || ICONS.star, sp = document.createElement('span'); sp.className = 'ico';
    sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d.l + '"/></svg>';
    return sp;
  }
  function chrome() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ico]'), function (n) { n.textContent = ''; n.appendChild(ico(n.getAttribute('data-ico'))); });
  }
  function cat(e) { return CATS[e.cat] || ['star', '#555', 'Sortie']; }
  function byId(id) { return EVENTS_ALL.concat(SEASON_ALL).filter(function (x) { return x.id === id; })[0]; }
  function dayShort(d) { return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''); }
  function dayLong(d) { return d === TODAY ? 'Aujourd’hui' : new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function isLive(e) { return e.start <= TODAY && e.end >= TODAY; }
  function firstDay(e) { return e.start < TODAY ? TODAY : e.start; }

  // Event of the day: one of today's events, the same for everyone that day (a stable hash).
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
  // 21/11: the 12 km range follows the player (the town centre without a position).
  var EVENTS = [], SEASON = [], liveNow = [], featured = null;
  function refreshRange() {
    var c = me || RANGE.centre;
    EVENTS = EVENTS_ALL.filter(function (e) { return dist(c, e) <= RANGE.events; });
    SEASON = SEASON_ALL.filter(function (e) { return dist(c, e) <= RANGE.season; });
    liveNow = EVENTS.filter(isLive);
    featured = liveNow.slice().sort(function (a, b) { return hash(a.id + TODAY) - hash(b.id + TODAY); })[0] || null;
  }
  refreshRange();
  function xpOf(e) { return (featured && e.id === featured.id ? FEATURED_XP : EVENT_XP) + (e.season ? SEASON_BONUS : 0); }

  // Level n starts at 30·n·(n−1) XP: 60, 180, 360, 600, 900… up to level 30 (GDD §8). Level 2
  // after three or four actions, then each level takes longer (21/11, 4th round: it rose too fast).
  var MAX_LEVEL = 30;
  function floorOf(n) { return 30 * n * (n - 1); }
  function levelOf(xp) { var n = 1; while (n < MAX_LEVEL && floorOf(n + 1) <= xp) n++; return n; }
  function titleOf(n) { var t = TITLES[0][1]; TITLES.forEach(function (x) { if (n >= x[0]) t = x[1]; }); return t; }

  function hud() {
    var n = levelOf(st.xp), a = floorOf(n), b = floorOf(n + 1);
    $('lvl').textContent = n; $('title').textContent = titleOf(n);
    $('xpbar').style.width = Math.round(100 * (st.xp - a) / (b - a)) + '%';
    $('xptxt').textContent = n >= MAX_LEVEL ? st.xp + ' XP · niveau maximum' : st.xp + ' XP · niveau ' + (n + 1) + ' à ' + b;
    var tc = $('teamchip'); tc.textContent = st.team ? '👥 ' + st.team : ''; tc.classList.toggle('on', !!st.team);
  }
  // 21/11: gains that come together are listed together (a hidden "+40 série complète" made a
  // "+15 XP" answer look like a level-up bug).
  function toast(t) { var x = $('toast'); x.style.whiteSpace = 'pre-line'; x.textContent = x.classList.contains('on') ? x.textContent + String.fromCharCode(10) + t : t; x.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { x.classList.remove('on'); }, 2500); }
  function gain(xp, why) {
    var before = levelOf(st.xp); st.xp += xp; save(); hud(); toast('+' + xp + ' XP · ' + why);
    var after = levelOf(st.xp);
    for (var n = before + 1; n <= after; n++) luQueue.push(n);
    if (luQueue.length && !luShowing && !luTimer) luTimer = setTimeout(nextLevelUp, 900);
  }
  var luQueue = [], luShowing = false, luTimer = 0;
  function nextLevelUp() {
    luTimer = 0; var n = luQueue.shift(); if (!n) return;
    var t = titleOf(n), isNew = titleOf(n - 1) !== t, nx = TITLES.filter(function (x) { return x[0] > n; })[0];
    $('lu-n').textContent = n; $('lu-t').textContent = isNew ? t : '';
    $('lu-p').textContent = isNew ? 'Nouveau titre débloqué' : nx ? 'Prochain titre au niveau ' + nx[0] + ' : ' + nx[1] : '';
    luShowing = true; $('levelup').classList.add('on');
  }
  $('lu-ok').onclick = function () { $('levelup').classList.remove('on'); luShowing = false; if (luQueue.length) luTimer = setTimeout(nextLevelUp, 300); };

  function checkSets() {
    Object.keys(SETS).forEach(function (s) {
      var all = SPOTS.filter(function (p) { return p.set === s; });
      if (all.length < SET_MIN_PLACES) return; // a one- or two-place set is no achievement
      if (!st.sets[s] && all.every(function (p) { return st.spots[p.id]; })) { st.sets[s] = true; gain(SET_XP, 'série complète : ' + SETS[s]); }
    });
    FILS.forEach(function (fl) {
      if (fl.steps.length && !st.sets['fil-' + fl.id] && fl.steps.every(filStep)) { st.sets['fil-' + fl.id] = true; gain(FIL_XP, 'fil complet : ' + fl.name); }
    });
    var cats = {}; Object.keys(st.events).forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    if (!st.sets.cats && Object.keys(CATS).every(function (c) { return cats[c]; })) { st.sets.cats = true; gain(ALL_CATS_XP, 'quatre genres de sorties'); }
  }

  // ── Map and layers ──
  var map = L.map('map', { zoomControl: false }).setView([48.408, 2.69], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  var FogLayer = L.Layer.extend({
    initialize: function () { this._holes = []; },
    onAdd: function (m) {
      if (!m.getPane('fog')) { m.createPane('fog').style.zIndex = 350; }
      this._c = L.DomUtil.create('canvas', '', m.getPane('fog'));
      m.on('moveend zoomend resize viewreset', this._redraw, this); m.on('zoomstart', this._hide, this); this._redraw();
    },
    onRemove: function (m) { L.DomUtil.remove(this._c); m.off('moveend zoomend resize viewreset', this._redraw, this); m.off('zoomstart', this._hide, this); },
    clearLayers: function () { this._holes = []; return this; },
    setHoles: function (h) { this._holes = h; if (this._map) this._redraw(); },
    _hide: function () { if (this._c) this._c.style.opacity = 0; },
    _redraw: function () {
      var m = this._map, c = this._c; if (!m || !c) return;
      // Half a screen of margin on each side, so a pan does not reveal unfogged edges
      var sz = m.getSize(), px = Math.round(sz.x / 2), py = Math.round(sz.y / 2), w = sz.x + 2 * px, h = sz.y + 2 * py;
      var r = window.devicePixelRatio || 1;
      c.width = Math.ceil(w * r); c.height = Math.ceil(h * r); c.style.width = w + 'px'; c.style.height = h + 'px';
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([-px, -py]));
      var g = c.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(36,48,42,.55)'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-out';
      this._holes.forEach(function (o) {
        var p = m.latLngToContainerPoint([o.lat, o.lng]), q = m.latLngToContainerPoint([o.lat + o.r / 111320, o.lng]);
        var x = p.x + px, y = p.y + py, rad = Math.max(4, Math.abs(p.y - q.y));
        var grd = g.createRadialGradient(x, y, rad * .65, x, y, rad); grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 2 * Math.PI); g.fill();
      });
      g.globalCompositeOperation = 'source-over'; c.style.opacity = 1;
    }
  });
  var LAYERS = {
    spots: { icon: 'pin', label: 'Lieux', on: true, g: L.layerGroup() },
    events: { icon: 'live', label: 'En direct', on: true, g: L.layerGroup() },
    invaders: { icon: 'invader', label: 'Invaders', on: true, g: L.layerGroup() }, // asked for on the map (21/11)
    // 21/11 feedback: the map opens light (places and live events); the other layers are one tap away
    quests: { icon: 'flag', label: 'Quêtes', on: false, g: L.layerGroup() },
    climb: { icon: 'climb', label: 'Grimpe', on: false, g: L.layerGroup() },
    season: { icon: 'xmas', label: 'Noël', on: false, g: L.layerGroup() },
    fog: { icon: 'fog', label: 'Brouillard', on: true, g: new FogLayer() }, // on by default (21/11): it focuses on what is around
  };
  var BASES = [['plan', 'Plan', '#e9e5dc'], ['doux', 'Doux', '#ece3cf'], ['nuit', 'Nuit', '#2b3540']];
  var base = 'plan';
  Object.keys(LAYERS).forEach(function (k) { if (LAYERS[k].on) LAYERS[k].g.addTo(map); });
  function panel() {
    var bs = $('bases'); bs.textContent = '';
    BASES.forEach(function (b) {
      var x = el('button'); x.type = 'button'; x.setAttribute('aria-pressed', base === b[0]);
      var t = el('div', 'thumb'); t.style.background = b[2]; x.appendChild(t); x.appendChild(document.createTextNode(b[1]));
      x.onclick = function () { base = b[0]; $('map').className = b[0] === 'plan' ? '' : b[0]; panel(); };
      bs.appendChild(x);
    });
    var ov = $('overlays'); ov.textContent = '';
    Object.keys(LAYERS).forEach(function (k) {
      var L0 = LAYERS[k], x = el('button'); x.type = 'button'; x.setAttribute('aria-pressed', L0.on);
      x.appendChild(ico(L0.icon)); x.appendChild(document.createTextNode(L0.label));
      x.onclick = function () { L0.on = !L0.on; if (L0.on) L0.g.addTo(map); else map.removeLayer(L0.g); panel(); };
      ov.appendChild(x);
    });
  }
  $('lbtn').onclick = function () { var p = $('lpanel'), on = !p.classList.contains('on'); p.classList.toggle('on', on); this.setAttribute('aria-expanded', on); };
  map.on('movestart', function () { $('lpanel').classList.remove('on'); });

  function pinMarker(p, layer) {
    var got = !!st.spots[p.id];
    var m = L.marker([p.lat, p.lng], { icon: L.divIcon({ html: '<div class="pin' + (got ? ' got' : ' locked') + '" style="background:' + RCOL[p.rarity] + '"></div>', className: '', iconSize: [30, 30], iconAnchor: [15, 15] }) });
    m.on('add', function () { m.getElement().querySelector('.pin').appendChild(ico(p.icon)); });
    m.on('click', function () { if (!arming) openSpot(p); });
    layer.addLayer(m);
  }
  function evtMarker(e, layer) {
    var live = isLive(e), star = featured && e.id === featured.id, got = !!st.events[e.id];
    var cls = 'evt' + (live ? ' live' : '') + (star ? ' star' : '') + (got ? ' got' : '') + (e.season ? ' season' : '');
    var size = star ? 30 : 24;
    var m = L.marker([e.lat, e.lng], { zIndexOffset: star ? 1000 : live ? 500 : 0,
      icon: L.divIcon({ html: '<div class="' + cls + '"><b></b><i></i></div>', className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) });
    m.on('add', function () {
      var d = m.getElement().querySelector('.evt'); d.style.background = cat(e)[1];
      d.querySelector('b').appendChild(ico(e.season ? 'xmas' : cat(e)[0]));
      d.querySelector('i').textContent = live ? 'LIVE' : dayShort(firstDay(e));
    });
    m.on('click', function () { if (!arming) openEvent(e); });
    layer.addLayer(m);
  }
  function draw() {
    Object.keys(LAYERS).forEach(function (k) { LAYERS[k].g.clearLayers(); });
    SPOTS.forEach(function (p) { pinMarker(p, p.set === 'grimpe' ? LAYERS.climb.g : LAYERS.spots.g); });
    EVENTS.forEach(function (e) { evtMarker(e, e.season ? LAYERS.season.g : LAYERS.events.g); });
    SEASON.forEach(function (e) { evtMarker(e, LAYERS.season.g); });
    INVADERS.forEach(function (v) {
      var on = invGot(v), mk = L.marker([v.lat, v.lng], { icon: L.divIcon({ html: '<div class="pin inv' + (on ? ' got' : '') + '"></div>', className: '', iconSize: [26, 26], iconAnchor: [13, 13] }) });
      mk.on('add', function () { mk.getElement().querySelector('.pin').appendChild(ico('invader')); });
      mk.on('click', function () { if (!arming) openInvader(v); });
      LAYERS.invaders.g.addLayer(mk);
    });
    CHAPTER.forEach(function (id, i) {
      var p = SPOTS.filter(function (x) { return x.id === id; })[0]; if (!p || st.spots[id]) return;
      var m = L.marker([p.lat, p.lng], { interactive: false, zIndexOffset: 800, icon: L.divIcon({ html: '<div class="qnum">' + (i + 1) + '</div>', className: '', iconSize: [20, 20], iconAnchor: [26, 26] }) });
      LAYERS.quests.g.addLayer(m);
    });
    drawFog();
  }
  // Fog of exploration: the world darkened, with a clearing around what the player has seen.
  function ring(c, r) { return { lat: c.lat, lng: c.lng, r: r }; }
  function drawFog() {
    var holes = [];
    SPOTS.forEach(function (p) { if (st.spots[p.id]) holes.push(ring(p, 700)); });
    Object.keys(st.events).forEach(function (id) { var e = byId(id); if (e) holes.push(ring(e, 500)); });
    INVADERS.forEach(function (v) { if (invGot(v)) holes.push(ring(v, 250)); });
    // Without a position yet, a clearing on the town centre, so the map never opens all dark
    holes.push(me ? ring(me, 400) : ring({ lat: 48.404, lng: 2.698 }, 600));
    LAYERS.fog.g.setHoles(holes);
  }

  var me = null, meMarker = null, arming = false;
  function setMe(lat, lng) {
    me = { lat: lat, lng: lng };
    if (meMarker) map.removeLayer(meMarker);
    meMarker = L.marker([lat, lng], { icon: L.divIcon({ html: '<div class="me"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(map);
    refreshRange(); draw(); liveBar(); renderAll();
  }
  function dist(a, b) {
    var r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
  }
  function radiusOf(p) { return /forêt|sentiers|grimpe|gorges/i.test(SETS[p.set] + p.type + p.set) ? RADIUS.foret : RADIUS.ville; }
  function fmtDist(d) { return d > 1500 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'; }

  function liveBar() {
    var n = liveNow.length;
    $('livetxt').textContent = '';
    var b = el('b', null, n + ' en direct'); $('livetxt').appendChild(b);
    $('livetxt').appendChild(document.createTextNode(' aujourd’hui · ' + EVENTS.length + ' cette semaine à 12 km · jusqu’à +' + FEATURED_XP + ' XP'));
    $('nb').textContent = n ? String(n) : '';
  }
  $('livebar').onclick = function () { tab('live'); };

  // ── Sheets ──
  var sheet = $('sheet');
  function closeSheet() { sheet.classList.remove('on'); }
  function header(bg, icon, chip, chipCol) {
    var art = el('div', 'art'); art.style.background = tint(bg); art.style.color = bg; art.appendChild(ico(icon));
    if (chip) { var r = el('span', 'r', chip); r.style.background = chipCol; art.appendChild(r); }
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer'); x.onclick = closeSheet; art.appendChild(x);
    return art;
  }
  function firstStep() { if (st.onboarded && !st.firstStep) { st.firstStep = true; gain(FIRST_STEP_XP, 'premier pas'); } }
  function openSpot(p) {
    firstStep();
    sheet.textContent = '';
    var got = st.spots[p.id];
    sheet.appendChild(header(got ? SETCOL[p.set] : '#8a8f8b', p.icon, p.rarity, RCOL[p.rarity]));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, p.name));
    b.appendChild(el('p', 'meta', p.type + ' · ' + SETS[p.set] + ' · ' + XP[p.rarity] + ' XP' + (me ? ' · à ' + fmtDist(dist(me, p)) : '')));
    if (p.set === 'grimpe') b.appendChild(el('div', 'todo', 'Grimper en famille : on vient voir, on essaie les premiers blocs du circuit enfants, à son niveau. Crash-pad, parade, jamais sur rocher mouillé. Le topo est chez Boolder.'));
    if (got) {
      b.appendChild(el('div', 'got-banner', '✓ Dans votre collection — ' + ({ gps: 'validé sur place (GPS)', question: 'validé par la question', honneur: 'validé sur l’honneur' })[got]));
      // 21/11: "je peux très bien dire j'y suis, mais je veux quand même la question". 22/11: "on
      // doit toujours voir la question" — once answered it stays, the right answer marked. The
      // answer opens the story (+ a small bonus); a place without a question shows its story.
      if (p.q) {
        var done = !!st.answered[p.id];
        var q2 = questionBlock(p, function () { st.answered[p.id] = 1; save(); gain(QUESTION_XP, 'bonne observation'); checkSets(); renderAll(); openSpot(p); }, done);
        q2.classList.add('on'); b.appendChild(q2);
      }
      if (p.text && (!p.q || st.answered[p.id])) {
        b.appendChild(el('p', null, p.text));
        b.appendChild(el('p', 'src', 'Source : ' + p.source));
      }
    } else {
      b.appendChild(el('p', null, 'Rendez-vous sur place pour débloquer la carte de ce lieu et son histoire.'));
      var acts = el('div', 'acts');
      var gps = el('button', 'btn', '📍 Je suis ici (GPS, rayon ' + radiusOf(p) + ' m)'); gps.type = 'button';
      gps.onclick = function () {
        // Mock: the player is put on site (on a phone, the real position decides)
        if (!me || dist(me, p) > radiusOf(p)) setMe(p.lat, p.lng);
        unlock(p, 'gps');
      };
      acts.appendChild(gps);
      // 22/11: no "sur l'honneur" on a place ("on a déjà Pas de GPS, c'est la même chose"). The
      // question is always on view: answered on the spot, it collects the card without GPS.
      if (p.q) {
        acts.appendChild(el('p', 'qlead', 'Pas de GPS ? Répondez à la question :'));
        var q = questionBlock(p, function () { st.answered[p.id] = 1; unlock(p, 'question'); });
        q.classList.add('on'); acts.appendChild(q);
      }
      b.appendChild(acts);
    }
    if (p.set === 'grimpe') { var a = el('a', null, 'Topo sur Boolder'); a.href = 'https://www.boolder.com/fr'; a.target = '_blank'; a.rel = 'noopener'; var pp = el('p', 'sheet-link'); pp.appendChild(a); b.appendChild(pp); }
    sheet.appendChild(b); sheet.classList.add('on');
  }
  // done: already answered — the question stays on view, the right answer marked.
  function questionBlock(p, onRight, done) {
    var q = el('div', 'q');
    q.appendChild(el('p', 'qtext', p.q));
    p.choices.forEach(function (c, i) {
      var cb = el('button', 'btn alt' + (done && i === p.answer ? ' right' : ''), (done && i === p.answer ? '✓ ' : '') + c); cb.type = 'button';
      if (done) cb.disabled = i !== p.answer;
      else cb.onclick = function () {
        if (i === p.answer) {
          cb.classList.add('right'); cb.textContent = '✓ ' + c; msg.className = 'qmsg ok'; msg.textContent = 'Bonne réponse !';
          Array.prototype.forEach.call(q.querySelectorAll('button'), function (x) { x.onclick = null; });
          setTimeout(function () { onRight(); sheet.scrollTop = 0; }, 700);
        } else {
          cb.disabled = true; cb.classList.add('wrong'); cb.textContent = '✗ ' + c;
          msg.className = 'qmsg ko'; msg.textContent = 'Pas tout à fait : regardez encore autour de vous.';
        }
      };
      q.appendChild(cb);
    });
    var msg = el('p', 'qmsg'); q.appendChild(msg);
    return q;
  }
  function unlock(p, how) {
    st.spots[p.id] = how; save();
    gain(how === 'honneur' ? half(XP[p.rarity]) : XP[p.rarity], p.name);
    draw(); renderAll(); openSpot(p); checkSets();
  }
  function openEvent(e) {
    firstStep();
    sheet.textContent = '';
    var c = cat(e), live = isLive(e), star = featured && e.id === featured.id, xp = xpOf(e);
    sheet.appendChild(header(c[1], e.season ? 'xmas' : c[0], star ? '★ événement du jour' : live ? 'en direct' : c[2], star ? 'var(--gold)' : live ? 'var(--live)' : 'rgba(29,59,41,.55)'));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, e.title));
    b.appendChild(el('p', 'meta', e.when + ' · ' + e.place + (e.schedule ? ' · ' + e.schedule : '') + (me ? ' · à ' + fmtDist(dist(me, e)) : '')));
    var line = el('p'); var chip = el('span', 'xpchip' + (star ? ' gold' : ''), '+' + xp + ' XP'); line.appendChild(chip);
    line.appendChild(document.createTextNode(star ? '  Événement du jour : XP doublée.' : e.season ? '  Bonus de saison compris.' : '  Une carte souvenir datée.'));
    b.appendChild(line);
    b.appendChild(el('p', 'meta', 'Passer le jour J suffit : on n’exige jamais un billet.'));
    if (st.events[e.id]) b.appendChild(el('div', 'got-banner', '✓ Carte souvenir obtenue le ' + st.events[e.id].d));
    else {
      var acts = el('div', 'acts');
      if (live) {
        var go = el('button', 'btn live', '📍 J’y suis (GPS, ' + RADIUS.event + ' m)'); go.type = 'button';
        go.onclick = function () {
          if (!me || dist(me, e) > RADIUS.event) setMe(e.lat, e.lng);
          claimEvent(e, 'gps');
        };
        var hon = el('button', 'btn soft', '🤝 Sur l’honneur (' + half(xp) + ' XP)'); hon.type = 'button'; hon.onclick = function () { claimEvent(e, 'honneur'); };
        acts.appendChild(go); acts.appendChild(hon);
      } else {
        var plan = el('button', 'btn alt', st.plans[e.id] ? '🔔 Prévu — rappel le jour J' : '🔔 J’y vais (rappel le jour J)'); plan.type = 'button';
        plan.onclick = function () { if (st.plans[e.id]) delete st.plans[e.id]; else st.plans[e.id] = 1; save(); renderAll(); openEvent(e); };
        acts.appendChild(plan);
        acts.appendChild(el('p', 'meta', 'La carte souvenir se gagne le ' + dayLong(firstDay(e)) + '.'));
      }
      // 22/11: the mock's « simuler le jour J » shortcut removed (the project lead: what is it for?).
      b.appendChild(acts);
    }
    if (e.page) { var a = el('a', null, 'Voir la fiche sur Fontainebleau Live'); a.href = 'https://fontainebleaulive.fr' + e.page; a.target = '_blank'; a.rel = 'noopener'; var pp = el('p', 'sheet-link'); pp.appendChild(a); b.appendChild(pp); }
    sheet.appendChild(b); sheet.classList.add('on');
  }
  function claimEvent(e, how) {
    var xp = how === 'honneur' ? half(xpOf(e)) : xpOf(e);
    st.events[e.id] = { d: TODAY, how: how, cat: e.cat }; delete st.plans[e.id]; save();
    gain(xp, 'carte souvenir'); draw(); renderAll(); openEvent(e); checkSets();
  }

  // ── En direct: the site's strength, its own tab ──
  function evRow(root, e) {
    var c = cat(e), r = el('button', 'ev-row'); r.type = 'button';
    var ic = el('span', 'ic'); ic.appendChild(ico(e.season ? 'xmas' : c[0])); ic.style.background = c[1]; r.appendChild(ic);
    var tx = el('span', 'tx'); tx.appendChild(el('b', null, e.title)); tx.appendChild(el('span', null, e.place + (e.schedule ? ' · ' + e.schedule : '')));
    r.appendChild(tx);
    if (st.events[e.id]) r.appendChild(el('span', 'xpchip', '✓'));
    else { if (st.plans[e.id]) r.appendChild(el('span', null, '🔔')); r.appendChild(el('span', 'xpchip' + (featured && e.id === featured.id ? ' gold' : ''), '+' + xpOf(e))); }
    r.onclick = function () { tab('map'); map.setView([e.lat, e.lng], 15); openEvent(e); };
    root.appendChild(r);
  }
  function renderLive() {
    var root = $('live'); root.textContent = '';
    root.appendChild(el('h2', null, 'En direct aujourd’hui et demain'));
    root.appendChild(el('p', 'meta', 'Les sorties de l’agenda deviennent des étapes le jour J : passez-y, gagnez une carte souvenir et de l’XP.'));
    if (featured) {
      var q = el('div', 'quest hot'); q.appendChild(el('span', 'livechip', '★ Événement du jour'));
      q.appendChild(el('p', null, 'XP doublée aujourd’hui, pour tout le monde.'));
      evRow(q, featured); root.appendChild(q);
    }
    var days = {};
    EVENTS.forEach(function (e) { var d = firstDay(e); (days[d] = days[d] || []).push(e); });
    var tomorrow = new Date(TODAY + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow = tomorrow.toISOString().slice(0, 10);
    Object.keys(days).sort().filter(function (d) { return d <= tomorrow; }).forEach(function (d) {
      root.appendChild(el('div', 'day', dayLong(d) + ' · ' + days[d].length));
      days[d].forEach(function (e) { if (!(d === TODAY && featured && e.id === featured.id)) evRow(root, e); });
    });
    var later = EVENTS.filter(function (e) { return firstDay(e) > tomorrow; }).length;
    if (later || SEASON.length) root.appendChild(el('p', 'meta', 'Plus tard : ' + later + ' sorties cette semaine, sur la carte' + (SEASON.length ? ', et ' + SEASON.length + ' rendez-vous de Noël (couche Noël).' : '.')));
  }

  // ── Collection ──
  // Collection look: badges, chosen on 22/11 over the cards of 21/11 (kept in tile() for now).
  function dexView() { return 'badges'; }
  var RING = { 'peu commun': '#b9bec4', rare: '#d4a72c', 'légendaire': '#d4a72c' };
  function tile(o) {
    // o: { bg, fg, icon (node), label, locked, rarity, dark, tag }
    var badge = dexView() === 'badges', c = el(o.tag || 'button', (badge ? 'mtile' : 'card') + (o.locked ? ' locked' : '') + (o.dark ? ' dark' : ''));
    if (c.tagName === 'BUTTON') c.type = 'button';
    if (badge) {
      var m = el('span', 'medal'); m.style.background = o.bg; m.style.color = o.fg; if (!o.locked && RING[o.rarity]) m.style.setProperty('--ring', RING[o.rarity]);
      m.appendChild(o.icon); c.appendChild(m);
    } else { c.style.background = o.bg; c.style.color = o.fg; c.appendChild(o.icon); }
    c.appendChild(el('small', null, o.label));
    return c;
  }
  function gridEl() { return el('div', 'cards' + (dexView() === 'badges' ? ' medals' : '')); }
  function renderDex() {
    var root = $('dex'); root.textContent = '';
    var n = Object.keys(st.spots).length;
    root.appendChild(el('h2', null, 'Collection · ' + n + ' / ' + SPOTS.length + ' lieux'));
    var ev = Object.keys(st.events);
    var box = el('div', 'set'); var h0 = el('h3'); h0.appendChild(el('span', null, '★ Cartes souvenirs')); h0.appendChild(el('span', null, String(ev.length))); box.appendChild(h0);
    if (!ev.length) box.appendChild(el('p', 'meta', 'Allez à une sortie de l’agenda, le jour même : vous gagnez sa carte souvenir, avec la date. Une fois l’événement passé, cette carte ne se gagne plus.'));
    else {
      var g = gridEl();
      ev.forEach(function (id) { var e = byId(id); if (!e) return; g.appendChild(tile({ tag: 'div', bg: cat(e)[1], fg: '#fff', icon: ico(e.season ? 'xmas' : cat(e)[0]), label: e.title })); });
      box.appendChild(g);
    }
    root.appendChild(box);
    Object.keys(SETS).forEach(function (s) {
      var all = SPOTS.filter(function (p) { return p.set === s; }), got = all.filter(function (p) { return st.spots[p.id]; }).length;
      var bx = el('div', 'set'), h = el('h3'); h.appendChild(el('span', null, SETS[s])); h.appendChild(el('span', null, got + '/' + all.length));
      bx.appendChild(h);
      var pr = el('div', 'prog'), pi = el('i'); pi.style.width = Math.round(100 * got / all.length) + '%'; pr.appendChild(pi); bx.appendChild(pr);
      var grid = gridEl();
      all.forEach(function (p) {
        /* locked: the same icon, greyed (21/11) */
        var c = tile({ bg: tint(SETCOL[s]), fg: SETCOL[s], icon: ico(p.icon), label: p.name, locked: !st.spots[p.id], rarity: p.rarity });
        c.onclick = function () { tab('map'); map.setView([p.lat, p.lng], 15); openSpot(p); };
        grid.appendChild(c);
      });
      bx.appendChild(grid); root.appendChild(bx);
    });
    invaderBox(root);
  }

  // ── Invader mosaics: on the map at street level, found by GPS or on one's honour ──
  var INV_XP = 15, INV_RADIUS = 100;
  function invGot(m) { return st.invaders && st.invaders[m.id] && st.invaders[m.id].how; }
  function invaderBox(root) {
    var got = INVADERS.filter(invGot).length;
    var bx = el('div', 'set'), h = el('h3'); h.appendChild(el('span', null, 'Les Space Invaders')); h.appendChild(el('span', null, got + '/' + INVADER_TOTAL));
    bx.appendChild(h);
    bx.appendChild(el('p', 'meta', INVADER_TOTAL + ' mosaïques posées par Invader en 2023 autour de Fontainebleau. La carte montre la rue, pas le mur : à vous de lever les yeux.'));
    var grid = gridEl();
    INVADERS.forEach(function (m) {
      var on = invGot(m), q = el('span', null, '?');
      var c = tile({ bg: '#2b2d42', fg: '#fff', icon: on ? ico('invader') : q, label: on ? m.name : m.street, locked: !on, dark: on });
      c.onclick = function () { tab('map'); map.setView([m.lat, m.lng], 17); openInvader(m); }; grid.appendChild(c);
    });
    var more = tile({ tag: 'div', bg: '#eeeae3', fg: '#8a8f8b', icon: el('span', null, '+' + (INVADER_TOTAL - INVADERS.length)), label: 'à relever', locked: true });
    grid.appendChild(more); bx.appendChild(grid);
    bx.appendChild(el('div', 'todo', 'Maquette : les 4 mosaïques du parcours à pied du centre-ville. Les autres viendront du relevé du chef de projet (rue et description), et l’état de chacune (détruite ou non) se vérifie sur place.'));
    root.appendChild(bx);
  }
  function openInvader(m) {
    firstStep();
    sheet.textContent = '';
    var on = invGot(m);
    sheet.appendChild(header(on ? '#2b2d42' : '#8a8f8b', 'invader', 'street art', '#2b2d42'));
    var b = el('div', 'body');
    b.appendChild(el('h2', null, on ? m.name : 'Une mosaïque d’Invader'));
    b.appendChild(el('p', 'meta', m.street + ' · ' + INV_XP + ' XP' + (me ? ' · à ' + fmtDist(dist(me, m)) : '')));
    if (!on) b.appendChild(el('p', null, 'Quelque part ' + (/^place/.test(m.street) ? 'sur la ' : 'dans la ') + m.street + ', en hauteur. Trouvez-la pour découvrir son nom.'));
    b.appendChild(el('div', 'todo', 'Pas de photo : l’œuvre est à Invader. Position de la rue (BAN), d’après le parcours à pied du centre-ville.'));
    if (on) b.appendChild(el('div', 'got-banner', '✓ Dans votre collection — ' + (on === 'gps' ? 'trouvée sur place (GPS)' : 'sur l’honneur')));
    else {
      var acts = el('div', 'acts');
      var gps = el('button', 'btn', 'Je l’ai trouvée (GPS, ' + INV_RADIUS + ' m)'); gps.type = 'button';
      gps.onclick = function () { if (!me || dist(me, m) > INV_RADIUS) setMe(m.lat, m.lng); claimInvader(m, 'gps'); };
      var hon = el('button', 'btn alt', 'Je l’ai vue (sur l’honneur, +' + half(INV_XP) + ' XP)'); hon.type = 'button';
      hon.onclick = function () { claimInvader(m, 'honneur'); };
      acts.appendChild(gps); acts.appendChild(hon); b.appendChild(acts);
    }
    sheet.appendChild(b); sheet.classList.add('on');
  }
  function claimInvader(m, how) {
    st.invaders = st.invaders || {}; st.invaders[m.id] = { d: TODAY, how: how }; save();
    gain(how === 'honneur' ? half(INV_XP) : INV_XP, 'mosaïque trouvée'); draw(); renderAll(); openInvader(m);
  }

  // ── Quests ──
  // 22/11: each quest has a medal (the line icon in a tinted circle, like the collection and the
  // profile) instead of an emoji; the event of the day in gold, not the live red ("trop flashy").
  function renderQuests() {
    var root = $('quests'); root.textContent = '';
    var has = function (ids) { return ids.filter(function (i) { return st.spots[i]; }).length; };
    var ofSet = function (s) { return SPOTS.filter(function (p) { return p.set === s; }).map(function (p) { return p.id; }); };
    var evN = Object.keys(st.events).length;
    var cats = {}; Object.keys(st.events).forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    if (st.team) {
      root.appendChild(el('h2', null, 'Équipe ' + st.team));
      var t = el('div'); [['Vous', st.xp], ['Équipe B', 640], ['Équipe C', 410]].sort(function (a, b) { return b[1] - a[1]; }).forEach(function (r, i) { t.appendChild(el('p', 'meta', (i + 1) + '. ' + r[0] + ' — ' + r[1] + ' XP')); });
      t.appendChild(el('div', 'todo', 'Le mode équipe demande un serveur (classement partagé) : M3, produit vendu aux séminaires, écoles et hôtels.'));
      quest(root, ['team', '#4a5bb8'], 'Classement de la session (maquette)', [], '', 0, 0, t);
    }
    root.appendChild(el('h2', null, 'Cette semaine'));
    var fx = null;
    if (featured) { fx = el('button', 'btn gold', 'Voir l’événement du jour'); fx.type = 'button'; fx.onclick = function () { tab('map'); map.setView([featured.lat, featured.lng], 15); openEvent(featured); }; }
    quest(root, ['star', '#b8860b'], 'L’événement du jour', ['+' + FEATURED_XP + ' XP', 'Change chaque jour'], featured ? featured.title + ' — ' + featured.place : 'Pas d’événement aujourd’hui à moins de 12 km.', featured && st.events[featured.id] ? 1 : 0, 1, fx, true);
    quest(root, ['calendar', '#4a5bb8'], 'La quête de la semaine', ['Annoncée le jeudi', '+40 XP'], 'Passez à deux sorties de l’agenda d’ici dimanche (' + EVENTS.length + ' sur la carte).', evN, 2);
    quest(root, ['mask', '#b8707d'], 'Quatre genres de sorties', ['+' + ALL_CATS_XP + ' XP', 'Badge'], 'Allez à quatre sorties de l’agenda, une de chaque genre : un spectacle, un atelier ou une expo, une sortie nature, une activité sportive.', Object.keys(cats).length, 4);
    root.appendChild(el('h2', null, 'Toujours là'));
    var filsDone = FILS.filter(function (fl) { return st.sets['fil-' + fl.id]; }).length;
    var head = el('div', 'fils-head');
    head.appendChild(el('p', null, 'Cinq fils, dans l’ordre de l’histoire. Chaque fil relie des lieux : collectez-les et répondez à leur question, dans l’ordre que vous voulez. Un fil complet rapporte +' + FIL_XP + ' XP et son badge.'));
    var hp = el('div', 'prog'), hi = el('i'); hi.style.width = Math.round(100 * filsDone / FILS.length) + '%'; hp.appendChild(hi); head.appendChild(hp);
    head.appendChild(el('span', 'meta', filsDone + ' / ' + FILS.length + ' fils complets'));
    quest(root, ['book', SETCOL.napoleon], 'Les fils de l’histoire', ['Quête principale', '5 fils'], '', 0, 0, head);
    FILS.forEach(function (fl, k) {
      var list = el('div', 'fsteps');
      fl.steps.forEach(function (id) {
        var p = SPOTS.filter(function (x) { return x.id === id; })[0]; if (!p) return;
        var got = st.spots[id], done = filStep(id);
        var row = el('button', 'fstep' + (done ? ' done' : got ? ' half' : '')); row.type = 'button';
        var c = el('span', 'fdot'); c.appendChild(ico(done ? 'check' : p.icon)); row.appendChild(c);
        var tx = el('span', 'ftx'); tx.appendChild(el('b', null, p.name));
        tx.appendChild(el('small', null, done ? 'collecté, question résolue' : got ? 'collecté : reste la question' : (p.q ? 'à collecter, avec sa question' : 'à collecter')));
        row.appendChild(tx);
        row.onclick = function () { tab('map'); map.setView([p.lat, p.lng], 15); openSpot(p); };
        list.appendChild(row);
      });
      if (fl.todo) list.appendChild(el('p', 'ftodo', fl.todo));
      var n = fl.steps.filter(filStep).length;
      quest(root, [fl.icon, fl.color], (k + 1) + '. ' + fl.name, fl.steps.length ? [fl.steps.length + ' étapes', '+' + FIL_XP + ' XP'] : ['À écrire'], fl.intro, n, fl.steps.length, list);
    });
    var cl = el('div'); SPOTS.filter(function (p) { return p.set === 'grimpe'; }).forEach(function (p) { cl.appendChild(el('p', 'meta', (st.spots[p.id] ? '✓ ' : '○ ') + p.name)); });
    quest(root, ['climb', SETCOL.grimpe], '5 Must Climb, en famille', ['Défi', 'Tous niveaux', '+60 XP la série'], 'Cinq sites de bloc à découvrir en famille : venir, essayer les premiers blocs, à son niveau. Aucune cotation exigée.', has(ofSet('grimpe')), 5, cl);
    root.appendChild(el('h2', null, 'De saison'));
    quest(root, ['xmas', '#b3261e'], 'Les marchés de Noël', ['Saison', 'Nov.-déc.', '+5 XP par sortie'], 'Deux marchés ou rendez-vous de Noël (' + SEASON.length + ' sur la carte, couche Noël).', Object.keys(st.events).filter(function (id) { var e = byId(id); return e && e.season; }).length, 2);
    var adv = el('a', null, 'Le calendrier de l’Avent du site'); adv.href = 'https://fontainebleaulive.fr/calendrier-de-l-avent/'; adv.target = '_blank'; adv.rel = 'noopener';
    quest(root, ['gift', '#b8860b'], 'Une case par jour', ['Décembre'], 'Le calendrier de l’Avent devient une quête : chaque case ouverte rapporte un peu d’XP.', 0, 0, adv);
    var eco = el('button', 'btn soft', st.eco ? '✓ Fait' : 'J’ai ramassé un déchet'); eco.type = 'button'; eco.disabled = st.eco;
    eco.onclick = function () { st.eco = true; save(); gain(ECO_XP, 'éco-geste'); renderAll(); };
    quest(root, ['leaf', SETCOL.foret], 'Éco-geste', ['Badge', 'Sur l’honneur', 'Toute l’année'], 'Ramasser un déchet en forêt et le rapporter (idée reprise de Tèrra Aventura).', st.eco ? 1 : 0, 1, eco);
    quest(root, ['stag', SETCOL.chateau], 'Le brame', ['Revient en septembre'], 'Écouter le brame depuis un point d’écoute autorisé, en silence. Quête de saison.', 0, 0);
    quest(root, ['mushroom', '#b8707d'], 'Les champignons', ['Revient en octobre'], 'Une sortie mycologique de l’agenda. Jamais de cueillette conseillée par le jeu.', 0, 0);
  }
  function quest(root, icon, title, tags, text, done, total, extra, hot) {
    var q = el('div', 'quest' + (hot ? ' hot' : ''));
    var m = el('span', 'qmedal'); m.style.background = tint(icon[1]); m.style.color = icon[1]; m.style.borderColor = icon[1]; m.appendChild(ico(icon[0])); q.appendChild(m);
    var bx = el('div', 'qbody'); bx.appendChild(el('b', null, title)); if (tags.length) bx.appendChild(el('br'));
    tags.forEach(function (t) { bx.appendChild(el('span', 'tag', t)); });
    if (text) bx.appendChild(el('p', null, text));
    if (total) { var pr = el('div', 'prog'), pi = el('i'); pi.style.width = Math.round(100 * Math.min(done, total) / total) + '%'; pr.appendChild(pi); bx.appendChild(pr); bx.appendChild(el('span', 'meta', Math.min(done, total) + ' / ' + total)); }
    q.appendChild(bx);
    if (extra) { var ex = el('div', 'qextra'); ex.appendChild(extra); q.appendChild(ex); }
    root.appendChild(q);
  }



  // ── Profile: account and (future) shop ──
  function renderMe() {
    var root = $('me'); root.textContent = '';
    var n = levelOf(st.xp);
    root.appendChild(el('h2', null, titleOf(n) + ' · niveau ' + n));
    var stats = el('div', 'stats');
    [[Object.keys(st.spots).length, 'lieux'], [Object.keys(st.events).length, 'souvenirs'], [st.xp, 'XP']].forEach(function (x) { var s = el('div', 'stat'); s.appendChild(el('b', null, String(x[0]))); s.appendChild(document.createTextNode(x[1])); stats.appendChild(s); });
    root.appendChild(stats);
    // 22/11: the achievements as medals, like the collection, each with its target (« 1/2 ») and a
    // progress ring. A set badge counts the set's places directly (Napoléon has two, the painters
    // one: below the set bonus's three, still a badge).
    root.appendChild(el('h2', null, 'Badges'));
    var bs = el('div', 'cards medals');
    function inSet(s) { var all = SPOTS.filter(function (p) { return p.set === s; }); return [all.filter(function (p) { return st.spots[p.id]; }).length, all.length]; }
    var evIds = Object.keys(st.events), cats = {};
    evIds.forEach(function (id) { if (st.events[id].cat) cats[st.events[id].cat] = 1; });
    var noel = evIds.filter(function (id) { var e = byId(id); return e && e.season; }).length;
    [['castle', 'Napoléon', inSet('napoleon'), SETCOL.napoleon],
      ['tree', 'Sentiers bleus', inSet('denecourt'), SETCOL.denecourt],
      ['palette', 'Peintres', inSet('peintres'), SETCOL.peintres],
      ['star', '1er souvenir', [Math.min(evIds.length, 1), 1], '#b8860b'],
      ['mask', '4 genres', [Object.keys(cats).length, 4], '#b8707d'],
      ['leaf', 'Éco-geste', [st.eco ? 1 : 0, 1], SETCOL.foret],
      ['climb', '5 Must Climb', inSet('grimpe'), SETCOL.grimpe],
      ['xmas', 'Noël', [Math.min(noel, 2), 2], '#b3261e']]
      .forEach(function (x) {
        var got = x[2][0], need = x[2][1], done = got >= need, c = el('div', 'mtile pmedal' + (done ? '' : ' locked'));
        var ring = el('span', 'pring'); ring.style.background = 'conic-gradient(' + x[3] + ' ' + Math.round(360 * got / need) + 'deg, #e4e1da 0)';
        var m = el('span', 'medal'); m.style.background = tint(x[3]); m.style.color = x[3]; m.appendChild(ico(x[0])); ring.appendChild(m); c.appendChild(ring);
        c.appendChild(el('small', null, x[1]));
        c.appendChild(el('span', 'target' + (done ? ' done' : ''), done ? '✓ obtenu' : got + ' / ' + need));
        bs.appendChild(c);
      });
    root.appendChild(bs);
    root.appendChild(el('h2', null, 'Titres'));
    var tl = el('div', 'titles');
    TITLES.forEach(function (t) {
      var on = n >= t[0], row = el('div', 'trow' + (on ? ' on' : '')), circ = el('span', 'tcirc');
      circ.appendChild(ico(on ? 'check' : 'lock')); row.appendChild(circ);
      var tx = el('span', 'ttx'); tx.appendChild(el('b', null, t[1])); tx.appendChild(el('small', null, 'niveau ' + t[0])); row.appendChild(tx);
      tl.appendChild(row);
    });
    root.appendChild(tl);

    root.appendChild(el('h2', null, 'Ma sauvegarde'));
    var acc = el('div', 'set');
    acc.appendChild(el('p', null, 'Sans compte : tout reste sur ce téléphone, votre position aussi.'));
    var code = el('button', 'btn soft', '🔑 Copier mon code de sauvegarde'); code.type = 'button'; code.onclick = function () { toast('Maquette : un code ou un QR à scanner sur le nouveau téléphone'); };
    acc.appendChild(code);
    // 22/11: the e-mail and the account, offered here, both optional. Mock: nothing is sent or
    // stored, the address stays in the field.
    acc.appendChild(el('h3', 'acc-h', 'Votre e-mail (facultatif)'));
    var mail = el('input', 'acc-mail'); mail.type = 'email'; mail.placeholder = 'prenom@exemple.fr'; mail.autocomplete = 'email'; acc.appendChild(mail);
    var okMail = function () { var v = mail.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Une adresse e-mail, par exemple prenom@exemple.fr'); mail.focus(); return ''; } return v; };
    var arow = el('div', 'acc-acts');
    var send = el('button', 'btn alt', '✉️ M’envoyer mon code'); send.type = 'button';
    send.onclick = function () { if (okMail()) toast('Maquette : votre code de sauvegarde partirait à cette adresse'); };
    var create = el('button', 'btn', 'Créer mon compte'); create.type = 'button';
    create.onclick = function () { if (okMail()) toast('Maquette : un lien de connexion partirait à cette adresse, sans mot de passe'); };
    arow.appendChild(send); arow.appendChild(create); acc.appendChild(arow);
    acc.appendChild(el('p', 'meta', 'Le compte sert à changer de téléphone, jouer en équipe, retrouver ses achats. Sans mot de passe : un lien arrive par e-mail. Votre adresse n’est jamais revendue ni partagée.'));
    root.appendChild(acc);

  }

  // ── Shop: in the bottom bar (21/11); what it sells is for a dedicated session ──
  function renderShop() {
    var root = $('shop'); root.textContent = '';
    root.appendChild(el('h2', null, '🛍️ Boutique'));
    root.appendChild(el('div', 'todo', 'Contenu à définir avec le chef de projet, en séance dédiée (21/11 : les offres de la v2 ne correspondaient pas à son idée). Règle gardée : ce qui s’achète ne donne jamais d’XP, de lieu ni d’événement.'));
  }

  // ── Entry flow (onboarding) ──
  // 21/11 feedback: no "what attracts you" screen (everything is offered to everyone), no account
  // screen (play without one; the save code lives in the profile), an "a bit of everything" choice,
  // and no imposed first quest (out of context): the flow ends on the map, around the player.
  var onb = $('onb'), step = 0, draft = null;
  var STEPS = ['welcome', 'profile', 'geo'];
  var PROFILES = [['weekend', '🧳', 'Je viens pour un week-end', 'Le meilleur en deux jours'], ['local', '🏡', 'J’habite dans le coin', 'Tout collectionner, à son rythme'],
    ['etudiant', '🎓', 'J’étudie ici', 'INSEAD, écoles, campus'], ['groupe', '👥', 'Je viens en groupe', 'Séminaire, hôtel, classe : avec un code'],
    ['tout', '✨', 'Un peu de tout', 'Plusieurs à la fois, ou je préfère ne pas répondre']];
  function choice(icon, title, sub, pressed, onclick, disabled) {
    var c = el('button', 'choice'); c.type = 'button'; c.setAttribute('aria-pressed', !!pressed); c.disabled = !!disabled;
    c.appendChild(el('span', null, icon)); var t = el('div'); t.appendChild(el('b', null, title)); if (sub) t.appendChild(el('small', null, sub)); c.appendChild(t);
    c.onclick = onclick; return c;
  }
  function renderOnb() {
    onb.textContent = '';
    var N = STEPS.length, last = N - 1, s = STEPS[step], dots = el('div', 'dots');
    for (var i = 0; i < N; i++) dots.appendChild(el('i', i === step ? 'on' : ''));
    onb.appendChild(dots);
    if (step > 0 && step < last) { var sk = el('button', 'skip', 'Passer'); sk.type = 'button'; sk.onclick = function () { step = last; renderOnb(); }; onb.appendChild(sk); }
    var inn = el('div', 'in'), foot = el('div', 'foot');
    function next(label, enabled, fn) { var b = el('button', 'btn', label); b.type = 'button'; b.disabled = enabled === false; b.onclick = fn || function () { step++; renderOnb(); }; foot.appendChild(b); return b; }
    if (s === 'welcome') {
      var hero = el('div', 'hero', '🗺️'); hero.appendChild(el('b', null, 'Fontainebleau Live Collection')); hero.appendChild(el('small', null, 'Fontainebleau se collectionne')); inn.appendChild(hero);
      [['📍', 'Explorez le château, la ville et la forêt'], ['🃏', 'Collectionnez les lieux, leurs histoires, leurs séries'], ['🔴', 'Vivez les événements du jour : ils rapportent le plus']]
        .forEach(function (f) { var r = el('div', 'feat'); r.appendChild(el('span', null, f[0])); r.appendChild(el('div', null, f[1])); inn.appendChild(r); });
      inn.appendChild(el('p', 'meta', 'Gratuit.'));
      next('Commencer');
    } else if (s === 'profile') {
      inn.appendChild(el('h1', null, 'Vous venez…'));
      PROFILES.forEach(function (p) { inn.appendChild(choice(p[1], p[2], p[3], draft.profile === p[0], function () { draft.profile = p[0]; renderOnb(); })); });
      if (draft.profile === 'groupe') {
        inn.appendChild(el('p', 'meta', 'Code donné par l’organisateur (facultatif) :'));
        var inp = el('input'); inp.placeholder = 'ex. SEMINAIRE-24'; inp.value = draft.team; inp.oninput = function () { draft.team = inp.value.trim().slice(0, 20).toUpperCase(); }; inn.appendChild(inp);
      }
      foot.appendChild(el('p', 'meta why', 'Votre réponse sert seulement à choisir votre première quête. Tout le jeu reste ouvert.'));
      next('Continuer', !!draft.profile);
    } else if (s === 'geo') {
      inn.appendChild(el('div', 'hero', '📍'));
      inn.appendChild(el('h1', null, 'Votre position reste sur ce téléphone'));
      inn.appendChild(el('p', 'lead', 'Elle sert seulement à vérifier que vous êtes devant un lieu. Elle n’est jamais envoyée ni enregistrée ailleurs.'));
      inn.appendChild(el('p', 'meta', 'Sans elle, on joue quand même : une question d’observation sur place, ou sur l’honneur.'));
      next('Autoriser la position', true, function () { draft.geo = 'oui'; setMe(48.40195, 2.69905); finishOnb(); });
      var later = el('button', 'btn soft', 'Plus tard'); later.type = 'button'; later.onclick = function () { draft.geo = 'non'; finishOnb(); }; foot.appendChild(later);
    }
    onb.appendChild(inn); onb.appendChild(foot);
  }
  function finishOnb() {
    st.onboarded = true; st.profile = draft.profile || 'tout'; st.likes = []; st.team = draft.profile === 'groupe' ? draft.team : ''; st.geo = draft.geo || '';
    save(); onb.classList.remove('on'); tab('map'); renderAll();
    if (me) map.setView([me.lat, me.lng], 15); else map.setView([48.404, 2.698], 14);
    // 21/11 feedback: no XP and no level-up when the map appears (it hid the map); a small bonus at
    // the first tap on a place or an event instead, below the level 2 threshold (60 XP).
    setTimeout(function () { toast(me ? 'Touchez un lieu près de vous pour commencer' : 'Touchez un lieu pour commencer'); }, 1200);
  }
  function openOnb() { step = 0; draft = { profile: '', team: '', geo: '' }; renderOnb(); onb.classList.add('on'); }
  $('replay').onclick = openOnb;

  function renderAll() { renderLive(); renderDex(); renderQuests(); renderMe(); renderShop(); hud(); }
  function tab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.toggle('on', s.id === 's-' + name); });
    closeSheet(); $('lpanel').classList.remove('on');
    if (name === 'map') setTimeout(function () { map.invalidateSize(); }, 50);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { tab(b.getAttribute('data-tab')); }; });
  $('mebtn').onclick = function () { tab('me'); };
  $('reset').onclick = function () { st = fresh(); save(); if (meMarker) { map.removeLayer(meMarker); meMarker = null; me = null; } refreshRange(); liveBar(); draw(); renderAll(); closeSheet(); openOnb(); };

  chrome(); panel(); liveBar(); draw(); renderAll();
  if (!st.onboarded && location.hash !== '#carte') openOnb();
  var QT = /[?&]onglet=([a-z]+)/.exec(location.search); if (QT) tab(QT[1]); // ?onglet=dex for screenshots ; ?lieu=<id> opens a sheet, &gps=1 collects it first (screenshots)
  var QL = /[?&]lieu=([a-z-]+)/.exec(location.search), QP = QL && SPOTS.filter(function (x) { return x.id === QL[1]; })[0];
  if (QP) { if (/[?&]gps=1/.test(location.search)) { setMe(QP.lat, QP.lng); unlock(QP, 'gps'); } else openSpot(QP); } // #carte: straight to the map (screenshots)
})();
`;

// Serves the mock-up and vendor/ only, on the loopback interface.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(open) {
  const allowed = [OUT, path.join(ROOT, 'vendor')].map((d) => d + path.sep);
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { rel = '/'; }
    if (rel === '/') { res.writeHead(302, { Location: '/reports/bleau-quest/maquette.html' }); return res.end(); }
    const file = path.normalize(path.join(ROOT, rel));
    if (!allowed.some((d) => file.startsWith(d)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} déjà pris : relancez avec PORT=8518 node scripts/bleau-quest-mock.js` : e.message);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}/reports/bleau-quest/maquette.html`;
    console.log(`Servie sur ${url} — Ctrl+C pour arrêter`);
    if (open && process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  });
}

// Icon proposals side by side (22/11), at the sizes the game uses: map pin, card, sheet header.
// Fixed markup from bleau-quest-icons.js only, nothing from the data.
function iconPage() {
  const svg = (k) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[k].l + '"/></svg>';
  const cols = ['#4a5bb8', '#0f8f9e', '#9247a0'];
  const rows = PROPOSALS.map((r, i) => '<section><h2>' + r.place + '</h2><div class="row">' + r.icons.map(([k, label]) => {
    const c = cols[i % cols.length];
    return '<figure><div class="trio"><span class="pin" style="background:' + c + '">' + svg(k) + '</span>' +
      '<span class="card" style="color:' + c + ';background:color-mix(in srgb,' + c + ' 14%,#fff)">' + svg(k) + '</span>' +
      '<span class="big">' + svg(k) + '</span></div><figcaption>' + label + '</figcaption></figure>';
  }).join('') + '</div></section>').join('');
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Icônes des lieux</title><style>' +
    'body{margin:0;padding:16px;font:15px/1.4 system-ui,sans-serif;background:#faf8f4;color:#1f2a24}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#5b625d}' +
    'h2{font-size:15px;margin:18px 0 8px}.row{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;background:#fff;border:1px solid #e4dfd6;border-radius:12px;padding:12px;width:150px}' +
    '.trio{display:flex;align-items:center;justify-content:space-between}figcaption{font-size:13px;margin-top:8px}' +
    '.pin{display:inline-flex;width:30px;height:30px;border-radius:50%;color:#fff;align-items:center;justify-content:center}.pin svg{width:17px;height:17px}' +
    '.card{display:inline-flex;width:44px;height:44px;border-radius:10px;align-items:center;justify-content:center}.card svg{width:30px;height:30px}' +
    '.big svg{width:56px;height:56px;color:#1f2a24}</style></head><body><h1>Icônes des lieux</h1>' +
    '<p>Pour chaque icône, de gauche à droite : l’épingle de la carte, la vignette de la collection, l’en-tête de la fiche.</p>' + rows + '</body></html>';
}

function main() {
  const today = process.env.TODAY || G.parisToday();
  const { week, season } = layers(today);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'maquette.html');
  fs.writeFileSync(file, page(today, week, season));
  fs.writeFileSync(path.join(OUT, 'icones.html'), iconPage());
  console.log(`Maquette : ${file} (${SPOTS.length} lieux, ${week.length} événements de la semaine, ${season.length} de Noël)`);
  if (!process.argv.includes('--file')) serve(!process.argv.includes('--no-open'));
}

if (require.main === module) main();
