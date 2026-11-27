<p align="center"><img src="docs/img/logo.svg" width="520" alt="Reforger Mapper"></p>

# Reforger Mapper

[English](README.md) · **Français**

> Esquisse une carte Arma Reforger dans ton navigateur en 7 étapes guidées (relief, eau, routes, villages, champs et forêts), puis envoie-la au Workbench Enfusion en un clic.

<p align="center"><img src="docs/img/main-fr.jpg" width="100%" alt="Une île générée avec son réseau routier, ses villages et ses lignes électriques"></p>

Outil de fan non officiel, en cours de développement (Vite + TypeScript), licence MIT, uniquement des assets vanilla.

**Il ne remplace pas le Workbench.** C'est dans le World Editor qu'une carte se finit (détails, éclairage, gameplay). Reforger Mapper est une couche de préparation et de travail d'équipe : poser vite les grandes lignes, laisser les générateurs faire le remplissage répétitif, préparer la carte à plusieurs, et faire des allers-retours avec un monde en cours. Le Workbench reste la référence.

## Fonctions

- 🧭 **Parcours guidé en 7 étapes** avec Suivant / Précédent ; chaque étape indique faite (✓ vert), à refaire (ambre) ou à faire (gris). Les options sont repliées sous « Réglages avancés ».
- 🗂️ **Plusieurs projets** : gardés dans le navigateur, les 3 derniers sur l'accueil, un tableau de bord par projet (Terrain, Atelier, Masques...).
- 🏝️ **Relief** : île procédurale, **lieu réel** (Copernicus, IGN LiDAR, GeoTIFF, OpenStreetMap...) ou monde ouvert dans le Workbench.
- 🏔️ **Relief érodé façon Gaea** et option **« montagnes »** (crêtes, incision des rivières, ravines, éboulis), ou **import depuis Gaea** via le mod Advanced Terrain Tools.
- 🪨 **Flancs de montagne** : herbe sur les pentes, bandes de roche et d'éboulis, rochers et falaises sur le terrain raide ; **les bois montent les pentes** jusqu'à 35°.
- 🛣️ **Routes** : à la main ou réseau complet, **routes de col** en lacets (pente 10-15 %), panneaux, mobilier et **⚡ lignes électriques** comme en vanilla.
- 🏘️ **Villages et villes** à partir de parcelles et fermes vanilla, ports et sites RP vanilla, 🌾 **champs et forêts**.
- 🎯 **Score de gameplay** et **adéquation aux scénarios** : Conflict, Combat Ops, Freedom Fighters, King of the Hill, Game Master.
- 📤 **Tout envoyer** au Workbench en un clic, puis **diagnostic automatique** du monde jouable.
- 📜 **Journal de l'app** (« Journal » dans la barre d'état) : tous les messages et erreurs, quelle que soit l'étape.
- 👥 **Collaboration** : salons partagés, curseurs en direct, historique, commentaires sur la carte (et en 3D).
- ❓ Bulle d'aide, visite guidée, FAQ et glossaire · 🌐 anglais et français, ajoute ta langue avec un fichier JSON.
- 🎨 **Interface au look Reforger** : Roboto Condensed, angles droits, barre du haut sur une ligne, panneau latéral repliable.

| Accueil | Aide |
|---|---|
| <img src="docs/img/welcome-fr.jpg" alt="Écran d'accueil"> | <img src="docs/img/help-fr.jpg" alt="Panneau d'aide"> |

### Exemples

Captures des générateurs (outil Zone et monde aléatoire), prises dans l'app.

