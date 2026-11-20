# Analysis: Benchmark_Tools_reforger (giorbev)

Read-only analysis of `Benchmark_Tools_reforger.py` (1044 lines), `README.md` (835 lines) and `.spec`. Nothing was executed.

## Quick verdict

The tool **measures neither the game's FPS nor its draw calls**. It samples the PC's **global system** load (CPU %, GPU %, RAM %, VRAM) via `psutil`/`GPUtil`, then **computes** an "FPS" and "drawcalls" from that load using arbitrary formulas. The "console modes" are hard-coded multipliers. It has **no link** to Workbench or the game: no log reading, no launch parameters, no Enforce script, no camera position.

## 1. Purpose, features, UI, usage

- Stated purpose (README l.15): measure "real performance" (FPS, GPU, CPU) while exploring the map in Play in Editor, and spot critical zones.
- UI: **CustomTkinter** (a Tkinter wrapper), not Qt. `PerformanceBenchmarkGUI(ctk.CTk)` l.506. Dark theme, metric cards, coloured `ScrolledText` log.
- Dependencies: `customtkinter`, `psutil`, `GPUtil` (optional, NVIDIA only; otherwise GPU = 0). Python 3.13.
- Packaging: PyInstaller `.spec`, exe `Benchmark_Tools_reforger`, `console=False`.
- Usage: launch the tool → Start → play the map in Workbench → "Mark Position" button (**manual** text entry via `simpledialog`, l.~960) → Stop (report in the log) → Export the CSV.
- Simulation buttons for PS5 / Xbox Series X / average PC (l.617+) and a choice of "NPC" scenarios (l.~940).

## 2. What it measures and how

`RealTimePerformanceMonitor.get_metrics()` (l.372-425), a loop every `SAMPLE_INTERVAL = 0.5` s (thread):

| Metric | Actual source | Note |
|---|---|---|
| cpu_percent | `psutil.cpu_percent(interval=0.05)` | Load of the **whole system**, not of the game process |
| gpu_percent, gpu_vram | `GPUtil.getGPUs()[0]` | NVIDIA only, first GPU |
| ram_percent | `psutil.virtual_memory().percent` | Global system RAM |
| **fps** | **computed**: `max(10, 60 - cpu%*0.25 - gpu%*0.30)` (l.406-410) | Possible range 5..60 clamped to 10; **never measured** |
| **drawcalls** | **computed**: `1500 * (1+gpu%*2.5) * (1+cpu%*1.5)` (`estimate_drawcalls`, l.364-370) | Pure function of the load |
| location | manually entered text | No real coordinates |
| critical | fps<30 or gpu>90 or cpu>85 | |

- No reading of Workbench or game logs, no `subprocess`, no `-autotest`/`-profile`/`-fps`, no diag menu, no Enforce script, no camera path (checked by grep: no `subprocess`, `.log`, `argv`).
- Contradiction: a GPU loaded at 99% with 144 real FPS gives "30 FPS"; a game bottlenecked by the CPU on a single core (a common case under Enfusion) looks lightly loaded on global CPU, hence "good FPS".
- Side effect: `deque(maxlen=1000)` (l.358) keeps only the **last 1000 samples**, about 8 min 20 s; beyond that, the stats and the CSV lose the start of the session.

## 3. Thresholds and figures per platform

- Global thresholds (l.33-36): `CRITICAL_FPS=30`, `CRITICAL_GPU=90`, `CRITICAL_CPU=85`.
- `CONSOLE_CONFIGS` (l.45-73): theoretical spec sheets, **not Reforger engine limits**:
  - PS5: 8 cores at 3.5 GHz, 10.28 TFLOPS, 16 GB, target 30 FPS
  - Xbox Series X: 8 cores at 3.8 GHz, 12 TFLOPS, "10 GB", target 30 FPS
  - Average 2024 PC: 6 cores at 3.6 GHz, 8 TFLOPS, 16 GB, target 60 FPS
  - **No Xbox Series S**, even though it is the most constrained platform (about 8 GB usable for games, 4 TFLOPS).
- `apply_platform_constraints` (l.200-261): arbitrary multipliers, for example PS5 fps×0.95 / gpu×1.05; XSX fps×0.98 / ram×1.15; PC fps×0.90 / gpu×1.15 / cpu×1.10.
- `estimate_platform_feasibility` (l.263-315): load = 0.4·cpu/1.2 (×1.0 on PC) + 0.6·gpu; thresholds <60 Excellent, <75 Good, <85 Critical, otherwise Impossible.
- `SCENARIO_CONFIGS` (l.97-166): "NPC" multipliers (light ×1.15 CPU, medium ×1.35, heavy ×1.60, combat ×1.70, etc.). The "realism rates of 75-90%" advertised in the code and the README are not backed by any measurement.
- `get_recommendations` (l.317-354): messages based on thresholds of 30/50 FPS and 70/85%. Small bug at l.348: the "high" RAM branch tests the raw `ram_percent` instead of `sim_ram`.

**No Reforger engine limit** (entities, draw call budget, streaming memory, world size, etc.) appears in the code or in the README.

## 4. Outputs

- On-screen log during the session, then a "FINAL REPORT" (l.980-1023): min, max and average for FPS, GPU and CPU, and the number of critical samples.
- CSV `perf_benchmark_YYYYMMDD_HHMMSS.csv` in the **current directory** (`export_csv`, l.484-500). Columns: `timestamp, cpu_percent, gpu_percent, ram_percent, fps, drawcalls, gpu_vram, location, critical`.
- No charts: the README only offers a pandas/matplotlib example to build yourself.

## 5. Licence and author

