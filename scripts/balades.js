'use strict';
/**
 * The walking, cycling and driving guides (items 104 and 104 bis, 01/11): written and walked by
 * the project lead, in his name — that is their value. Hand-written content, never generated:
 * every route, address and time here comes from his PDF sheets, word for word. Claude does not
 * add a stop or a fact (§5); a correction goes into the PDF and here, the same day.
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
    description: 'Une balade de 3 h dans Fontainebleau, en famille : le château, le parc, la place Napoléon, les rues commerçantes, le marché et le défi des petits explorateurs. Le parcours personnel d’un Bellifontain, fiche PDF à prix libre.',
    pdf: '/public/balades/fontainebleau-a-pied.pdf',
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
  },
  {
    key: 'a-velo',
    slug: 'fontainebleau-a-velo',
    num: 2,
    mode: 'À vélo',
    title: 'Fontainebleau à vélo',
    subtitle: '3 balades en famille, du parc du château à Barbizon',
    description: 'Trois balades à vélo en famille autour de Fontainebleau : le parc du château et le Grand Canal (5 km), la route des Hauteurs de la Solle (15 km), les gorges d’Apremont jusqu’à Barbizon (22 km). Fiche PDF à prix libre.',
    pdf: '/public/balades/fontainebleau-a-velo.pdf',
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
  },
  {
    key: 'en-voiture',
    slug: 'fontainebleau-en-voiture',
    num: 3,
    mode: 'En voiture',
    title: 'Fontainebleau en voiture',
    subtitle: '2 boucles en famille : villages de peintres et vallée du Loing',
    description: 'Deux boucles en voiture autour de Fontainebleau : Arbonne, Courances et Barbizon au nord-ouest ; Moret, Episy et Grez-sur-Loing au sud, le long du Loing. Balades à pied sur place, mini-jeux pour les enfants. Fiche PDF à prix libre.',
    pdf: '/public/balades/fontainebleau-en-voiture.pdf',
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
  },
];

module.exports = { GUIDES, PAY, SUGGESTED, OSM };
