# Bleau Quest — Game Design Document

**Version** 0.3, 21 novembre 2026 (0.1 et 0.2 des 20 et 21/11) · **Auteurs** : le chef de projet (game design, direction artistique),
Claude (rédaction, technique) · **Statut** : maquette faite, prototype à construire.
Suivi des tâches : item 116 du [document de conception](Events-calendar-DesignTechdoc.md) (§9).

> Ce document décrit le jeu. Le document de conception du site fait toujours autorité pour la
> technique, les données et les règles de confiance ; en cas de doute, c'est lui qui tranche.

## Où on en est (22/11/2026, à lire en reprenant)
- **Nom, décidé le 21/11** : **« Fontainebleau Live Collection »**, sous la marque du site.
  « Bleau Quest » est abandonné : beaucoup de gens ne savent pas ce qu'est « Bleau ». Les noms de
  fichiers (`Bleau-Quest-GDD.md`, `scripts/bleau-quest-mock.js`) seront renommés plus tard.
- **Retours sur la maquette, en cours (21/11)** : le parcours d'entrée est revu (§6.1, trois écrans
  au lieu de six, puis la carte allégée, maquette v3). Deuxième série du 21/11 (carte et style :
  « bien ») : En direct limité à aujourd'hui et demain, phrases de la collection et des quêtes
  réécrites, « Toujours là » et les sentiers bleus remontés (cinq lieux), série des Space Invaders
  (§7.1 bis), profil en haut et boutique en bas (§7.7). **La boutique sera revue en séance dédiée**
  (les offres de la v2 ne correspondent pas à l'idée du chef de projet, §12.2). Troisième série (21/11) :
  portée de 12 km autour du joueur, qui le suit (§7.2) ; les Invaders du centre-ville sur la
  carte (§7.1 bis) ; **icônes dessinées** à la place des emojis, adoptées (« bien mieux ») ;
  essai de **pixel art écarté**, on garde **le style du site** (§10). En attente : les
  emplacements des Invaders, que le chef de projet va relever dans les rues (§7.1 bis).
  Quatrième série (21/11), les fiches : « bien » ; lien vers Fontainebleau Live plus petit, sans
  flèche. Suite demandée : **écrire les textes et les questions**, les monuments d'abord. Premiers
  brouillons sourcés pour quatre lieux (cour des Adieux, jardin de Diane, obélisque, théâtre,
  §9), relus par le chef de projet (« vraiment top »), à vérifier sur place. Cinquième série
  (21/11) : couleurs des fiches et des cartes reprises de la palette du site (en-tête en teinte
  claire, icône en couleur, plus de marron) ; barème d'XP divisé par trois environ (§8). Retour suivant : couleurs « un peu mieux » ; icônes du château et de la fontaine « pas super », à retravailler (ou d'autres propositions) ; un niveau 2 inattendu venait du bonus d'une série d'un seul lieu (§8, corrigé).
  Sixième série (22/11), les lieux : 31 dans la maquette. Textes et questions pour la forêt et Barbizon (tour Denecourt, grotte du Serment, mont Ussy, Grand Veneur, Franchard, Apremont, musée de Barbizon) ; la **caverne d'Augas**, ensablée en 1972 et effondrée en 1986, est remplacée par la **croix d'Augas** ; le rocher Cassepot devient un simple point de vue. Des **points à collecter sans texte ni question** quand on n'a pas de source (croix du Calvaire, croix de Toulouse, antre des Druides, caverne des Brigands, mares aux Évées et aux Fées) : c'est voulu, un lieu peut n'être qu'un point. En ville, les étapes de la fiche à pied (fresque de Napoléon, porte du Grand Ferrare, place Napoléon-Bonaparte et l'Aigle Noir, Saint-Louis, hôtel de ville), l'ancienne maison d'arrêt et, à Avon, le parc de Bel-Ébat. Les 5 sites de grimpe sont gardés tels quels (le chef de projet les connaît). Les fiches n'affichent plus de mention « brouillon » ni de phrase d'introduction à la question : **tout le texte de la maquette est provisoire, une passe complète est prévue au développement** (116d), la moitié est déjà relue. Sources à recouper à ce moment : Grand Veneur (Wikipédia), grotte du Serment, croix d'Augas (blog local, AAFF), dates de la maison d'arrêt, Bel-Ébat (ville d'Avon), date de la mort de Denecourt (mars ou mai 1875). Icônes choisies le 22/11 : château en façade avec cheminées et escalier en fer à cheval, **jardin de Diane dessiné en cerf**, théâtre gardé en masque, église en nef et clocher ; les autres acceptées telles quelles (toutes sur `reports/bleau-quest/icones.html`). Collection (22/11) : les cartes débordaient de leur encart (un nom long élargissait sa colonne), corrigé ; les petites cartes plaisent (« sympas »). **Alternative demandée : des badges** — médailles rondes à la couleur de la série, un second anneau pour la rareté (argent : peu commun, or : rare), le nom dessous, anneau en pointillé gris tant que le lieu n'est pas collecté. Les deux vues sont dans la maquette (sélecteur « Cartes / Badges » en haut de la collection) ; choix du chef de projet attendu, sinon on garde les cartes.
