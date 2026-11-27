# Réorganisation de l'interface (schéma Giorbev + carte depuis une image)

Trois niveaux : **Accueil** → **Projets** → **Tableau de bord** du projet actif (6 sections).
Rien n'est réécrit : les panneaux existants sont regroupés sous la nouvelle navigation. Les données de
navigation (sections, tuiles, étapes visibles) sont dans `src/nav.ts` (testé par `tests/nav.test.ts`).

Ouverture de l'appli : un projet autosauvegardé avec un terrain arrive directement sur son tableau de bord
(dernière section ouverte, `localStorage reforger-mapper.nav`), sinon l'Accueil. Les liens de partage
(`#…` de collaboration) et l'autosauvegarde ne changent pas.

## Barre du haut (globale)
Menu/logo (→ Accueil), version + nouveautés, annuler/rétablir, statut Workbench, **nom du projet** (→ Projets),
une-clic / tout rejouer, bibliothèque d'objets, partage, langue, aide. Tout existait sauf le nom du projet.

## Inventaire : fonction → nouvel emplacement

| Fonction existante | Avant | Maintenant |
|---|---|---|
| Écran d'accueil (titre, visite guidée) | `#welcome` | **1 Accueil** |
| Reprendre la carte en cours | bandeau `#welcome` | 1 Accueil (bouton Reprendre) |
| Liste des projets (ouvrir, renommer, dupliquer, exporter, supprimer) | `#welcome` | **2 Projets › Ouvrir** |
| Créer un projet | cartes Nouvelle île / Aléatoire / Réel | 2 Projets › Créer → 3.1 Terrain |
| Ouvrir un fichier projet (.json, .mapper.json) `pOpen` | pied d'accueil + étape 1 | 2 Projets › Importer / Exporter |
| Enregistrer le projet (fichier) `pSave` | étape 1 | 2 Projets › Exporter + 3 Partage + étape 1 |
| Rejoindre une carte partagée | carte d'accueil | 2 Projets + 3 Partage |
| Ancien mini-tableau `#projDash` | accueil | remplacé par la barre de sections |
| Nouvelle île `tGen` + réglages relief | étape 1 | **3.1 Terrain** › Créer |
| Monde aléatoire `tRandom` (dialogue) | étape 1 | 3.1 Terrain › Créer |
| Depuis une image `tImg` (`imgBox`) | étape 1 | 3.1 Terrain › Créer |
| Importer une heightmap (Gaea, PNG/R16/RAW/R32) `tGaea` | étape 1 | 3.1 Terrain › Importer |
| Importer le monde ouvert du Workbench `tImport` | étape 1 | 3.1 Terrain › Importer |
| Lieu réel `tReal` | étape 1 / accueil | 3.1 Terrain › Importer |
| QGIS / SIG | — | 3.1 Terrain › Importer (**bientôt**, tuile désactivée) |
| Carte de référence vanilla `tRef`, stats | étape 1 | 3.1 Terrain › Retoucher |
| Sculpter (outils 2-6), calque à décalquer | étape 2 | 3.1 Terrain › Retoucher |
| Atelier A0 Projet (associer un projet Reforger) | bouton Atelier | **3.2 Atelier** › Projet Reforger |
| Atelier A1 Diagnostic | Atelier | 3.2 Atelier + 3.5 Diagnostic |
| Projet Workbench / monde cible / mods `wbProject` | étape 7 | 3.2 Atelier › Projet Reforger |
| Eau, rivières, lacs, ripisylve, simulation | étape 3 | 3.2 Atelier › Eau et contraintes |
| Atelier A3 Eau | Atelier | 3.2 Atelier › Eau + 3.4 |
| Routes, autoroute, réseau auto, électricité | étape 4 | 3.2 Atelier › Réseaux et accès |
| Atelier Réseaux (rail, routes, électricité) | Atelier | 3.2 Atelier › Réseaux et accès |
| Villages, industrie, militaire, zones, aérodrome | étape 5 | 3.2 Atelier › Structures |
| Champs, forêts, végétation | étape 6 | 3.2 Atelier › Structures |
| Atelier « Générer dans une zone » | Atelier | 3.2 Atelier › Structures |
| Bibliothèque d'objets `libBtn`, bibliothèque de parcelles `plBox` | haut / étape 5 | 3.2 Atelier › Bibliothèque + barre du haut |
| Tout envoyer au Workbench `sendAll` | étape 7 | 3.2 Atelier › Export |
| Atelier A6 Export / sauvegardes | Atelier | 3.2 Atelier › Export |
| Classes de sol climatiques (biomes) `gcBox` | étape 7 › manuel | **3.3 Masques** › Biomes |
| Atelier A2 Surfaces | Atelier | 3.3 Masques |
| Masques classiques `tMasks` | étape 7 › manuel | 3.3 Masques › Classique |
| Pente auto-matériau `gcSlope` | étape 7 › manuel | 3.3 Masques › Auto-matériau |
| Simplifier les textures de tuile (baking) | Atelier | 3.3 Masques › Baking + 3.4 Textures |
| Carte satellite `satBox` | étape 6 | **3.4 Satellite et topo** › Satmap |
| Carte en jeu `tIngame` | étape 7 › manuel | 3.4 › Topo |
| Atelier A4 Carte en jeu, A5 Courbes | Atelier | 3.4 › Topo |
| Vérification avant envoi `checkBox`, gameplay | étape 7 | **3.5 Diagnostic** |
| Collaboration, commentaires, historique | bouton Partage | **3.6 Partage** |
| Calques de la carte, vue 3D, aide, nouveautés, visite | carte / haut | inchangés (globaux) |
| Envoi manuel : surface, heightmap, lire le terrain, JSON | étape 7 › manuel | inchangé (étape Envoyer) |

Les étapes 1-7 du générateur restent : dans chaque section, seules celles qui la concernent sont visibles
(Terrain : 1-2 ; Atelier : 3-7 ; Masques/Diagnostic : 7 ; Satellite : 6-7). Ouvrir une étape d'une autre
section (raccourci, aide, coach) bascule sur cette section.

## Non couvert / à faire
- Import QGIS/SIG : tuile « bientôt », aucune fonction.
- Les panneaux Masques et Satellite restent physiquement dans les étapes 6-7 : la tuile ouvre l'étape et
  met le bloc en évidence (pas de déplacement du DOM, pour ne rien casser).
