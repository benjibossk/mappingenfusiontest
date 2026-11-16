# Cahier de recette

Tests à passer à la main avant de considérer une fonction comme validée.
Statut : ⬜ à faire · ✅ OK · ❌ KO (noter la date + ce qui a été vu).

## R1 — Lieu réel : Angers 32 km (reporté, ajouté le 2026-11-16, version 0.4.8)

Préparation : Workbench ouvert sur le monde de test, addon Mapgenerator + EnfusionMCP chargés.

| # | Étape | Attendu | Statut |
|---|-------|---------|--------|
| 1 | Onglet Lieu réel → chercher « Angers », zone 32 km → Trouver | Relief chargé (IGN/Terrarium/Copernicus), satellite visible | ⬜ |
| 2 | Construire (OSM + couverture ESA) | Étapes + barre de progression, pas de gel définitif | ⬜ |
| 3 | « Tout envoyer au Workbench » | Projet découpé en `mapgen.N.json` (~300 Ko) | ⬜ |
| 4 | Lire `profile/MapGen/report.txt` | sent.txt = built.txt (écarts listés) | ⬜ |
| 5 | Console Workbench : « invalid segments on the road » | 0 (avant : 97 routes). Sinon l'écart min. de 3 m (cleanSpline) ne suffit pas | ⬜ |
| 6 | Console : « Surface import: Too many layers » | Absent (limitPerBlock : voisins + max 4) | ⬜ |
| 7 | Panneaux routiers | Tous construits, bien placés (voir report.txt) | ⬜ |
| 8 | Forêts / lacs / champs fermés OSM | Générés, pas réduits à un point | ⬜ |

Notes :
- Overpass souvent en 502 → vérifier que le repli sur les miroirs (maps.mail.ru, kumi.systems) fonctionne.

## R2 — Interface guidée (ajouté le 2026-11-16)

| # | Étape | Attendu | Statut |
|---|-------|---------|--------|
| 1 | Ouvrir le site | 7 étapes numérotées en haut du panneau, titre + phrase d'aide sous les étapes | ⬜ |
| 2 | Suivant / Précédent | Passe d'une étape à l'autre ; Précédent grisé à l'étape 1, Suivant caché à l'étape 7 | ⬜ |
| 3 | Recharger la page | Revient sur la dernière étape ouverte | ⬜ |
| 4 | « Réglages avancés » / « Outils de test » | Fermés par défaut, s'ouvrent au clic, tous les boutons marchent comme avant | ⬜ |
| 5 | Étape 7 Envoyer | Vérification + gros bouton vert « Tout envoyer » ; envoi manuel replié | ⬜ |
| 6 | Bouton 🌐 FR/EN | Toute l'interface change de langue, y compris les étapes et l'info-bulle | ⬜ |
| 7 | Écran étroit (< 1100 px) | Les étapes n'affichent plus que leur numéro, rien ne déborde | ⬜ |
| M1 | Thème MILSPEC | Fond encre, accents ambre, titres Oswald majuscules, données en police mono, coins 2 px ; aucune emoji dans l'en-tête | ⬜ |
| M2 | Accueil (projet vide) | 3 cartes Nouvelle île / Lieu réel / Rejoindre un salon + « Ouvrir un fichier… » ; Rejoindre ouvre le panneau collab et le formulaire de connexion | ⬜ |
| M3 | Étapes | Fait = carré vert ✓, à refaire = ambre, à faire = gris ; étape active cadre ambre ; en-tête « ÉTAPE 04 / 07 » | ⬜ |
| M4 | Sélecteur de langue | Liste FR / EN avec % de traduction ; flèches + Entrée choisissent, Échap ferme ; « Suivre la langue du navigateur » mémorisé | ⬜ |
| M5 | Exporter / importer la langue | Export = JSON des clés ; un JSON traduit importé apparaît comme langue « XX » (textes manquants en anglais) | ⬜ |
| M6 | Barre d'état | Coordonnées X / Z / altitude du curseur en bas à gauche | ⬜ |
| M7 | Bulle « ? » (bas gauche, au-dessus de Calques) | Panneau d'aide : présentation, 7 étapes avec bouton Aller, contrôles souris/clavier, lien GitHub | ⬜ |
| M8 | Visite guidée | Lancée une seule fois à la 1re visite (5 arrêts, Passer/Échap), relançable depuis l'aide | ⬜ |
| M9 | Écran 1100 px | En-tête sur une ligne (nom de langue masqué), panneau lisible | ⬜ |