| | |
|---|---|
| <img src="docs/img/gallery/town-2d.jpg" alt="Ville : quartiers de Voronoï, place centrale, rues jusqu'aux routes"> | <img src="docs/img/gallery/town-3d.jpg" alt="Ville en 3D"> |
| Ville : quartiers de Voronoï, place centrale, rues jusqu'aux routes | Ville en 3D |
| <img src="docs/img/gallery/camp-2d.jpg" alt="Camp militaire en modules (US / URSS / FIA)"> | <img src="docs/img/gallery/camp-3d.jpg" alt="Camp militaire en 3D"> |
| Camp militaire en modules (US / URSS / FIA) | Camp militaire en 3D |
| <img src="docs/img/gallery/prodforest-3d.jpg" alt="Forêt de production"> | <img src="docs/img/gallery/junkyard.jpg" alt="Casse auto"> |
| Forêt de production : pistes droites, parcelles jeunes / adultes / coupées, piles de bois | Casse auto : allées, rangées d'épaves, atelier |
| <img src="docs/img/gallery/parking-3d.jpg" alt="Parking avec marquages"> | <img src="docs/img/gallery/orchard-3d.jpg" alt="Verger en rangs le long des courbes de niveau"> |
| Parking avec marquages | Verger en rangs le long des courbes de niveau |
| <img src="docs/img/gallery/pasture-2d.jpg" alt="Pâture clôturée"> | <img src="docs/img/gallery/cemetery-2d.jpg" alt="Cimetière"> |
| Pâture clôturée | Cimetière |
| <img src="docs/img/gallery/hunting-3d.jpg" alt="Poste de chasse avec miradors en bois"> | <img src="docs/img/gallery/lots-2d.jpg" alt="Lots tournés vers les rues"> |
| Poste de chasse avec miradors en bois | Lots tournés vers les rues |
| <img src="docs/img/gallery/random-fields.jpg" alt="Monde aléatoire : champs et haies"> |  |
| Monde aléatoire : champs et haies |  |
| **Routes et eau** | |
| <img src="docs/img/gallery/roads-classes.jpg" alt="Classes de routes à leur vraie largeur"> | <img src="docs/img/gallery/motorway-3d.jpg" alt="Autoroute avec échangeur"> |
| Classes de routes à leur vraie largeur | Autoroute avec échangeur |
| <img src="docs/img/gallery/roundabout-world.jpg" alt="Rond-point"> | <img src="docs/img/gallery/bridges-overpass-3d.jpg" alt="Pont sur tabliers vanilla"> |
| Rond-point : une spline ronde, les routes la touchent | Passage supérieur sur tabliers de pont vanilla |
| <img src="docs/img/gallery/riparian-v2-3d.jpg" alt="Végétation de berge"> | <img src="docs/img/gallery/dam-2d.jpg" alt="Barrage en terre"> |
| Végétation de berge (roseaux, saules) | Barrage en terre, lac de retenue, rivière qui repart en aval |
| **Réseau électrique** | |
| <img src="docs/img/gallery/power-world-overview.jpg" alt="Centrale, lignes 110 kV, postes"> | <img src="docs/img/gallery/power-world-village.jpg" alt="Cascade de transformateurs"> |
| Centrale, lignes 110 kV, postes | Cascade de transformateurs jusqu'aux lignes du village |
| <img src="docs/img/gallery/power-village-entrance.jpg" alt="Village alimenté par un transformateur à l'entrée"> | <img src="docs/img/gallery/power-hamlet-entrance.jpg" alt="Hameau : poteau d'entrée, une ligne"> |
| Village alimenté par un transformateur à l'entrée, une courte ligne de rue | Hameau : poteau d'entrée, une ligne à l'intérieur |
| <img src="docs/img/gallery/overpass-3d.jpg" alt="Tablier de pont en 3D"> | |
| Tablier de passage supérieur en 3D | |
| **Villes, campagne et forêts** | |
| <img src="docs/img/gallery/habitation-dense-2d.jpg" alt="Zone d'habitation"> | <img src="docs/img/gallery/town-roads-world.jpg" alt="Les routes traversantes deviennent des rues"> |
| Zone d'habitation : boucles de rues, deux rangs de lots | Les routes traversantes deviennent des rues |
| <img src="docs/img/gallery/countryside-hamlet.jpg" alt="Champs autour des hameaux"> | <img src="docs/img/gallery/forest-edge-app.jpg" alt="Lisières progressives"> |
| Champs autour des hameaux, chemins agricoles courbes | Lisières de forêt progressives |
| <img src="docs/img/gallery/rock-after.jpg" alt="Roche sur crêtes et falaises"> | <img src="docs/img/gallery/outside-3d.jpg" alt="Anneau de terrain hors carte"> |
| Roche seulement sur les crêtes et falaises | Anneau de terrain hors carte |
| **Zones spéciales et outils** | |
| <img src="docs/img/gallery/chantier-3d.jpg" alt="Chantier"> | <img src="docs/img/gallery/plage-3d.jpg" alt="Plage"> |
| Chantier | Plage |
| <img src="docs/img/gallery/import-map.jpg" alt="Import local .osm / .geojson"> | <img src="docs/img/gallery/replay-all.jpg" alt="Chaîne rejouable"> |
| Import local .osm / .geojson | Chaîne de génération rejouable |
| **Collaboration** | **Choix de la langue** |
| <img src="docs/img/collab-fr.jpg" alt="Onglet Collaboration"> | <img src="docs/img/lang-fr.jpg" alt="Sélecteur de langue"> |

