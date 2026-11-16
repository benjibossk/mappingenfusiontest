# Journal des modifications

Version française du [CHANGELOG.md](CHANGELOG.md) (la version anglaise fait foi). Format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions [SemVer](https://semver.org/lang/fr/), sous 1.0.0 tant que l'outil est en chantier.

## [Non publié]

### Ajouté
- **Mode Atelier** (carte d'accueil « Ouvrir un projet Workbench existant ») : finir un projet fait dans le Workbench, parité avec les outils de Map Generator Pro de giorbev. Étapes A0-A6 : ouvrir le projet (relais ou lecture seule navigateur), diagnostic des tuiles QTRE, surfaces/biomes, eau comme en jeu + réécriture `.layer` (Appliquer / Restaurer), fond de carte en jeu (militaire / réaliste, légende, PNG 2k-8k), `.conf` des courbes de niveau, sauvegardes `_originaux` + export/import d'archive.
- Relais : routes `/atelier/*` et écriture sûre (refus si Workbench ouvert, SHA, sauvegarde, jamais hors du dossier projet).

## [0.5.0] - 2026-11-16

La grande version « débutant » : une interface guidée, un monde aléatoire en un clic et beaucoup de nouveautés à poser sur la carte.

### Ajouté
- **Interface guidée en 7 étapes** : écran d'accueil avec des chemins d'entrée (Nouvelle île, Monde aléatoire, Lieu réel, Rejoindre un salon, Ouvrir un fichier), puis 7 étapes numérotées (Relief, Sculpter, Eau, Routes, Villages, Champs & forêts, Envoyer) avec Suivant / Précédent et un état fait / à refaire / à faire sur chaque étape. Les réglages avancés sont repliés.
- **De l'aide partout** : bulle « ? » avec les 7 étapes, les commandes, une FAQ et un glossaire, visite guidée à la première visite, et un panneau « Nouveautés » dans l'appli (aussi ouvert par le numéro de version dans la barre d'état).
- **Choix de la langue** : anglais / français avec le % traduit, option « suivre la langue du navigateur », export / import d'un fichier de langue pour que chacun puisse ajouter une traduction.
- **Onglet Collaboration** : commentaires épinglés sur la carte (répondre, résoudre), historique des changements (qui, quelle étape, quand) et mini-carte satellite / ombrage. Les salons sont gardés sur disque par le serveur collab.
- **Générateur de monde aléatoire** : un seul nombre fait une carte entière — relief, rivières et lacs, villes et villages, aérodrome, bases militaires, routes, zones industrielles, lignes électriques, forêts et sols. Ses chiffres sont calibrés sur les vraies cartes Everon, Arland et Kolguyev. Même nombre, même carte.
- **Villages v2** : rues organiques, rues secondaires, cours de ferme, jardins à l'arrière, une église par village, ports, et différents types de lieu (hameau, village, ville).
- **Zones industrielles, bases militaires et aérodromes** (étape Villages) : « Proposer des emplacements » affiche des emplacements numérotés et classés, un clic construit le site et aplanit le sol.
- **Réseau routier qui tient compte de la pente** : le réseau automatique évite les pentes raides et il est vérifié sur le lit de route creusé.
- **Lignes électriques** (étape Routes) : pylônes haute tension entre les lieux principaux, poteaux basse tension le long des routes.
- **Sols depuis une photo satellite** (étape Champs & forêts) : 5 couleurs lues sur la photo, chacune devient un sol, avec aperçu sur la carte ; envoi en masques de sol ou enregistrement d'un PNG.
- **Portages depuis ARTE** (MIT, © Icebird) : table des largeurs de route OpenStreetMap, ponts et tunnels exclus, lit de route au-dessus de l'eau avec un bord adouci, trous des données d'altitude comblés.
- **Pastille de connexion Workbench** avec un guide en 3 étapes et Réessayer ; `start-bridge.bat` lance le relais d'un double-clic.
- Vue ombrage ; l'image satellite est maintenant enregistrée avec le projet.

### Modifié
- **Thème MILSPEC Tactical** : fond sombre, accents ambre, titres lisibles et barre d'état avec X / Z / altitude du curseur.
- **Les gros calculs tournent en arrière-plan** (Web Worker) : la page reste fluide, le panneau de progression affiche un vrai pourcentage, et Annuler arrête le travail sans toucher à ta carte.
- Villages plus denses et plus crédibles dans le monde aléatoire (environ 70 % des parcelles ont une maison au lieu de 30 %).
- README réécrit pour la nouvelle interface, avec un README français et des captures neuves.

### Corrigé
- « Too many layers » dans Workbench : au plus 4 sols par bloc de 64 m, blocs voisins compris.
- Les forêts se génèrent maintenant sur les îles fictives.
- Chaque référence de prefab porte son `{GUID}` vérifié (contrôlé dans la base de ressources du jeu).
- Lieu réel avec Copernicus : le relais est vérifié d'abord ; s'il est éteint, un guide dit quoi lancer, avec Réessayer ou « Utiliser Terrarium ».
- Le réseau routier et la vérification avant envoi sont d'accord ; les pontons construits exprès sur l'eau ne sont plus signalés.
- La visite guidée ne s'ouvre plus par-dessus l'écran d'accueil ; les fermes sont comptées à part des hameaux ; les lieux évitent les lacs.
- Plein de petites corrections pour les débutants : un seul panneau flottant à la fois, libellés plus clairs, étape de l'historique.

## Versions précédentes

Les versions 0.1.0 à 0.4.8 sont décrites (en anglais) dans le [CHANGELOG.md](CHANGELOG.md#048---2026-10-17).

[Non publié]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.5.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.5.0
