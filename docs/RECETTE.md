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