## Montagnes / relief façon Gaea

Nouveau en v0.8.0. Captures réelles du World Editor sur une carte générée (à gauche : avant, à droite : après le relief érodé et les flancs de montagne).

| |
|---|
| <img src="docs/img/gallery/mountains-before-after-flank.jpg" alt="Flanc de montagne avant et après : crêtes érodées, bandes de roche et d'éboulis"> |
| Flanc avant / après : crêtes érodées, herbe sur les pentes, bandes de roche et d'éboulis, rochers sur le raide |
| <img src="docs/img/gallery/mountains-before-after-top.jpg" alt="Vu du dessus, avant et après"> |
| Vu du dessus, avant / après |

| Bois sur les pentes | Village de vallée |
|---|---|
| <img src="docs/img/gallery/mountains-wooded-flanks.jpg" alt="Forêts qui montent les flancs"> | <img src="docs/img/gallery/mountains-village-valley.jpg" alt="Flancs herbeux, rochers et bois autour d'une vallée"> |

Comment : étape 1 Relief, type de **Relief** « érodé (façon Gaea) » (par défaut) ou « montagnes ». Pour une érosion plus fine, fais la heightmap dans Gaea et importe-la avec le mod Advanced Terrain Tools.

## Démarrage rapide (sans coder)

1. Installe [Node.js](https://nodejs.org) (LTS). Télécharge ce dépôt (bouton vert **Code** → Download ZIP) et décompresse-le.
2. Ouvre un terminal dans le dossier, tape `npm install` puis `npm run dev`. Ouvre l'adresse affichée (http://localhost:5173).
3. Sur l'écran d'accueil choisis **Nouvelle île** (conseillé), **Monde aléatoire**, **Lieu réel**, **Rejoindre un salon** ou **Ouvrir un fichier…**, puis suis les étapes.

Tout est enregistré dans le navigateur. **Enregistrer…** / **Télécharger le fichier projet** en garde une copie sur le disque.

## Les 7 étapes

| # | Étape | Ce que tu fais |
|---|---|---|
| 1 | **Relief** | Générer une île, ou importer un lieu réel ou une heightmap. |
| 2 | **Sculpter** | Modeler le sol : monter, creuser, aplanir, lisser, peindre la mer. |
| 3 | **Eau** | Tracer rivières et lacs, ou laisser la simulation de pluie les trouver. |
| 4 | **Routes** | Tracer des routes, ou un réseau complet entre les lieux. Les lignes électriques sont ici. |
| 5 | **Villages** | Remplir les lieux le long des routes : maisons, ruelles, places. |
| 6 | **Champs et forêts** | Marquer une zone à découper en champs et haies, puis forêts et zones. |
| 7 | **Envoyer** | Vérifier la carte (score de gameplay compris), puis tout envoyer au Workbench. |

Souris et clavier : molette = zoom, bouton du milieu = déplacer, clic droit = actions, Maj+molette / Ctrl+molette = rayon / force du pinceau, Ctrl+Z / Ctrl+Y = annuler / rétablir, Échap = annuler l'outil, touches 1–9 = outils de sculpture. La bulle **?** rouvre l'aide et la visite.

## Connecter le Workbench

Seulement utile à l'étape 7 : tout se dessine sans. L'indicateur en haut (**Workbench : non connecté / connecté**) montre l'état ; clique dessus pour ces étapes :

1. **Installer l'addon (une fois)** : copier `workbench/Mapgenerator/` dans `Documents/My Games/ArmaReforgerWorkbench/addons/`, puis l'ajouter dans le Workbench.
2. **Activer la NET API** : Workbench > Options, NET API activée (port **5775**).
3. Ouvrir le Workbench avec l'addon Mapgenerator et ton monde chargés.
4. **Lancer le relais** : double-clic sur `start-bridge.bat` (Windows), ou `npm run bridge` (port **5780**). Laisser sa fenêtre ouverte.
5. Cliquer **Réessayer** : l'indicateur passe au vert.

Aucun outil d'IA ni serveur MCP n'est nécessaire. Les plugins sont dans le menu **MapGen** du World Editor :
`Apply project`, `Apply heightmap`, `Labels`, `Entity budget` (entités par cellule, occlusion du terrain, doublons, objets enterrés), `Capture templates` (parcelles maison + jardin pour le générateur de villages), `Measure prefabs`, `Regenerate MG_ shapes`, `Register surfaces`, plus des diagnostics (`Stamp calibration`, `Terrain probe`, `Create test shapes`, `Terrain write test` / `test 2`).

À l'envoi, le relais écrit `profile/MapGen/sent.txt`, le plugin écrit `built.txt`, et `report.txt` les compare. Les gros projets sont découpés en morceaux de ~300 Ko. Après chaque envoi, un **diagnostic** vérifie les entités de base d'un monde jouable (liste World Setup) et l'onglet Workbench montre l'état de chaque calque (vide, prêt, envoyé, à renvoyer).

```mermaid
flowchart LR
    WEB["🌐 Outil web"] -- "projet (JSON)" --> B["🔌 Relais · 5780"]
    B -- "MG_ApplyProject" --> P["Plugin MapGen · NET API 5775"]
    P --> WE["World Editor"]
    P -. "MG_ExportHeights / MG_ExportEntities" .-> B
    B -. "GET /world · /entities" .-> WEB
```

**Importer le monde ouvert** : relief, routes, rivières et lacs deviennent modifiables ; bâtiments et panneaux restent verrouillés ; les objets remplacés ne sont supprimés que par l'envoi qui les reconstruit (pas de doublons).

Satmap : l'outil ne lit aucun fichier du jeu pour la produire. Sur le conseil d'un développeur de Bohemia, chaque surface reçoit une couleur unie accordée à l'aspect vanilla en jeu, plus un bruit multi-échelle à graine (aucun motif répété) et l'ombrage du relief. Les surfaces inconnues (mods) prennent la couleur de leur famille (herbe, route, roche, sable, terre...).

## Collaboration

**Mode direct (par défaut, sans serveur) :** Partager → Rejoindre un salon… → **Créer un salon**, puis **Copier le lien** et l'envoyer en privé. Les autres ouvrent le lien, tapent un nom et sont dedans. Les navigateurs se connectent entre eux en WebRTC ([Trystero](https://github.com/dmotz/trystero), MIT) ; des relais Nostr publics servent seulement à se trouver, et tout ce qui y passe est chiffré avec la clé du salon (la partie `cle=` du lien, dans le `#`, donc jamais envoyée à un serveur). Chaque paire de navigateurs prouve aussi la clé par un défi HMAC. Le premier arrivé est l'hôte (copie de référence, donne carte + commentaires aux nouveaux) ; s'il part, le suivant le plus ancien prend le relais. Chaque navigateur garde une copie du salon (IndexedDB) : un salon rouvert reprend. STUN public seulement : certains réseaux stricts (entreprise, certains mobiles) bloquent ; au bout de 15 s l'outil le dit et propose le mode serveur, ou ajoute ton serveur TURN dans Réglages avancés.

**Mode serveur :**

1. Une personne lance `npm run collab` (port **5790**) ; il affiche un mot de passe.
2. Chacun clique **Partager** (ou **Rejoindre un salon** à l'accueil), entre l'adresse du serveur, un nom de salon et le mot de passe.
3. La carte se synchronise, les curseurs de chacun s'affichent. L'onglet Collaboration contient :
   - **Commentaires** : épingle numérotée sur la carte, réponses, résolution ; un clic en 3D y envoie la caméra.
   - **Historique** : qui a fait quoi, à quelle étape, quand ; un clic centre la carte.
   - **Vue satellite** : mini-carte (photo satellite pour un lieu réel, relief ombré sinon) avec opacité.

Historique, commentaires et dernière carte sont gardés dans `collab/data/<salon>.jsonl` / `.project.json` et reviennent après un redémarrage. Rien n'est envoyé sans le bon mot de passe ; le serveur n'écoute que sa propre machine sauf si `MAPGEN_COLLAB_HOST` est défini. Partage en réseau local ou VPN privé (ex. Tailscale), jamais ouvert sur Internet ; le dernier changement gagne.

## Langues et traduction

Bouton de langue (en haut à droite) : choisis une langue (avec son % de traduction) ou coche « Suivre la langue du navigateur ». Flèches + Entrée, Échap ferme.

**Ajouter une langue**, sans coder :
1. Dans le menu de langue, **Exporter le fichier de langue** : un JSON avec toutes les clés de texte.
2. Traduis les valeurs (garde les clés et les `{variables}` telles quelles).
3. **Importer une traduction** : elle apparaît comme nouvelle langue ; les textes manquants restent en anglais.

Pour l'intégrer à l'outil pour tous, ajoute la table dans `src/i18n.ts` et ouvre une pull request (voir [CONTRIBUTING.md](CONTRIBUTING.md)).

## Développement

| Commande | Rôle |
|---|---|
| `npm install` | Installer les dépendances |
| `npm run dev` | Site avec rechargement à chaud (http://localhost:5173) |
| `npm run build` | Vérif TypeScript (`tsc`) et build dans `dist/` |
| `npm run preview` | Servir le site construit |
| `npm run bridge` | Relais local vers le Workbench (port 5780), ou `start-bridge.bat` |
| `npm run collab` | Serveur de collaboration (port 5790) |

Organisation : `src/` (site : `main.ts`, `i18n.ts`, `collab.ts`, `project.ts`, `terrain.ts`, `realWorld.ts`, `modules/`), `bridge/` (relais Node), `collab/` (serveur de salons), `workbench/Mapgenerator/` (addon Workbench). Cahier de recette : [docs/RECETTE.md](docs/RECETTE.md). Historique des versions : [CHANGELOG.fr.md](CHANGELOG.fr.md) (anglais : [CHANGELOG.md](CHANGELOG.md)).

## Partir d'un lieu réel

L'idée : charger une vraie zone comme **forme de départ**, puis la remodeler au pinceau, avec les générateurs et la bibliothèque de parcelles, comme une primitive en modélisation 3D.

**Comment (étape 1 Relief → 🌍 Lieu réel…, ou « Lieu réel » sur l'accueil) :**
1. Ouvre un fichier d'altitude (GeoTIFF Copernicus ou LiDAR national, grille ESRI ASCII `.asc` comme IGN LiDAR HD / RGE ALTI, SRTM `.hgt` ou PNG en niveaux de gris 8 ou 16 bits), **ou** tape une latitude et une longitude pour télécharger la dalle Copernicus DEM 30 m (via le relais si le navigateur est refusé).
2. Choisis la zone sur l'aperçu ombré : glisser pour déplacer, molette pour redimensionner, Maj + molette pour tourner ; le bord blanc devient le nord de la carte. Règle la grille (513 / 1025 / 2049), l'échelle verticale et le niveau de la mer.
3. Coche les éléments OpenStreetMap à ramener (API Overpass publique, ou fichier JSON Overpass), puis **Construire le terrain**.
4. Sculpte, corrige et génère comme d'habitude.

| Donnée | Source (données ouvertes) | Devient dans l'outil |
|---|---|---|
| ✅ **Altitude** | Ta heightmap PNG 16 bits / GeoTIFF ; téléchargées pour toi : Copernicus DEM GLO-30, tuiles Terrarium, IGN RGE ALTI, IGN LiDAR HD | Heightmap recadrée, tournée, remise à l'échelle Reforger, niveau de la mer au choix |
| ✅ **Routes, pistes, sentiers** | OpenStreetMap | Formes de route avec le bon générateur, morceaux d'une même route joints |
| ✅ **Rivières, lacs, mer** | OpenStreetMap, couches eau Copernicus | Formes de rivière et de lac posées sur le relief ; la mer est là où le relief est à 0 m ou moins |
| ✅ **Forêts**, **hauteur des arbres** | Bois OSM, ESA WorldCover / CORINE ; hauteur de canopée LiDAR | Générateurs de forêt vanilla : type de feuillage d'après OSM, hauteur (jeune / normale / adulte) d'après le LiDAR ou à la main |
| ✅ **Champs, lieux, surfaces** | Occupation du sol et lieux OSM, ESA WorldCover 10 m | Zones de champs, sites de villages, surfaces du sol (sous-bois, culture, lande, béton, terre) |
| ✅ **Bâtiments** | Emprises OpenStreetMap | Chaque emprise remplacée par le bâtiment vanilla de taille la plus proche |
| ✅ **Photo satellite** | Esri World Imagery, ou ta propre image | Image de calque dans le panneau Calques (ni envoyée au jeu, ni enregistrée) |

**Adapté, pas copié** (coché par défaut) : bois à moins de 25 m soudés, petits bois isolés et petits bouts de route retirés, centres denses allégés (3 bâtiments par carré de 40 m au plus, 2500 en tout), pour le gameplay et les FPS. Décoche pour une copie fidèle.

**Choisir le lieu** : recherche par nom (OpenStreetMap Nominatim) ou latitude / longitude, puis Télécharger : toutes les dalles Copernicus sous la zone sont jointes. Boutons de taille 4 / 8 / 16 / 32 km, 4 zones favorites, fond satellite, et alerte quand le relief dépasse les 2046 m que le terrain Reforger peut porter.

À garder en tête : les vraies données entrent rarement telles quelles dans la taille Reforger et le budget d'entités ; un MNT à 30 m est lisse et demande de la sculpture ; chaque source a sa licence (OpenStreetMap : ODbL ; Copernicus : attribution), écrite dans le journal et gardée dans le projet. Une ville chargée peut amener des centaines de routes : décoche les petites routes et sentiers pour un premier essai.

## Problèmes connus

- 🏔️ **Montagnes** : les ravines fines façon Gaea ne sont pas atteignables avec la grille de terrain de 8 m (passer par un import Gaea) ; les plateformes des lacets de col restent modestes.
- 🌲 **Pistes de forêt de production** en montagne : en grande partie abandonnées (gardées seulement à 15 % de pente ou moins).
- 🌉 **Ponts** : hauteur, longueur et alignement du tablier encore approximatifs sur certains passages.
- 🌊 **Rivières et 💧 lacs** : lit, berges et niveau d'eau pas toujours bien calés dans le relief.
- 🧱 Les surfaces du sol ne sont pas importées depuis un monde existant (relief seulement).
- 📊 Les limites du budget d'entités par plateforme sont provisoires (pas encore de mesures FPS).

Envie d'aider ? Voir [CONTRIBUTING.md](CONTRIBUTING.md). Aide bienvenue sur le placement des ponts, rivières et lacs, les berges, les routes de montagne, l'import des surfaces, et des mesures FPS par plateforme (Xbox Series S/X, PS5, PC) pour calibrer le budget d'entités.

- **Assets vanilla** uniquement : aucun contenu tiers requis ni redistribué.
- **Aucun outil d'IA requis** : le site, le relais et le plugin suffisent.

## Documentation (`docs/`)

La liste complète des notes (architecture, formats Enfusion, générateurs, recherches, études ARTE / TAT / Gaea) est dans le [README anglais](README.md#documentation-docs). Les notes marquées (FR) y sont écrites en français.

## Remerciements, crédits et sources

Ce projet s'appuie sur le travail de nombreuses personnes (BARNMAP, Map-generator de giorbev, mapgen4, AgriFieldGenerator, geotiff.js, Gaea pour l'idée des masques d'érosion…) : merci à toutes. Détail de ce qui a été repris et liste complète : [CREDITS.md](CREDITS.md) et le [README anglais](README.md#thanks-credits-and-sources).

- **ARTE** (plugin QGIS, © 2026 Icebird, licence **MIT**) : table des largeurs de routes OSM, exclusion ponts/tunnels, lit de route au-dessus de l'eau et remplissage des trous NoData portés en TypeScript (voir [docs/ARTE_STUDY.md](docs/ARTE_STUDY.md)).
- Données : OpenStreetMap (ODbL), Copernicus DEM (attribution), ESA WorldCover (CC BY 4.0), IGN LiDAR HD (Licence Ouverte Etalab 2.0).

## Licence et mentions

Code sous licence [MIT](LICENSE).

*Arma Reforger* et *Enfusion* sont des marques de **Bohemia Interactive**. Reforger Mapper est un **outil de fan non officiel**, ni affilié ni approuvé par Bohemia Interactive.
