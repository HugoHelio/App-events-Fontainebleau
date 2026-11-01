'use strict';
/**
 * The walking, cycling and driving guides (items 104 and 104 bis, 01/11): written and walked by
 * the project lead, in his name — that is their value. Hand-written content, never generated:
 * every route, address and time here comes from his PDF sheets (typography aside). Claude does
 * not add a stop or a fact (§5); a correction goes into the PDF and here, the same day.
 *
 * English (`en`, 01/11): the same shape as the French, field by field, swapped in by the FR/EN
 * switch like the weekend pages (data-en). Arrays line up by index with the French ones; a field
 * left out (a step's distance, a total's figures) falls back to the French. Translated from the
 * latest French sheets (01/11). The English PDFs are drawn from this text by scripts/guides-pdf.js:
 * after any change here, run it and commit the PDFs.
 *
 * generate-pages.js renders /balades/ (index, one page per guide, /balades/merci/) from this
 * file. The PDFs and the images live in public/balades/, copied by hand from the project lead's
 * folder (maps reduced to 1 200 px wide for phones).
 *
 * Payment (§7, 01/11): pay what you want, no lock. The PDF is always downloadable for free; a
 * Stripe Payment Link (« the customer chooses the amount », 3 € pre-filled, 2 € minimum) sits
 * next to it. A link stays empty until the project lead has created it: an empty link = the
 * page shows the free download only, and says nothing about payment.
 */

// Stripe Payment Links, one per guide plus the pack. After payment, Stripe redirects to
// https://fontainebleaulive.fr/balades/merci/?fiche=<key> (key = the guide's `key`, or `pack`).
const PAY = {
  'a-pied': '',
  'a-velo': '',
  'en-voiture': '',
  pack: '',
};
const SUGGESTED = { guide: 3, pack: 6 };

const OSM = '© les contributeurs d’OpenStreetMap';