## R3 — Limite de surfaces par bloc (ajouté le 2026-11-16)

| # | Étape | Attendu | Statut |
|---|-------|---------|--------|
| 1 | Générer une île fictive (Relief → Générer, seed 1) | Pas d'alerte « blocks exceed 5 surfaces » dans le journal (vu : 1 bloc en dépassement ; corrigé : limitPerBlock garanti ≤ 4 surfaces/bloc voisins compris, test seeds 1-20 à 2 m : 0 bloc) | ✅ 2026-11-16 (test auto) |
| 2 | Envoyer au Workbench | Pas de « Surface import: Too many layers » | ⬜ |

## R4 — Apports ARTE (ajouté le 2026-11-16)

| # | Étape | Attendu | Statut |
|---|-------|---------|--------|
| 1 | Lieu réel (ville avec autoroute + chemins) → importer OSM | Routes avec largeur par classe (primaire ~9.5 m, résidentielle ~5.5 m, piste 3–4.5 m) ; `width`/`lanes` OSM prioritaires | ⬜ |
| 2 | Activer « aplanir » sur une route OSM qui passe sur un pont/viaduc réel | Le relief n'est ni remblayé ni creusé sous le tronçon pont/tunnel | ⬜ |
| 3 | Route aplanie longeant un lac / une rivière | Le lit de route reste ≥ 5 cm au-dessus de l'eau ; la rivière n'est pas comblée sous la route (pont généré intact) | ⬜ |
| 4 | Charger un GeoTIFF avec trous NoData intérieurs | Plus de puits vers la mer : trous remplis par la hauteur voisine ; mer hors couverture inchangée | ⬜ |
| 5 | Route aplanie quelconque | Bord du ruban en rampe douce (cosinus), bande aplanie ~15 % plus large qu'avant | ⬜ |

## R5 — Onglet Collaboration (ajouté le 2026-11-16)

Serveur : `npm run collab` (mot de passe affiché). Deux navigateurs (ou une fenêtre privée) dans la même salle.

| # | Action | Attendu | OK |
|---|--------|---------|----|
| 1 | Bouton 👥 de l'en-tête | Le panneau latéral passe en vue « Collaboration » (Commentaires / Historique / Vue satellite) ; ✕ revient à l'étape en cours | ⬜ |
| 2 | « Se connecter… » → rejoindre une salle à deux | La ligne de connexion affiche la salle et les noms | ⬜ |
| 3 | 📌 Ajouter un commentaire → clic sur la carte → texte → Publier | Épingle numérotée orange sur la carte, visible aussi chez l'autre mapper, avec auteur et heure | ⬜ |
| 4 | Chez l'autre : Répondre, puis ✓ Résoudre | La réponse et la résolution apparaissent des deux côtés ; épingle grise, masquée sauf « Afficher les résolus » | ⬜ |
| 5 | Générer le réseau routier, ajouter une route, sculpter | Historique : « réseau routier généré », « route ajoutée ROAD_… », « relief sculpté » avec auteur, étape, heure (plus récent en haut) | ⬜ |
| 6 | Clic sur une ligne d'historique ou un en-tête de commentaire | La carte se centre sur l'endroit | ⬜ |
| 7 | Arrêter puis relancer le serveur, rejoindre la même salle | Historique, commentaires et dernière carte reviennent (`collab/data/<salle>.jsonl`, `.project.json`) | ⬜ |
| 8 | Hors salle : commenter, puis rejoindre | Marqué « hors ligne », puis envoyé à la salle en rejoignant (réponses comprises) | ⬜ |
| 9 | Lieu réel importé (photo Esri) | Mini-carte = photo satellite + rectangle de vue ; case « Afficher la photo » et curseur d'opacité agissent sur la carte (synchro avec Calques) | ⬜ |
| 10 | Île fictive | Mini-carte = relief ombré, message « Pas de photo satellite » ; clic sur la mini-carte déplace la vue | ⬜ |

## R6 — Lignes électriques

