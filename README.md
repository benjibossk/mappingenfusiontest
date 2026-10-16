# Reforger Mapper

> Reforger Mapper is an unofficial, work-in-progress web tool (Vite + TypeScript) to quickly design Arma Reforger terrains: generate an island, sculpt the heightmap, paint surface masks, lay out roads, rivers, lakes and bridges, then send everything to the Enfusion Workbench through a small local bridge and a Workbench plugin (`MapGen` menu). Vanilla assets only. MIT licensed. The UI is in English and French (toggle in the top bar); the documentation is in English.

Web tool to map quickly for **Arma Reforger** (Enfusion engine) and auto-fill a map with vanilla assets, then send it to the Workbench World Editor.

## Features

- **Terrain / island generation**: procedural heightmap (noise, island shape), heightmap export.
- **Sculpt**: interactive terrain brush (approach inspired by mapgen4).
- **Surfaces and masks**: computed surface masks (altitude, slope, etc.).
- **Roads**: drawing, road network (graph), furniture and signs along roads.
- **Water**: rivers (flow accumulation), lakes, banks.
- **Bridges** at road / river crossings.
- **Countryside**: farm plots (Voronoi, inspired by AgriFieldGenerator).
- **Debug labels** in the World Editor.
- **Send to the Workbench**: shapes (`.et`), generators and vanilla prefabs.

Main modules: `src/modules/` (`island`, `sculpt`, `roads`, `network`, `hydro`, `water`, `campaign`), `src/terrain.ts`, `src/project.ts`, `src/bridge.ts`.

## How it works

1. **Site**: `npm install` then `npm run dev` → http://localhost:5173
2. **Local bridge**: `npm run bridge` (Node, port **5780**), which links the site to the Workbench.
3. **Workbench plugin**: copy `workbench/Mapgenerator/` as an addon into
   `Documents/My Games/ArmaReforgerWorkbench/addons/`, then add it in the Workbench.
4. **Enable the Workbench NET API**: Workbench > Options, NET API enabled (port **5775**). The bridge talks to the
   plugin's own handlers (`MG_*`); nothing else is needed (no AI tool, no MCP server).

   The plugins appear in the World Editor **MapGen** menu:
   - `MapGen - Apply project`: applies the project sent by the site
   - `MapGen - Apply heightmap`
   - `MapGen - Labels`: debug labels
   - `MapGen - Entity budget`: entity count per cell, terrain occlusion, suspects (duplicates, buried objects)
   - `MapGen - Capture templates`: captures building parcels (house + garden) from any world, for the village generator
   - `MapGen - Measure prefabs`
   - `MapGen - Regenerate MG_ shapes`
   - `MapGen - Register surfaces`
   - `MapGen - Stamp calibration`, `MapGen - Terrain probe`, `MapGen - Create test shapes`,
     `MapGen - Terrain write test` / `test 2` (diagnostic tools)

## Documentation (`docs/`)

| File | Content |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture: a single tool, three layers, modules sharing one project |
| [ROADMAP.md](docs/ROADMAP.md) | Roadmap and tech stack |
| [RESEARCH.md](docs/RESEARCH.md) | Research file (BARNMAP, Map-generator, mapgen4, AgriFieldGenerator…) |
| [STATE_OF_ART.md](docs/STATE_OF_ART.md) | State of the art of terrain generation / auto-fill (engines, tools, data, libs) |
| [CITIES.md](docs/CITIES.md) | Village and town generation: state of the art and proposed pipeline |
| [GENERATORS.md](docs/GENERATORS.md) | List of vanilla World Editor generator prefabs (`Prefabs/WEGenerators/`) |
| [ENFUSION_FORMATS.md](docs/ENFUSION_FORMATS.md) | Enfusion formats and API (verified / assumed) |
| [WIKI_TERRAIN.md](docs/WIKI_TERRAIN.md) | Summary of the Bohemia wiki on Reforger terrain creation |
| [WORKSHOP_TERRAIN_MODS.md](docs/WORKSHOP_TERRAIN_MODS.md) | Study of Workshop terrain tooling mods |
| [FINDINGS.md](docs/FINDINGS.md) | Findings and pitfalls (Workbench script, measured prefabs, water, tooling) and remaining work |
| [BENCHMARK_GIORBEV.md](docs/BENCHMARK_GIORBEV.md) | Analysis of giorbev's benchmark tool |
| [FF_ET_SKILLS.md](docs/FF_ET_SKILLS.md) | What is reused from the Reforger / Freedom Fighters skills |

## Status

**Work in progress.** Next step: **village and town** generation (see [docs/CITIES.md](docs/CITIES.md)).

- **Vanilla assets** only: no third-party content is required or redistributed.
- Sources, inspirations and licences: see [CREDITS.md](CREDITS.md).

## Licence and notices

Code under the [MIT](LICENSE) licence.

*Arma Reforger* and *Enfusion* are trademarks of **Bohemia Interactive**. Reforger Mapper is an **unofficial fan tool**, not affiliated with or endorsed by Bohemia Interactive.