const GUIDES = [
  {
    key: 'a-pied',
    slug: 'fontainebleau-a-pied',
    num: 1,
    mode: 'À pied',
    title: 'Fontainebleau à pied',
    subtitle: 'Balade en famille au cœur de la ville impériale',
    subtitle2: 'Les 9 étapes, pas à pas',
    description: 'Une balade de 3 h dans Fontainebleau, en famille : le château, le parc, la place Napoléon, les rues commerçantes, le marché et le défi des petits explorateurs. Le parcours personnel d’un Bellifontain, fiche PDF à prix libre.',
    pdf: '/public/balades/fontainebleau-a-pied.pdf',
    pdfEn: '/public/balades/fontainebleau-a-pied-en.pdf',
    checked: 'oct. 2026',
    towns: ['fontainebleau'],
    facts: [['Départ', 'Parking du château'], ['Durée', '3 h'], ['Distance', '≈ 3 à 4 km'], ['Niveau', 'Facile, en ville'], ['Pour qui', 'Toute la famille']],
    why: 'Installé à Fontainebleau depuis plusieurs années, j’aime faire découvrir notre joyau à chaque visiteur qui vient nous voir. Cette balade nous permet de parcourir en 3 h les plus beaux monuments de Fontainebleau. Le moment préféré des enfants est le cache-cache dans les labyrinthes de buis du jardin à la française.',
    before: [
      'Château : cours et parc en accès libre.',
      'Version courte (2 h) : sautez le jardin anglais, traversez le parterre en ligne droite et coupez le jardin de Diane.',
      'Poussette : allées gravillonnées dans le parc.',
      'Pause : petite aire de jeux place de la République.',
      'Les horaires du parc du château changent selon la saison.',
    ],
    overview: {
      head: ['Étape', 'Durée'],
      rows: [
        ['1. Départ : fresque & rue de Ferrare', '10 min'],
        ['2. Château : cours & Étang des Carpes', '30 min'],
        ['3. Parc & Grand Parterre', '40 min'],
        ['4. Place Napoléon-Bonaparte', '10 min'],
        ['5. Théâtre municipal', '5 min'],
        ['6. Rues de Ferrare & des Sablons', '30 min'],
        ['7. Place de la République', '20 min'],
        ['8. Église Saint-Louis', '15 min'],
        ['9. Hôtel de ville & glaces', '20 min'],
      ],
      total: ['Total indicatif', '3 h'],
    },
    routes: [
      {
        title: 'Les 9 étapes, pas à pas',
        map: { src: '/public/balades/img/a-pied-carte.jpg', w: 1200, h: 1457, alt: 'Carte du parcours à pied dans Fontainebleau, du parking du château aux 9 étapes numérotées' },
        steps: [
          { k: '1', title: 'Le départ', sub: 'Parking du Château (Interparking) · 10 min', items: [
            'Du parking du Château, prenez la rue de Ferrare.',
            'Admirez la grande fresque représentant Napoléon, puis la porte de l’hôtel du Grand Ferrare.',
            'Traversez la place du Général-de-Gaulle jusqu’à l’entrée principale du château.',
          ] },
          { k: '2', title: 'Le Château de Fontainebleau', sub: 'Cour d’honneur / cour du Cheval blanc · 30 min', items: [
            'Entrez par la cour d’honneur et admirez le célèbre escalier en fer à cheval.',
            'Rejoignez la cour de la Fontaine et observez les poissons de l’Étang des Carpes.',
            'Rejoignez le jardin anglais (ou pas si vous êtes pressés).',
          ], notes: [['wc', 'dans l’enceinte du château, cour d’honneur.']],
          img: { src: '/public/balades/img/a-pied-chateau.jpg', w: 1024, h: 873, alt: 'Illustration : une famille devant le château de Fontainebleau' } },
          { k: '3', title: 'Le parc du château', sub: 'Grand Parterre · 40 min', items: [
            'Flânez dans les jardins à la française et leurs parterres dessinés par André Le Nôtre.',
            'Ressortez par le jardin de Diane.',
          ], notes: [['option', 'promenez-vous dans les trois jardins (≈ +60 min).'], ['astuce', 'cache-cache dans les petits labyrinthes de buis.']] },
          { k: '4', title: 'Place Napoléon-Bonaparte', sub: 'Le carrousel · 10 min', items: [
            'Découvrez la place et son carrousel, apprécié des enfants.',
            'Admirez l’hôtel de l’Aigle Noir, demeure du XVIe siècle (ancien hôtel de Retz), rebaptisée L’Aigle Noir sous l’Empire.',
          ], img: { src: '/public/balades/img/a-pied-carrousel.jpg', w: 1024, h: 654, alt: 'Illustration : des enfants devant le carrousel de la place Napoléon-Bonaparte' } },
          { k: '5', title: 'Le Théâtre municipal', sub: '6 rue Dénecourt · 5 min', items: [
            'Rejoignez le théâtre municipal : commencé en 1905 et inauguré en 1912, de style Louis XIII en brique et pierre.',
          ] },
          { k: '6', title: 'Les rues commerçantes', sub: 'Rue de Ferrare & rue des Sablons · 30 min', items: [
            'Du théâtre, prenez la rue Richelieu et remontez vers la rue de Ferrare, puis à droite la rue des Sablons.',
            'Remontez-la tranquillement jusqu’à la place de la République, en passant devant le Théâtre de l’Âne Vert.',
            'Admirez les devantures : boucheries, fleuristes, poissonnerie…',
          ] },
          { k: '7', title: 'Place de la République', sub: 'Cœur de ville · 20 min', items: [
            'Les mardis, vendredis et dimanches matin, c’est jour de marché (7 h – 13 h).',
            'Flânez dans les librairies de la place : livres sur la ville.',
            'Poussez la porte de l’Office de tourisme (entrée sur la place).',
          ], notes: [['astuce', 'un petit parc de jeux attend les plus jeunes.']] },
          { k: '8', title: 'Église Saint-Louis', sub: 'Rue de la Paroisse · 15 min', items: [
            'Descendez la rue de la Paroisse jusqu’à l’église Saint-Louis, joyau du XVIIe siècle bâti sous Louis XIII.',
          ], notes: [['wc', '2 rue de la Paroisse, entre la place de la République et l’église.']] },
          { k: '9', title: 'Hôtel de ville & douceurs', sub: '44 rue Grande · 20 min', items: [
            'Prenez la rue Grande vers le château et passez devant la mairie, reconstruite sous le Second Empire en 1864.',
            'Au niveau de la place de l’Étape, trouvez le passage secret !',
            'Retour vers le parking du château par la rue de France puis par la rue de Ferrare.',
          ], notes: [['astuce', 'un petit passage remonte de la rue Grande vers la rue du Conventionnel-Geoffroy et la rue des Trois-Maillets… où vous attendent d’excellentes glaces.']] },
        ],
        game: {
          title: 'Le défi des petits explorateurs',
          intro: 'Cochez chaque trésor repéré pendant la balade. Tout trouvé ? Vous avez mérité votre glace !',
          items: ['La fresque de Napoléon', 'L’escalier en fer à cheval', 'Une carpe dans l’étang', 'Un labyrinthe de buis', 'Le carrousel', 'Le théâtre municipal', 'Le Théâtre de l’Âne Vert', 'Un étal du marché', 'Un livre sur le château', 'Les vitraux de Saint-Louis', 'Le drapeau de la mairie', 'Le passage secret'],
          extra: { title: 'Street art : les mosaïques d’Invader', items: ['Lampe abat-jour (rue Dénecourt)', 'Napoléon et son bicorne (place de la République)', 'Alien rouge et son livre (rue du Conventionnel-Geoffroy)', 'Alien bleu à lunettes (rue des Trois-Maillets)'] },
        },
      },
    ],
    more: {
      title: 'Envie de forêt ? 3 balades de 2 h au départ de la ville',
      items: [
        ['Faisanderie & Mont Aigu', 'Départ : parking de la Faisanderie.'],
        ['Croix du Calvaire & Tour Dénecourt', 'Départ : gare de Fontainebleau-Avon.'],
        ['Mont Ussy & route tournante des hauteurs de la Solle', 'Départ : parking du Mont Ussy.'],
      ],
      note: 'Accès en forêt : certains secteurs peuvent être fermés (incendies de 2026). Vérifiez avant de partir sur onf.fr.',
    },
    teaser: ['3 h · ≈ 3 à 4 km · en ville', '3 h · ≈ 3–4 km · in town'],
    thumb: '/public/balades/img/thumb-a-pied.jpg',
    en: {
      mode: 'On foot',
      title: 'Fontainebleau on foot',
      subtitle: 'A family walk through the heart of the imperial town',
      subtitle2: 'The 9 stops, step by step',
      facts: [['Start', 'Château car park'], ['Duration', '3 h'], ['Distance', '≈ 3–4 km'], ['Level', 'Easy, in town'], ['For', 'All the family']],
      why: 'I have lived in Fontainebleau for several years, and I love showing our gem to everyone who comes to visit. In 3 hours, this walk takes in the finest monuments of Fontainebleau. The children’s favourite moment is hide-and-seek in the little box-hedge mazes of the French formal garden.',
      before: [
        'Château: the courtyards and the park are free to enter.',
        'Short version (2 h): skip the English garden, cross the parterre in a straight line and cut through the Diane garden.',
        'Pushchairs: gravel paths in the park.',
        'Break: a small playground on place de la République.',
        'The château park’s opening hours change with the season.',
      ],
      overview: {
        head: ['Stop', 'Time'],
        rows: [
          ['1. Start: mural & rue de Ferrare', '10 min'],
          ['2. Château: courtyards & Carp Pond', '30 min'],
          ['3. Park & Grand Parterre', '40 min'],
          ['4. Place Napoléon-Bonaparte', '10 min'],
          ['5. Municipal theatre', '5 min'],
          ['6. Rue de Ferrare & rue des Sablons', '30 min'],
          ['7. Place de la République', '20 min'],
          ['8. Saint-Louis church', '15 min'],
          ['9. Town hall & ice cream', '20 min'],
        ],
        total: ['Approximate total', '3 h'],
      },
      routes: [
        {
          title: 'The 9 stops, step by step',
          mapAlt: 'Map of the walk through Fontainebleau, from the château car park to the 9 numbered stops',
          steps: [
            { title: 'The start', sub: 'Château car park (Interparking) · 10 min', items: [
              'From the Château car park, take rue de Ferrare.',
              'Admire the large mural of Napoleon, then the doorway of the Hôtel du Grand Ferrare.',
              'Cross place du Général-de-Gaulle to the château’s main entrance.',
            ] },
            { title: 'The Château de Fontainebleau', sub: 'Cour d’honneur / White Horse Courtyard · 30 min', items: [
              'Enter through the main courtyard and admire the famous horseshoe staircase.',
              'Walk on to the Fountain Courtyard and watch the fish in the Carp Pond (Étang des Carpes).',
              'Carry on to the English garden (or skip it if you are in a hurry).',
            ], notes: ['inside the château grounds, main courtyard.'], imgAlt: 'Illustration: a family in front of the Château de Fontainebleau' },
            { title: 'The château park', sub: 'Grand Parterre · 40 min', items: [
              'Stroll through the French formal gardens and their parterres designed by André Le Nôtre.',
              'Leave through the Diane garden (jardin de Diane).',
            ], notes: ['explore all three gardens (≈ +60 min).', 'hide-and-seek in the little box-hedge mazes.'] },
            { title: 'Place Napoléon-Bonaparte', sub: 'The carousel · 10 min', items: [
              'Discover the square and its carousel, a favourite with children.',
              'Admire the Hôtel de l’Aigle Noir, a 16th-century residence (formerly the Hôtel de Retz), renamed “the Black Eagle” under the Empire.',
            ], imgAlt: 'Illustration: children in front of the carousel on place Napoléon-Bonaparte' },
            { title: 'The municipal theatre', sub: '6 rue Dénecourt · 5 min', items: [
              'Walk on to the municipal theatre: begun in 1905 and opened in 1912, in Louis XIII style, brick and stone.',
            ] },
            { title: 'The shopping streets', sub: 'Rue de Ferrare & rue des Sablons · 30 min', items: [
              'From the theatre, take rue Richelieu up to rue de Ferrare, then turn right into rue des Sablons.',
              'Wander up it to place de la République, past the Théâtre de l’Âne Vert.',
              'Admire the shopfronts: butchers, florists, fishmonger…',
            ] },
            { title: 'Place de la République', sub: 'Town centre · 20 min', items: [
              'On Tuesday, Friday and Sunday mornings it is market day (7 am – 1 pm).',
              'Browse the bookshops on the square: books about the town.',
              'Pop into the tourist office (entrance on the square).',
            ], notes: ['a small playground awaits the youngest.'] },
            { title: 'Saint-Louis church', sub: 'Rue de la Paroisse · 15 min', items: [
              'Walk down rue de la Paroisse to Saint-Louis church, a 17th-century gem built under Louis XIII.',
            ], notes: ['2 rue de la Paroisse, between place de la République and the church.'] },
            { title: 'Town hall & treats', sub: '44 rue Grande · 20 min', items: [
              'Take rue Grande towards the château and pass the town hall, rebuilt under the Second Empire in 1864.',
              'Near place de l’Étape, find the secret passage!',
              'Back to the Château car park along rue de France, then rue de Ferrare.',
            ], notes: ['a little passage climbs from rue Grande to rue du Conventionnel-Geoffroy and rue des Trois-Maillets… where excellent ice cream awaits.'] },
          ],
          game: {
            title: 'The little explorers’ challenge',
            intro: 'Tick off each treasure you spot along the way. Found them all? You’ve earned your ice cream!',
            items: ['Napoleon’s mural', 'The horseshoe staircase', 'A carp in the pond', 'A box-hedge maze', 'The carousel', 'The municipal theatre', 'The Théâtre de l’Âne Vert', 'A market stall', 'A book about the château', 'Saint-Louis’s stained glass', 'The town hall flag', 'The secret passage'],
            extra: { title: 'Street art: Invader’s mosaics', items: ['Lamp with a lampshade (rue Dénecourt)', 'Napoleon in his bicorne (place de la République)', 'Red alien with a book (rue du Conventionnel-Geoffroy)', 'Blue alien with glasses (rue des Trois-Maillets)'] },
          },
        },
      ],
      more: {
        title: 'Fancy the forest? 3 two-hour walks from town',
        items: [
          ['Faisanderie & Mont Aigu', 'Start: Faisanderie car park.'],
          ['Croix du Calvaire & Tour Dénecourt', 'Start: Fontainebleau-Avon station.'],
          ['Mont Ussy & the Route Tournante on the Hauteurs de la Solle', 'Start: Mont Ussy car park.'],
        ],
        note: 'Forest access: some areas may be closed (2026 fires). Check onf.fr before setting off.',
      },
    },
  },
  {
    key: 'a-velo',
    slug: 'fontainebleau-a-velo',
    num: 2,
    mode: 'À vélo',
    title: 'Fontainebleau à vélo',
    subtitle: '3 balades en famille, du parc du château à Barbizon',
    subtitle2: 'Les balades en forêt, section par section',
    description: 'Trois balades à vélo en famille autour de Fontainebleau : le parc du château et le Grand Canal (5 km), la route des Hauteurs de la Solle (15 km), les gorges d’Apremont jusqu’à Barbizon (22 km). Fiche PDF à prix libre.',
    pdf: '/public/balades/fontainebleau-a-velo.pdf',
    pdfEn: '/public/balades/fontainebleau-a-velo-en.pdf',
    checked: 'oct. 2026',
    towns: ['fontainebleau', 'avon', 'barbizon'],
    facts: [['Balades', '45 min · 1 h 30 · 3 h'], ['Distances', '≈ 5 · 15 · 22 km'], ['Revêtement', 'Chemins & routes goudronnées'], ['Niveau', 'Facile à soutenu']],
    why: 'Mes enfants ont appris à faire du vélo à Fontainebleau. Quel plaisir de parcourir la forêt, le nez au vent, dans les feuilles mortes ou les flaques d’eau. Plaisir assuré !',
    before: [
      'Enfants autonomes à vélo.',
      'Accès à la forêt : certains secteurs peuvent être fermés (incendies de 2026). Vérifiez sur onf.fr.',
      'Parc du château : horaires variables selon la saison.',
    ],
    overview: {
      head: ['Balade', 'Départ', 'Distance', 'Durée', 'Niveau'],
      rows: [
        ['1. Le parc du château & le Grand Canal', 'Place d’Armes', '≈ 5 km', '45 min', 'Facile'],
        ['2. La route des Hauteurs de la Solle', 'Route Louis-Philippe', '≈ 15 km', '1 h 30', 'Moyen'],
        ['3. Fontainebleau – Apremont – Barbizon', 'Route Louis-Philippe', '≈ 22 km', '3 h', 'Soutenu'],
      ],
    },
    routes: [
      {
        num: 1,
        title: 'Le parc du château & le Grand Canal',
        sub: 'Départ : place d’Armes · ≈ 5 km · 45 min · allées du parc · facile',
        map: { src: '/public/balades/img/a-velo-1-parc.jpg', w: 1200, h: 976, alt: 'Carte de la balade à vélo dans le parc du château et le long du Grand Canal' },
        steps: [
          { k: 'A', text: 'De la place d’Armes, entrez dans le parc.', dist: '0,2 km', time: '5 min' },
          { k: 'B', text: 'À gauche, descendez l’avenue des Cascades.', dist: '0,8 km', time: '5 min' },
          { k: 'C', text: 'Passez le Grand Canal, longez-le par la droite.', dist: '2,5 km', time: '20 min' },
          { k: 'D', text: 'Revenez par les allées d’Avon, de la Mi-Voie, Lenôtre dans le bois.', dist: '1,0 km', time: '10 min' },
          { k: 'E', text: 'Retour à la place d’Armes.', dist: '0,5 km', time: '5 min' },
        ],
        total: ['Total indicatif', '≈ 5 km', '45 min'],
        notes: [['astuce', 'l’allée en diagonale mène à un parc pour enfants.'], ['attention', 'boueux après la pluie ; horaires du parc variables selon la saison.']],
        game: {
          title: 'Mini-jeu · Les trésors du canal',
          items: ['Un cygne ou un canard', 'Les cascades', 'Les quatre girafes', 'L’aire de jeux'],
          riddles: [['Le Grand Canal a été creusé sous le roi H _ _ _ _ IV.', 'Indice : le roi de la poule au pot.'], ['Le canal mesure 1,2 km : est-il plus long que 10 terrains de foot ?', 'Oui ou non ?']],
          answer: 'Henri IV · oui, environ 11 terrains !',
        },
      },
      {
        num: 2,
        title: 'La route des Hauteurs de la Solle',
        sub: 'Départ : parking route Louis-Philippe (derrière le cimetière) · ≈ 15 km A/R · 1 h 30 · goudronné · moyen',
        map: { src: '/public/balades/img/a-velo-2-solle.jpg', w: 1200, h: 1211, alt: 'Carte de la balade à vélo de la route Louis-Philippe aux Hauteurs de la Solle' },
        steps: [
          { k: 'A', text: 'Montez la route Louis-Philippe : longue montée, aidez les plus jeunes.', dist: '1,5 km', time: '15 min' },
          { k: 'B', text: 'En haut, à droite, la route du Gros Fouteau jusqu’au bout.', dist: '2,0 km', time: '10 min' },
          { k: 'C', text: 'À droite, la route des Hauteurs de la Solle : l’hippodrome apparaît en contrebas, à gauche.', dist: '2,5 km', time: '15 min' },
          { k: 'D', text: 'Continuez jusqu’à la D606 et faites demi-tour.', dist: '1,5 km', time: '10 min' },
          { k: 'E', text: 'Retour par le même chemin, avec la descente en récompense !', dist: '7,5 km', time: '40 min' },
        ],
        total: ['Total indicatif', '≈ 15 km', '1 h 30'],
        notes: [['astuce', 'à chaque point de vue, cherchez les chevaux à l’entraînement.']],
        game: {
          title: 'Mini-jeu · Les sentinelles de la Solle',
          items: ['L’hippodrome', 'Un chêne géant', 'Une marque bleue sur un arbre', 'Un écureuil'],
          riddles: [['Route du G _ _ _ F _ _ _ _ _ _', 'Lisez le panneau en haut de la montée.'], ['Combien de virages sur la route des Hauteurs ?', 'À vous de compter !']],
          answer: 'Gros Fouteau',
        },
      },
      {
        num: 3,
        title: 'Fontainebleau – Gorges d’Apremont – Barbizon',
        sub: 'Départ : parking route Louis-Philippe · ≈ 22 km A/R · 3 h avec les pauses · goudronné · soutenu',
        map: { src: '/public/balades/img/a-velo-3-barbizon.jpg', w: 1200, h: 720, alt: 'Carte de la balade à vélo de la route Louis-Philippe aux gorges d’Apremont et à Barbizon' },
        steps: [
          { k: 'A', text: 'Montez la route Louis-Philippe, à gauche la route Paul jusqu’au tunnel sous la D607.', dist: '2,5 km', time: '20 min' },
          { k: 'B', text: 'Après le tunnel, à droite la route du Bouquet du Roi jusqu’au carrefour des Cépées.', dist: '2,0 km', time: '10 min' },
          { k: 'C', text: 'En face : routes du Château, de Sully puis de la Gorge aux Néfliers. Après le carrefour du Milan, parking à droite et point de vue d’Apremont.', dist: '3,5 km', time: '20 min' },
          { k: 'D', text: 'Légèrement à droite, la route Sully : grande descente jusqu’au parking de l’allée des Vaches.', dist: '2,0 km', time: '10 min' },
          { k: 'E', text: 'À gauche, l’allée des Vaches mène à Barbizon. Retour par la même route.', dist: '1 + 11 km', time: '1 h 15' },
        ],
        total: ['Total vélo (hors pauses)', '≈ 22 km', '2 h 15'],
        notes: [['coeur', 'à pied jusqu’à la caverne des Brigands, départ près du chalet (snacks et boissons en saison).'], ['attention', 'au retour, la grande descente devient une longue montée !']],
        game: {
          title: 'Mini-jeu · La piste des brigands',
          items: ['Le tunnel sous la route', 'Un rocher en forme d’animal', 'Une fougère', 'Le chêne Sully', 'La vue sur les gorges', 'Un atelier de peintre à Barbizon'],
          riddles: [['Carrefour des C _ _ _ _ s', 'Après le tunnel (B).'], ['Carrefour du M _ _ _ _', 'Avant les gorges (C).'], ['Route du B _ _ _ _ _ _ du Roi', 'Juste après le tunnel.']],
          answer: 'Cépées · Milan · Bouquet',
        },
      },
    ],
    teaser: ['3 balades · 5 à 22 km · 45 min à 3 h', '3 rides · 5–22 km · 45 min to 3 h'],
    thumb: '/public/balades/img/thumb-a-velo.jpg',
    en: {
      mode: 'By bike',
      title: 'Fontainebleau by bike',
      subtitle: '3 family rides, from the château park to Barbizon',
      subtitle2: 'The forest rides, section by section',
      facts: [['Rides', '45 min · 1 h 30 · 3 h'], ['Distances', '≈ 5 · 15 · 22 km'], ['Surface', 'Tracks & tarmac roads'], ['Level', 'Easy to demanding']],
      why: 'My children learnt to ride a bike in Fontainebleau. What a joy to ride through the forest, wind in your face, through the dead leaves or the puddles. Fun guaranteed!',
      before: [
        'Children who can ride on their own.',
        'Forest access: some areas may be closed (2026 fires). Check onf.fr.',
        'Château park: opening hours vary with the season.',
      ],
      overview: {
        head: ['Ride', 'Start', 'Distance', 'Time', 'Level'],
        rows: [
          ['1. The château park & the Grand Canal', 'Place d’Armes', '≈ 5 km', '45 min', 'Easy'],
          ['2. The route des Hauteurs de la Solle', 'Route Louis-Philippe', '≈ 15 km', '1 h 30', 'Moderate'],
          ['3. Fontainebleau – Apremont – Barbizon', 'Route Louis-Philippe', '≈ 22 km', '3 h', 'Demanding'],
        ],
      },
      routes: [
        {
          title: 'The château park & the Grand Canal',
          sub: 'Start: place d’Armes · ≈ 5 km · 45 min · park paths · easy',
          mapAlt: 'Map of the bike ride through the château park and along the Grand Canal',
          steps: [
            { text: 'From place d’Armes, enter the park.' },
            { text: 'Turn left down the avenue des Cascades.' },
            { text: 'Cross the Grand Canal and ride along it on the right.' },
            { text: 'Come back through the woods along the allées d’Avon, de la Mi-Voie and Lenôtre.' },
            { text: 'Back to place d’Armes.' },
          ],
          total: 'Approximate total',
          notes: ['the diagonal path leads to a children’s playground.', 'muddy after rain; park opening hours vary with the season.'],
          game: {
            title: 'Mini-game · Treasures of the canal',
            items: ['A swan or a duck', 'The cascades', 'The four giraffes', 'The playground'],
            riddles: [['The Grand Canal was dug under King H _ _ _ _ IV.', 'Clue: the king who wanted “a chicken in every pot”.'], ['The canal is 1.2 km long: is it longer than 10 football pitches?', 'Yes or no?']],
            answer: 'Henri IV (Henry IV) · yes, about 11 pitches!',
          },
        },
        {
          title: 'The route des Hauteurs de la Solle',
          sub: 'Start: route Louis-Philippe car park (behind the cemetery) · ≈ 15 km there and back · 1 h 30 · tarmac · moderate',
          mapAlt: 'Map of the bike ride from the route Louis-Philippe to the Hauteurs de la Solle',
          steps: [
            { text: 'Ride up the route Louis-Philippe: a long climb, help the youngest.' },
            { text: 'At the top, turn right onto the route du Gros Fouteau, all the way to the end.' },
            { text: 'Turn right onto the route des Hauteurs de la Solle: the racecourse appears below, on the left.' },
            { text: 'Carry on to the D606 and turn back.' },
            { text: 'Back the same way, with the downhill as a reward!' },
          ],
          total: 'Approximate total',
          notes: ['at each viewpoint, look out for horses in training.'],
          game: {
            title: 'Mini-game · The sentinels of the Solle',
            items: ['The racecourse', 'A giant oak', 'A blue mark on a tree', 'A squirrel'],
            riddles: [['Route du G _ _ _ F _ _ _ _ _ _', 'Read the sign at the top of the climb.'], ['How many bends on the route des Hauteurs?', 'Count them yourselves!']],
            answer: 'Gros Fouteau',
          },
        },
        {
          title: 'Fontainebleau – Gorges d’Apremont – Barbizon',
          sub: 'Start: route Louis-Philippe car park · ≈ 22 km there and back · 3 h with breaks · tarmac · demanding',
          mapAlt: 'Map of the bike ride from the route Louis-Philippe to the Gorges d’Apremont and Barbizon',
          steps: [
            { text: 'Ride up the route Louis-Philippe, then left onto the route Paul to the tunnel under the D607.' },
            { text: 'After the tunnel, turn right onto the route du Bouquet du Roi to the carrefour des Cépées.' },
            { text: 'Straight on: routes du Château, de Sully, then de la Gorge aux Néfliers. After the carrefour du Milan, car park on the right and the Apremont viewpoint.' },
            { text: 'Bear right onto the route Sully: a long descent to the allée des Vaches car park.' },
            { text: 'Turn left: the allée des Vaches leads to Barbizon. Back the same way.' },
          ],
          total: 'Bike total (without breaks)',
          notes: ['walk to the caverne des Brigands, starting near the chalet (snacks and drinks in season).', 'on the way back, the long descent becomes a long climb!'],
          game: {
            title: 'Mini-game · The brigands’ trail',
            items: ['The tunnel under the road', 'An animal-shaped rock', 'A fern', 'The Sully oak', 'The view over the gorges', 'A painter’s studio in Barbizon'],
            riddles: [['Carrefour des C _ _ _ _ s', 'After the tunnel (B).'], ['Carrefour du M _ _ _ _', 'Before the gorges (C).'], ['Route du B _ _ _ _ _ _ du Roi', 'Just after the tunnel.']],
            answer: 'Cépées · Milan · Bouquet',
          },
        },
      ],
    },
  },
  {
    key: 'en-voiture',
    slug: 'fontainebleau-en-voiture',
    num: 3,
    mode: 'En voiture',
    title: 'Fontainebleau en voiture',
    subtitle: '2 boucles en famille : villages de peintres et vallée du Loing',
    subtitle2: 'La vallée du Loing, étape par étape',
    description: 'Deux boucles en voiture autour de Fontainebleau : Arbonne, Courances et Barbizon au nord-ouest ; Moret, Episy et Grez-sur-Loing au sud, le long du Loing. Balades à pied sur place, mini-jeux pour les enfants. Fiche PDF à prix libre.',
    pdf: '/public/balades/fontainebleau-en-voiture.pdf',
    pdfEn: '/public/balades/fontainebleau-en-voiture-en.pdf',
    checked: 'nov. 2026',
    towns: ['fontainebleau', 'arbonne-la-foret', 'courances', 'barbizon', 'moret-loing-et-orvanne', 'montigny-sur-loing', 'la-genevraye', 'grez-sur-loing'],
    facts: [['Boucles', 'Nord-Ouest · Sud'], ['Distances', '≈ 30 à 45 km'], ['Durée', '½ journée à 1 journée'], ['Sur place', 'Balades à pied faciles'], ['Pour qui', 'Toute la famille']],
    why: 'Pour m’évader de Fontainebleau, voici mes deux tours favoris. Une magnifique boucle au nord en passant par Barbizon, et une bouffée de fraîcheur au sud, le long du Loing, pour un pique-nique au bord de l’eau. Nature et culture au rendez-vous.',
    before: [
      'Horaires : vérifiez les jours d’ouverture des châteaux (Courances : avril à début novembre, l’après-midi).',
      'Dans le coffre : pique-nique pour les bords du Loing.',
      'Forêt : certains secteurs peuvent être fermés (incendies de 2026), vérifiez sur onf.fr.',
    ],
    overview: {
      head: ['Boucle', 'Distance', 'Route', 'Avec visites'],
      rows: [
        ['1. Boucle Nord-Ouest : Arbonne, Courances & Barbizon', '≈ 30 km (45 km avec Courances)', '45 min', '½ journée'],
        ['2. Boucle Sud : la vallée du Loing, de Moret à Grez', '≈ 45 km', '1 h 15', '1 journée'],
      ],
    },
    routes: [
      {
        num: 1,
        title: 'Boucle Nord-Ouest : Arbonne, Courances & Barbizon',
        sub: 'Départ : Fontainebleau · ≈ 30 km (≈ 45 km avec Courances) · ½ journée · villages de peintres et châteaux',
        map: { src: '/public/balades/img/en-voiture-1-nord-ouest.jpg', w: 1200, h: 738, alt: 'Carte de la boucle en voiture de Fontainebleau à Arbonne-la-Forêt, Courances et Barbizon' },
        steps: [
          { k: 'A', text: 'De Fontainebleau, prenez la D409 à travers la forêt jusqu’à Arbonne-la-Forêt.', dist: '≈ 12 km', time: '20 min' },
          { k: 'B', text: 'Détour conseillé : depuis le centre d’Arbonne, la petite route forestière de Courances mène au château de Courances.', dist: '+ 15 km A/R', time: '2 h' },
          { k: 'C', text: 'D’Arbonne, direction Macherin puis Barbizon. Garez-vous place Marc-Jacquet.', dist: '≈ 9 km', time: '15 min' },
          { k: 'D', text: 'À pied, remontez la Grande Rue jusqu’à la forêt : maisons de peintres, ateliers, galeries.', dist: 'à pied', time: '1 h' },
          { k: 'E', text: 'Du parking, retour à Fontainebleau par la D607 (avenue de Fontainebleau).', dist: '≈ 10 km', time: '15 min' },
        ],
        total: ['Total route (hors détour)', '≈ 30 km', '45 min'],
        notes: [['coeur', 'le château de Courances, son parc et ses miroirs d’eau. Comptez 2 h avec la visite.'], ['astuce', 'au bout de la Grande Rue, repérez le médaillon de Millet et Rousseau ; poussez jusqu’au rocher de l’Éléphant (45 min à pied).']],
        game: {
          title: 'Mini-jeu · Le chasseur de tableaux',
          items: ['Un panneau « Arbonne-la-Forêt »', 'Un miroir d’eau à Courances', 'Une mosaïque de tableau sur un mur', 'Une enseigne d’auberge ancienne', 'Le médaillon des deux peintres', 'Le rocher en forme d’éléphant'],
          riddles: [['Le médaillon honore Jean-François M _ _ _ _ _ et Théodore R _ _ _ _ _ _ _.', 'Au bout de la Grande Rue.'], ['Qui a peint « L’Angélus » ? Cherchez la mosaïque !', 'Indice : le même que ci-dessus.']],
          answer: 'Millet · Rousseau · Millet (L’Angélus)',
        },
      },
      {
        num: 2,
        title: 'Boucle Sud : la vallée du Loing, de Moret à Grez',
        sub: 'Départ : rond-point de l’Obélisque · ≈ 45 km · 1 journée · cités médiévales, canal et bords de rivière',
        map: { src: '/public/balades/img/en-voiture-2-loing.jpg', w: 1200, h: 1264, alt: 'Carte de la boucle en voiture de Fontainebleau à Moret-sur-Loing, Episy, La Genevraye et Grez-sur-Loing' },
        steps: [
          { k: 'A', text: 'Du rond-point de l’Obélisque, la D606 mène à Moret-sur-Loing. Garez-vous près de la porte de Samois.', dist: '≈ 10 km', time: '15 min' },
          { k: 'B', text: 'À pied : la rue Grande, la maison dite de François Ier (cour de l’hôtel de ville), la porte de Bourgogne, le pont et les berges ; pique-nique au pré Margaron (rive gauche, par la rue de la Pêcherie).', dist: 'à pied', time: '1 h 30' },
          { k: 'C', text: 'Reprenez la voiture : D104 vers Montigny, à droite route de Sorques, traversez le canal du Loing jusqu’à Episy.', dist: '≈ 8 km', time: '15 min' },
          { k: 'D', text: 'La D40 mène à La Genevraye (église romane Saint-Martin à gauche), puis Moncourt-Fromonville ; au rond-point, à droite vers Grez-sur-Loing.', dist: '≈ 10 km', time: '15 min' },
          { k: 'E', text: 'Garez-vous après le camping (chemin des Prés). À pied : vieux pont, tour de Ganne, église Saint-Laurent, lavoir. Retour par la D104 puis la N7 plein nord.', dist: '≈ 15 km', time: '1 h' },
        ],
        total: ['Total route', '≈ 45 km', '1 h 15'],
        notes: [
          ['astuce', 'à Moret, ne manquez pas la galerie Renaissance de la maison Chabouillé, puis traversez le pont et longez les berges par le chemin des Impressionnistes.'],
          ['astuce', 'à Episy, 30 à 40 min de balade le long du canal ou dans les marais.'],
        ],
        game: {
          title: 'Mini-jeu · Les secrets du Loing',
          items: ['Les deux portes fortifiées de Moret', 'Une façade Renaissance sculptée', 'Un moulin au bord de l’eau', 'Une écluse sur le canal', 'Une péniche', 'Un clocher roman', 'Une tour en ruine', 'Un lavoir'],
          riddles: [['Le peintre Alfred S _ _ _ _ _ _ a peint Moret des centaines de fois.', 'Un impressionniste anglais.'], ['Moret a deux portes : celle de Samois et celle de B _ _ _ _ _ _ _ _.', 'Vous la passez à pied.']],
          answer: 'Sisley · Bourgogne',
        },
      },
    ],
    more: {
      title: 'Si vous avez le temps…',
      items: [
        ['Au nord : le château de Vaux-le-Vicomte', 'Plus loin, comptez une demi-journée de visite.'],
        ['Au sud : Larchant et sa forêt', 'Comptez une demi-journée pour vous promener en forêt.'],
      ],
    },
    teaser: ['2 boucles · 30 à 45 km · ½ à 1 journée', '2 loops · 30–45 km · half a day to a day'],
    thumb: '/public/balades/img/thumb-en-voiture.jpg',
    en: {
      mode: 'By car',
      title: 'Fontainebleau by car',
      subtitle: '2 family loops: painters’ villages and the Loing valley',
      subtitle2: 'The Loing valley, step by step',
      facts: [['Loops', 'North-west · South'], ['Distances', '≈ 30–45 km'], ['Time', 'Half a day to a day'], ['On the way', 'Easy walks'], ['For', 'All the family']],
      why: 'To get away from Fontainebleau, here are my two favourite drives. A beautiful loop to the north through Barbizon, and a breath of fresh air to the south, along the Loing, for a picnic by the water. Nature and culture all the way.',
      before: [
        'Opening hours: check the châteaux’ opening days (Courances: April to early November, afternoons).',
        'In the boot: a picnic for the banks of the Loing.',
        'Forest: some areas may be closed (2026 fires), check onf.fr.',
      ],
      overview: {
        head: ['Loop', 'Distance', 'Driving', 'With visits'],
        rows: [
          ['1. North-west loop: Arbonne, Courances & Barbizon', '≈ 30 km (45 km with Courances)', '45 min', 'Half a day'],
          ['2. South loop: the Loing valley, from Moret to Grez', '≈ 45 km', '1 h 15', '1 day'],
        ],
      },
      routes: [
        {
          title: 'North-west loop: Arbonne, Courances & Barbizon',
          sub: 'Start: Fontainebleau · ≈ 30 km (≈ 45 km with Courances) · half a day · painters’ villages and châteaux',
          mapAlt: 'Map of the drive from Fontainebleau to Arbonne-la-Forêt, Courances and Barbizon',
          steps: [
            { text: 'From Fontainebleau, take the D409 through the forest to Arbonne-la-Forêt.' },
            { text: 'Recommended detour: from the centre of Arbonne, the little forest road to Courances leads to the Château de Courances.', dist: '+ 15 km return' },
            { text: 'From Arbonne, head for Macherin, then Barbizon. Park on place Marc-Jacquet.' },
            { text: 'On foot, walk up the Grande Rue to the forest: painters’ houses, studios, galleries.', dist: 'on foot' },
            { text: 'From the car park, back to Fontainebleau along the D607 (avenue de Fontainebleau).' },
          ],
          total: 'Driving total (without detour)',
          notes: ['the Château de Courances, its park and its water mirrors. Allow 2 h with the visit.', 'at the end of the Grande Rue, look for the medallion of Millet and Rousseau; walk on to the Elephant rock (45 min on foot).'],
          game: {
            title: 'Mini-game · The painting hunter',
            items: ['An “Arbonne-la-Forêt” sign', 'A water mirror at Courances', 'A mosaic of a painting on a wall', 'An old inn sign', 'The two painters’ medallion', 'The elephant-shaped rock'],
            riddles: [['The medallion honours Jean-François M _ _ _ _ _ and Théodore R _ _ _ _ _ _ _.', 'At the end of the Grande Rue.'], ['Who painted “The Angelus”? Find the mosaic!', 'Clue: the same as above.']],
            answer: 'Millet · Rousseau · Millet (The Angelus)',
          },
        },
        {
          title: 'South loop: the Loing valley, from Moret to Grez',
          sub: 'Start: Obélisque roundabout · ≈ 45 km · 1 day · medieval towns, canal and riverbanks',
          mapAlt: 'Map of the drive from Fontainebleau to Moret-sur-Loing, Episy, La Genevraye and Grez-sur-Loing',
          steps: [
            { text: 'From the Obélisque roundabout, the D606 leads to Moret-sur-Loing. Park near the porte de Samois.' },
            { text: 'On foot: the rue Grande, the so-called house of François I (town hall courtyard), the porte de Bourgogne, the bridge and the riverbanks; picnic on the pré Margaron (left bank, via rue de la Pêcherie).', dist: 'on foot' },
            { text: 'Back in the car: the D104 towards Montigny, right onto the route de Sorques, across the Loing canal to Episy.' },
            { text: 'The D40 leads to La Genevraye (Romanesque church of Saint-Martin on the left), then Moncourt-Fromonville; at the roundabout, right towards Grez-sur-Loing.' },
            { text: 'Park after the campsite (chemin des Prés). On foot: old bridge, tour de Ganne, Saint-Laurent church, wash house. Back along the D104, then the N7 due north.' },
          ],
          total: 'Driving total',
          notes: ['in Moret, don’t miss the Renaissance gallery of the maison Chabouillé, then cross the bridge and follow the banks along the chemin des Impressionnistes.', 'in Episy, a 30 to 40 min walk along the canal or through the marshes.'],
          game: {
            title: 'Mini-game · Secrets of the Loing',
            items: ['Moret’s two fortified gates', 'A carved Renaissance façade', 'A mill by the water', 'A lock on the canal', 'A barge', 'A Romanesque bell tower', 'A ruined tower', 'A wash house'],
            riddles: [['The painter Alfred S _ _ _ _ _ _ painted Moret hundreds of times.', 'An English Impressionist.'], ['Moret has two gates: the porte de Samois and the porte de B _ _ _ _ _ _ _ _.', 'You walk through it.']],
            answer: 'Sisley · Bourgogne',
          },
        },
      ],
      more: {
        title: 'If you have time…',
        items: [
          ['To the north: the Château de Vaux-le-Vicomte', 'Further away; allow half a day for the visit.'],
          ['To the south: Larchant and its forest', 'Allow half a day for a walk in the forest.'],
        ],
      },
    },
  },
];

module.exports = { GUIDES, PAY, SUGGESTED, OSM };