Générateurs natifs vérifiés dans les données du jeu (11/2026) : HT `{6958471456266DD6}PG_PowerLine_HV_02_Metal.et`,
HT béton `{F9CF7B0E9B97B012}PG_PowerLine_HV_01_Concrete.et`, BT `{20E4877A07D28502}PG_PowerLine_01_WoodenSmall.et`
(`Prefabs/WEGenerators/Powerline/`). La forme envoyée = les coins du tracé, `m_fDistance` = espacement des poteaux.

| # | Action | Attendu | OK |
|---|---|---|---|
| 1 | Routes → Réseau automatique → Placer les sites, Générer le réseau ; puis « Lignes électriques » → Générer | Lignes HT jaunes (poteaux carrés) entre villes/villages, BT blanches pointillées vers les hameaux ; info « N lignes · km · poteaux » | ⬜ |
| 2 | Calques → décocher « Lignes électriques » | Les lignes disparaissent de la carte, le reste reste | ⬜ |
| 3 | Annuler (↶) puis Rétablir | Les lignes disparaissent puis reviennent | ⬜ |
| 4 | Recharger la page | Les lignes sont toujours là (autosave) | ⬜ |
| 5 | 👥 Historique | « lignes électriques générées » étiqueté **Routes** ; « route ajoutée » / « réseau routier généré » aussi **Routes** (plus Relief) | ⬜ |
| 6 | **Workbench** : Envoyer (tout) avec le plugin | Une forme polyline `POWER_HV_n` / `POWER_LV_n` par ligne, avec le générateur en enfant ; poteaux + câbles posés automatiquement, aucun « cannot create generator » dans la console | ⬜ |
| 7 | **Workbench** : inspecter un générateur | `m_fDistance` = 80 (HV_02) / 50 (HV_01) / 35 (BT) ; poteaux pas dans l'eau ni au milieu des villages | ⬜ |
| 8 | Effacer les lignes | Carte et info vidées ; étape Routes reste « fait » si des routes existent | ⬜ |
| 9 | Photo satellite (calque ou lieu réel), puis recharger la page | La photo revient (IndexedDB) ; « Enregistrer » le projet puis l'ouvrir ailleurs → photo incluse si < 8 Mo | ⬜ |

## R7 — Correctifs du test débutant (ajouté le 2026-11-16, voir UX_TEST_2026-11-16.md)
- [ ] Relais arrêté : la pastille en haut est **grise** « Workbench : non connecté » ; clic → l'aide s'ouvre sur « Connecter le Workbench » (3 étapes + Réessayer).
- [ ] Étape 7, « Tout envoyer » relais arrêté : message « Impossible d'envoyer : le Workbench n'est pas connecté… », encadré 3 étapes + Réessayer + « Télécharger le fichier du projet ».
- [ ] Relais lancé + Workbench ouvert : Réessayer → pastille verte « connecté », l'encadré disparaît.
- [ ] Un seul panneau flottant à la fois (aide, langue, connexion salon, calques) ; Échap ferme ; fermer la vue Collaboration ferme le formulaire de connexion.
- [ ] Île fictive → Champs et forêts → « Générer des forêts » : des bois apparaissent, loin des lieux et hors de l'eau.
- [ ] Réseau auto : après « Relier les lieux », « Vérifier » ne signale aucune route trop raide ; aucun lieu à moitié dans la mer.
- [ ] Carte : étiquettes « Rivière 1 », « Hameau 3 », « Ville 1 » (noms de route seulement en zoom rapproché) ; un seul bouton « Eau »/« Remettre » dans la barre de gauche.

## R8 — Réseau réaliste + reliquats UX (ajouté le 2026-11-16)
- [ ] Île graine 1 → « Relier les lieux » : villages reliés en **asphalte étroit**, hameaux en chemin de terre ; routes en lacets sur les pentes ; « Vérifier » → « Aucun problème détecté ».
- [ ] Une route auto est aplanie (déblai/remblai visible sur le relief) ; un hameau longé par une route n'a pas de « aucune route ne dessert ce lieu ».
- [ ] Sculpter → Monter, un trait : message « Trait terminé : sol monté jusqu'à X m ».
- [ ] Calques : « Ruissellement (traits bleus fins) » avec info-bulle ; décocher → les traits bleus disparaissent.
- [ ] Légende « ✓ vert = fait · ambre = à refaire » sous les étapes ; le statut se vide en changeant d'étape et n'est plus coupé.
- [ ] Champs sur une zone montagneuse : message « N parcelles écartées : trop pentues… », pas de parcelle au sommet.
- [ ] Panneau Partager : « Rejoindre un salon… », « Aperçu de la carte (photo ou relief) ».
- [ ] Textes gris longs : 1re phrase + icône (i) au survol.

