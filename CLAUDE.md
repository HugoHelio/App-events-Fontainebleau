# Agrégateur d'événements — Fontainebleau

Application web statique qui collecte automatiquement les événements de la région de
Fontainebleau (rayon ≈ 15 km) et les affiche sur une carte et un calendrier.

## À lire en premier

**[Events-calendar-DesignTechdoc.md](Events-calendar-DesignTechdoc.md) fait autorité.** Il contient
l'architecture, le schéma de données, le journal des décisions, les risques et la roadmap
priorisée. Consulte-le avant toute modification, et **mets-le à jour dans le même commit que le
code** — journal des décisions (§7) et roadmap (§9). Le doc a déjà dérivé du code par le passé.

## Structure

| Fichier | Rôle |
|---|---|
| `scripts/fetch-events.js` | Pipeline de collecte : scans Gemini → validation → fusion → géocodage → vérification des URL |
| `scripts/datatourisme-coverage.js` | Sonde de couverture DATAtourisme, **mode observation** : ne modifie jamais `data.json` |
| `index.html` | Frontend complet (HTML + CSS + JS dans un seul fichier), Leaflet + FullCalendar |
| `data.json` | **Généré.** Source de vérité des événements — ne jamais éditer à la main |
| `geocode-cache.json` | **Généré.** Cache de géocodage BAN |
| `.github/workflows/` | `daily-check.yml` (collecte) et `datatourisme-coverage.yml` (observation) |

`app.js` et `style.css` sont des reliquats vides : tout le frontend vit dans `index.html`.

## Contraintes à respecter

- **Zéro dépendance** dans `scripts/` : bibliothèque standard Node uniquement (`fs`, `path`,
  `crypto`, `fetch` global). Node ≥ 18 requis, les workflows utilisent Node 22.
- **Pas de build** : `index.html` est servi tel quel par GitHub Pages. Les CDN autorisés sont
  ceux déjà présents (Leaflet, FullCalendar).
- **Sécurité du frontend** : tout contenu venant du LLM ou du web est hostile. Passe les textes
  par `escapeHtml()` et les liens par `safeUrl()` (schémas `http(s)` uniquement). Ne jamais
  injecter de champ de `data.json` via `innerHTML` sans échappement.
- **Fins de ligne CRLF** sur les fichiers existants — les préserver lors des éditions.
- **Langue** : interface et données en français, dates en `Europe/Paris`. Les commentaires de
  code sont en anglais, sauf dans les workflows.
- **`data.json` accepte deux formes** : l'objet `{ schemaVersion, generatedAt, windowEnd, events }`
  et le tableau nu hérité de la v1. Les deux lecteurs (script et frontend) doivent continuer à
  gérer les deux.

## Commandes

```bash
# Essai local sans rien écrire (fait de vrais appels Gemini, donc facturés)
GEMINI_API_KEY=… DRY_RUN=1 node scripts/fetch-events.js

# Forcer un scan malgré la cadence de 60 h
GEMINI_API_KEY=… FORCE_RUN=1 node scripts/fetch-events.js

# Sonde DATAtourisme (télécharge ~9 Mo ; DT_CSV_PATH évite le téléchargement)
node scripts/datatourisme-coverage.js
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
