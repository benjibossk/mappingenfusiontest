# Village and town generation: state of the art and proposed pipeline

Research into ideas and algorithms only: no code was copied.
Written on 2026-10-15. Sources marked "(unverified)" could not be consulted
while writing (video, Fab page): their description relies on the title or category
of the link and must be re-read before being relied upon.

---

## 1. Sources

### 1.1 Fantasy Town Generator (fantasytowngenerator.com, with /temporary-settlement)
- **What it does**: it generates a complete town (layout, named buildings, inhabitants, shops).
  The "temporary settlement" variant produces camps: tents and fires arranged around
  a centre, without real streets.
- **Observable method**: the layout starts from a set of main roads crossing the area
  (often 2 to 4 axes out to the edges), plus an optional river or coast. Buildings
  are then aligned along the axes, with a **fixed setback**, and a rotation that follows the
  road tangent. Density drops as you move away from the centre. The building type
  (tavern, forge, farm) is drawn according to the size of the town, then assigned a plot.
  The temporary camp has no streets: it is a **radial or ring-based placement with
  collision rejection** (Poisson disk style).
- **Takeaway**: "axes first, then buildings on the frontage, decreasing density". This is
  exactly the model of a street hamlet (Straßendorf).
- **Licence**: closed source, commercial (freemium). Ideas only.

### 1.2 FantasyGen, City Map Generator (fantasygen.net/city-map-generator)
- **What it does**: a stylised town map with walls, districts, streets
  and squares.
- **Probable method**: it follows the principle of the watabou generator: a relaxed (Lloyd)
  **Voronoi** diagram, central cells = districts, outer cells =
  countryside, streets = Voronoi edges, and plots cut inside each cell.
- **Licence**: closed. Ideas only.

### 1.3 YouTube video UmUs9W4riPs (unverified)
- The title, description and transcript could not be retrieved. Judging from the
  context, it is probably a devlog on procedural town generation (roads, then
  blocks, then plots). **To be watched** to complete this section: note the road
  growth method and the way plots are cut.

### 1.4 Fab listing 013f192b-… (unverified)
- This is an Unreal/Unity asset from the Fab marketplace, probably a town or
  road generator (PCG or spline tool). This kind of tool generally follows this scheme: road
  splines placed by hand, then **PCG filling of the roadside strips** (sampling
  along the spline, lateral offset, projection onto the ground, slope filter, weighted
  mesh selection). **To be checked.**
- **Licence**: proprietary (standard Fab licence). Ideas only.

### 1.5 ProbableTrain MapGenerator (maps.probabletrain.com)
- Repository: github.com/ProbableTrain/MapGenerator. The README and documentation are online
  on the site.
- **Method** (after Chen et al. 2008):
  1. **Tensor field**: a weighted sum of basis fields. A "grid" field
     has a fixed direction. A "radial" field is centred on a point. The weight decreases with
     distance (exponentially). Water edges and existing roads add a field
     aligned with their tangent. Noise rotates the field.
  2. **Streamlines**: the field is integrated (RK4) in the major or minor direction from
     seeds. A line is stopped if it passes within `dsep` of another line,
     leaves the area or hits water. It is extended until it joins a nearby line
     (`dlookahead`) to close the intersections.
  3. **Hierarchy**: several passes with a decreasing `dsep`, first water, then main
     roads, then major streets and finally minor streets.
  4. **Graph**: intersections are computed, then the **polygons** (faces of the
     planar graph) are extracted. These polygons are shrunk to obtain the blocks, then
     **recursively subdivided** into plots. Buildings are extruded from the plots.
- **User control**: base fields (grid or radial) are added or moved, and the user
  sets `dsep`, the size, the noise and the park density.
- **Licence**: **LGPL-3.0** (to be confirmed in the repository). The ideas are free. If we
  were to reuse code, it would have to be kept in a separate module and its sources published.
  → We reimplement.

### 1.6 Simteract City Generator (simteract.com/projects/city-generator)
- A commercial or R&D tool that generates realistic towns for simulation (autonomous
  driving, digital twins). It first generates the road network, from OSM or
  procedurally, then the detailed lanes and intersections. It then cuts the
  blocks into parcels and places buildings drawn from an asset library, **whose type
  depends on the zoning**.
- Takeaway: the **asset inventory by category and size**, and the zoning that drives
  the choice. This is what we need for the Reforger prefabs.
- **Licence**: closed.

