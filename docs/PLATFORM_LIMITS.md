# Platform object budgets (PC / Xbox Series X / PS5 / Xbox Series S)

Code: `src/modules/platformBudget.ts` (budgets, density grid), `src/modules/densityLayer.ts` (heat map),
`validate.ts` issue kind `overBudget`. UI: Workbench tab > Checks > *Target platform*; map layer *Object density*.

## What is known (sources, confidence)

| Fact | Source | Confidence |
|---|---|---|
| Terrain is split in blocks (32x32 faces, 1 block = 1 draw call, 5 LODs) and tiles of 1-32 blocks; max 5 detail surfaces per block | BIKI *Terrain: Terrain Entity* (wiki_search) | High (official) |
| Terrain creation is PC-only; maps are played on console through the Workshop | BIKI *Terrain Tutorial* | High |
| Series S *Performance* mode stutters / bad frame pacing when entering populated areas (villages) | BI Feedback Tracker user report, https://feedback.bistudio.com/T191407 | Medium (user report) |
| Mods reserve ~24 GB on Xbox Series X/S (storage, not entities) | BI Feedback Tracker, https://feedback.bistudio.com/T192833 | Medium |
| Entity / AI counts drive server CPU cost; no numeric cap given | xgamingserver.com performance guide (hosting vendor) | Low |

**Bohemia publishes no hard object / tree / entity limit per km², per block or per map, for any platform.**
No wiki page, forum post or game data file found gives one (searched 2026-11-17).

## Budgets used (heuristic, low confidence)

Averaged over a 256 m cell (0.0655 km²). Calibrated so a cell of full forest sits exactly at the Series S budget: forest plus a village in the
same cell warns on Series S, a dense town core warns on X/PS5 only when heavily packed.

| Platform | objects / km² | per 256 m cell | per map |
|---|---|---|---|
| PC | 40 000 | ~2 621 | 4 000 000 |
| Xbox Series X | 28 000 | ~1 835 | 2 800 000 |
| PS5 | 28 000 | ~1 835 | 2 800 000 |
| Xbox Series S (default) | 20 000 | ~1 311 | 2 000 000 |

Counted: every settlement building, every zone entity, and forest trees estimated at 0.02 / m² (~200 / ha,
`FOREST_TREES_PER_M2`) sampled on a 16 m lattice. Road furniture, Workbench-side generator props and clutter are
not counted, so real counts are higher. Warnings never block a send.

Tune the table in `PLATFORM_BUDGETS` when in-game measurements (Diag menu FPS on Series S vs entity count) exist.