- **Fait** : benchmark (§5), ce document, la maquette M0 v2 (`node scripts/bleau-quest-mock.js`,
  servie sur `http://localhost:8517/` ; `PORT=…` si le port est pris ; Ctrl+C pour l'arrêter),
  commitée le 21/11 (`de9f5b22`). Verdict du chef de projet : « très bien pour un premier mock-up ».
- **En attente** : le chef de projet a **beaucoup de retours sur la maquette**, à recueillir à la
  prochaine séance avant toute nouvelle version. Il veut aussi **plusieurs propositions
  d'interface** (contenu) à comparer, dans le style du site.
- **Décisions à prendre** (§16) : sujet de l'enquête, nom, les 35 lieux du M1, styles graphiques à
  essayer, les cinq sites de grimpe en famille, quand parler à l'ONF, la première offre payante.
- **Acquis du 21/11** : événements au centre du jeu (§7.2), grimpe en famille (§7.4), couches à
  cocher (§7.6), parcours d'entrée (§6.1), pas de compte pour jouer et ce qui pourra s'acheter
  (§12), style du site.
- **Lien avec le carrousel du jeudi** (item 115) : la quête de la semaine pourra y être annoncée ;
  la règle de sélection des cartes vit désormais dans `generate-pages.js` (`carouselPool`) et
  servira aussi à la couche événements (§11).
- **Réseaux sociaux, en ligne depuis le 20/11** : page Facebook **facebook.com/fontainebleaulive**
  et compte Instagram **instagram.com/fontainebleaulive** (lien de la bio : `/ce-week-end/`),
  liés en pied de toutes les pages du site (logos en SVG dans la page, rien de chargé chez Meta ;
  clics `social/…`). **Premier carrousel publié à la main** le 20/11, pour le week-end du 21-22/11 :
  post sur la page Facebook, partagé dans un groupe local, et sur Instagram. Deux légendes depuis
  (`legende-facebook.txt`, `legende-instagram.txt`) : Instagram ne rend jamais un lien de légende
  cliquable, d'où « lien en bio ».
- **Suite** : encore un ou deux jeudis publiés à la main (`node scripts/carousel.js` le mercredi
  ou le jeudi), puis le jeton Meta (secret GitHub, aucun mot de passe partagé) et le workflow
  semi-automatique (aperçu le mercredi, publication en un clic le jeudi, item 115 (d)). Le
  carrousel pourra un jour annoncer la quête de la semaine du jeu.

---

## 1. Pitch

**Le Pays de Fontainebleau comme un monde de jeu.** On explore la ville, le château, la forêt et
les villages pour de vrai. Chaque lieu visité débloque une carte qui raconte sa vraie histoire,
fait gagner de l'XP et avance des quêtes. Une enquête historique sert de fil rouge. Et le monde
est **vivant** : les événements de l'agenda de Fontainebleau Live apparaissent sur la carte, le
jour J.

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
| **Jeunes adultes en week-end** | Une sortie originale, des choses à partager | Des cartes à montrer, une quête qui tient une journée |
| **Hôtels, séminaires** | Occuper un après-midi, une activité clé en main | Le jeu offert dans le pack d'accueil, plus tard un mode équipes |
| **Grimpeurs** | Les blocs mythiques, la culture de Bleau | La quête « 5 Must Climb » et l'histoire des sites |
| **Habitants** | Redécouvrir chez eux | Des séries complètes, des quêtes de saison |

Les familles ne sont pas le public prioritaire : `/foret/` et le calendrier de l'Avent les servent.

## 4. Piliers

1. **Le vrai lieu d'abord.** Le jeu fait lever les yeux de l'écran : la récompense, c'est d'être
   là. Chaque texte est **vrai et sourcé** ; l'IA ne produit jamais un fait ni une étape.
2. **Généreux.** On ne bloque jamais un joueur : GPS **ou** question d'observation **ou** sur
   l'honneur, des indices jusqu'à la solution. Moins d'XP, jamais d'impasse.
3. **Vivant.** Les événements de l'agenda, les saisons, la quête de la semaine.
4. **Solo d'abord.** Tout se joue seul. Le social (classements, équipes) viendra ensuite.
5. **Respect du lieu.** Des sentiers existants, aucune étape en réserve ni en zone de quiétude,
   aucune au bord d'une route, rien de posé dans la nature.

## 5. Benchmark (20/11/2026)

| Jeu | Chiffres | Mécanique clé | On prend | On laisse |
|---|---|---|---|---|
| **Pokémon GO** (Niantic, Scopely depuis 2025) | 20 M de joueurs par semaine, 10 M par jour (mars 2025) ; plus de 1 Md$ en 2025 ; plus de 9 Md$ en dix ans | Lieux réels comme points d'intérêt (PokéStops), raids et événements à date, Routes partagées, vitrines ; sponsors payés à la visite (« moins de 0,50 $ par visiteur unique », 2017) | Les lieux réels, **les événements datés**, plus tard les itinéraires et les lieux partenaires | Le combat, le hasard payant |
| **Dragon Quest Walk** (Square Enix, Japon seul) | Plus de 2 Md$ (avril 2024), 86 M$ le premier mois ; **51 $ par joueur** le premier mois, contre 12 $ pour Pokémon GO | Un RPG où **marcher fait progresser un personnage**, avec quêtes et histoire | **La progression RPG et le récit** : l'enquête historique en chapitres, niveaux et titres | Le gacha |
| **FlashInvaders** (Invader) | Plus de 4 000 mosaïques suivies par les applis de fans ; 10 à 100 points par mosaïque, un score par ville | Trouver une œuvre réelle, la « flasher » (photo + GPS), une galerie | La chasse, **la valeur variable par trouvaille**, le score par ville, la galerie | Les œuvres posées (il faudrait des autorisations) |
| **Tèrra Aventura** (CRT Nouvelle-Aquitaine) | Gratuit, payé par les territoires ; environ 240 000 joueurs par an dans la seule Vienne ; 400 à 600 parcours | Badges de personnages (Poï'z) à collectionner ; un **joker** (on en regagne un tous les 10 trésors trouvés sans aide) ; un personnage qui récompense l'éco-geste (ramasser un déchet) | La collection de personnages, **le joker généreux**, **l'éco-geste récompensé**, le modèle institutionnel | La cache physique |
| **Fog of World** | Depuis 2012, 30 $, données sur l'appareil | Un brouillard de guerre qui se lève là où l'on marche | Le brouillard des sentiers (couche ultérieure) ; **la position ne quitte pas le téléphone** | — |
| **Pikmin Bloom** | 100 M$ cumulés ; la seule des trois licences Niantic en croissance chaque année | Un jeu doux de marche, sans combat | **Le ton doux**, la marche récompensée | — |
| **Monster Hunter Now** | 337 M$ en trois ans, mais des revenus en chute (-69 % la deuxième année) | Combat et grind | La leçon : **le combat et la répétition s'usent** | Le combat |
| **Boolder** | Gratuit, libre, la référence du bloc à Bleau | Topo, carte des blocs, croix | **On renvoie vers lui**, on ne le refait pas | — |
| myCityHunt, Urban Quest, Forest Mystery, Paris Region Aventures | 12,99 € par personne à 30-36 € ; PRA gratuit | Jeux de piste à usage unique | — | Le format |

## 6. Boucles de jeu

- **À la minute** : je marche, la carte montre un lieu proche, j'arrive, je le débloque (GPS ou
  question), je lis sa carte, je gagne de l'XP.
- **Sur une sortie** : une quête du jour ou de la semaine (« trois lieux des peintres de
  Barbizon », « un marché de Noël »), un événement de l'agenda sur le chemin.
- **Sur des semaines** : compléter des séries, monter de niveau, gagner des titres, finir les
  chapitres de l'enquête, les quêtes de saison.

### 6.1 Le parcours d'entrée (revu le 21/11 après les retours du chef de projet)
Trois écrans, moins d'une minute, « Passer » à chaque étape :
1. **Accueil** : le nom (centré), trois promesses (explorer, collectionner, vivre les événements du
   jour), « Gratuit. » — ni « sans compte » (un compte viendra, facultatif) ni « sans publicité »
   (rien n'est exclu).
2. **Vous venez…** : pour un week-end, j'habite dans le coin, j'étudie ici, en groupe (avec le
   code donné par l'organisateur, facultatif), et **« Un peu de tout »** (plusieurs à la fois, ou
   je préfère ne pas répondre). L'explication (« sert seulement à choisir votre première quête »)
   est en bas de l'écran, au-dessus du bouton.
3. **La position** expliquée *avant* la demande du navigateur : elle reste sur le téléphone ; sans
   elle on joue quand même (question ou honneur).

Puis **la carte**, centrée sur le joueur (ou le centre-ville), **allégée** : seulement les lieux
et les événements en direct, **sous le brouillard** (activé par défaut le 21/11 : il concentre le
regard sur ce qui est autour ; sans position, une clairière sur le centre-ville) ; quêtes, grimpe
et Noël restent à un geste, dans le panneau des couches, et « Touchez un lieu près de vous pour commencer ». **Rien ne s'affiche par-dessus
la carte à son arrivée** (21/11 : le « niveau 2 » immédiat la cachait) : 5 XP « premier pas » au
premier lieu ou événement touché, sous le seuil du niveau 2 ; le premier passage de niveau vient
après trois ou quatre actions (§8).

**Lisibilité de la carte (21/11)** : rien ne doit faire « guirlande de Noël ». Événements en petits
carrés (24 px) aux couleurs de catégorie adoucies ; un événement en cours pulse lentement dans le
vert du site, seule l'étiquette « LIVE » reste rouge ; les lieux restent en ronds ; crédit
OpenStreetMap discret.

Retirés le 21/11 : **la première quête imposée** (hors contexte : elle ne tenait pas compte de
l'endroit où l'on est, « trop violent »), **« Ce qui vous attire »** (le jeu propose tout à tout le monde : balades,
histoire, événements ; un écran de trop) et **« Un compte ? Pas besoin. »** (on joue sans compte,
point ; le code de sauvegarde et le futur compte sont dans le profil, §12). Le bouton « J'ai un code
de sauvegarde » de l'accueil part avec lui, dans le profil.

## 7. Les couches du monde

### 7.1 Les lieux (collection permanente)
- Environ 150 à terme, **35 au premier jalon** (30 en ville et autour du château, 5 classiques de
  la forêt).
- Types : monument, jardin, rocher nommé, site des sentiers bleus de Denecourt (tour Denecourt,
  rocher Cassepot, mont Ussy…), belvédère, gorges, village et maison de peintre, patrimoine
  urbain, site de bloc.
- Chaque lieu porte une **carte** : nom, illustration, série, rareté, un texte court **sourcé**
  (la source s'affiche), une anecdote, une question d'observation de secours.
- **Rareté** selon l'effort ou la saison, jamais selon le hasard : commun (en ville),
  peu commun (lisière), rare (au cœur d'un massif), légendaire (une saison, une heure,
  une série complète).
- **Les sentiers bleus** (série de Denecourt) : cinq lieux dans la maquette du 21/11, mont Ussy,
  tour Denecourt, rocher Cassepot, caverne d'Augas, grotte du Serment (positions OSM ; textes à
  écrire et sourcer). La quête remonte en tête des quêtes permanentes, juste après l'enquête.

### 7.1 bis Les Space Invaders (série, demandée le 21/11)
- 46 mosaïques d'Invader posées en 2023, à Fontainebleau et dans 23 communes autour ; au
  25/07/2026, 32 encore « flashables », 14 détruites (pixel-hunting.com, dont la carte n'est pas
  réutilisable : mentions légales ; OpenStreetMap n'en recense aucune, vérifié le 21/11).
- **Les positions viennent du chef de projet**, qui a vu la plupart des mosaïques en se promenant :
  ce sont nos propres données. Les quatre du parcours à pied du centre-ville (`scripts/balades.js` :
  lampe abat-jour rue Dénecourt, Napoléon place de la République, alien rouge rue du
  Conventionnel-Geoffroy, alien bleu rue des Trois-Maillets) sont dans la maquette, **placées à la
  rue** (BAN), pas au mur : on cherche encore. Les autres : relevé du chef de projet (rue et
  description) ; l'état de chacune (détruite depuis ?) se vérifie sur place.
- Couche « Invaders » sur la carte, active par défaut. Validation : GPS (100 m) ou sur l'honneur,
  15 XP (8 sur l'honneur). Le nom se découvre en la trouvant.
- **Pas de photo** : l'œuvre est à Invader.

### 7.2 Les événements (en direct) — la force du jeu
**Décision du 21/11 : les événements de l'agenda sont ce que les autres jeux n'ont pas.** Ils sont
identifiables au premier coup d'œil et rapportent le plus d'XP.
- **Repérables** : sur la carte, un carré (les lieux sont des ronds) à la couleur de la catégorie,
  avec le jour (« sam ») ou **« LIVE »** qui pulse le jour même ; un bandeau en haut de la carte
  (« 8 en direct aujourd'hui · 56 cette semaine ») ; un onglet **En direct** avec un compteur,
  la liste **d'aujourd'hui et de demain seulement** (21/11 : quatre jours et plus, c'était trop
  long à faire défiler), l'XP de chaque sortie ; le reste de la semaine et Noël sont sur la carte.
- **Portée, décidée le 21/11** : les sorties à **12 km autour du joueur** (du centre-ville sans
  position), et la portée **le suit** quand il bouge ; la carte reste lisible. La page embarque
  toute la zone de l'agenda (20 km) et filtre sur le téléphone : la position n'est envoyée nulle
  part. L'événement du jour est le même pour tous ceux d'un même secteur.
- **L'événement du jour** : un des événements du jour, le même pour tous, **XP doublée** (40),
  étoile dorée sur la carte. C'est la raison d'ouvrir le jeu chaque jour.
- **« J'y vais »** sur une sortie à venir : un rappel le jour J (sans XP, l'XP se gagne sur place).
- **Quêtes d'événements** : la quête de la semaine (deux sorties d'ici dimanche), « Quatre genres
  de sorties » (une sortie de chaque genre : spectacle, atelier ou expo, nature, sport ; nommée
  « Toutes les scènes » jusqu'au 21/11, pas compris).
- Les fiches de l'agenda **confirmées par une source lue** (jamais Gemini seul, la règle du
  carrousel) deviennent des étapes éphémères **le jour J**, à leur adresse.
- Y passer donne une **carte souvenir datée** (« Marché de Noël de Fontainebleau, 2026 ») et de
  l'XP bonus. Le jeu envoie du monde aux organisateurs, et nous savons le compter : c'est la
  preuve à montrer aux organisateurs et aux communes (item 114).
- Pas d'événement payant imposé : passer devant suffit, on n'exige jamais un billet.
- Validation : GPS dans un rayon de 200 m **le jour même**, ou sur l'honneur à demi-XP.

### 7.3 Les quêtes
- **Quête principale : l'enquête historique**, en chapitres répartis sur les lieux (sujet à
  choisir : la cour, Napoléon, les peintres, Denecourt…). Chaque chapitre se débloque en visitant
  ses lieux, dans l'ordre qu'on veut.
- **Défis thématiques** : « Napoléon à Fontainebleau », « Les peintres de Barbizon », « Les sentiers
  bleus », **« 5 Must Climb »** (ci-dessous).
- **Quêtes de saison** (retenues le 21/11) : Noël (marchés de Noël de l'agenda, couche « Noël » sur
  la carte, bonus de 5 XP par sortie ; le calendrier de l'Avent du site devient une quête), le brame
  (septembre-octobre, depuis un point d'écoute autorisé), les champignons (une sortie de l'agenda,
  jamais de cueillette conseillée), le printemps du bloc.
- **Quête de la semaine**, annoncée par le carrousel du jeudi (item 115).
- **Éco-geste** (repris de Tèrra Aventura) : ramasser un déchet en forêt rapporte un badge, sur
  l'honneur.

### 7.4 « 5 Must Climb, en famille »
**Décision du 21/11 : très accessible.** Pas cinq blocs durs, mais **cinq sites de bloc à visiter
en famille** : on vient, on regarde, on essaie les premiers blocs du circuit le plus facile, à son
niveau. Aucune cotation exigée.
- Proposition à valider avec des grimpeurs (positions OSM relevées le 21/11) : **Bas Cuvier**
  (le site historique), **Rocher Canon**, **Canche aux Merciers**, **Cul de Chien** (le sable des
  Trois Pignons), **l'Éléphant** à Larchant (le rocher en forme d'éléphant). Pour chacun, vérifier
  qu'un circuit enfants ou très facile existe et que le parking est proche.
- Validation comme un lieu (GPS 150 m, question, honneur) : on valide la **visite**, pas une
  ascension. Couche « Grimpe » sur la carte.
- Chaque site renvoie vers **Boolder** pour le topo ; aucune description de passage écrite par nous.
- Un avertissement de sécurité (crash-pad, parade, jamais sur rocher mouillé), et rien qui pousse
  à grimper au-dessus de son niveau.
- Plus tard, peut-être, une variante pour grimpeurs confirmés (blocs mythiques par niveau, sur
  l'honneur ; exemple sourcé : La Marie-Rose, Bas Cuvier, 6a, René Ferlet, 1946).

### 7.5 L'exploration (couche « Brouillard »)
- Le brouillard des sentiers balisés (près de 300 km dans le Pays de Fontainebleau) : un
  pourcentage de forêt explorée, des badges par massif. Le tracé reste sur le téléphone. La
  maquette montre l'idée : la carte assombrie, éclaircie autour de ce qu'on a vu. Dessiné sur un
  canevas (21/11) : les clairières qui se chevauchent se fondent, bords adoucis ; le premier essai
  en polygone troué rassombrissait les chevauchements.

### 7.6 Les couches, comme sur une application de cartes
Un bouton en haut à droite ouvre un panneau : **type de carte** (Plan, Doux, Nuit : les mêmes
tuiles OpenStreetMap, filtrées, aucun fournisseur tiers) et **couches** à cocher : Lieux,
En direct, Quêtes (étapes numérotées de l'enquête), Grimpe, Saison (Noël en ce moment),
Brouillard.

### 7.7 Navigation (21/11)
- **Barre du haut** : niveau, titre, barre d'XP et le bouton **Profil** (badges, titres,
  sauvegarde).
- **Barre du bas** : Carte, En direct, Collection, Quêtes, **Boutique**.
- Ordre des quêtes : cette semaine (événements), puis **toujours là** (enquête, sentiers bleus,
  5 Must Climb), puis de saison.

## 8. Progression
- **XP** (barème revu une troisième fois le 21/11, à régler en test) : lieu commun 15, peu commun
  20, rare 30, légendaire 60 ; **événement 20, événement du jour 40**, bonus de saison 5 ;
  « Quatre genres de sorties » 50 ; mosaïque d'Invader 15 ; série complète 40 ; éco-geste 10 ;
  premier pas 5 ; validation sur l'honneur à la moitié (arrondie). **Aucun gain ne vaut plus d'un
  niveau.** Le bonus de série ne vaut que pour une série d'**au moins trois lieux** (21/11 : la série
  « Napoléon » de la maquette, un seul lieu, ajoutait 40 XP à la première réponse, d'où un niveau 2
  inattendu après « +15 XP ») ; des gains simultanés s'affichent ensemble.
- **Niveaux** 1 à 30 : le niveau n commence à 30·n·(n−1) XP (60, 180, 360, 600, 900…).
  **Niveau 2 après trois ou quatre actions**, puis six à huit pour le niveau 3, et de plus en plus.
  Historique du 21/11 : le premier barème (événement 150, niveau 3 à 150 XP) faisait passer du
  niveau 1 au niveau 6 en deux événements ; le deuxième (niveau 2 à 50 XP) montait dès le premier
  événement ; le troisième (lieu 40, série complète 200, niveau 2 à 100) faisait encore monter de
  deux ou trois niveaux en une ou deux questions, la série « Napoléon » de la maquette n'ayant
  qu'un lieu (« ça monte trop vite, laisse-moi du temps »). **Un écran par niveau franchi**, l'un après l'autre ; « Nouveau titre » seulement quand
  le titre change, sinon le prochain titre à viser.
- **Titres** : Promeneur, Flâneur, Bellifontain, Peintre de Barbizon, Bleausard, … Denecourt.
- **Badges** : séries, saisons, éco-geste, premier événement, « 5 Must Climb ».
- **Collection** : pourcentage par série et global, la galerie des cartes.

## 9. Valider une étape (« soyons généreux »)
1. **GPS** : rayon de 100 m en ville, 150 m en forêt (précision moindre sous les arbres).
2. **Ou une question d'observation** sur place (une date gravée, un détail de statue), quand le GPS
   décroche ou qu'on refuse la géolocalisation.
3. ~~Ou sur l'honneur~~ : **retiré des lieux le 22/11** (chef de projet : « on a déjà Pas de GPS, c'est
   la même chose »). Un lieu se collecte par le GPS ou par sa question ; un simple point à collecter,
   sans question, seulement par le GPS. Le « sur l'honneur » reste pour les Space Invaders, qui n'ont
   pas de position (§7.1 bis), et les événements : « sur l'honneur » pour ce qui n'a pas de position
   GPS (22/11, « on verra »).
- **Forme de la question (21/11)** : trois choix, comme le jeu de la forêt ; elle porte sur ce
  qu'on **voit sur place** (forme d'un escalier, nombre de chiens d'une fontaine, matériau d'une
  façade), pas sur une date à connaître. Une mauvaise réponse grise ce choix (« regardez encore »),
  sans pénalité. Le texte de la carte (trois phrases, la source affichée dessous) ne s'ouvre
  qu'une fois le lieu collecté **et la question résolue** : validé par le GPS, le
  joueur a encore la question, qui ouvre l'histoire et rapporte 5 XP (21/11 : « je peux très bien
  dire j'y suis, mais je veux quand même la question »). **La question est toujours visible sur la
  fiche** (22/11 : « on doit toujours voir la question ») : avant la visite, directement sous le
  bouton GPS (« Pas de GPS ? Répondez à la question »), sans bouton à ouvrir ; une fois résolue, elle
  reste affichée, la bonne réponse cochée, au-dessus de l'histoire. **Retour de réponse sur le bouton
  lui-même** (22/11 : la bulle verte « Pas tout à fait » était trop discrète et faisait croire à une
  bonne réponse) : croix et fond rouge sur une mauvaise réponse, « Pas tout à fait : regardez encore
  autour de vous » en rouge sous la question ; coche et fond vert sur la bonne, « Bonne réponse ! »,
  puis la fiche remonte sur la carte collectée et son histoire. Sans GPS, la question valide à la fois
  la visite et l'histoire. Textes provisoires dans la maquette (`CARDS`) : chaque fait vient
  de la source citée ; passe complète au développement (116d), avec la vérification des questions
  sur place ; la source du jardin de Diane est à recouper avec le château.