## R9 — Générateurs branchés + monde aléatoire (ajouté le 2026-11-16)
Navigateur (vérifié par Playwright, captures `world-*.png` du scratchpad) :
- [ ] Accueil : 4e carte « Monde aléatoire » ; étape 1 : bouton « Monde aléatoire ». Fenêtre : numéro (dé), taille 2/4/8 km, 6 curseurs (×0 à ×2), aérodrome, lignes électriques.
- [ ] « Fabriquer le monde » : barre « Étape i/11 : … », puis île + rivières + lieux + routes + villages + lignes + forêts + grands sites ; les étapes passent en vert ; Ctrl+Z ramène la carte d'avant.
- [ ] Même numéro, mêmes réglages → même carte (test node : même empreinte SHA-1) ; changer « Hameaux » ne bouge pas les villes.
- [ ] Annuler pendant le calcul : « Arrêté. Rien n'a été modifié. »
- [ ] Villages : « Nouveau générateur de villages » coché par défaut (type de lieu, rues, cours de ferme, église, port) ; jardins en vert clair derrière les maisons.
- [ ] Zones industrielles / Base militaire / Aérodrome : « Proposer des emplacements » → pastilles numérotées ; clic → site construit, sol aplani ; Échap annule ; « Retirer » vide.
- [ ] Calques : « Industrie, bases, aérodromes » masque/affiche les sites.
- [ ] Champs et forêts → « Surfaces depuis la photo satellite » : grisé sans photo ; avec photo : « Lire les couleurs » → 5 pastilles + % + liste de surfaces, aperçu sur la carte, « Enregistrer le PNG (R, V, B, A) ».

Workbench (à faire par Benji, rien de neuf côté plugin : les sites partent comme formes + objets, comme les routes et les bâtiments) :
| # | Action | Attendu | État |
|---|---|---|---|
| 1 | Monde aléatoire 4 km → Envoyer (relief puis tout) | Relief aplani sous l'aérodrome / les bases / les zones (pas de marche) | ⬜ |
| 2 | Inspecter `AIR_1_air_…_rwy` | Spline `RG_Road_Concrete_USSR_02`, `RoadWidth` 35 : la piste s'affiche-t-elle en entier ? (sinon repli 2-3 splines de 15 m) | ⬜ |
| 3 | Base militaire | Mur `WG_ConcreteWall_USSR_03` / grillage ouvert au portail, tours, casernes ; emprises **estimées** : chevauchements ? | ⬜ |
| 4 | Zone industrielle | Rue reliée à la route principale, clôture `WG_NetFence_01` (chemin sans GUID), bâtiments sur la plateforme | ⬜ |
| 5 | Village v2 en bord de mer | Ponton `PierWooden_01_25m` au-dessus de l'eau (ycm), abris à bateaux sur la plage | ⬜ |
| 6 | « Envoyer comme masques du sol » (satellite) | Les 5 surfaces apparaissent dans le Workbench, aucun bloc > 5 surfaces | ⬜ |

