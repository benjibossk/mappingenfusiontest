# Persistent modifiers (design proposal)

Status: proposal, not implemented. Inspired by how MapToPlay's editor works (public docs only, no code
reused).

## Problem

Today most edits are baked: a road flattens the heightmap once, a forest generator writes its points once.
When the source changes (new OSM import, a road moved, the relief re-downloaded), the baked result is
stale and has to be redone by hand or regenerated from scratch, losing manual work.

## Idea

Keep the **source** (imported relief, OSM shapes, hand-drawn shapes) separate from a **stack of
modifiers**. The working terrain and the generated objects are always `apply(modifiers, source)`; they are
never edited directly. Changing a source or a modifier re-runs the stack.

```
source heightmap ─┐
source shapes ────┼─► [modifier 1] ─► [modifier 2] ─► … ─► working heightmap + objects ─► Workbench
manual sculpt ────┘   (each: scope, params, seed, enabled)
```

## Modifier model

```ts
interface Modifier {
  id: string
  kind: 'buffer' | 'grade' | 'roadbed' | 'depth' | 'heightOffset' | 'distribute' | 'simplify'
  scope: { layer?: string; category?: string; featureIds?: string[] }   // what it applies to
  params: Record<string, number | string | boolean>
  seed?: number          // distribute: same seed = same objects
  enabled: boolean
}
```

| Kind | Does | Replaces today |
|---|---|---|
| buffer | line → polygon of half-width w | road / river width handling |
| grade | flattens the terrain under a polygon (median/min/max + edge blend) | building / village pads |
| roadbed | smooths the profile along a line + shoulders, skips bridges | road flattening in the send step |
| depth | digs / raises inside a polygon with a steepness | lake and river beds |
| heightOffset | constant offset | water level tweaks |
| distribute | spacing, jitter, edge buffer, seed → points | forest / field object scatter |
| simplify | Douglas-Peucker on shapes | the fixed tolerances in osm.ts |

## Rules

- Deterministic: same source + same stack + same seeds = same result (needed for collaboration and undo).
- Order matters; the stack is shown as a list the user can reorder, mute, or delete.
- Manual sculpt strokes are themselves a modifier (a recorded delta layer), so they survive re-imports.
- Cost guard: a modifier re-runs only on the region it touches (dirty rectangle), not the whole map.

## Migration plan

1. Wrap the current baked steps (road flattening, building pads, forest scatter) as modifiers with their
   current parameters, same output (golden test on a saved project).
2. Show the stack in the project dashboard (list + enable toggle).
3. Re-import keeps the stack: re-run on the new source.
4. Then add new kinds (grade, depth) as needed.

Open question: memory for 2049² grids when keeping source + working + delta layers (3 × 16 MB Float32,
acceptable).
