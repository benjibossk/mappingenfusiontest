# Trouvailles et pièges rencontrés

Tout ce qu'on a appris en faisant, et qui n'est écrit nulle part ailleurs. Utile à quiconque scripte le
World Editor d'Enfusion (Arma Reforger) depuis un outil externe.

## 1. Script Workbench (Enforce)

- **`JsonApiStruct` et les flottants** : un champ `float` reste à 0 si la valeur JSON est un entier
  (`"yaw": 90`). D'où `int yaw` et `int ycm` (hauteur en centimètres) dans `MG_ProjectEntity`.
- **Rotation d'une entité créée** : l'argument `angles` de `WorldEditorAPI.CreateEntity` est ignoré.
  Il faut ensuite `SetVariableValue(src, null, "angles", "pitch yaw roll")`. `angleY` reste à 0 et ne sert
  à rien sur ces entités.
- **Convention de yaw** : yaw = `atan2(x, z)` en degrés tourne le +Z du modèle vers la direction (x, z) ;
  le +X du modèle va alors vers (cos yaw, −sin yaw).
- **`Math.Atan` n'existe pas** : utiliser `Math.Atan2(s, 1)`.
- **Pas de ternaire** `a ? b : c` en Enforce.
- **Bâtiments à hauteur relative au terrain** : pour certains prefabs (maisons), la hauteur passée à
  `CreateEntity` est comptée *au-dessus du sol* : la maison finit à sol + hauteur demandée (le double).
  Le plugin mesure maintenant l'origine réelle juste après la création et corrige `coords`.
- **Inclinaison selon la pente** : pitch = −atan(pente avant), roll = −atan(pente latérale), pentes
  mesurées ±4 m le long des axes du prefab. Bon pour les berges ; les bâtiments restent droits.
- **Ctrl+Bas / Ctrl+Maj+Bas** (Snap to Ground, et avec Orient by Normal) sont des commandes internes de
  l'éditeur, non appelables depuis un script. `SCR_EntityHelper.SnapToGround` ne fait que descendre.
- **`[EntityEditorProps(...)]` mal formé** casse la compilation avec une erreur signalée ailleurs
  (sur l'attribut d'un plugin voisin).
- **Supprimer une classe d'entité** encore présente dans un monde empêche son chargement
  (« Bad type ») : garder une classe vide le temps de retirer l'entité.
- **Textes de debug persistants** : `DebugTextWorldSpace.Create(world, texte, CENTER | FACE_CAMERA, x, y, z,
  taille, couleur, fond)` fonctionne depuis un plugin ; une entité avec `_WB_AfterWorldUpdate` n'affichait
  rien. Les textes meurent au rechargement des scripts : un objet global les redessine.
- **Variables statiques au démarrage** : un objet global construit pendant `#InitGlobals` peut tourner
  avant l'initialisation des statiques de sa classe : tester `null`.
- **Recherche de ressources** : `Workbench.SearchResources(cb, {"et"}, null, dossier, true)` (signalé
  obsolète mais fonctionne) ; `GetBounds` donne les bornes locales du prefab instancié.

## 2. Prefabs vanilla mesurés

Mesures faites avec le plugin « MapGen - Measure prefabs » (844 prefabs → `profile/MapGen/prefabs.txt`).

- **Tabliers ConcreteBridge_01** : pivot à une extrémité, s'étendent vers +X. Narrow 13 m, Narrow_Long et
  Wide 26 m ; largeur Narrow ±5 m, Wide ±6,5 m ; dessus à +0,13, dessous à −1,3.
- **« Pillar » dans les noms des tabliers** (`_PillarSmall`, `_PillarBig`) désigne les **poteaux du
  garde-corps**, pas les piles : ce sont les variantes avec rambardes (enfants sur les sockets
  `socket_pillar_*`). Les `_Base` n'ont pas de garde-corps.
- **Piles** `ConcreteBridge_01_Pillar(_narrow)` : Y −4,3..7,05 ; sommet à poser sous le tablier
  (1,3 + 7,05 m plus bas que le dessus).
- **Placement bout à bout** : le yaw envoyé est arrondi au degré ; poser les morceaux le long de cette
  direction arrondie, sinon ils glissent de côté (quelques cm sur 26 m).
- **PierWooden_02_bridge** : 50 m le long de Z (−25..25,3), pivot au milieu, pieds jusqu'à −14,4.
- **BridgeConcrete_E_01_small** : 13 m le long de X, 4,6 m de large.
- **Bâtiments de village** : pas d'église ni de mairie parmi les prefabs mesurés ; le pub (PubVillage)
  sert de bâtiment central.
- **Berges ErodedEmbankment_01** : ~16 m le long de X, ~8 m de profondeur, face érodée vers −Z.

## 3. Eau

- Les générateurs d'eau ne façonnent pas le terrain : le site creuse lit et cuvette lui-même (seulement
  vers le bas), puis envoie les points au niveau de l'eau.
- Lacs automatiques : cuvettes du « priority flood » (`filled − heights`) traversées par une rivière,
  plus de petits lacs de source.
- Les routes sont coupées là où elles traversent l'eau ; les coupures deviennent des ponts.

## 4. Outillage (MCP enfusion, NET API)

- La compilation sans fenêtre passe par la NET API (handler `EMCP_WB_Reload` →
  `ScriptEditor.ExecuteAction({"Build","Validate and Reload Scripts"})`), même session Windows verrouillée.
- Les erreurs d'une compilation ratée ne sont écrites dans aucun log : on les lit dans le panneau Errors
  par UI Automation.
- Boîtes à gérer automatiquement pendant un rechargement : « Resources are leaking » (Ignore), « fichier
  modifié par un autre programme, recharger ? » (Yes, sinon l'éditeur de scripts réécrit l'ancienne
  version), « Reload world : save changes? » (Yes ; c'est une fenêtre Qt, pas une boîte Win32 : clic par
  UI Automation).
- Un retour à la ligne dans une constante chaîne C# d'un script `Add-Type` fait échouer tout le script
  PowerShell sans message.

## 5. Ce qu'il reste à faire (audit des outils récupérés)

Par ordre utilité / effort :

1. Validation avant envoi (routes sur l'eau sans pont, pentes, bâtiments mal placés, villages isolés).
2. ~~Budget d'entités par plateforme~~ : plugin « MapGen - Entity budget », avec doublons, objets enterrés et occlusion par le terrain (cases chargées plates ou en crête).
3. Lisières de forêt et couloirs dégagés autour des routes.
4. Forêts selon altitude / pente / biome.
5. Clôtures et murs de villages, lignes électriques.
6. Objets isolés (rochers, ruines, arbres seuls) semés avec plafond.
7. Remplacement / suppression en masse dans une zone.
8. Bench FPS réel sur un parcours caméra (CSV), croisé avec la carte de densité.
9. Exports de débogage (GeoJSON, CSV d'inventaire).

## 6. Occlusion

- Le principal occluder d'Enfusion est le **relief** (Terrain Occlusion) : une grande zone plate couverte de
  forêt fait tout dessiner d'un coup ; les forêts en crête se voient de loin (tutoriel terrain du BIKI).
- Les occluders des bâtiments sont des maillages `OCC_` dans les modèles (alignés sur les axes, 4-5 m
  minimum, 3-4 par bâtiment, 1-2 m sous le sol), pas des entités qu'on place dans le monde.