- Des indices jusqu'à la solution. Des jokers (reprendre l'idée de Tèrra Aventura).
- Triche : sans importance tant que le jeu est solo. Les classements, plus tard, ne compteront
  que les validations GPS.

## 10. Direction artistique
**Décision du 21/11 : le style du site** (« reprendre le style du site est bien »), avec les
icônes dessinées ci-dessous.

**Pixel art, essayé et écarté le 21/11** (« ça ne va pas ») : mêmes écrans avec police à chasse
fixe, angles droits, bordures épaisses, carte OpenStreetMap en gros pixels. Retiré de la maquette.

Pistes encore possibles, pour **les illustrations des cartes de lieux** seulement (pas
l'interface) : gravure (Ridinger, CC0, déjà sur `/foret/`), aquarelle ou huile façon École de
Barbizon. Même lieu, même carte, comparés sur téléphone avant de choisir.

**Icônes (21/11, « bien mieux »)** : les emojis (rendus différemment selon le téléphone, « pas
top ») sont remplacés par un jeu d'icônes au trait dessiné pour le projet
(`scripts/bleau-quest-icons.js`). Les lieux verrouillés montrent leur icône grisée plutôt qu'un
« ? ». Restent en emoji : parcours d'entrée, badges, titres des quêtes (à reprendre).

## 11. Plateforme et technique
- **Web d'abord**, sur fontainebleaulive.fr (`/jeu/` ou `/bleau-quest/`), en PWA installable.
  Contenu dans un fichier écrit à la main (`scripts/bleau-quest.js`, comme `foret.js`), pages
  générées par `generate-pages.js`, construit en `textContent`, sans dépendance.
- Progression dans `localStorage` (avec un code d'export pour changer de téléphone). **La position
  ne quitte jamais le téléphone.** Carte Leaflet (`vendor/`), tuiles OpenStreetMap (pas de
  téléchargement en masse pour le hors ligne : les règles d'OSM l'interdisent).
- La couche événements lit `data.json`, avec la règle du carrousel du jeudi : `carouselPool()` de
  `generate-pages.js` (sources lues seulement, quatre jours au plus, pas d'offre permanente ni de
  petit train), pour que le jeu, le post et `/ce-week-end/` montrent les mêmes sorties.
- **La maquette** est servie par un petit serveur local (`127.0.0.1`) : OpenStreetMap refuse les
  tuiles à une page ouverte depuis le disque (`file://`, sans Referer). En ligne, la question ne
  se pose pas.
- **Application Android plus tard** (compte développeur Google existant) : une *Trusted Web
  Activity* emballe la PWA pour le Play Store sans la réécrire. iOS ensuite.
- Un serveur (Cloudflare Worker) seulement pour ce qui l'exige : classements, synchronisation
  entre appareils, avantages partenaires. C'est la première entorse au tout statique, à décider
  le moment venu.

## 12. Compte et monétisation (pensés dès le 21/11, rien vendu au premier jalon)

### 12.1 Faut-il un compte ? Non, pas pour jouer.
- **Jouer sans compte** est le choix par défaut : la progression vit sur le téléphone. Chaque
  écran d'inscription perd des joueurs, et un compte oblige à garder des données personnelles
  (courriel, progression), donc un serveur, une base, des droits RGPD à tenir.
- **Code de sauvegarde** : la progression exportée en un code ou un QR, pour changer de
  téléphone. Sans serveur.
- **Compte facultatif, plus tard**, par courriel sans mot de passe (lien magique), le jour où l'un
  de ces trois besoins arrive : jouer en équipe (classement partagé), retrouver un achat sur un
  autre appareil, jouer sur plusieurs appareils. C'est le même serveur que §11 (Cloudflare
  Worker), et une ligne de plus dans les mentions légales.
- Sur l'application Android, Google Play retrouve lui-même les achats : le compte y est encore
  moins nécessaire.

### 12.2 Ce qui pourra s'acheter
> **À revoir en séance dédiée** (21/11) : ces offres ne correspondent pas à ce que le chef de
> projet a en tête. La boutique a son onglet dans la barre du bas, vide en attendant.

Règle : **ce qui s'achète ne donne jamais d'XP, de lieu ni d'événement.** Pas de publicité, pas de
hasard payant, pas d'énergie à recharger.

| Offre | Pour qui | Prix indicatif | Ce qu'il faut construire |
|---|---|---|---|
| **Session d'équipe** (code, classement, récapitulatif pour l'organisateur) | séminaires, INSEAD, écoles, hôtels | sur devis, par groupe | le serveur (classement). Le premier revenu réaliste à 5 000 visites par mois |
| **L'enquête complète** (chapitre 1 gratuit, 2 à 5 payants) | joueurs conquis | 4,99 € une fois | l'enquête écrite ; un déblocage |
| **Coffret souvenir** (cartes d'une série imprimées, pin's) | visiteurs, cadeau | ~12 € | un imprimeur, l'envoi. Un objet, donc hors des règles des magasins d'applications |
| **Autre style de cartes** (gravure, aquarelle) | collectionneurs | 1,99 € | les essais de 116c servent deux fois |
| **Soutien à prix libre** | habitués | libre | le lien Stripe existe déjà (balades) |
| Saison financée par l'office de tourisme ou l'interco (modèle Tèrra Aventura) | institutions | convention | des chiffres d'usage (M2) |
| Commerçants partenaires, signalés comme tels | commerces | plus tard (décision du 20/11) | — |