### 1.7 Mapimator City Roads (mapimator.com/tools/city-roads)
- It extracts the roads of a real town through the **OSM Overpass API** (`way[highway]` in
  a bbox or an administrative area), then renders them as SVG/PNG. The line thickness depends
  on the `highway` type. The principle comes from anvaka's "city-roads" (MIT).
- **Interest for us**: we can import the **real layout of a French or Eastern European village**
  as a template: streets, `building=*` tags, footprints. We then fit it onto our
  roads. OSM data is under **ODbL**: attribution is mandatory, and share-alike
  if a derived database is redistributed.
- Mapimator's code is closed. anvaka's city-roads is under the MIT licence.

### 1.8 Parish & Müller 2001, "Procedural Modeling of Cities" (SIGGRAPH)
- **Extended L-system**: a road module proposes a segment, then two sets of constraints
  correct it.
  - **Global goals**: it follows the population density (the most populated point in a cone),
    or a pattern (grid, radial, terrain following).
  - **Local constraints**: water and slopes that are too steep are refused, the segment is
    truncated or rotated, and the segment is **snapped** to an intersection or to an existing road within a given
    radius.
- A priority queue (the "delay" of the modules) lets highways grow
  before streets.
- Blocks are cut into plots by subdivision. Buildings use facade
  L-systems.
- Takeaway: **propose, then correct with local constraints**. This is very well suited to our
  map (slope, rivers, sea, existing roads).

### 1.9 Chen, Esch, Wonka, Müller, Zhang 2008, "Interactive Procedural Street Modeling"
- This is the basis of ProbableTrain. The tensor field can be edited by hand with brushes
  (grid, radial, field derived from a polyline). The field **aligns with contours**:
  shoreline, river, contour lines via the height gradient. Streets are traced as
  streamlines, major then minor.
- Takeaway: a **field derived from the terrain gradient** gives streets that follow the contour
  lines (village streets on a hillside). The control is very good.

### 1.10 watabou, Medieval Fantasy City Generator
- Points are generated in a spiral, then a **Voronoi** diagram is built and relaxed. The central
  cells become "wards" (square, market, crafts, nobility, farm…).
  The walls follow the outline of the inner cells, and the streets follow the Voronoi
  edges, from the gate to the centre (shortest path). Each ward is **recursively split**
  (the polygon is cut on its longest side, at a random ratio, with a gap between
  plots) until a minimum area is reached, then some of the plots are removed at random
  (courtyards, gardens).
- Licence: the old Haxe version is published under **GPL-3.0** (watabou/TownGeneratorOS repository).
  The recent web versions are closed. → **Ideas only** for us, since our project
  is not GPL.

### 1.11 Plot subdivision
- **OBB recursive split**: the minimum oriented bounding box of the polygon is computed, it is cut
  perpendicular to the long axis at about 0.4–0.6, and the process repeats while the area exceeds
  the maximum. A plot with **no side on a street** (access) is rejected, or merged.
