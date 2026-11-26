# Fond de carte (NAR-205)

Décision du 26/11/2026 : **fond auto-hébergé**. Un fournisseur de tuiles (MapTiler, Stadia,
CARTO, tuiles OpenStreetMap publiques) verrait les tuiles demandées, donc le quartier où se
trouve un enfant pendant un SOS ou un « Où est … ? » : exclu par la règle « aucun service tiers
ne voit les positions ».

| Élément | Choix |
|---|---|
| Données | OpenStreetMap (© OpenStreetMap contributors, licence ODbL), build quotidien de Protomaps |
| Format | un fichier PMTiles de Madagascar, lu par morceaux (en-tête `Range`) |
| Servi par | notre API : `GET /api/map/tiles.pmtiles` (fichier `MAP_TILES_FILE`, volume), polices `GET /api/map/fonts/…` (`server/map/fonts`, Noto Sans, OFL) |
| Affichage | MapLibre GL JS 6 (WebGL2), style `@protomaps/basemaps` (clair, sans icônes), chargé seulement sur les écrans de carte |
| Sans WebGL2, fichier absent | la position reste en texte (coordonnées, précision, heure) |

## Taille mesurée (build du 26/11/2026, rectangle 43,1 / −25,7 / 50,6 / −11,9)

| Zoom maximal | Taille |
|---|---|
| 13 | 147 Mo |
| **14 (retenu)** | **291 Mo** |
| 15 (détail complet de Protomaps) | 607 Mo |

Au-delà du zoom 14, MapLibre agrandit les tuiles vectorielles (rues et bâtiments restent nets).
Un parent qui ouvre une carte ne télécharge que les morceaux de la zone affichée (quelques
centaines de Ko), gardés une journée par le téléphone.

## Produire l'extrait

```bash
brew install pmtiles            # ou https://github.com/protomaps/go-pmtiles/releases
curl -s https://build-metadata.protomaps.dev/builds.json | tail -c 300   # dernier build (AAAAMMJJ.pmtiles)
pmtiles extract https://build.protomaps.com/AAAAMMJJ.pmtiles madagascar.pmtiles \
  --bbox=43.1,-25.7,50.6,-11.9 --maxzoom=14
pmtiles verify madagascar.pmtiles
```

Seul le rectangle demandé est lu (environ 300 Mo transférés, jamais le monde entier). Données
publiques : aucune donnée d'Akaiky ne part. À refaire quand on veut des rues plus récentes
(par exemple une fois par trimestre), puis remplacer le fichier sur le volume (NOSYHOST.md § 8).

Extrait de test : `tests/fixtures/map/tana.pmtiles` (centre d'Antananarivo, zooms 12 à 14,
284 Ko), utilisé par les tests du serveur, l'e2e et la recette.