- **Paiement** : sur le web, Stripe (déjà utilisé pour les balades), sans commission de magasin.
  Sur Android, un contenu numérique vendu dans l'application passe par la facturation Google Play
  (15 % pour un petit éditeur) ; un objet physique ou une prestation (session d'équipe) peut rester
  sur Stripe.
- **Sans serveur, un déblocage n'est pas un verrou** : le site est public, un code de déblocage
  se contourne. Acceptable pour un prix bas et honnête (comme le prix libre des balades) ; un vrai
  verrou attendra le serveur.

## 13. Garde-fous
- **ONF** : des lieux seulement sur les sentiers existants, aucun en réserve biologique ni en zone
  de quiétude ; période du brame respectée ; **leur présenter le projet avant de publier des lieux
  en forêt** ; une activité commerciale en forêt domaniale peut demander une convention.
- **Parc du château** : vérifier auprès de l'établissement public.
- **Sécurité** : aucune étape au bord d'une route ni sur un rocher dangereux ; avertissements
  pour le bloc.
- **Vie privée** : géolocalisation demandée au moment du jeu, jamais transmise ; dit dans
  `/mentions-legales/`.
- **Faits** : sourcés, relus par le chef de projet ; faits naturalistes contre l'ONF et l'INPN.
- **Droits** : illustrations du chef de projet ou libres (CC0), crédit OSM.

## 14. Mesure
GoatCounter, sans rien qui identifie le joueur : `quest-start`, `spot-unlock/<id>`,
`spot-method/<gps|question|honneur>`, `event-checkin`, `level/<n>`, `set-complete/<série>`.

## 15. Jalons
| Jalon | Contenu | Quand |
|---|---|---|
| **M0 Maquette** | Maquette cliquable : carte, fiche de lieu, collection, profil, couche événements avec les vraies données. v2 du 21/11 : parcours d'entrée, panneau de couches, onglet En direct et événement du jour, Noël, brouillard, grimpe en famille, compte et boutique | Fait le 20-21/11 |
| **M1 Prototype jouable** | 30 lieux en ville et au château, 5 en forêt, XP, niveaux, badges, couche événements, FR/EN, une première série et un premier chapitre | 4 à 6 semaines |
| **M2 Test sur place** | Amis, puis un groupe d'étudiants de l'INSEAD ; grille d'observation | Après M1 |
| **M3 Lancement public** | Page, liens depuis le site, carrousel dédié | Après M2 |
| **M4 Couches suivantes** | « 5 Must Climb, en famille », brouillard, quêtes de saison, enquête complète, code de sauvegarde | 2027 |
| **M5 Application Android** | TWA sur le Play Store, si l'usage le justifie | 2027 |

## 16. Questions ouvertes
1. **Le sujet de l'enquête** : la cour (Renaissance), Napoléon, les peintres, Denecourt ?
2. **La direction artistique** : quels styles essayer en premier ?
3. ~~**Le nom**~~ : décidé le 21/11, « Fontainebleau Live Collection » (« Bleau » n'est pas compris de tous).
4. **Les 35 lieux du M1** : la liste, avec le chef de projet, à partir du parcours à pied vérifié.
5. **Les « 5 Must Climb, en famille »** : valider les cinq sites proposés (circuit enfants, parking,
   fréquentation) avec des grimpeurs, et avec l'ONF.
6. **Quand parler à l'ONF** : avant M1 pour les 5 lieux en forêt ?
7. **Propositions d'interface** : plusieurs maquettes de contenu à comparer, dans le style du site
   (21/11 : reprendre le style de Fontainebleau Live est bien).
8. **La première offre payante** : la session d'équipe (B2B, serveur nécessaire) ou l'enquête
   complète (B2C, sans serveur) ?
