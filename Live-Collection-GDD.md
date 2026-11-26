# Fontainebleau Live Collection — Game Design Document

**Version** 0.4, 23 novembre 2026 (0.1 à 0.3 du 20 au 22/11) · **Auteurs** : le chef de projet
(game design, direction artistique), Claude (rédaction, technique) · **Statut** : maquette
terminée, prototype (M1) à construire.
Suivi des tâches : item 116 du [document de conception](Events-calendar-DesignTechdoc.md) (§9).
Ancien nom : Bleau Quest (abandonné le 21/11 : beaucoup de gens ne savent pas ce qu'est « Bleau »).

> Ce document décrit le jeu. Le document de conception du site fait toujours autorité pour la
> technique, les données et les règles de confiance ; en cas de doute, c'est lui qui tranche.

## Où on en est (25/11/2026, à lire en reprenant)
- **La maquette (M0) est terminée** : tous les écrans ont été revus avec le chef de projet entre le
  21 et le 22/11, la boutique comprise. `node scripts/live-collection-mock.js`, servie sur
  `http://localhost:8517/` (`PORT=…` si le port est pris, `--file` pour écrire la page seulement,
  Ctrl+C pour arrêter) ; elle s'écrit dans `reports/live-collection/` (jamais commité). Tout son
  texte est provisoire : la passe complète se fait au développement (116d).
- **Décidé le 23/11** : les lieux de la maquette sont ceux du M1 (§7.1), **40 depuis** (deux lieux
  napoléoniens et le carrousel ajoutés) ; la page est **`/jeu/`** ; fichiers renommés
  (`Live-Collection-GDD.md`, `scripts/live-collection-*.js`).
- **En ligne et lancé le 23/11** : **fontainebleaulive.fr/jeu/**, indexé, carte « Jouer » sur l'accueil et
  les pages du site ; « bêta » dans le profil. Vrai GPS, FR/EN, code de sauvegarde, installation sur
  l'écran d'accueil. Code : `scripts/live-collection-page.js` ; contenu : `scripts/live-collection.js`.
- **Boutique ouverte le 23/11** (§12.2) : « Soutenir le jeu » encaisse pour de vrai (lien Stripe
  collé) ; **partie de groupe jouable sur le centre-ville**, sans serveur
  (`scripts/live-collection-group.js`), réservée par e-mail. Son paiement en ligne (29 € / 59 €)
  attend le **médiateur de la consommation : CM2C, contacté le 23/11** (suivi, adhésion et contrat :
  chef de projet). Serveur du classement en direct : reporté aux premiers clients (§12.2).
- **Questions validées** : les **7 étapes du centre-ville**, le 23/11, par le chef de projet qui fait
  la boucle très souvent (`check` complet : 7 lieux sur 40 prêts). Les autres restent à vérifier
  sur place (116i), puis la relecture des textes. Carte sans réseau faite le 25/11 (§11).
- **Quêtes de groupe forêt et Barbizon préparées le 25/11** (§12.2), pas encore jouables en groupe
  (`play` absent) : chaque étape a maintenant un texte sourcé et une question (croix du Calvaire,
  rocher Cassepot, caverne des Brigands, question du Bas-Bréau, tirés des pages de l'office de
  tourisme). La forêt est remise dans l'ordre pour finir à la croix du Calvaire, au-dessus de la
  ville. Reste : le parcours fait à pied par le chef de projet (temps, balisage, point de départ),
  les questions vérifiées sur place, et l'ONF avant de vendre une sortie dans les deux (§13 : le
  Bas-Bréau, la caverne et Apremont sont aussi en forêt domaniale).
- **En attente du chef de projet** : le reste des relevés d'Invaders dans les rues (§7.1 bis) ;
  rien à relancer.
- **Agenda de la Ville lu à chaque scan depuis le 21/11** (pare-feu ouvert par la mairie, item 72c du
  doc de conception) : les sorties de fontainebleau.fr sont des fiches confirmées par une source lue,
  donc éligibles à la couche événements et à l'événement du jour (§7), sans copie à la main.
- **Ville de Fontainebleau, direction de la communication** : jeu et site présentés par courriel le
  25/11, appel demandé (item 72d du doc de conception). Boutique non mentionnée ; une saison financée
  par une institution (§12.2, « Plus tard ») attend des chiffres d'usage.
- **Questions encore ouvertes** : §16. Les cinq sites de grimpe sont validés (§7.4).
- **Lien avec le carrousel du jeudi** (item 115) : la quête de la semaine pourra y être annoncée ;
  la règle de sélection des sorties (`carouselPool()` de `generate-pages.js`) sert aussi à la couche
  événements (§11).

---

## 1. Pitch

**Le Pays de Fontainebleau comme un monde de jeu.** On explore la ville, le château, la forêt et
les villages pour de vrai. Chaque lieu visité entre dans la collection, ouvre sa vraie histoire
(une fois sa question résolue), fait gagner de l'XP et avance des quêtes. Cinq **fils de
l'histoire** relient les lieux. Et le monde est **vivant** : les événements de l'agenda de
Fontainebleau Live apparaissent sur la carte, le jour J.

On y joue **seul**, toute l'année, en français et en anglais, sur le site d'abord, peut-être en
application ensuite.

## 2. Pourquoi ce jeu, et pas un jeu de piste

- Un jeu de piste se joue une fois. Il y en a déjà cinq à Fontainebleau (myCityHunt, Urban Quest,
  Forest Mystery, Paris Region Aventures, les agences de team building), tous à usage unique.
- Un jeu de **collection** permanent n'existe pas ici. On y revient : une nouvelle série, une
  saison, un événement ce week-end.
- **Notre avantage, que personne d'autre n'a, c'est l'agenda vérifié** : environ 400 sorties
  confirmées, mises à jour tous les trois jours. Aucun concurrent ne peut brancher le monde réel
  du moment sur son jeu.

## 3. Publics

| Public | Ce qu'il cherche | Ce que le jeu lui donne |
|---|---|---|
| **Étudiants de l'INSEAD** (deux rentrées par an, environ 230 par rentrée sur le campus de Fontainebleau, 70 nationalités, sur place une dizaine de mois) | « Tout faire » avant de partir, en anglais, entre amis | Une bucket list jouable, en anglais, plus tard un classement par promotion |
| **Jeunes adultes en week-end** | Une sortie originale, des choses à partager | Une collection à montrer, une quête qui tient une journée |
| **Hôtels, séminaires** | Occuper un après-midi, une activité clé en main | La session de groupe (§12.2) |
| **Familles qui grimpent** | Découvrir le bloc sans être experts | « 5 Must Climb, en famille » (§7.4) |
| **Habitants** | Redécouvrir chez eux | Des séries complètes, des quêtes de saison |

Les jeunes enfants ne sont pas le public prioritaire : `/foret/` et le calendrier de l'Avent les
servent.

## 4. Piliers

1. **Le vrai lieu d'abord.** Le jeu fait lever les yeux de l'écran : la récompense, c'est d'être
   là. Chaque texte est **vrai et sourcé** ; l'IA ne produit jamais un fait ni une étape.
2. **Généreux.** On ne bloque jamais un joueur : le GPS **ou** la question d'observation. Jamais
   d'impasse.
3. **Vivant.** Les événements de l'agenda, les saisons, la quête de la semaine.
4. **Solo d'abord.** Tout se joue seul. Le social (classements, équipes) viendra ensuite.
5. **Respect du lieu.** Des sentiers existants, aucune étape en réserve ni en zone de quiétude,
   aucune au bord d'une route, rien de posé dans la nature.
6. **Court.** Le moins de texte possible à l'écran ; pas de phrase d'explication inutile (ce qui
   doit être précisé va dans les conditions de vente ou les mentions légales).

## 5. Benchmark (20/11/2026)

| Jeu | Chiffres | Mécanique clé | On prend | On laisse |
|---|---|---|---|---|
| **Pokémon GO** (Niantic, Scopely depuis 2025) | 20 M de joueurs par semaine, 10 M par jour (mars 2025) ; plus de 1 Md$ en 2025 ; plus de 9 Md$ en dix ans | Lieux réels comme points d'intérêt (PokéStops), raids et événements à date, Routes partagées, vitrines ; sponsors payés à la visite (« moins de 0,50 $ par visiteur unique », 2017) | Les lieux réels, **les événements datés**, plus tard les itinéraires et les lieux partenaires | Le combat, le hasard payant |
| **Dragon Quest Walk** (Square Enix, Japon seul) | Plus de 2 Md$ (avril 2024), 86 M$ le premier mois ; **51 $ par joueur** le premier mois, contre 12 $ pour Pokémon GO | Un RPG où **marcher fait progresser un personnage**, avec quêtes et histoire | **La progression** : niveaux et titres | Le gacha |
| **FlashInvaders** (Invader) | Plus de 4 000 mosaïques suivies par les applis de fans ; 10 à 100 points par mosaïque, un score par ville | Trouver une œuvre réelle, la « flasher » (photo + GPS), une galerie | La chasse, **la valeur variable par trouvaille**, la galerie | Les œuvres posées (il faudrait des autorisations) |
| **Tèrra Aventura** (CRT Nouvelle-Aquitaine) | Gratuit, payé par les territoires ; environ 240 000 joueurs par an dans la seule Vienne ; 400 à 600 parcours | Badges de personnages (Poï'z) à collectionner ; un **joker** (on en regagne un tous les 10 trésors trouvés sans aide) ; un personnage qui récompense l'éco-geste (ramasser un déchet) | La collection, **l'éco-geste récompensé**, le modèle institutionnel | La cache physique |
| **Fog of World** | Depuis 2012, 30 $, données sur l'appareil | Un brouillard de guerre qui se lève là où l'on marche | Le brouillard ; **la position ne quitte pas le téléphone** | — |
| **Pikmin Bloom** | 100 M$ cumulés ; la seule des trois licences Niantic en croissance chaque année | Un jeu doux de marche, sans combat | **Le ton doux**, la marche récompensée | — |
| **Monster Hunter Now** | 337 M$ en trois ans, mais des revenus en chute (-69 % la deuxième année) | Combat et grind | La leçon : **le combat et la répétition s'usent** | Le combat |
| **Boolder** | Gratuit, libre, la référence du bloc à Bleau | Topo, carte des blocs, croix | **On renvoie vers lui**, on ne le refait pas | — |
| myCityHunt, Urban Quest, Forest Mystery, Paris Region Aventures | 12,99 € par personne à 30-36 € ; PRA gratuit | Jeux de piste à usage unique | — | Le format |

## 6. Boucles de jeu

- **À la minute** : je marche, la carte montre un lieu proche, j'arrive, je le collecte (GPS ou
  question), je lis son histoire, je gagne de l'XP.
- **Sur une sortie** : une quête de la semaine, un événement de l'agenda sur le chemin.
- **Sur des semaines** : compléter des séries et des fils de l'histoire, monter de niveau, gagner
  des titres et des badges, les quêtes de saison.

### 6.1 Le parcours d'entrée
Trois écrans, moins d'une minute, « Passer » à chaque étape :
1. **Accueil** : le nom (centré), trois promesses (explorer, collectionner, vivre les événements du
   jour), « Gratuit. »
2. **Vous venez…** : pour un week-end, j'habite dans le coin, j'étudie ici, en groupe (avec le
   code donné par l'organisateur, facultatif), **« Un peu de tout »**. L'explication (« sert
   seulement à choisir votre première quête ») est en bas de l'écran, au-dessus du bouton.
3. **La position**, expliquée *avant* la demande du navigateur : elle reste sur le téléphone ; sans
   elle on joue quand même (par les questions).

Puis **la carte**, centrée sur le joueur (ou le centre-ville), **allégée** : les lieux et les
événements en direct, sous le brouillard (une clairière sur le centre-ville sans position) ; les
autres couches sont à un geste (§7.6). « Touchez un lieu près de vous pour commencer. » **Rien ne
s'affiche par-dessus la carte à son arrivée** ; 5 XP « premier pas » au premier lieu ou événement
touché, sous le seuil du niveau 2.

Écartés : une première quête imposée (elle ne tenait pas compte de l'endroit où l'on est), un
écran « Ce qui vous attire » (le jeu propose tout à tout le monde), un écran sur le compte (on
joue sans compte ; la sauvegarde est dans le profil, §12.1).

**Lisibilité de la carte** : rien ne doit faire « guirlande de Noël ». Événements en petits carrés
(24 px) aux couleurs de catégorie adoucies ; un événement en cours pulse lentement dans le vert du
site, seule l'étiquette « LIVE » reste rouge ; les lieux en ronds ; crédit OpenStreetMap discret.

## 7. Les couches du monde

### 7.1 Les lieux (collection permanente)
- **40 lieux au M1** : les 37 de la maquette, figés le 23/11, puis le carrousel, le jardin anglais et la salle du Trône (même jour). Environ 150 à terme. Positions
  OpenStreetMap, à vérifier sur place.
- Types : monument, jardin, patrimoine urbain, rocher nommé, site de Denecourt, gorges, croix et
  mares de la forêt, village et lieu des peintres, site de bloc.
- Chaque lieu a une **fiche** : nom, icône, série, rareté, une **question d'observation** et, une
  fois la question résolue, un texte court **sourcé** (trois phrases, la source affichée dessous).
  Un lieu sans source sûre est un **simple point à collecter**, sans texte ni question : c'est voulu.
- **Rareté** selon l'effort, jamais selon le hasard : commun (en ville), peu commun (lisière,
  Barbizon), rare (au cœur d'un massif), légendaire (une saison, une heure ; aucun au M1).

| Série | Lieux |
|---|---|
| **Le château et ses jardins** (4) | Jardin de Diane, obélisque de Marie-Antoinette, le donjon (cour Ovale, peu commun), galerie François Ier (rare) |
| **Napoléon à Fontainebleau** (4) | Cour des Adieux, fresque de Napoléon, jardin anglais (Hurtault, 1810-1812, et la fontaine Belle-Eau), salle du Trône (1808, rare : visite payante) — deux ajoutés le 23/11, deux ne suffisaient pas pour une série |
| **La ville** (8) | Le carrousel de la place Napoléon-Bonaparte (simple point, 23/11), théâtre municipal, église Saint-Louis, hôtel de ville, place Napoléon-Bonaparte et l'Aigle Noir, porte de l'hôtel du Grand Ferrare, parc de Bel-Ébat (Avon), ancienne maison d'arrêt (peu commun) |
| **Les sentiers bleus** (4) | Mont Ussy, rocher Cassepot (peu communs), tour Denecourt, grotte du Serment (rares) |
| **Grands sites de la forêt** (11) | Croix du Calvaire ; croix de Toulouse, croix du Grand Veneur, croix d'Augas, antre des Druides, caverne des Brigands, mare aux Évées (peu communs) ; gorges de Franchard, gorges d'Apremont, gorges du Houx et les abris de carriers, mare aux Fées (rares) |
| **Les peintres de Barbizon** (4) | Musée de l'École de Barbizon, médaillon de Millet et Rousseau, le Bas-Bréau, Chailly-en-Bière (peu communs) |
| **5 Must Climb, en famille** (5) | Bas Cuvier, Rocher Canon, Canche aux Merciers (peu communs), Cul de Chien, l'Éléphant à Larchant (rares) — §7.4 |

La caverne d'Augas (ensablée en 1972, effondrée en 1986) est remplacée par la croix d'Augas.
**Sources recoupées le 23/11** (116d) : ce qui n'a pas été confirmé a été retiré du texte (fonte
Keller au jardin de Diane, « point le plus haut » à la croix d'Augas, dates de réparation du Grand
Veneur) ; la fresque de Napoléon, sans source, devient un simple point. Textes raccourcis : deux
phrases le plus souvent. État du contenu : `node scripts/live-collection.js`.

### 7.1 bis Les Space Invaders
- 46 mosaïques d'Invader posées en 2023, à Fontainebleau et dans 23 communes autour ; au
  25/07/2026, 32 encore « flashables », 14 détruites (pixel-hunting.com, dont la carte n'est pas
  réutilisable ; OpenStreetMap n'en recense aucune).
- **Les positions viennent des relevés du chef de projet** (liste complète reçue le 23/11) : ce sont nos propres données.
  **Seules celles encore en place entrent au jeu.** Six au 23/11, toutes à Fontainebleau ; la
  série compte celles-là (« 0 / 6 »), pas les 46 d'origine :

  | Code | Rue | Dans le jeu |
  |---|---|---|
  | FTBL_04 | rue du Château | Château aux tours pointues |
  | FTBL_07 | angle rue de la Corne et rue des Trois-Maillets | Alien bleu à lunettes |
  | FTBL_08 | rue Dénecourt | Lampe abat-jour |
  | FTBL_13 | rue Saint-Merry | Alien vert aux yeux blancs |
  | FTBL_43 | rue du Conventionnel-Geoffroy | Alien rouge et son livre |
  | FTBL_44 | angle place du Marché et rue Grande | Napoléon et son bicorne |

  Quatre sont sur la fiche « Fontainebleau à pied » (noms repris de la fiche), toutes sont sur le
  chemin de la quête de groupe du centre-ville (« 6 mosaïques d'Invader en bonus »).
- **Placées à la rue** (BAN), pas au mur : on cherche encore. Le nom et le code se découvrent en la
  trouvant. Nos noms en quelques mots ; **ni photo ni texte des sites de fans** : les œuvres sont à
  Invader, les descriptions à ceux qui les ont écrites.
- Couche « Invaders » active par défaut. Validation : GPS (100 m) ou sur l'honneur (elles n'ont pas
  de position exacte) ; 15 XP, 8 sur l'honneur.

### 7.2 Les événements (en direct) — la force du jeu
Les événements de l'agenda sont ce que les autres jeux n'ont pas. Ils sont identifiables au
premier coup d'œil et rapportent le plus d'XP.
- **Repérables** : sur la carte, un carré (les lieux sont des ronds) à la couleur de la catégorie,
  avec le jour (« sam ») ou **« LIVE »** le jour même ; un bandeau en haut de la carte (« 8 en
  direct aujourd'hui · 56 cette semaine ») ; un onglet **En direct** : **aujourd'hui et demain**
  seulement, l'XP de chaque sortie ; le reste de la semaine et la saison sont sur la carte.
- **Portée** : les sorties à **12 km autour du joueur** (du centre-ville sans position) ; la portée
  le suit. La page embarque toute la zone de l'agenda (20 km) et filtre sur le téléphone : la
  position n'est envoyée nulle part.
- **L'événement du jour** : un des événements du jour, le même pour tous ceux d'un secteur, **XP
  doublée** (40), en doré (pas en rouge). C'est la raison d'ouvrir le jeu chaque jour.
- **« J'y vais »** sur une sortie à venir : un rappel le jour J (sans XP, l'XP se gagne sur place).
- **Seulement les fiches confirmées par une source lue** (jamais Gemini seul, la règle du
  carrousel), à leur adresse, le jour J. Le flux de la Ville en fait partie, lu à chaque scan depuis
  le 21/11 (84 sorties dans la fenêtre de trois mois au scan du 21/11).
- Y passer donne une **carte souvenir datée** (« Marché de Noël de Fontainebleau, 2026 ») et de
  l'XP. Le jeu envoie du monde aux organisateurs, et nous savons le compter : c'est la preuve à
  montrer aux organisateurs et aux communes (item 114).
- Pas d'événement payant imposé : passer devant suffit, on n'exige jamais un billet.
- Validation : GPS dans un rayon de 200 m **le jour même**, ou sur l'honneur à demi-XP.

### 7.3 Les quêtes
- **Les fils de l'histoire** (quête principale, 22/11) : des lieux à collecter **avec leur
  question**, sans récit ni personnage (une enquête « fait jeu de rôle »). Cinq fils, dans l'ordre
  de l'histoire : **les rois** (le donjon, la galerie François Ier, le jardin de Diane, Saint-Louis,
  la cour des Adieux, le Grand Veneur, l'obélisque), **les Napoléon**, **Denecourt** (les sentiers
  bleus), **les peintres de Barbizon** (le musée, le médaillon, le Bas-Bréau, Apremont,
  Chailly-en-Bière), **le grès et les carriers** (mont Ussy et croix d'Augas, Franchard, gorges du
  Houx, Apremont ; source : AAFF, « Les carriers »). Une étape est faite quand le lieu est
  collecté **et** sa question résolue, dans l'ordre qu'on veut ; un lieu peut servir à deux fils.
  Un fil complet : 60 XP et son badge. Une phrase d'introduction par fil, rien de plus. Le lien de
  Corot avec Chailly n'est pas sourcé : Corot reste au Bas-Bréau.
- **Quêtes d'événements** : la quête de la semaine (deux sorties d'ici dimanche, annoncée par le
  carrousel du jeudi), « Quatre genres de sorties » (spectacle, atelier ou expo, nature, sport).
- **Toujours là** : « Trois sorties sportives » (badge « Sportif », 23/11), « 5 Must Climb, en famille » (§7.4), la chasse aux Invaders.
- **Quêtes de saison** : Noël (marchés de Noël de l'agenda, couche de saison, 5 XP de bonus par
  sortie ; le calendrier de l'Avent du site devient une quête), le brame (septembre-octobre,
  depuis un point d'écoute autorisé), les champignons (une sortie de l'agenda, jamais de
  cueillette conseillée), le printemps du bloc.
- **Éco-geste** (repris de Tèrra Aventura) : ramasser un déchet en forêt rapporte un badge, sur
  l'honneur.
- **Calques** (26/11) : Quêtes, Grimpe et Saison sont éteints au début, puis allumés par défaut à partir du
  niveau 4 (tous les calques).
- Ordre à l'écran : cette semaine, puis toujours là, puis de saison. Chaque quête a sa médaille
  (icône au trait dans un cercle teinté).

### 7.4 « 5 Must Climb, en famille »
**Très accessible** : pas cinq blocs durs, mais **cinq sites de bloc à visiter en famille** : on
vient, on regarde, on essaie les premiers blocs du circuit le plus facile. Aucune cotation exigée.
- Les cinq sites : **Bas Cuvier** (le site historique), **Rocher Canon**, **Canche aux Merciers**,
  **Cul de Chien** (le sable des Trois Pignons), **l'Éléphant** à Larchant. **Validés** par le chef
  de projet, qui y a grimpé en famille avec ses enfants : on les garde tels quels.
- On valide la **visite** (GPS 150 m ou question), pas une ascension. Couche « Grimpe ».
- Chaque site renvoie vers **Boolder** pour le topo ; aucune description de passage écrite par nous.
- Un avertissement de sécurité (crash-pad, parade, jamais sur rocher mouillé), rien qui pousse à
  grimper au-dessus de son niveau.

### 7.5 L'exploration (couche « Brouillard »)
Le brouillard des sentiers balisés (près de 300 km dans le Pays de Fontainebleau) : un pourcentage
de forêt explorée, plus tard des badges par massif. Le tracé reste sur le téléphone. Dans la
maquette : la carte assombrie, éclaircie autour de ce qu'on a vu (canevas, clairières fondues,
bords adoucis).

### 7.6 Les couches, comme sur une application de cartes
Un bouton en haut à droite ouvre un panneau : **type de carte** (Plan, Doux, Nuit : les mêmes
tuiles OpenStreetMap, filtrées, aucun fournisseur tiers) et **couches** à cocher : Lieux,
En direct, Invaders, Quêtes, Grimpe, Saison (Noël en ce moment), Brouillard.

### 7.7 Navigation
- **Barre du haut** : niveau, titre, barre d'XP, la pastille de l'équipe en groupe (elle ouvre le
  classement) et le bouton **Profil** (avatar et cadre du joueur).
- **Barre du bas** : Carte, En direct, Collection, Quêtes, **Boutique**.
- **Collection** en **badges** : médailles rondes à la couleur de la série, un second anneau pour la
  rareté (argent : peu commun, or : rare), le nom dessous, anneau en pointillé gris tant que le
  lieu n'est pas collecté.
- **Profil** : badges de réussite en médailles avec leur cible (« 2 / 4 ») et un anneau de
  progression ; titres avec cadenas ou coche dans un cercle ; « Ma sauvegarde » (§12.1) ; avatar et
  cadre (§12.2).

## 8. Progression
- **XP** (à régler en test) : lieu commun 15, peu commun 20, rare 30, légendaire 60 ; question
  résolue 5 ; **événement 20, événement du jour 40**, bonus de saison 5 ; « Quatre genres de
  sorties » 50 ; trois sorties sportives 40 (badge « Sportif », 23/11 : courses, trails, VTT de l'agenda) ; mosaïque d'Invader 15 ; série complète 40 (série d'**au moins trois lieux**) ;
  fil de l'histoire complet 60 ; éco-geste 10 ; premier pas 5 ; sur l'honneur à la moitié
  (arrondie). Des gains simultanés s'affichent ensemble.
- **Aucun gain ne vaut plus d'un niveau** (« laisse-moi du temps »).
- **Niveaux** 1 à 60 (26/11) : 60 XP pour le niveau 2, 180 pour le 3, puis **120 XP par niveau**
  (niveau 10 à 1 020 XP, 20 à 2 220, 30 à 3 420, 40 à 4 620, 50 à 5 820, 60 à 7 020). L'ancienne
  courbe 30·n·(n−1) mettait le niveau 10 à 2 700 XP, au-delà de tout le contenu fixe réuni (lieux,
  questions, séries, fils, Invaders : environ 1 800 XP) : ses récompenses n'auraient jamais été vues.
  Les nouveaux seuils ne sont jamais plus hauts que les anciens : aucun joueur ne perd de niveau.
  Niveau 10 : à peu près les deux tiers des lieux ; niveau 60 : un an de joueur assidu (sorties de
  l'agenda et quête de la semaine).
- **Récompenses de niveau** (26/11, chef de projet : « il faut qu'on récompense les joueurs qui
  progressent ») : un avatar ou un cadre tous les dix niveaux (dessins validés le 26/11), montré sur l'écran du niveau, à
  choisir dans le profil, affiché verrouillé avec son niveau tant qu'il n'est pas gagné.
  **10 : Renard**, **20 : Django** (guitare manouche : Samois et le festival ; un instrument, jamais
  un portrait), **30 : Châtelain** (le château vu de la cour des Adieux, l'escalier en fer à
  cheval), **40 : cadre « Sentiers bleus »** (les marques de Denecourt), **50 : cadre « Couronne
  d'or »**, **60 : Napoléon**, avec le titre « Empereur ». Renard, Napoléon et la couronne sortent du
  pack collectionneur ; qui avait débloqué le pack avant le 26/11 les garde (ne jamais changer les
  règles après coup, §12.2). Les Invaders ne sont **pas** verrouillés par un niveau (§7.1 bis).
  Un écran par niveau franchi ; « Nouveau titre » seulement quand le titre change, sinon le
  prochain titre à viser.
- **Titres** : Promeneur (1), Flâneur (3), Bellifontain (5), Bleausard (8), Peintre de Barbizon (12),
  Denecourt (20), Châtelain (30), Empereur (60).
- **Badges** : séries (tous les lieux de la série, sans minimum), fils de l'histoire, saisons,
  éco-geste, premier événement, « 5 Must Climb » ; Mécène (§12.2).

## 9. Valider une étape (« soyons généreux »)
1. **GPS** : rayon de 100 m en ville, 150 m en forêt (précision moindre sous les arbres).
2. **Ou la question d'observation**, quand le GPS décroche ou qu'on refuse la géolocalisation.
   Un simple point à collecter, sans question, se collecte seulement par le GPS.
3. **Sur l'honneur** : seulement pour les Invaders (pas de position exacte) et les événements.
   Pas pour les lieux (22/11 : « on a déjà Pas de GPS, c'est la même chose »).

**La question** : trois choix, sur ce qu'on **voit sur place** (forme d'un escalier, nombre de
chiens d'une fontaine, matériau d'une façade), jamais une date à connaître. **Toujours visible sur
la fiche** : avant la visite, sous le bouton GPS (« Pas de GPS ? Répondez à la question ») ; après,
la bonne réponse cochée, au-dessus de l'histoire. Validé par le GPS, le joueur a encore la question :
elle ouvre l'histoire et rapporte 5 XP. Sans GPS, elle valide à la fois la visite et l'histoire.
Retour sur le bouton lui-même : croix et fond rouge sur une mauvaise réponse (« Pas tout à fait :
regardez encore autour de vous »), sans pénalité ; coche et fond vert sur la bonne (« Bonne
réponse ! »). Chaque question se vérifie sur place avant publication (116d).

- Triche : sans importance tant que le jeu est solo. Les classements, plus tard, ne compteront
  que les validations GPS.

## 10. Direction artistique
- **Le style du site** (décidé le 21/11), couleurs reprises de sa palette : en-tête des fiches en
  teinte claire, icône en couleur, pas de marron.
- **Icônes au trait** dessinées pour le projet (`scripts/live-collection-icons.js`, planche sur
  `reports/live-collection/icones.html`) à la place des emojis. Lieux verrouillés : icône grisée.
  Choisies le 22/11 pour les monuments : château en façade avec l'escalier en fer à cheval, cerf
  pour le jardin de Diane, masque pour le théâtre, nef et clocher pour l'église.
- **Avatars du pack** dessinés en couleur (`scripts/live-collection-avatars.js`, §12.2).
- **Pixel art essayé et écarté** le 21/11 (« ça ne va pas ») : ne pas le reproposer.
- **Illustrations des lieux** : pas au M1 (la collection est en badges). Pistes pour plus tard :
  gravure (Ridinger, CC0, déjà sur `/foret/`), aquarelle ou huile façon École de Barbizon (§16).

## 11. Plateforme et technique
- **Web d'abord**, sur **fontainebleaulive.fr/jeu/** (décidé le 23/11), en PWA installable.
  Contenu dans un fichier écrit à la main (`scripts/live-collection.js`, comme `foret.js`), page
  générée par `generate-pages.js`, construite en `textContent`, sans dépendance.
- **Sur l'écran d'accueil** (23/11) : le jeu s'installe comme une application à part (manifeste propre,
  icône du jeu), proposé après la première chose collectée ; sur iPhone, l'encart montre les deux gestes.
  Hors ligne grâce au service worker du site. L'application Android (TWA) emballera la même page.
- Progression dans `localStorage` (avec un code d'export pour changer de téléphone). **La position
  ne quitte jamais le téléphone.** Carte Leaflet (`vendor/`), tuiles OpenStreetMap (pas de
  téléchargement en masse pour le hors ligne : les règles d'OSM l'interdisent). **Carte sans réseau
  (25/11)** : `sw.js` garde les tuiles que le jeu a affichées ; sur la fiche d'un lieu en forêt et
  avant le départ d'une quête de groupe en forêt, « Garder la carte du coin hors ligne » charge une
  petite zone (300 tuiles au plus, au toucher, jamais seul) ; depuis le 26/11, un bouton sur la carte
  garde la zone affichée, **depuis la ville, avant de partir** (en forêt il n'y a plus de réseau), et
  passe en coche une fois la zone gardée ; hors ligne, un bandeau le dit, les
  zooms 17 et plus agrandissent les tuiles du zoom 16, et la distance s'accompagne de la direction
  (« à 650 m, vers le nord-est »), calculées sur le téléphone.
- La couche événements lit `data.json`, avec la règle du carrousel du jeudi : `carouselPool()` de
  `generate-pages.js` (sources lues seulement, quatre jours au plus, pas d'offre permanente ni de
  petit train), pour que le jeu, le post et `/ce-week-end/` montrent les mêmes sorties.
- **La maquette** est servie par un petit serveur local (`127.0.0.1`) : OpenStreetMap refuse les
  tuiles à une page ouverte depuis le disque (`file://`, sans Referer). En ligne, la question ne
  se pose pas.
- **Application Android plus tard** (compte développeur Google existant) : une *Trusted Web
  Activity* emballe la PWA pour le Play Store sans la réécrire. iOS ensuite.
- Un serveur (Cloudflare Worker) seulement pour ce qui l'exige : classements et sessions de groupe,
  synchronisation entre appareils, compte. C'est la première entorse au tout statique, à décider
  le moment venu (116m).

## 12. Compte et monétisation (rien vendu au M1)

### 12.1 Pas de compte pour jouer
- **Jouer sans compte** : la progression vit sur le téléphone. Chaque écran d'inscription perd des
  joueurs, et un compte oblige à garder des données personnelles (donc un serveur, une base, le
  RGPD).
- **Code de sauvegarde** : la progression exportée en un code ou un QR, pour changer de
  téléphone. Sans serveur.
- **Dans le profil, « Ma sauvegarde »** : un champ « Votre e-mail (facultatif) », « M'envoyer mon
  code » et « Créer mon compte » (lien de connexion, sans mot de passe). Le compte arrive le jour
  où l'un de ces besoins arrive : jouer en équipe, retrouver un achat sur un autre appareil, jouer
  sur plusieurs appareils. Serveur de §11, une ligne dans les mentions légales (116g), aucune
  adresse revendue ni partagée.
- Sur Android, Google Play retrouve lui-même les achats.

### 12.2 Ce qui pourra s'acheter (décidé le 22/11)
**Pas de contenu vendu** : des cosmétiques et surtout du **service**. Règle : **ce qui s'achète ne
donne jamais d'XP, de lieu ni d'événement.** Pas de publicité, pas de hasard payant, pas d'énergie
à recharger. **Ne jamais changer les règles après coup** (la leçon de Komoot, 2025).

Benchmark (22/11) : Pokémon GO vend des tenues mais gagne surtout sur les passes de raid (la
pression sur le jeu, refusée) ; Pikmin Bloom vend du décor ; Geocaching, un Premium (39,99 $/an) et
des objets à collectionner ; AllTrails Plus (35,99 $/an) et Wandrer (30-40 $/an) vendent du
service ; Zombies, Run! vend des missions (du contenu, écarté).

| Priorité | Offre | Pour qui | Prix | Ce qu'il faut construire |
|---|---|---|---|---|
| **Haute** | **Session de groupe** : un code, des équipes, un **classement à l'arrivée** (en direct quand le serveur existera), un **récapitulatif pour l'organisateur** (podium, étape la plus vite bouclée, question la plus ratée, le plus d'Invaders ; ni nom de joueur ni position). **Trois quêtes prêtes**, dont les étapes ne sont pas montrées (c'est ce qui s'achète) : le **centre-ville** (les étapes de la fiche « Fontainebleau à pied » et ses Invaders), **la forêt, hauteurs de la Solle** (mont Ussy, croix d'Augas, rocher Cassepot, tour Denecourt, croix du Calvaire ; ordre du 25/11), **Barbizon** (musée, médaillon, Bas-Bréau, caverne des Brigands, gorges d'Apremont) | séminaires, hôtels, INSEAD, anniversaires | **une sortie sur une quête : 29 € jusqu'à 10 joueurs, 59 € jusqu'à 30** ; au-delà, « nous contacter ». Pas de devis ni de quête sur mesure | **fait pour le centre-ville** (23/11, sans serveur) ; **forêt et Barbizon : textes et questions écrits le 25/11**, à parcourir et vérifier sur place ; reste : le médiateur (CM2C), les deux Payment Links, l'ONF pour les deux quêtes en forêt ; le serveur pour le direct |
| **Haute** | **Soutien à prix libre**, remercié par le **badge « Mécène »** sur le profil **et le pack collectionneur** : quatre avatars dessinés en couleur (chouette, écureuil, cèpe, bloc et grimpeur) et trois cadres ornés (feuillage, gravure, grès) ; jusqu'au 26/11, six avatars et quatre cadres : le renard, Napoléon et la couronne d'or sont devenus des récompenses de niveau (§8). Le pack se débloque **aussi sans payer** (« Débloquer le pack sans payer », comme les balades) ; seul le badge dit qui a payé. Badge montré une fois obtenu, jamais comme une cible verrouillée. Gratuits d'office : trois avatars au trait (promeneur, arbre, feuille) et le cadre simple | habitués, collectionneurs | libre : 4 € conseillés, 2 € minimum | un Payment Link « le client choisit le montant » ; le retour de Stripe pose le badge (sans serveur, contournable : accepté) |
| **Basse** | **Vos cartes imprimées** : les lieux collectés, avec la date | visiteurs, cadeau | à définir | PDF prêt à imprimer ou imprimeur partenaire (§16) |
| Plus tard | Saison financée par l'office de tourisme ou l'interco (modèle Tèrra Aventura) ; commerçants partenaires signalés comme tels | institutions, commerces | convention | des chiffres d'usage (M2) |

**Écartés** : une enquête payante ; vendre la sauvegarde ou la synchronisation (la progression en
otage) ; des indices ou des jokers ; le hasard payant ; un pass d'événement à récompenses.

**Dans le jeu (23/11)** : la boutique est ouverte sur `/jeu/` (onglet Boutique) : « Soutenir le jeu » à prix libre payé par Stripe (badge Mécène et pack ; le pack aussi sans payer), groupes réservés par e-mail avec leurs prix ; retour de Stripe = badge sur le téléphone et code (`FLC-MEC-…`) pour un autre appareil ; avatar et cadre choisis dans le profil ; `/conditions-de-vente/`. Le pack à 2,99 € a été fondu le même jour dans le soutien (chef de projet : « ce ne sont que de la UI 2D ») : plus de vente à prix fixe, donc ni renonciation au droit de rétractation ni médiateur de la consommation.

**Partie de groupe (23/11, centre-ville)** : sans serveur. Code de partie (`FLC-GRP-…`) pour l'organisateur, qui choisit une durée limite et envoie un lien aux équipes (un téléphone par équipe). Étapes dans l'ordre, chronomètre ; sur place (GPS) +20, bonne réponse +100 ou +50 au 2ᵉ essai, étape sans question +100 par GPS, Invaders +30 ; égalité au temps. Fin : dernière étape, durée limite, ou « Terminer la partie ». Chaque équipe envoie son résultat en lien ; ouvert chez l'organisateur, il remplit le classement et le récapitulatif. Pas de classement en direct (il faudrait le serveur de §11). En fin de partie, le message (texte et lien) s'ouvre **tout prêt** dans WhatsApp ou l'appli SMS, adressé à l'organisateur s'il a donné son numéro (facultatif, transmis seulement dans le lien d'invitation) : il reste à toucher « Envoyer », aucun site ne pouvant envoyer à la place du joueur. Une arrivée par GPS collecte aussi le lieu dans le jeu solo. Les 7 questions des étapes sont validées (23/11) ; la fresque de Napoléon a sa question (à cheval, le bicorne : observation du chef de projet). Paiement en ligne des paliers quand le médiateur de la consommation (CM2C, contacté le 23/11) est en place : il est obligatoire dès qu'un particulier peut acheter, même auprès d'une entreprise ; d'ici là, réservation par e-mail et code envoyé à la main.

**Serveur (devis du 23/11, reporté aux premiers clients)** : le volume est minuscule (une centaine de messages par sortie), les offres gratuites suffisent ; retenu, Cloudflare Workers et Durable Objects (0 €, puis 5 $/mois au-delà de 100 000 requêtes par jour ; données gardées en Europe possible). Écartés : Firebase (100 connexions simultanées en gratuit), Supabase (pause après une semaine sans activité, sinon 25 $/mois), un VPS (4 à 8 €/mois, mais entretien à notre charge). Le coût réel est la construction : deux à trois séances. Apport : classement qui bouge en direct, résultats reçus sans WhatsApp, progression des équipes par étape, codes de partie vérifiés.

**À l'écran** : onglet Boutique, dans l'ordre **soutien, groupes, cartes imprimées**. Le soutien est
ouvert d'emblée : les avatars du pack sur une ligne, les cadres sur la suivante, « 4 € conseillés »
(et non « Prix libre », qui se lisait comme « gratuit »), « Débloquer le pack sans payer » en lien
discret, « Soutenir encore » pour un Mécène. Les autres produits sont **repliés** (icône, nom, une
ligne, prix ou « Bientôt » ; une flèche pour l'ouvrir). Sous le bouton de réservation, l'adresse
`contact@helioso.com` est écrite et copiable (un lien `mailto:` ne fait rien sans appli de courriel). Le groupe : « 1. Choisissez votre quête » (nom, durée, distance, deux puces), « 2. Une
sortie » et les deux tarifs. Dans le profil, un avatar ou un cadre à cadenas ouvre la boutique sur
le soutien. Dans la maquette, rien n'est payé ; « Essayer avec le code DEMO-SEMINAIRE » ouvre un
classement avec trois équipes fictives.

- **Paiement** : sur le web, Stripe (déjà utilisé pour les balades). Sur Android, un contenu
  numérique vendu dans l'application passe par la facturation Google Play (15 % pour un petit
  éditeur) ; une prestation (session de groupe) ou un objet peut rester sur Stripe.
- **Sans serveur, un déblocage n'est pas un verrou** : acceptable pour un prix bas et honnête ; un
  vrai verrou attendra le serveur.

## 13. Garde-fous
- **ONF** (revu le 23/11) : des lieux seulement sur les sentiers existants, aucun en réserve
  biologique ni en zone de quiétude ; période du brame respectée. Le jeu gratuit montre des lieux
  publics, comme un guide de randonnée : rien à demander. **Les voir devient nécessaire pour vendre
  la session de groupe en forêt** (une activité commerciale organisée en forêt domaniale se fait
  sous autorisation) ; utile avant le lancement pour vérifier les 24 lieux en forêt (zones
  sensibles, sites fermés). La visibilité serait un bonus, pas la raison.
- **Parc du château** : vérifier auprès de l'établissement public.
- **Sécurité** : aucune étape au bord d'une route ni sur un rocher dangereux ; avertissements
  pour le bloc.
- **Vie privée** : géolocalisation demandée au moment du jeu, jamais transmise ; dit dans
  `/mentions-legales/`.
- **Faits** : sourcés, relus par le chef de projet ; faits naturalistes contre l'ONF et l'INPN.
- **Droits** : illustrations du chef de projet ou libres (CC0), crédit OSM ; pour les Invaders,
  ni photo ni texte repris (§7.1 bis).

## 14. Mesure
GoatCounter, sans rien qui identifie le joueur : `quest-start`, `spot-unlock/<id>`,
`spot-method/<gps|question|honneur>`, `event-checkin`, `level/<n>`, `reward/<id>` (récompense de niveau montrée), `set-complete/<série>`.

## 15. Jalons
| Jalon | Contenu | Quand |
|---|---|---|
| **M0 Maquette** | Tous les écrans, revus avec le chef de projet | Faite du 20 au 22/11 |
| **M1 Prototype jouable** | Les 37 lieux, les Invaders relevés, XP, niveaux, titres, badges, les fils de l'histoire, la couche événements, FR/EN, code de sauvegarde, sur `/jeu/` | 4 à 6 semaines |
| **M2 Test sur place** | Amis, puis un groupe d'étudiants de l'INSEAD ; grille d'observation | Après M1 |
| **M3 Lancement public** | Page indexable, liens depuis le site, carrousel dédié | Après M2 |
| **M4 Couches suivantes** | Brouillard complet, quêtes de saison, serveur, session de groupe et boutique | 2027 |
| **M5 Application Android** | TWA sur le Play Store, si l'usage le justifie | 2027 |

## 16. Questions ouvertes
1. **Quand parler à l'ONF** (§13) : pas nécessaire pour le jeu gratuit ; avant de vendre la
   session de groupe en forêt.
2. **Les cartes imprimées** : PDF prêt à imprimer ou imprimeur partenaire.
3. **Les illustrations des lieux**, après le M1 : gravure ou peinture façon École de Barbizon.
