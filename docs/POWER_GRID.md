# Power grid generation (src/modules/powergrid.ts)

Step Roads > Power lines. Pure module, tested in `tests/library/powergrid.test.ts`.

## Hierarchy

| Level | Role | Vanilla generator (Everon / Soviet) | Span (m_fDistance) |
|---|---|---|---|
| EHV | plant to plant, links > 4 km (maps >= 8 km, or forced) | `PG_PowerLine_EHV_01` | 130 m |
| HV | transmission mesh: plant yards and town substations | `PG_PowerLine_HV_02_Metal` / `PG_PowerLine_HV_USSR_01` | 80 / 50 m |
| MV | feeders from substations to villages, industry, remote farms | `PG_PowerLine_HV_01_Concrete` / `PG_PowerLine_HV_03_Wooden` | 50 / 50 m |
| LV | village streets, hamlets within reach | `PG_PowerLine_01_WoodenSmall` / `PG_PowerLine_LV_USSR_01` | 35 / 40 m |

Stations (GUIDs read from base-game data and layers, never invented):

- source: `DieselPowerPlant_USSR_01` {71A6647EE336A395}, 39.6 x 29.5 m. It is the only vanilla power plant. The Everon `DieselPowerPlant_01` GUID is not referenced by any file we can read, so both styles use the USSR plant. No vanilla thermal, hydro, wind or solar plant exists. `Prefabs/Infrastructure/Dam/Dam_01` {F9BD45A336D521FF} exists, but it is not used yet (see Limits).
- step-up yard and HV->MV substation: `TransformerStation110kV_E_01_simple_v1` {BE3D31D8919CA073}, 13 x 21.5 m.
- EHV ends: `TransformerStation110kV_E_01_double` {5BC1688321A0EF60}. It is the EHV_01 generator's own start and end pole, so the generator places it. Each EHV line gets its own bay 60 m out of the yard, offset sideways, so two stations never land on the same spot.
- MV->LV: `TransformerSubstation_01` {A54F6416C3A6A4D7} (Everon) / `TransformerStation_USSR_02` {E5CB175C37DBD3BC} (Soviet).
- industry: `TransformerStation_E_02` {6AD4788522334B53} / `TransformerStation_USSR_02`.

Every station sits on a flattened pad (rectangle + 6 m, 12 m blend) in the height grid, as the zones do. A dirt access track (`RG_Road_Dirt_01`) runs from its gate (local +Z face, turned to the road) to the nearest road.

## Algorithm

1. **Sources.** By default there is 1 plant per ~6 km of map side, at most 3. Candidates are scored on a coarse lattice:
   - flat (relief over 70 x 60 m <= 6 m), dry;
   - >= 350 m outside every settlement;
   - <= 600 m from a road;
   - bonus for water within 600 m (cooling / fuel by boat) and for an industrial zone within 1.5 km;
   - picked best-first with a minimum spacing (side / (n+1)) so the plants are spread out.
2. **Load substations.** Every town gets an HV->MV station on its edge, facing the map interior. If there are fewer than 2 towns, the most remote villages are added.
3. **Transmission mesh.** A minimum spanning tree over plant yards and town substations, plus one extra link from every dead end to its nearest non-neighbour. This closes loops (N-1 redundancy) without the n² candidate lines. Plant-to-plant links and links over 4 km are EHV, the others HV.
4. **MV feeders.** A tree grown from all substations (Prim with several sources):
   - each village, town or industrial zone is joined to the nearest node already fed (cost x0.85 when the midpoint is near a road), up to `mvMax`;
   - its own MV->LV transformer sits at its edge, facing the feeder, and becomes a node in turn;
   - every MV line therefore ends at a station;
   - villages come first; a hamlet gets its own kiosk only if no transformer lies within `lvMax`.
4b. **Isolated farms.** One LV drop from the nearest LV pole (along the road for at most `FARM_ALONG_MAX` = 600 m, then the last spans straight across the fields), or a pole transformer on the nearest MV pole. A farm out of reach of both (far from every road) gets an MV spur straight across the fields (`FARM_SPUR_MAX` = 2.5 km) to a pole transformer 35 m from its yard, then one short LV span.
5. **LV.** Up to two runs per village from its transformer to far road points inside the village, offset 8 m onto the verge. Hamlets are fed from the nearest transformer within `lvMax`.
6. **Routing.** Each line is routed with A* over the height grid (power.ts). Slope over the limit, water and village centres (0.5 R, except for LV) are forbidden. Road corridors are cheaper for MV and LV. The route is then straightened by line of sight (EHV/HV spans up to 5 km). One cost field is shared per level.

## Logic borrowed and sources (only what was read)

- Gegner, Birchfield, Xu, Shetye, Overbye, *A Methodology for the Creation of Geographically Realistic Synthetic Power Flow Models*, PECI 2016 — https://overbye.engr.tamu.edu/wp-content/uploads/sites/146/2022/06/synthetic-networks-PECI-2016_final_WithFooter.pdf. Ideas reused:
  - load substations follow where people live (our towns and villages);
  - generators are sited separately, as their own substations;
  - nearest-neighbour graphs (Delaunay in the paper) give realistic topologies whose mean nodal degree does not grow with system size.
  
  Our MST + nearest non-neighbour loop is a cheap stand-in for that nearest-neighbour graph. It keeps the degree low (2-3) and avoids a pure tree.
- OpenStreetMap wiki, *Power networks/Guidelines/Substations* — https://wiki.openstreetmap.org/wiki/Power_networks/Guidelines/Substations. Ideas reused:
  - the substation roles (generation = plant step-up yard, transmission = meshing node, distribution = town HV->MV, industrial = a station dedicated to a factory zone);
  - lines end on the portal or busbar side of a fenced yard. Our lines stop at a "port" on the station edge that faces the other end.

## Limits

- Hydro is not done: `Dam_01` was found, but its size and orientation are unknown, so it is not sited on rivers yet.
- No wind or solar plants exist in vanilla.
- The random world generator (worldgen.ts) still uses its own simpler HV/LV step. This planner runs from the Roads > Power lines button.
- The station yaw convention matches the bridges and zones (entity yaw = -yaw in degrees). The busbar and portal positions of the vanilla stations were not read from the meshes. Lines attach to the station edge, not to the exact portal.