- **Straight skeleton** (Vanegas et al. 2012, "Procedural Generation of Parcels in Urban
  Modeling"): the straight skeleton of the block gives strips running along each street. Each
  strip is cut into plots perpendicular to the frontage. Result: **all plots touch
  the street**, which is realistic for Europe. It is more complex to code. An **inner
  offset** at a fixed depth is enough in practice as a first approximation.

### 1.12 Townscaper / Wave Function Collapse
- Townscaper uses an irregular grid (quads derived from relaxed hexagons) and
  modules chosen by **marching cubes and adjacency rules**. WFC is used to assemble
  tiles according to neighbourhood constraints.
- **Low relevance** for us: we place **whole prefabs**, not modules. WFC
  could be used later for low walls, fences or the outbuildings of a farm
  courtyard. Out of MVP.

---

## 2. Comparison table

| Source | Method | Input | User control | Follows terrain? | Follows existing roads? | Output |
|---|---|---|---|---|---|---|
| Fantasy Town Gen | axes + frontages, radial density | size, type | low (preset) | no | no | 2D layout + text |
| FantasyGen | Voronoi + wards (assumed) | size, seed | low | no | no | map image |
| ProbableTrain | tensor field + streamlines + subdivision | basis fields, water | **strong** (editable fields) | possible (gradient field) | yes (polyline field) | road graph, polygons, SVG/STL |
| Simteract | network, then zoning, then asset library | OSM or procedural | medium | yes (3D engine) | yes | 3D scene |
| Mapimator | Overpass query | bbox/real town | area choice | — | — (it is real) | OSM polylines |
| Parish & Müller | L-system + constraints | density, water, terrain | medium (maps) | **yes** (local constraint) | **yes** (snapping) | graph, plots, buildings |
| Chen 2008 | interactive tensors | brushes, contours | **strong** | **yes** | **yes** | road graph |
| watabou | Voronoi + wards + split | size, seed | low | no | no | 2D layout |
| OBB / skeleton | subdivision | block polygon | parameters | — | frontage on the street | plots |
| Townscaper/WFC | grid + rules | clicks | strong, local | no | no | modules |
| Fab (unverified) | spline + roadside PCG | splines | medium | yes (projection) | yes | instances |

---

## 3. Recommended pipeline for reforger-mapper

Data already available: height, slope, rivers, sea, typed user roads with
junctions, agricultural parcels. Outputs: `ProjectShape` (polyline/spline + generator) and
`ProjectEntity` (`prefab`, `x`, `z`, `yaw`).

**General principle**: *we do not generate a town on a blank sheet.* We **densify the
existing network**:
1. we choose a centre;
2. we grow secondary streets and paths under constraints (Parish &
   Müller approach);
3. we cut **frontage strips** along the streets;
4. we fill these strips with prefabs.

### 3.1 Placing settlements (seeding)
A score is computed on a coarse grid (25–50 m cells):
- `+` proximity to a road **junction** (bonus depending on the number of branches and the road
  type);
- `+` river at 50–300 m (water, mill), **without being in a flood zone**: altitude at least
  2–3 m above the bed;
- `+` sheltered coast (port);
- `+` flat terrain: mean slope under 8% over a 100 m radius;
- `+` edge of agricultural parcels (villages sit in the middle of fields);
- `−` steep slope, water, distance to any road, another settlement closer than `Dmin` (about
  1.5 km for a village and 4 km for a small town).

Then the local maxima are taken with non-maximum suppression (Poisson). The settlement type
follows from the score and the road rank: a hamlet on a road of rank ≤ track,
a village on a departmental road with a crossroads, a small town on a crossroads
of main roads and/or a bridge. The user can **place or move** the centre and
the type by hand: this is the priority control.

### 3.2 Road hierarchy
| Level | Source | Indicative width | Generation |
|---|---|---|---|
| Main road | existing user roads | — | never modified |
| Street | generated | 6–7 m | growth from the main road |
| Lane/track | generated | 3–4 m, often dirt | from the streets, dead-ending toward courtyards or fields |

Each generated road becomes a `ProjectShape` `spline` with the matching road generator
(narrow asphalt, gravel, dirt), reused from the existing road type table.

### 3.3 Street growth, by settlement type
- **Street hamlet** (5–15 buildings): **no new street**. Frontage strips are used along the
  existing road, over 150–400 m around the seed, on one or both sides. We
  add 0 to 2 perpendicular farm tracks.
- **Square village** (20–60 buildings): we create a **square** (a 30–60 m polygon) at the
  junction or on the nearest flat point. We grow 2 to 5 streets as a **constrained
  L-system** from the square and the main road:
  - **segment**: 30–60 m, with a branching angle of 90° ± 20°;
  - **slope constraint**: if the slope in the segment direction exceeds 10%, the segment is
    rotated toward the contour line (projection onto the perpendicular of the
    gradient);
  - **stop**: on water, a slope above 15% or a maximum radius;
  - **snapping**: to a node or a street within 15 m, which closes loops;
  - **priority**: segments close to the centre are processed first.
- **Small town** (100–300 buildings): we combine a **tensor field** (Chen style) with
  the following elements:
  - a radial field at the centre (old town);
  - a field aligned with each existing road;
  - a field aligned with the contour lines, weighted by slope;
  - a grid field for a recent or industrial district on the outskirts.

  Streamlines are traced with `dsep` equal to 60–80 m for streets and 30–40 m for
  lanes. The L-system is enough if we want to postpone the effort: the tensor is a **stage 3**.
- Pure grids are avoided, except for an industrial zone or a housing estate: they are not
  credible for Everon/Arland.

### 3.4 Blocks → plots → footprints
1. **Planar graph**: the existing roads and the new streets are put into it (intersections
   computed, then faces extracted). These faces are the **blocks**. For a hamlet, there
   is no closed face: **strips** are used directly (offset of the road polyline
   on each side).
2. **Frontage strip**: the street axis is offset by `half-width + setback`, then a
   strip of depth `P` is created (the centre has a setback of 0–2 m and a depth of 15–25 m,
   residential 3–6 m and 25–40 m, a farm 5–10 m and 40–70 m). This is the approximation
   of the straight skeleton.
3. **Cutting**: we advance along the strip by curvilinear abscissa with a frontage width drawn
   according to the district (centre 8–12 m, residential 12–20 m, farm 25–50 m). We
   cut perpendicular to the local tangent. For the closed blocks of a small town,
   we apply an **OBB recursive split** to the block core (courtyards, sheds, parks) and reject
   plots without access.
4. A plot is **skipped** with a probability of 10–25% (gardens, gaps), more so on the
   outskirts.
5. **Footprint**: prefab centred on the plot frontage, at `setback + depth/2` from the axis. The
   `yaw` is the tangent orientation, ±90° so that the **door faces the street** (see
   §4). We add a small jitter of ±2° and ±0.5 m. For corner buildings, we choose
   the higher-ranked street.
6. **Collisions**: we test the overlap of OBBs between placed prefabs, with the road
   (distance from the OBB to the axis greater than the half-width plus 1 m), and with water and
   agricultural parcels (we **trim** the parcel or reject the plot).

### 3.5 Districts and prefab choice
The district is assigned by distance to the centre and by context:
- **centre** (radius ≈ 0.25 R): terraced town houses, town hall, church, shops,
  café. We place **only one** civic building per village: the church goes on the square, the
  town hall next to it.
- **residential** (0.25–0.8 R): detached houses with a garden.
- **farm** (beyond 0.8 R or in contact with agricultural parcels): farmhouses,
  barns and sheds grouped around a **courtyard** (2–4 prefabs arranged in a U around a courtyard).
- **industrial** (small town, along the main road or near the river, the railway
  or the port): warehouses, workshops, silos.

Prefab choice for a plot:
1. we filter the candidates from the table `district ∈ tags`, `width ≤ frontage − 2·margin`,
   `depth ≤ P`;
2. we make a **weighted** draw by prefab weight, limiting repetition (no two
   identical prefabs side by side);
3. if there is no candidate, we redo the cut with a wider frontage or leave the
   plot empty.

### 3.6 Slope limits
- We sample the height at the **4 corners and the centre** of the prefab OBB. We compute
  `Δh = max − min`.
- We accept if `Δh ≤ maxDrop` of the prefab: about 0.5 m for a house without a plinth,
  1–1.5 m for a house with a plinth or cellar, 0.3 m for a shed or warehouse.
- Fallback values: plot slope ≤ 8% for the centre and industrial, ≤ 12% for
  residential, ≤ 15% for barns. Beyond that, the plot is rejected.
- Generated streets: longitudinal slope ≤ 10% for a street and ≤ 15% for a track.
- Later: local terrain flattening (terrain flatten) via the Workbench. Out of MVP.

### 3.7 Output
- Each street or lane yields a `ProjectShape { kind:'spline', closed:false, points, generator,
  paramKeys:['RoadWidth'], … }`.
- The square yields a closed `ProjectShape` `polyline`, with a surface or paving
  generator if one exists.
- Any fences and low walls (stage 2) yield a `ProjectShape` `polyline` with a wall
  generator, along the rear or side boundary of the plot.
- Each building yields a `ProjectEntity { id, prefab:'{GUID}path.et', x, z, yaw }`. The height
  is left to the Workbench (snap to ground on creation).
- Elements are grouped by settlement with a prefixed `id` (`settle-<n>-…`) so that a settlement
  can be deleted and regenerated. Random seed per settlement, for a
  reproducible result.

### 3.8 Implementation stages
- **Stage 1, MVP: "hamlet and street village along existing roads"**
  - The user clicks on a junction or a road point, then chooses the type (hamlet
    or village) and the radius.
  - We create frontage strips on both sides of the existing roads within the radius, with
    curvilinear cutting, district by distance (centre, residential, farm), slope
    check at 5 points and OBB collision tests.
  - A **hand-written prefab table** of 15–25 buildings, with their dimensions and the door
    side.
  - No new street is generated. The output consists only of `ProjectEntity`.
  - A 2D preview is drawn on the map (oriented rectangles) before sending to the Workbench.
- **Stage 2**: creation of the square and secondary streets as a constrained L-system (slope, water,
  snapping), with `spline` output. We add U-shaped farm courtyards and fences.
- **Stage 3**: automatic placement of settlements (score, §3.1), then closed blocks, OBB
  split and industrial zoning.
- **Stage 4**: tensor field for small towns, with an editable basis field in the
  UI. Optional OSM import as a template.

---

## 4. Required data on vanilla prefabs

**The prefab inventory remains to be done.** For each building prefab
(`Prefabs/Structures/Houses/...`, `.../Farms/...`, `.../Industrial/...`, `.../Civic/...`), we
need:

| Field | Use |
|---|---|
| `prefab` (`{GUID}path.et`) | output |
| `width`, `depth` (m, in the local frame) | cutting, collisions |
| `offset` (bbox centre relative to the prefab origin) | an off-centre origin is common; correct x/z |
| `doorSide` (`+z`, `-z`, `+x`, `-x`) | yaw computation so that the door faces the street |
| `districts` (`centre`/`residential`/`farm`/`industrial`/`civic`) | choice |
| `maxDrop` (m) | slope limit |
| `weight`, `unique` (church, town hall) | draw |
| `terrace` (bool, can be attached) | rows of town houses in the centre |

Two ways to obtain the footprint:
1. **Via the Workbench API** (existing plugin or enfusion-mcp): instantiate each prefab in
   an empty world, read `IEntity.GetBounds(mins, maxs)` (or the bbox of the visual mesh), then the
   transform, then export to JSON. This is automated once and for all. Caution: the
   bbox includes overhangs (stoop, canopy) and the **origin** is not always at the centre.
2. **Hand-written table**: we measure in the Workbench (gizmo, grid), then note the
   door side by eye. It is reliable but slow. A combination is recommended: **automatic
   bbox + `doorSide`, districts and `maxDrop` entered by hand** in a versioned JSON
   (`data/prefabs-buildings.json`).

The door side cannot be deduced from a bbox. Possible leads: the position of child door
entities, if the prefab contains any, or manual entry.

---

## 5. Licences

| Source | Code | Licence | Use for us |
|---|---|---|---|
| ProbableTrain MapGenerator | open | LGPL-3.0 (to be confirmed) | ideas; reimplement |
| watabou TownGeneratorOS (Haxe) | open | GPL-3.0 | ideas only (copyleft) |
| watabou MFCG recent web version | closed | — | ideas |
| anvaka city-roads | open | MIT | ideas; reusable with attribution |
| OSM / Overpass data | open | ODbL | attribution + share-alike of derived databases |
| Fantasy Town Generator | closed | — | ideas |
| FantasyGen | closed | — | ideas |
| Simteract | closed | — | ideas |
| Mapimator | closed | — | ideas |
| Fab asset | proprietary | Fab licence | ideas; to be checked |
| YouTube video | — | copyright | ideas |
| Papers (Parish & Müller, Chen, Vanegas) | — | publications | algorithms freely reimplementable |

Rule: **no code copied**. Everything is reimplemented in TS from the algorithmic
descriptions above.

## 6. City builders: reusable logic

Summary of the growth mechanics of real games and simulators, drawn from docs, wikis
and code pages. No code is copied; GPL code is only used to inspire rewritten logic.

### 6.1 OpenTTD: town growth (`src/town_cmd.cpp`)

Sources: https://github.com/OpenTTD/OpenTTD/blob/master/src/town_cmd.cpp ,
https://wiki.openttd.org/en/Manual/Game%20mechanics ,
https://wiki.openttd.org/en/Manual/Settings/Road%20layout

1. At each growth tick: **random walk along the roads** from the centre;
   at each tile, an action is attempted (extend, branch, build).
2. Layout mode: *original* (organic, random branching), *better roads* (avoids
   dead ends and adjacent roads), *2x2 / 3x3 grid* (roads allowed only if
   `(x-cx) % (n+1) == 0` or `(y-cy) % (n+1) == 0` → n×n blocks), *random*.
3. Free tile at the roadside → **house** rather than road (probability depends on the mode).
4. Rejections: incompatible slope (road only on a "straight" slope, house on flat
   ground or with foundations), water, occupied tile.
5. House choice: filters by climate, **town zone** (5 concentric rings
   `dist² < radius[i]`, radii growing with the number of houses), year, size
   (1×1, 2×1, 1×2, 2×2), then a weighted draw. **Unique** buildings (church, stadium) are placed once.
6. Pace: interval between ticks depending on the stations served and on funding.

Takeaway: zone rings, trials spread along the roads, discrete plot sizes,
unique buildings. GPL v2 → inspiration only.

### 6.2 Micropolis (open source SimCity)

Source: https://github.com/SimHacker/micropolis (GPL v3; `zone.cpp`, `scan.cpp`)

1. R/C/I zones painted in 3×3 blocks.
2. Low-resolution influence maps: land value (distance to the centre, terrain,
   pollution, crime), traffic, population density, service coverage.
3. At each scan, a zone grows or declines according to demand + land value − pollution
   − traffic, provided it has **road access**.
4. Density is a level 0..N that replaces the tile with a denser version.

Takeaway: a **site score** (centre + road − slope − nuisance) computed on cheap
low-resolution maps. The time simulation is not useful here.

### 6.3 Cities: Skylines (zoning attached to roads)

Sources: https://skylines.paradoxwikis.com/Zoning , https://skylines.paradoxwikis.com/Districts

1. Each road segment creates **8×8 m cells, 4 deep** (32 m) on
   each side. Cells that overlap another road or an object are removed.
2. The player paints a type (low/high-density residential, commercial, industrial, offices).
3. A building occupies a **plot of 1..4 × 1..4 cells**, backed onto the road, facade toward the road.
4. Levels 1..5 depending on land value and services.
5. **Districts**: painted polygons carrying policies and specialisations
   (agricultural, forestry…) that filter the buildings.

Directly relevant takeaway: buildable strip of fixed depth, cut into cells;
plot in cells; facade oriented toward the road; district = catalogue filter. Proprietary game:
only the publicly described mechanics are taken.

### 6.4 Citybound (AGPL v3)

Sources: https://github.com/citybound/citybound , https://aeplay.org/citybound-devblog

The player draws **plans** (roads and zones as free polygons). **Plots** are
computed by intersecting zone ∩ strip along the roads, and each plot knows its facade
side. Agents (households, businesses) then choose the plots. The plan model
is editable and versioned: a proposed plan only applies once validated.
Takeaway: plot = polygon with a facade edge; plans proposed then applied.

### 6.5 Manor Lords (burgage plots) and Banished

Sources: https://wiki.hoodedhorse.com/Manor_Lords/Building ,
https://steamcommunity.com/app/1363080/discussions/0/4524512863775599726/ ,
https://www.gamespot.com/articles/manor-lords-upgrade-town-village-guide/1100-6523015/

The player draws a polygon along a road; the game cuts it into **strip-shaped
parcels**: narrow frontage on the road, great depth at the back (garden, vegetable plot,
outbuilding). There is no grid: boundaries are perpendicular to the road and
"snapping" is done on the roads. The internal algorithm is not published, only the observed
behaviour is described. Banished has no automatic generation; we only keep
the clusters of houses around services.

This is **the most accurate reference for a European street village**: 12 to 25 m frontage,
30 to 60 m depth, house on the frontage, barn at the back, hedge or fence on the side boundaries.

### 6.6 Emilien et al. 2012, "Procedural generation of villages on arbitrary terrains"

Source: https://hal.inria.fr/hal-00694525 (The Visual Computer, 2012)

1. Incremental addition of buildings according to an **interest function**: distance to the centre,
   slope, altitude, water, road.
2. Each new building is connected to the network by a shortest path weighted by slope.
3. Parcels are deduced afterwards by expansion; buildings are oriented according to
   the road or the slope.
4. Parameter sets depending on the village type (hilltop, plain, valley).

Takeaway: the per-candidate interest function, the ridge parallel to the contour lines,
filling up to a quota. Academic paper: the logic is reimplementable.

### 6.7 Minecraft ("jigsaw" villages)

Sources: https://minecraft.wiki/w/Jigsaw_Block , https://minecraft.wiki/w/Village

A starting piece (square, well) is placed, then pieces drawn from **weighted pools** per biome
are attached through **connectors**. Depth is limited (about 7) and any
piece colliding by bounding box is rejected. Streets follow the terrain.
Takeaway: weighted pools, "road edge → prefab door" connector, OBB test,
bounded depth.

### 6.8 Townscaper

Source: https://www.gamedeveloper.com/design/how-townscaper-works-a-story-four-games-in-the-making

Irregular grid and WFC on the corners: the displayed module depends on the neighbours.
Takeaway: **choose the variant according to the neighbours** (terraced, detached or corner house).

### 6.9 The site as a city builder: interaction tools

The games all rely on a **tool → ghost preview → validation → growth** loop.
Tools proposed for a top-down 2D canvas, each linked to the generation stage it drives:

| Tool (UI) | Inspiration | Stage driven |
|---|---|---|
| **Road**: clicked/dragged polyline with snapping to existing nodes and roads, choice of class (track, street, departmental) | C:S, Citybound | Road graph (§3.2); recomputes the buildable strips |
| **Zone brush**: drag along a road to paint the strip cells (8 m); right-click erases; size 1 to 4 cells | C:S | Strip → type (residential, farm, centre, industry) |
| **Parcel lasso**: free polygon backed onto a road, cut into strips live, with a frontage width handle | Manor Lords | Plot cutting (§3.4) |
| **District**: painted and named polygon, with a style (Everon/Arland), an era and a faction | C:S, Citybound | Prefab pool filter (§3.5) |
| **Density, era and style selectors** (per district or per settlement), fill slider in % | OpenTTD (years), C:S (levels) | Fill rate per ring, catalogue filter |
| **Centre and radius**: move the centre of a settlement; type hamlet, village or town | OpenTTD (rings) | Zone rings, quota |
| **Unique building**: pin church, town hall or square on a plot | OpenTTD | Reserves the plot before filling |
| **Plot editing**: click a plot to freeze or reject the prefab, draw another, rotate it or empty it | Citybound | Manual override kept across regenerations |
| **Growth**: instant "generate" button, plus a "step by step" or "play" mode that fills the plots in score order | Micropolis, OpenTTD | Fill order; useful for tuning the quota by eye |
| **Seed**: show and change the seed, with a button to re-roll whatever is not locked | — | Determinism |
| **Layers** of slope, score and zones (heatmap) | Micropolis (maps) | Rejection diagnostics |
| **Undo / Redo**: command stack (Command pattern) on the editable model, generation being a pure function | Citybound (plans) | All editing |
| **Export** of prefab placements (`.layer` or JSON) | — | Output (§3.7) |

Principle: we store the **intent** (roads, zones, districts, locks) and not the result;
buildings are recomputed deterministically from the intent and the seed.
The "growth over time" mode is only an animation of the fill order,
not a simulation.

### 6.10 What we keep for reforger-mapper (implementation order)

1. **Buildable strip** on either side of each road: 35 to 50 m deep in
   a hamlet or village, 25 to 35 m in a town centre; water, roads and slopes beyond the threshold are excluded.
2. **Strip-shaped parcels**: cut perpendicular to the road, frontage of 12 to 25 m in the
   village and 8 to 14 m in a town centre, with a jitter of ±10%.
3. **Prefab on the frontage**: the bbox must fit in the plot with a setback of 2 to 6 m, the door
   turned toward the road; rejection by OBB collision with neighbours and the road.
4. **Slope**: rejection if the height difference under the footprint exceeds the prefab threshold; ridge
   parallel to the contour lines when possible; placement at the min or median height.
5. **Back of the parcel**: barn, shed or garden if the remaining depth exceeds 15 m.
6. **Rings** according to d/radius (50, 120 or 250 m): 0 = centre (church, town hall, terraced),
   1 = tight houses, 2 = houses with gardens, 3 = farms and empty plots.
7. **Fill rate** per ring (for example 90, 70, 45, 20%) for an organic look.
8. **Site score** (centre + crossroads − slope − nuisance) that sets the fill order
   up to the quota.
9. **Unique buildings** placed on the best plot of ring 0.
10. **Weighted pools** by settlement type × ring × style or district.
11. **Variant according to neighbours**: terraced, detached or corner at crossroads.
12. **UI tools** in this order: road, then centre and radius, then generation and seed,
    then undo/redo, then plot editing; zone brush, lasso and districts come afterwards.
13. Later: dead-end lanes when a strip is saturated (*better roads* rule: no dead end shorter than 30 m).

Licences: OpenTTD (GPL v2), Micropolis (GPL v3) and Citybound (AGPL v3) are only used to
inspire rewritten logic. C:S, Manor Lords, Minecraft and Townscaper are proprietary:
only their publicly described mechanics are taken. Emilien et al. is a paper,
hence reimplementable.
