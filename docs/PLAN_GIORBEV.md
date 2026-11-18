# Plan d'action — proposition Giorbev (outil de mapping commun)

Décision : OK sur tout **sauf** la techno du moteur de sol. Pas de Python ni d'.exe séparé : masques,
biomes climatiques, eau, végétation potentielle et carte en jeu sont **réécrits en TypeScript** (app + pont),
et comparés aux sorties de MGP. Forêts, routes, murs, clôtures et haies passent toujours par spline/shape + générateur natif.
Taille : S < 1 jour, M = quelques jours, L = 1 semaine ou plus.

## Phase 0 — Banc de calibration (Everon / Arland / Zimnitrita)
- **Scénario de mesure commun (vol + combat)** dans l'addon Mapgenerator : script Enforce qui suit une caméra sur un trajet fixe et logue FPS / mémoire. Rien de tel n'existe. **M**
- **Collecteur côté pont** : route `POST /bench` dans `bridge/server.mjs`, qui lit le `console.log` le plus récent et le convertit en CSV/JSON. N'existe pas (le pont n'a que `/status /apply /entities /templates /surfaces /masks /heightmap`). **M**
- **Page « règles chiffrées »** (Everon = sûr, Zimnitrita = danger), dans `docs/` + `docs/PLATFORM_LIMITS.md`. **S**
- **Recalibrer `src/modules/platformBudget.ts`** : les budgets actuels (40k/28k/20k objets par km²) sont des heuristiques. Les remplacer par les mesures. **S**

## Phase 1 — Mesure de ZBK
- **Lecteur de matériaux** : lister les matériaux déclarés et ceux qui sont vraiment peints (ZBK : 35 sur 51 jamais peints). Nouveau handler NET API + route `GET /materials` sur le pont. **M**
- **Purge des matériaux non peints sur une copie**, avec mesure avant/après via le banc de la phase 0. Bouton Atelier + handler. **M**
- **Validateur « 5 textures par bloc » et doublons de clutter** : `limitPerBlock` existe déjà dans `island.ts` / `satmask.ts`. Il manque le rapport des doublons de clutter entre textures d'un même bloc, à ajouter dans `src/modules/validate.ts`. **S**

## Phase 2 — Coût par fonction
- **Mesure étape par étape** (forêts → routes → village → bourg) : lancer le banc après chaque `/apply` et stocker le coût dans un JSON (`src/data/costs.ts`). **M**
- **Jauges de budget alimentées par ces coûts** : `densityLayer.ts` et `validate.ts` consomment déjà `platformBudget`. Il faut y brancher les coûts réels par type (arbre, bâtiment, prop), par zone et par plateforme, plus le pire point de vue. **M**
- **Rôles des objets : essentiel / PC seulement / clutter.** Ils n'existent pas. Il faut un champ `role` sur chaque entité émise (`gen-common.ts` et les modules) et l'afficher dans les jauges. **M**
- **Contrôles d'objets flottants, enterrés ou en double** : `fenceDedupe.ts` couvre les clôtures. Il faut généraliser à tous les prefabs dans `validate.ts`. **S**

## Phase 3 — Contrat JSON + moteur de sol en TypeScript
- **Contrat JSON versionné** (`src/contract/schema.ts`). En entrée : heightmap, eau, routes, zones, biome, budget de matériaux. En sortie : masques par matériau, zones de végétation potentielle, rapport de budget. Un validateur commun au pont et à l'app. **M**
- **Masques** : `satmask.ts` (photo satellite) et `groundMasks.ts` / `rockMask.ts` / `biomes/surfaces.ts` existent. Il manque les masques dérivés de la pente, de l'altitude et de l'humidité au format du contrat. **M**
- **Biomes climatiques** : absents (`data/biomes.ts` et `biomes/` ne parlent ni de climat ni de température). Nouveau module `src/biomes/climate.ts` (température, pluie, altitude → biome), pensé pour des grilles 8192² (typed arrays, Web Worker). **L**
- **Eau** : `hydro.ts`, `riparian.ts` et `dam.ts` existent. Il faut y appliquer les règles d'eau de MGP (lacs de 60 points au plus, points de forme au sol) sur toute la génération. **M**
- **Végétation potentielle** : `biomes/vegetation.ts`, `forestgen.ts` et `canopy.ts` existent. Il manque la sortie « zones » (polygones vers spline et générateur natif, jamais des milliers de prefabs). **M**
- **Carte en jeu** : n'existe pas. Rendu de la carte 2D depuis les masques et les routes, en TypeScript, puis export. **M**
- **Banc de comparaison avec MGP** : script `scripts/compare-mgp.ts` qui calcule la différence pixel par pixel entre nos masques et ceux de MGP sur ZBK et Zimnitrita. **M**
- **Couches dépendantes avec graines** : il n'y a pour l'instant que des graines globales (`#seed`, `#rwSeed` dans `main.ts`). Il faut une graine par couche et un état « à refaire » qui se propage aux couches suivantes. **M**
- **Marquage généré / verrouillage du travail à la main** : il n'y a pas de marqueur fiable. Il faut une étiquette `gen:<couche>` sur chaque entité envoyée par `/apply`, et que le pont refuse de supprimer ou modifier ce qui n'est pas étiqueté. Côté addon, il faut un handler qui lit ces étiquettes. **M**
- **Envois par lots selon la mémoire du Workbench** : vérifier le découpage de `/apply` et ajouter une taille de lot réglable. **S**

## Plus tard — Streaming et export PC / console
- **Tuiles alignées, positions absolues** et rôles utilisés pour le streaming. **L**
- **Export de deux mondes (PC et console)** depuis un projet : filtrer selon le rôle, et sortir les réglages serveur (distance de vue console, distances d'IA, envoi étalé). Avant tout, tester si ça se publie proprement. **L**
