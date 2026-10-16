# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions stay below 1.0.0 while the tool is a work in progress.

## [Unreleased]

### Added
- Work with several people: shared rooms on a small server (`npm run collab`), the map is synced between
  everyone in the room and each mapper's cursor is shown with their name.
- `CONTRIBUTING.md`, issue templates and a pull request template.

## [0.3.0] - 2026-10-16

### Added
- Import the world open in the Workbench: relief, roads, rivers and lakes become editable in the site;
  buildings and signs are shown locked; bridges are rebuilt by the site.
- Right-click on an existing object shows what it is; existing roads can be taken over for editing, and
  any existing object can be deleted from the world on the next send.
- `MG_ExportEntities` and `MG_Status` NET API handlers (read only).
- `MapGen - Capture templates` plugin: captures house + garden parcels from any world (vanilla maps included).
- Villages can be built from the captured parcels ("Captured parcels" option).
- `MapGen - Entity budget` plugin: entities per cell against a per-platform limit, terrain occlusion
  (flat and crest cells), suspects (duplicates, buried objects).
- English UI with a FR/EN toggle; Workbench and bridge messages translated in the French UI.
- Project logo, README diagrams, screenshots, credits tables.

### Changed
- The repository (docs, README, credits, code comments) is now in English.
- The bridge no longer needs the EnfusionMCP addon: it only talks to the plugin's own handlers.
- An imported world survives a page reload.
- Deletions in the world only go with the send that rebuilds the same family (roads, water), so sending
  villages alone never removes roads.

### Removed
- Keyboard shortcuts of the plugins (they clashed with Workbench shortcuts).
- PNG heatmap of the budget plugin (replaced by the report and in-world labels).
- Ground-material export by terrain traces: it crashed the Workbench (ground surfaces are not imported yet).

### Fixed
- Start-up errors when an autosaved project was restored before the page was ready.
- Importing a world kept the previous project's roads, rivers and villages on top of it.

## [0.2.0] - 2026-10-15

### Added
- Local bridge (`npm run bridge`) and "Send to the Workbench" button.
- Island generation, mapgen4-style relief brush, rivers on the grid, sea level and coastal surfaces.
- Surface masks and satellite map generation; 5-surfaces-per-block limit respected.
- Roads: drawing, network generator, per-road width and flattening, verge posts, crash barriers, signs.
- Water: rivers, lakes, banks, bridges at road / river crossings.
- Undo / redo, road list, draggable points, project autosave and save / open file.

### Fixed
- Sign and crash barrier orientation, river level against the terrain, bank orientation (several passes).

## [0.1.0] - 2026-10-14

### Added
- Project scaffold (Vite + TypeScript) and the research, state-of-the-art and roadmap documents.
- First Workbench plugin tests: shapes and generators created by script.

[Unreleased]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.3.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.2.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.1.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