- "© 2025 giorbev" (README l.9 and l.816), version 3.1.0. **No licence for the tool itself**, so all rights reserved by default. The README only lists the licences of the dependencies (CustomTkinter BSD, psutil BSD, GPUtil MIT).
- To reuse any code, giorbev's written permission is required. In any case, there is little code worth taking.

## 6. What we can take and how to combine it with Lou's heatmap

**To take (the ideas, not the formulas):**
- The usage flow: a recorded session, zone markers, a min/max/average report, a timestamped CSV export.
- The notion of load scenarios (AI, combat, destruction), but **measured** for real rather than multiplied.
- The CSV schema as a base, to be extended with coordinates.

**Not to take:** the estimated FPS and draw calls, the console multipliers, the "realism rates".

**Proposed approach for our benchmark component:**
1. **In-engine measurement**: an Enforce script (Play mode or build) that, along a scripted camera path (waypoints on a grid), samples at each point the real frame time (`System.GetFrameTimeS()` or equivalent to be checked in the API), the camera position (x, z), and if possible the entity count and memory, then writes everything to `$profile:bench_<map>.csv`. We can also launch the game or server with the engine's profiling and FPS options and use the logs (exact options to be checked in the BI wiki).
2. **Static density**: the `QueryEntitiesByAABB` in `SCR_WorldEditorToolHelper.c` (Lou) counts entities per grid cell (for example 100 m). `SCR_ImageHelper.c` exports the heatmap as PNG.
3. **Merge**: same grid for both, then join per cell (density, average and P99 frametime). This yields a density heatmap, a frametime heatmap, and a correlation that makes it possible to predict the at-risk cells of a new map generated by our web tool, before testing it.
4. **Platforms**: replace the multipliers with real measurements on Xbox Series S/X and PS5 (Workshop build, same path, frametime captures). From these we derive empirical budgets (entities per cell, total) per platform. **The Series S should serve as the low reference**, and crashes are probably correlated with memory rather than FPS.

**Limits and bugs found:** fake FPS and draw calls; global system CPU, GPU and RAM rather than the process's; NVIDIA-only GPU; 1000-sample buffer (about 8 min); manual location; no Series S; RAM bug l.348; CSV written to the current directory; no Reforger engine data.

---

# MapGeneratorPro v8.4 (veille du 2026-11-20)

Lecture seule du depot public `giorbev/Map-generator` (clone a jour dans `tools/third_party/giorbev-map-generator`, tag `V8.4.0`). Rien execute, aucun contact.

## Licence

Le depot est sous **licence MIT** (`LICENSE`, (c) 2026 [otea] Giorbev). L'adaptation est permise avec mention. Nous avons quand meme **reimplemente a partir des notes de version** (aucun code copie), mention dans `NOTICE` et en tete des fichiers.

## Nouveautes v8.4

- 6 biomes climatiques (tempere oceanique par defaut, montagnard, mediterraneen, boreal, desertique, glaciaire). Chaque biome pose ses classes de sol a partir de l'altitude, la pente, l'ensoleillement, creux/cretes, ecoulement, humidite, distance a la cote. Le moteur classique (13 masques temperes) est supprime.
- Onglets Biome / Reglages / Textures / Cuisson ; 2 a 4 reglages par biome + taille de zone, bouton Reinitialiser, **auto-calibrage depuis la heightmap**.
- Textures : proposition automatique classe vers texture du projet, classes partageant une texture fusionnees, chaque bloc ramene au budget du projet, classe sans texture marquee **manquant** sans bloquer l'export.
- Masques exportes **dans l'ordre d'import** (`01_mer__SeaBed_01.png`...) + `00_LISEZMOI_import.txt` FR/EN (ordre, texture, part de carte, etapes pour les manquants).
- Les biomes respectent le masque d'exclusion (zone B gardee).
- Fond carte en jeu : pentes fortes ombrees gris-brun (seuil 25/30/35 deg, 30 par defaut) a la place des hachures ; murs et clotures plus dessines (le jeu dessine ceux du .topo) ; case « masquer les murs .topo ».
- Fonds satellite : plus d'eau sous les quais, quais vus de dessus (beton, escaliers, digues, jetees).
- Atlas metrique : cache d'analyse invalide quand la taille de cellule ne correspond plus a la heightmap.

## Ce qu'on avait deja

- `src/biomes/climate.ts` : temperature/pluie/humidite par cellule vers BiomeId (choix du biome, pas des sols).
- `src/biomes/surfaces.ts` + `src/shared/maskPaint.mjs` : regles de surfaces au sol par biome FF, masques par texture, budget de couches par bloc deja gere cote peinture.
- `src/modules/ingameMap.ts` : carte en jeu avec ombrage de relief et courbes de niveau.

## Ecarts et ce qui a ete fait (branche cal/giorbev84)

- **Fait** `src/biomes/groundClasses.ts` (module autonome, opt-in, non branche sur surfaces.ts pour ne pas croiser cal/bench) : derivees de terrain (pente, ensoleillement, TPI creux/cretes, accumulation D8, indice d'humidite TWI, distance a la cote), 6 biomes et leurs classes, reglages par biome + `autoCalibrate`, masque d'exclusion, proposition de textures avec drapeau manquant, fusion par texture, budget par bloc, noms de masques dans l'ordre d'import et texte `00_LISEZMOI_import.txt` FR/EN.
- **Fait** ombrage des pentes fortes dans la carte en jeu : option `slopeShadeDeg` (25/30/35) de `renderIngameMap`, desactivee par defaut.
- **Reste** : brancher le module dans l'UI (choix du biome, reglages, tableau textures) et dans l'envoi des masques (ecrire les PNG + LISEZMOI dans le bridge) ; quais vus de dessus ; invalidation de cache par taille de cellule (a verifier dans notre atlas) ; option « masquer murs .topo ».