## R10 — Parcours d'entrée guidés + chargements (ajouté le 2026-11-16)
Navigateur (vérifié par Playwright, contexte neuf, captures `onb-*.png` du scratchpad ; 0 erreur de page) :
- [ ] Nouvelle île (carte d'accueil) : carte « Étape suivante » « Voilà ton île. » + liste Déjà fait / Reste à faire + bouton « Étape suivante : Routes » ; « Montre-moi » lance une mini-visite propre au parcours (relief, étapes, eau, calques, envoi). ~1,2 s.
- [ ] Monde aléatoire : barre de la fenêtre avec « Étape i/n » + secondes écoulées ; à la fin toast « terminé (x s) » et carte « Voilà ton monde aléatoire » : étapes 1 à 6 en vert, bouton « Étape suivante : Envoyer ». ~6 s en 4 km.
- [ ] Lieu réel (2 km autour d'Angers, Copernicus + OSM, passerelle lancée) : fenêtre en style MILSPEC (titre Oswald, barre ambre), barre « Étape i/5 … (s, total) » ; à la fin la fenêtre se ferme, toast, carte « Voilà ton lieu réel » : Relief, Eau, Routes, Champs et forêts en vert ; bouton « Étape suivante : Envoyer ». 20 s à 2 min selon Overpass.
- [ ] Rejoindre un salon : carte d'aide « Rejoindre un salon » au-dessus du formulaire ; « Montre-moi » pointe le formulaire.
- [ ] Ouvrir un fichier : panneau « Ouverture du projet », puis carte « Projet ouvert » vers la première étape non verte.
- [ ] Toute action longue (Générer, Autre tirage, rivières, réseau de routes, placer les lieux, villages, lignes, forêts, industrie/base, analyse satellite, tous les envois au Workbench, chargement du terrain) : panneau « En cours » (nom de l'action, barre indéterminée ou étape i/n, secondes écoulées), boutons grisés pendant le calcul (pas de double clic), toast vert « terminé (x s) » ou rouge « échec ».
- [ ] Carte : noms de rivières et lacs masqués à l'échelle de l'île, visibles en zoomant (comme les routes) ; aucun nom n'en chevauche un autre ; Calques > « Noms » les masque tous.
- [ ] Aide > FAQ : « La page est-elle bloquée ? » et « Trop de noms sur la carte ? ».
Limite connue : les générateurs synchrones (worldgen, réseau, villages) ne publient pas encore leurs sous-étapes : barre indéterminée + temps écoulé, Annuler seulement pour le monde aléatoire (dans sa fenêtre).

## R11 — Calculs dans un Web Worker + relais + densité (ajouté le 2026-11-16)
Navigateur (Playwright sur `vite preview` :5200, captures `wkr-*.png` du scratchpad ; 0 erreur de page) :
- [ ] Monde aléatoire 8 km : le panneau « En cours » affiche un **pourcentage réel** (ex. « 11 % », « 52 % » pendant le réseau de routes) qui avance ; la page reste fluide (rAF ~6 ms pendant le calcul).
- [ ] Annuler (panneau ou fenêtre) arrête le calcul tout de suite (worker terminé) ; toast « annulé » ; la carte reste celle d'avant (rien n'est appliqué).
- [ ] Relancer jusqu'au bout : toast « terminé », résumé « … N hameaux, M fermes … » (les fermes ne sont plus comptées dans les hameaux).
- [ ] Générer (île), réseau de routes, forêts, analyse satellite passent aussi par le worker (bar du réseau en %).
- [ ] Lieu réel, source Copernicus, relais arrêté : encadré « Relais non connecté » (quoi lancer, `npm run bridge`), bouton Réessayer, et « Prendre Terrarium à la place » ; Terrarium / IGN marchent sans relais.
- [ ] `npx tsx scripts/check-worker-determinism.ts 4096 3` : « IDENTICAL » (même hash direct / via worker).
Bench 8 km (seeds 1-5) : remplissage des lots 30-34 % → 69-73 % ; bâtiments 597/401/351/416/572 → 880/662/565/673/913 ; 0 problème au contrôle ; 14-19 s.
Limite connue : les rivières « en direct » (recompose) et les lignes électriques / villages manuels restent sur la page ; sans worker (navigateur ancien) tout tourne dans la page et Annuler n'agit qu'entre deux étapes.

## R12 — Mode Atelier (ajouté le 2026-11-16)
Automatique : `node --test "tests/atelier/*.test.*"` (23 tests : `.terr`/`.ttile` 16×16 et 19×19, eau + réécriture `.layer`, classement des prefabs, `.conf`, raster, zip, safeWrite ; lot 2 : LZ4, BC1/BC7, poids `_layer.edds`, `.topo` réel, Atlas/auto-calibration/biomes, passage au générateur).
Navigateur (Playwright sur `vite preview`, relais lancé, copie de Normandy_Edit dans le scratchpad ; captures `atelier-*.png` ; 0 erreur de page) :
- [ ] Accueil : carte « Ouvrir un projet Workbench existant (Atelier) » ; le mode générateur est inchangé.
- [ ] A0 : coller le chemin du dossier addon → « Ouvrir » ; le monde unique se charge seul (panneau « En cours » avec barre) ; résumé : grille, hauteurs, matériaux, objets, eau.
- [ ] Relais arrêté → message clair ; « Choisir un dossier » (Chrome/Edge) ouvre en lecture seule (badge « lecture seule », pas de bouton Appliquer).
- [ ] A1 : blocs colorés (sous / au / au-delà du budget / vides), liste des problèmes, clic tuile → tableau des blocs ; recherche d'une texture ; CSV téléchargé.
- [ ] A2 : usage des surfaces + présence des textures de chaque biome.
- [ ] A3 : « Analyser » → liste lacs/rivières, contours rouge (actuel) / vert (proposé), eau bleue ; « Appliquer » écrit, journal « original gardé dans _originaux/… ».
- [ ] Workbench ouvert → Appliquer refusé (« fermez le Workbench »), fichier intact.
- [ ] A4 : aperçu militaire puis réaliste ; PNG 4096 téléchargé ; « Enregistrer dans le projet » → `UI/Textures/Map/`.
- [ ] A5 : `.conf` mis à jour en direct ; téléchargement / enregistrement dans `Configs/Map/`.
- [ ] A6 : sauvegarde listée → « Restaurer » ; fichier identique octet pour octet à l'original ; export `.rmatelier.zip`.
- [ ] Bouton FR/EN : la page se recharge et rouvre l'Atelier dans l'autre langue.
Dans Workbench (manuel) : ouvrir le monde corrigé, vérifier lacs/rivières régénérés ; importer le PNG (ToSRGB, Tiled off, Mips off) et le brancher sur `SCR_MapEntity` ; brancher le `.conf` via `SCR_MapConfigComponent` du GameMode.
Lot 2 (2026-11-16, captures `atelier2-*.png`, copie Normandy_Copy + `_layer`/`_supertexture.edds` + `Data/TESTIsland.topo` ; 0 erreur de page) :
- [ ] A0 : journal « … blocks with painted weights, satmap W×H, .topo: N roads / M buildings ».
- [ ] A1 : « N slot(s) négligeable(s) » + seuil (%) réglable ; tableau de tuile avec % par texture (rouge sous le seuil) ; CSV avec colonne `negligible_slots`.
- [ ] A2 : « Auto-calibrer » remplit 7 seuils ; « Calculer les masques » → aperçu coloré, % par texture, textures absentes en orange, PNG ; Atlas métrique (tableau + expositions + classes de pente).
- [ ] A4 réaliste : textures du terrain (supertextures) + ombrage + arbres ombrés ; routes `.topo` à leur vraie largeur, emprises des bâtiments.
- [ ] A6 « Continuer dans le générateur » : la page recharge en mode générateur avec le relief, les lacs/rivières et les routes du monde ; « Annuler » du générateur et autosave inchangés.


## R13 — Collaboration directe sans serveur (ajouté le 2026-11-16)

Deux navigateurs (ou deux PC sur des réseaux différents, ex. box + partage 4G) :
1. Navigateur A : générer une île, 👥 → Rejoindre un salon… → mode **Direct** → **Créer un salon**. Le statut dit « Connecté (1 participants, direct) ». **Copier le lien**.
2. Navigateur B (fenêtre privée ou autre PC) : ouvrir le lien → demande d'un nom → « Connexion… » puis « Connecté (2 participants, direct) » ; la carte de A s'affiche.
3. A pose un commentaire → visible chez B ; B répond → visible chez A. B modifie (ex. régénérer les routes) → A reçoit « Carte mise à jour par B ». Le curseur de B apparaît chez A.
4. Fermer A → B garde la carte (« Tu gardes maintenant la copie de référence »). Un 3e navigateur C ouvre le lien → reçoit carte + commentaires depuis B.
5. Lien avec une clé modifiée (`cle=autre`) → aucune connexion ; après ~15 s : « Ta connexion bloque le direct … — utilise un serveur » + bouton **Utiliser un serveur** qui bascule en mode serveur.
6. Recharger B puis rouvrir le lien : la carte et les commentaires reviennent de la copie locale.
7. Gros projet (8 km) : la synchro arrive en entier (messages découpés), pas d'erreur console.
