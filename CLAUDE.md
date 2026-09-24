# Agrégateur d'événements — Fontainebleau

Application web statique qui collecte automatiquement les événements autour de Fontainebleau
(**rayon de 20 km**, `MAX_RADIUS_KM` dans `scripts/fetch-events.js`) et les affiche sur une carte
et un calendrier. Trois sources : Gemini, DATAtourisme, OpenAgenda.

## À lire en premier

**[Events-calendar-DesignTechdoc.md](Events-calendar-DesignTechdoc.md) fait autorité.** Il contient
l'architecture, le schéma de données, le journal des décisions, les risques et la roadmap
priorisée. Consulte-le avant toute modification, et **mets-le à jour dans le même commit que le
code** — journal des décisions (§7) et roadmap (§9). Le doc a déjà dérivé du code par le passé.

## Structure

| Fichier | Rôle |
|---|---|
| `scripts/fetch-events.js` | Pipeline de collecte : scans Gemini + DATAtourisme → validation → fusion → géocodage → vérification des URL |
| `scripts/datatourisme.js` | Bibliothèque partagée DATAtourisme (téléchargement, parsing, correspondance) — utilisée par le pipeline **et** par la sonde |
| `scripts/openagenda.js` | Troisième source : OpenAgenda via le portail Île-de-France. Sans clé, filtrage côté serveur. Les agendas emploi sont exclus par éditeur |
| `scripts/feedback.js` | Lecture du formulaire de signalement (CSV publié). Seul le masquage est automatique ; tout le reste part en relecture humaine |
| `scripts/translate.js` | Descriptions anglaises. Appel Gemini **non grounded**, cache par hash du texte français |
| `scripts/translate-data.js` | Utilitaire hors bande : traduit les descriptions de `data.json` sans lancer de scan (`--sample` pour relire avant publication) |
| `translate-cache.json` | **Généré et commité.** Cache de traduction — sans lui, chaque run CI retraduirait tout |
| `overrides.json` | **Édité à la main, jamais généré.** Corrections durables, appliquées à chaque run et clées par id d'événement |
| `venues.json` | **Édité à la main.** Coordonnées exactes des lieux récurrents, consultées avant la BAN — qui ne connaît que des adresses, pas des noms de salles |
| `index.html` | Frontend complet (HTML + CSS + JS dans un seul fichier), Leaflet + FullCalendar |
| `data.json` | **Généré.** Source de vérité des événements — ne jamais éditer à la main |
| `manifest.json` / `sw.js` | PWA (installable, hors ligne). Le service worker est **réseau d’abord** : jamais de cache servi en priorité |
| `CNAME` | Domaine perso `fontainebleaulive.fr` servi par GitHub Pages |
| `og-image.png` | Visuel de marque (1200×630) pour les aperçus de lien, composé depuis `BackgroundDeco-FL-v1.png` |
| `favicon.ico` | Favicon 16/32/48 à la racine — celui que Google Search et les robots demandent directement |
| `geocode-cache.json` | **Généré.** Cache de géocodage BAN |
| `.github/workflows/` | `daily-check.yml` (collecte) et `translate.yml` (traduction à la demande) |

`app.js` et `style.css` sont des reliquats vides : tout le frontend vit dans `index.html`.

`overrides.json` et `venues.json` sont les **seuls** fichiers de données modifiables à la main. `data.json` est
régénéré à chaque scan : toute correction faite directement dedans est perdue au run suivant.

## Contraintes à respecter

- **Zéro dépendance** dans `scripts/` : bibliothèque standard Node uniquement (`fs`, `path`,
  `crypto`, `fetch` global). Node ≥ 18 requis, les workflows utilisent Node 22.
- **Pas de build** : `index.html` est servi tel quel par GitHub Pages. Les CDN autorisés sont
  ceux déjà présents (Leaflet, FullCalendar) + GoatCounter si `ANALYTICS.code` est renseigné.
  Décision du 21/09 : **pas de CDN de polices ni de fournisseur de tuiles tiers.**
- **Sécurité du frontend** : tout contenu venant du LLM ou du web est hostile. Passe les textes
  par `escapeHtml()` et les liens par `safeUrl()` (schémas `http(s)` uniquement). Ne jamais
  injecter de champ de `data.json` via `innerHTML` sans échappement.
- **Fins de ligne CRLF** sur les fichiers existants — les préserver lors des éditions.
- **Langue** : interface bilingue FR/EN (dictionnaire `STRINGS` dans `index.html`), dates en
  `Europe/Paris`. Côté données, **seule la `description` est traduite** (`descriptionEn`) : les
  titres, horaires, tarifs et noms de lieux restent en français pour rester reconnaissables sur
  une affiche ou un guichet. Les commentaires de code sont en anglais, sauf dans les workflows.
- **`data.json` accepte deux formes** : l'objet `{ schemaVersion, generatedAt, windowEnd, events }`
  et le tableau nu hérité de la v1. Les deux lecteurs (script et frontend) doivent continuer à
  gérer les deux.

## Commandes

```bash
# Essai local sans rien écrire (fait de vrais appels Gemini, donc facturés)
GEMINI_API_KEY=… DRY_RUN=1 node scripts/fetch-events.js

# Forcer un scan malgré la cadence de 60 h
GEMINI_API_KEY=… FORCE_RUN=1 node scripts/fetch-events.js

# Le pipeline principal importe aussi DATAtourisme automatiquement ; DATATOURISME=0 pour le désactiver
GEMINI_API_KEY=… DATATOURISME=0 OPENAGENDA=0 DRY_RUN=1 node scripts/fetch-events.js

# Lecture du formulaire de signalement. Sans FEEDBACK_CSV_URL, la fonctionnalité est simplement
# inactive. L'URL vit dans le secret GitHub du même nom, jamais dans le dépôt : une réponse peut
# contenir le contact facultatif du visiteur.
FEEDBACK_CSV_URL=… GEMINI_API_KEY=… DRY_RUN=1 node scripts/fetch-events.js

# Relire quelques traductions AVANT quoi que ce soit (rien n’est écrit, coût marginal).
# Le pipeline publie sans relecture humaine : vérifier la formulation une fois, ici, coûte
# moins cher que de la découvrir sur 171 cartes en ligne.
GEMINI_API_KEY=… node scripts/translate-data.js --sample 8

# Remplir data.json maintenant, sans attendre le prochain scan (~7 000 tokens, pas de grounding).
# Remplit aussi translate-cache.json : le scan suivant ne repaiera rien. Commiter les DEUX.
GEMINI_API_KEY=… node scripts/translate-data.js --write

# Désactiver la traduction sur un run
TRANSLATE=0 GEMINI_API_KEY=… node scripts/fetch-events.js
```

## Cadence et coûts

Le workflow se déclenche chaque jour mais le script ne scanne réellement que si `data.json` a plus
de 60 h (`MIN_RUN_INTERVAL_HOURS`), soit **un scan tous les ~3 jours**. Un déclenchement manuel
force le scan. Chaque scan consomme des tokens Gemini facturés : ne pas lancer de run réel sans
raison.

## Ce qui n'est pas automatisé

Les runs publient directement sur `main`, sans relecture humaine. La confiance dans les données
est le produit : une date fausse coûte plus cher qu'un événement manquant. La validation, la
vérification des URL et les contrôles de cohérence sont des fonctionnalités de premier plan, pas
du polish — voir §5 du doc de conception.
