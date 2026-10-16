# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions stay below 1.0.0 while the tool is a work in progress.

## [Unreleased]

## [0.4.4] - 2026-10-17

### Added
- Real place: building now shows numbered steps (Step 2/5…), a progress bar and the time spent, plus a typical duration for the OpenStreetMap download.

## [0.4.3] - 2026-10-17

### Changed
- Real place: **Find** now downloads the relief straight away, so the preview shows without another click.
- The language button shows the current language (🌐 FR / 🌐 EN) with a clear tooltip.

## [0.4.2] - 2026-10-17

### Fixed
- The site crashed at start-up (tracing image read before it was declared), so no toolbar button worked, including **Real place**.

## [0.4.1] - 2026-10-17

### Fixed
- Real place: OpenStreetMap forests, lakes and fields came out as a single point (closed outlines were simplified away), so forests were then all dropped by the gameplay adaptation. Outlines are now kept.

## [0.4.0] - 2026-10-17

### Added
- Work with several people: shared rooms on a small server (`npm run collab`), the map is synced between
  everyone in the room and each mapper's cursor is shown with their name.
- `CONTRIBUTING.md`, issue templates and a pull request template.
- Start from a real place (Island tab, 🌍): elevation from GeoTIFF, `.asc`, `.hgt` or greyscale PNG, or a
  Copernicus DEM 30 m tile downloaded by latitude / longitude; area picked on a shaded preview (move, size,
  rotation), grid 513 / 1025 / 2049, vertical scale, sea level. OpenStreetMap roads, tracks, paths, rivers,
  lakes, forests, fields and places come with it (Overpass API or JSON file); forests are sent as forest
  generators, field areas can become the field zone. Data credits are kept in the project.
- Bridge: `GET /dem?tile=` fetches and caches a Copernicus DEM tile.
- Parcel library (Villages tab, 📦): gallery and editor of ready-made lots (house + garden, flats + parking,
  farm yard...), JSON export / import, community parcels in `public/parcels/`; the village generator
  uses them, and a new "flats + parking" type fills town centres.

- Real place: OpenStreetMap forests and fields now paint forest floor and crop field surfaces; the height scale follows the real relief.
- Real place: optional OpenStreetMap buildings, each footprint replaced by the closest-sized vanilla building, turned to match.
- Tracing image in the Layers panel: an image you may use (satellite, ortho photo, scanned map) stretched over the terrain, with opacity; display only.
- Tree height for forests: young / normal / mature picks the matching vanilla forest generator; set from a LiDAR canopy height file (CHM) or by right-click on a forest, along with the leaf type.
- Real place: "Adapt for gameplay and performance" (on by default) welds nearby woods into forests, drops small woods and short road pieces, thins dense town centres.
- Real place: search by place name, Copernicus tiles joined into one relief (areas across tile borders), 4 / 8 / 16 / 32 km size buttons, 4 favourite areas, warning over 2046 m of height.
- Real place: relief from Terrarium tiles and IGN (RGE ALTI, LiDAR HD with the tree height); ESA WorldCover land cover paints ground surfaces (forest floor, crops, heath, concrete, dirt) and can outline forests; Esri satellite photo of the area as tracing image. Bridge: `GET /landcover?tile=` forwards WorldCover byte ranges.
- Real place: optional satellite background under the area picker.

### Security
- Collab server: password required before anything is sent (map, cursors, names), listens on the local
  machine by default, wrong passwords blocked after 5 tries, room and size limits, rooms erased when empty.

### Changed
- Roadmap: new phase "Real-world import" (DEM / LiDAR heightmap, OpenStreetMap roads, water, forests,
  fields, buildings, land cover).

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
[0.4.4]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.4
[0.4.3]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.3
[0.4.2]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.2
[0.4.1]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.1
[0.4.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.0
[0.3.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.2.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.1.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
