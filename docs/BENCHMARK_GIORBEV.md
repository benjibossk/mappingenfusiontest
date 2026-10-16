# Analyse : Benchmark_Tools_reforger (giorbev)

Analyse en lecture seule de `Benchmark_Tools_reforger.py` (1044 l.), `README.md` (835 l.) et `.spec`. Rien n'a été exécuté.

## Verdict rapide

L'outil **ne mesure ni les FPS ni les draw calls du jeu**. Il échantillonne la charge **système globale** du PC (CPU %, GPU %, RAM %, VRAM) via `psutil`/`GPUtil`, puis **calcule** un « FPS » et des « drawcalls » à partir de cette charge avec des formules arbitraires. Les « modes console » sont des multiplicateurs codés en dur. Il n'a **aucun lien** avec Workbench ou le jeu : pas de lecture de logs, pas de paramètres de lancement, pas de script Enforce, pas de position caméra.

## 1. But, fonctionnalités, UI, utilisation

- But annoncé (README l.15) : mesurer les « performances réelles » (FPS, GPU, CPU) pendant qu'on explore la carte en Play in Editor, et repérer les zones critiques.
- UI : **CustomTkinter** (surcouche de Tkinter), pas Qt. `PerformanceBenchmarkGUI(ctk.CTk)` l.506. Thème sombre, cartes de métriques, journal `ScrolledText` coloré.
- Dépendances : `customtkinter`, `psutil`, `GPUtil` (optionnel, NVIDIA uniquement ; sinon GPU = 0). Python 3.13.
- Paquetage : `.spec` PyInstaller, exe `Benchmark_Tools_reforger`, `console=False`.
- Utilisation : lancer l'outil → Démarrer → jouer la map dans Workbench → bouton « Marquer Position » (saisie **manuelle** d'un texte via `simpledialog`, l.~960) → Arrêter (rapport dans le journal) → Exporter le CSV.
- Boutons de simulation PS5 / Xbox Series X / PC moyen (l.617+) et choix de scénarios « NPJ » (l.~940).

## 2. Ce qu'il mesure et comment

`RealTimePerformanceMonitor.get_metrics()` (l.372-425), une boucle toutes les `SAMPLE_INTERVAL = 0.5` s (thread) :

| Métrique | Source réelle | Remarque |
|---|---|---|
| cpu_percent | `psutil.cpu_percent(interval=0.05)` | Charge de **tout le système**, pas du process du jeu |
| gpu_percent, gpu_vram | `GPUtil.getGPUs()[0]` | NVIDIA uniquement, premier GPU |
| ram_percent | `psutil.virtual_memory().percent` | RAM système globale |
| **fps** | **calculé** : `max(10, 60 - cpu%*0.25 - gpu%*0.30)` (l.406-410) | Plage possible 5..60 bornée à 10 ; **jamais mesuré** |
| **drawcalls** | **calculé** : `1500 * (1+gpu%*2.5) * (1+cpu%*1.5)` (`estimate_drawcalls`, l.364-370) | Pure fonction de la charge |
| location | texte saisi à la main | Aucune coordonnée réelle |
| critical | fps<30 ou gpu>90 ou cpu>85 | |

- Pas de lecture des logs Workbench ou du jeu, pas de `subprocess`, pas de `-autotest`/`-profile`/`-fps`, pas de diag menu, pas de script Enforce, pas de parcours caméra (vérifié par grep : aucun `subprocess`, `.log`, `argv`).
- Contradiction : un GPU chargé à 99 % avec 144 FPS réels donne « 30 FPS » ; un jeu bloqué par le CPU sur un seul cœur (cas fréquent sous Enfusion) apparaît peu chargé en CPU global, donc « bon FPS ».
- Effet de bord : `deque(maxlen=1000)` (l.358) garde seulement les **1000 derniers échantillons**, soit environ 8 min 20 s ; au-delà, les stats et le CSV perdent le début de la session.

## 3. Seuils et chiffres par plateforme

- Seuils globaux (l.33-36) : `CRITICAL_FPS=30`, `CRITICAL_GPU=90`, `CRITICAL_CPU=85`.
- `CONSOLE_CONFIGS` (l.45-73) : fiches techniques théoriques, **pas des limites moteur Reforger** :
  - PS5 : 8 cœurs à 3,5 GHz, 10,28 TFLOPS, 16 Go, cible 30 FPS
  - Xbox Series X : 8 cœurs à 3,8 GHz, 12 TFLOPS, « 10 Go », cible 30 FPS
  - PC moyen 2024 : 6 cœurs à 3,6 GHz, 8 TFLOPS, 16 Go, cible 60 FPS
  - **Pas de Xbox Series S**, alors que c'est la plateforme la plus contrainte (environ 8 Go utilisables pour les jeux, 4 TFLOPS).
- `apply_platform_constraints` (l.200-261) : multiplicateurs arbitraires, par exemple PS5 fps×0,95 / gpu×1,05 ; XSX fps×0,98 / ram×1,15 ; PC fps×0,90 / gpu×1,15 / cpu×1,10.
- `estimate_platform_feasibility` (l.263-315) : charge = 0,4·cpu/1,2 (×1,0 sur PC) + 0,6·gpu ; seuils <60 Excellent, <75 Bon, <85 Critique, sinon Impossible.
- `SCENARIO_CONFIGS` (l.97-166) : multiplicateurs « NPJ » (léger ×1,15 CPU, moyen ×1,35, lourd ×1,60, combat ×1,70, etc.). Les « taux de réalisme 75-90 % » annoncés dans le code et le README ne s'appuient sur aucune mesure.
- `get_recommendations` (l.317-354) : messages selon des seuils de 30/50 FPS et de 70/85 %. Petit bug l.348 : la branche RAM « élevée » teste `ram_percent` brut au lieu de `sim_ram`.

**Aucune limite moteur Reforger** (entités, budget de draw calls, mémoire de streaming, taille de monde, etc.) ne figure dans le code ni dans le README.

## 4. Sorties

- Journal à l'écran pendant la session, puis « RAPPORT FINAL » (l.980-1023) : min, max et moyenne pour FPS, GPU et CPU, et nombre d'échantillons critiques.
- CSV `perf_benchmark_YYYYMMDD_HHMMSS.csv` dans le **répertoire courant** (`export_csv`, l.484-500). Colonnes : `timestamp, cpu_percent, gpu_percent, ram_percent, fps, drawcalls, gpu_vram, location, critical`.
- Aucun graphique : le README propose seulement un exemple pandas/matplotlib à faire soi-même.

## 5. Licence et auteur

- « © 2025 giorbev » (README l.9 et l.816), version 3.1.0. **Aucune licence pour l'outil lui-même**, donc tous droits réservés par défaut. Le README liste seulement les licences des dépendances (CustomTkinter BSD, psutil BSD, GPUtil MIT).
- Pour réutiliser du code, il faut l'accord écrit de giorbev. De toute façon, il y a peu de code à reprendre.

## 6. Ce qu'on peut reprendre et comment le combiner avec la heatmap de Lou

**À reprendre (les idées, pas les formules) :**
- Le flux d'utilisation : session enregistrée, marqueurs de zones, rapport min/max/moyenne, export CSV horodaté.
- La notion de scénarios de charge (IA, combat, destruction), mais à **mesurer** réellement plutôt qu'à multiplier.
- Le schéma CSV comme base, à étendre avec des coordonnées.

**À ne pas reprendre :** le FPS et les draw calls estimés, les multiplicateurs console, les « taux de réalisme ».

**Approche proposée pour notre volet benchmark :**
1. **Mesure dans le moteur** : un script Enforce (mode Play ou build) qui, sur un parcours caméra scripté (points de passage sur une grille), échantillonne à chaque point le temps de frame réel (`System.GetFrameTimeS()` ou équivalent à vérifier dans l'API), la position caméra (x, z), et si possible le nombre d'entités et la mémoire, puis écrit le tout dans `$profile:bench_<map>.csv`. On peut aussi lancer le jeu ou le serveur avec les options de profil et de FPS du moteur et exploiter les logs (options exactes à vérifier dans le wiki BI).
2. **Densité statique** : le `QueryEntitiesByAABB` de `SCR_WorldEditorToolHelper.c` (Lou) compte les entités par cellule de grille (par exemple 100 m). `SCR_ImageHelper.c` exporte la heatmap en PNG.
3. **Fusion** : même grille pour les deux, puis jointure par cellule (densité, frametime moyen et P99). On obtient une heatmap de densité, une heatmap de frametime, et une corrélation qui permet de prédire les cellules à risque d'une nouvelle carte générée par notre outil web, avant de la tester.
4. **Plateformes** : remplacer les multiplicateurs par de vraies mesures sur Xbox Series S/X et PS5 (build Workshop, même parcours, captures du frametime). On en tire des budgets empiriques (entités par cellule, total) par plateforme. **La Series S doit servir de référence basse**, et les crashs se corrèlent probablement à la mémoire plutôt qu'aux FPS.

**Limites et bugs relevés :** FPS et draw calls fictifs ; CPU, GPU et RAM système globaux et non ceux du process ; GPU NVIDIA uniquement ; tampon de 1000 échantillons (environ 8 min) ; localisation manuelle ; pas de Series S ; bug RAM l.348 ; CSV écrit dans le répertoire courant ; aucune donnée moteur Reforger.
