// Surface mask painting, shared by the bridge (bridge/terrain-masks.mjs -> PNG files for the Workbench) and
// the app (the 3D/2D preview drape renders the same final pixels the engine gets). Pure: no node, no DOM.
// Pipeline (paintMasks): sample the app's surface grids per pixel -> stamp the vector surfaces (roads, water,
// buildings... as `roads` entries) -> per-block limit (limitPixelBlocks then the guaranteed enforcePixelBlocks).
// Pixel row 0 = NORTH (z max), column 0 = west, value 0..255 = surface weight.

//! Road surfaces at pixel precision (row 0 = NORTH): core surface within `half` metres of the centre
//! line, fading out over `edge` metres; the optional `side` surface fills the fade band (dirt shoulders).
//! Returns Map(surface name -> Float32Array side*side, 0..1), first road layer wins where they overlap.
export function roadLayers(side, mPerPx, roads) {
  const layers = new Map();
  const layer = (name) => {
    if (!/^[\w-]+$/.test(name ?? "")) throw new Error("road surface invalid: " + name);
    if (!layers.has(name)) layers.set(name, new Float32Array(side * side));
    return layers.get(name);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  for (const r of roads) {
    const core = layer(r.core);
    const shoulder = r.side ? layer(r.side) : null;
    const reach = r.half + r.edge;
    const p = r.points;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / mPerPx));
      const c1 = Math.min(side - 1, Math.ceil((Math.max(ax, bx) + reach) / mPerPx));
      const z0 = Math.max(0, Math.floor((Math.min(az, bz) - reach) / mPerPx));
      const z1 = Math.min(side - 1, Math.ceil((Math.max(az, bz) + reach) / mPerPx));
      for (let zi = z0; zi <= z1; zi++) {
        const row = side - 1 - zi;
        const z = zi * mPerPx;
        for (let col = c0; col <= c1; col++) {
          const x = col * mPerPx;
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
          const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
          if (d >= reach) continue;
          const i2 = row * side + col;
          const w = (d <= r.half ? 1 : 1 - smooth((d - r.half) / r.edge)) * (r.peak ?? 1);
          if (shoulder) {
            // core: hard-ish edge (1 m fade), shoulder fills the band outside
            const cw = d <= r.half ? 1 : Math.max(0, 1 - (d - r.half) / 1);
            core[i2] = Math.max(core[i2], cw);
            shoulder[i2] = Math.max(shoulder[i2], w - cw);
          } else core[i2] = Math.max(core[i2], w);
        }
      }
    }
  }
  // a pixel can't be more than 100 % road: the first layers keep their weight
  const list = [...layers.values()];
  for (let i = 0; i < side * side; i++) {
    let left = 1;
    for (const a of list) { if (!a[i]) continue; a[i] = Math.min(a[i], left); left -= a[i]; }
  }
  return layers;
}

//! paints the road layers into the surface bytes (adds the road surfaces to `names` when missing)
function stampRoads(bytes, names, side, mPerPx, roads) {
  if (!roads.length) return;
  for (const [name, a] of roadLayers(side, mPerPx, roads)) {
    let k = names.indexOf(name);
    if (k < 0) { names.push(name); bytes.push(new Uint8Array(side * side)); k = names.length - 1; }
    const own = bytes[k];
    for (let i = 0; i < a.length; i++) {
      const w = a[i];
      if (!w) continue;
      for (let j = 0; j < bytes.length; j++) if (j !== k) bytes[j][i] = Math.round(bytes[j][i] * (1 - w));
      own[i] = Math.min(255, Math.round(own[i] * (1 - w) + 255 * w));
    }
  }
}

export function sampler(s) {
  if (!/^[\w-]+$/.test(s.name ?? "")) throw new Error("surface name invalid: " + s.name);
  if (!(s.cols >= 2 && s.rows >= 2 && s.step > 0 && s.weights?.length === s.cols * s.rows))
    throw new Error("grid invalid for " + s.name);
  return (x, z) => {
    const gx = Math.min(Math.max((x - (s.minX ?? 0)) / s.step, 0), s.cols - 1);
    const gz = Math.min(Math.max((z - (s.minZ ?? 0)) / s.step, 0), s.rows - 1);
    const x0 = Math.min(Math.floor(gx), s.cols - 2);
    const z0 = Math.min(Math.floor(gz), s.rows - 2);
    const fx = gx - x0;
    const fz = gz - z0;
    const w = s.weights;
    const i = z0 * s.cols + x0;
    const a = w[i] + (w[i + 1] - w[i]) * fx;
    const b = w[i + s.cols] + (w[i + s.cols + 1] - w[i + s.cols]) * fx;
    return a + (b - a) * fz;
  };
}

//! Final mask bytes, exactly what writeMasks writes: one Uint8Array(side*side) per name.
//! surfaces: [{name, minX, minZ, step, cols, rows, weights}] (row 0 = south), roads: see roadLayers,
//! colours: {name: [r, g, b]} or null. blockPx / margin: engine block (63 px) and read margin (3 px),
//! scaled down by the preview when it paints at a lower resolution.
export function paintMasks(side, terrainSize, surfaces, roads = [], colours = null, blockPx = 63, margin = 3) {
  const mPerPx = terrainSize / (side - 1);
  const bytes = surfaces.map((s) => {
    const sample = sampler(s);
    const a = new Uint8Array(side * side);
    for (let row = 0; row < side; row++)
      for (let col = 0; col < side; col++)
        a[row * side + col] = Math.round(Math.min(Math.max(sample(col * mPerPx, (side - 1 - row) * mPerPx), 0), 1) * 255);
    return a;
  });
  const names = surfaces.map((s) => s.name);
  stampRoads(bytes, names, side, mPerPx, roads);
  const rgb = colours ? names.map((n) => colours[n] ?? null) : null;
  // road / track cores are kept by the block limiter whatever their share of the block: a crossing road is a
  // small share of its block and was dropped first (seed 21 IND_1: concrete road turned into Pebbles_01,
  // asphalt cut, grass clutter across the carriageway)
  // (a band may set its own `prio`: pole-foot dirt patches, else lost as a tiny share of their block)
  const pr = new Map();
  for (const r of roads) {
    const v = r.prio ?? (/^(Dirt_0[12]|Grass|Forest)/.test(r.core ?? "") ? 1 : ROAD_PRIO);
    pr.set(r.core, Math.max(pr.get(r.core) ?? 1, v));
  }
  const prio = names.map((n) => pr.get(n) ?? 1);
  limitPixelBlocks(bytes, side, blockPx, 4, margin, rgb, prio);
  // the iterative pass above can oscillate between neighbouring blocks and stop at its pass cap
  // (seen: block [12x22] left with 6 surfaces) -> hard, guaranteed pass on the same footprint
  enforcePixelBlocks(bytes, side, blockPx, 4, margin, rgb, 2, 0.01, prio);
  return { names, bytes };
}

//! The engine allows 5 surfaces per block INCLUDING the default one (docs/ARCHITECTURE.md), so 4 painted
//! surfaces (`max`) per block (tile 252 px / 4 = 63 px) and reads a few pixels past
//! the block edge. Enforced on the final pixels: for each block region (+ margin) with too many
//! surfaces, one is removed and its weight goes to a surface left on that pixel (or nearby).
//! With `cols` (rgb per surface) the removed surface is the one that changes the look least
//! (weight x colour gap to its closest kept surface) and it is replaced by that closest-coloured
//! surface, so blocks along roads don't show up as squares of another colour.
//! Repeated until every region is fine, since a move can touch a neighbour region.
export const ROAD_PRIO = 40;
export function limitPixelBlocks(bytes, side, blockPx = 63, max = 5, margin = 3, cols = null, prio = null) {
  const gap = (a, b) => (cols && cols[a] && cols[b] ? Math.hypot(cols[a][0] - cols[b][0], cols[a][1] - cols[b][1], cols[a][2] - cols[b][2]) : null);
  const nb = Math.ceil((side - 1) / blockPx);
  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    for (let by = 0; by < nb; by++) {
      for (let bx = 0; bx < nb; bx++) {
        const r0 = Math.max(0, by * blockPx - margin), r1 = Math.min(side - 1, by * blockPx + blockPx + margin);
        const c0 = Math.max(0, bx * blockPx - margin), c1 = Math.min(side - 1, bx * blockPx + blockPx + margin);
        for (;;) {
          const totals = bytes.map((a) => {
            let t = 0;
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) t += a[r * side + c];
            return prio ? t * prio[bytes.indexOf(a)] : t;
          });
          const used = totals.map((t, k) => [t, k]).filter(([t]) => t > 0).sort((a, b) => b[0] - a[0]);
          if (used.length <= max) break;
          changed = true;
          let drop = used[used.length - 1][1];
          if (cols) {
            let bestCost = Infinity;
            for (const [t, k] of used) {
              const g = Math.min(...used.filter(([, o]) => o !== k).map(([, o]) => gap(k, o) ?? 1e3));
              if (t * (g + 5) < bestCost) { bestCost = t * (g + 5); drop = k; }
            }
          }
          // kept surfaces, closest colour to the dropped one first
          const kept = used.map(([, k]) => k).filter((k) => k !== drop);
          if (cols) kept.sort((a, b) => (gap(drop, a) ?? 1e3) - (gap(drop, b) ?? 1e3));
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const i = r * side + c;
              const v = bytes[drop][i];
              if (!v) continue;
              bytes[drop][i] = 0;
              // strongest kept surface on this pixel, else nearby (so no surface appears out of
              // nowhere in a neighbouring block)
              // with colours: the closest-coloured kept surface present here or nearby;
              // without: the strongest one
              let best = -1, bv = 0;
              const pick = (j) => {
                if (cols) { for (const k of kept) if (bytes[k][j] > 0) { if (best < 0 || kept.indexOf(k) < kept.indexOf(best)) best = k; break; } }
                else for (const k of kept) if (bytes[k][j] > bv) { bv = bytes[k][j]; best = k; }
              };
              pick(i);
              for (let rad = 1; best < 0 && rad <= 8; rad++)
                for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
                  const rr = r + dr, cc = c + dc;
                  if (rr < 0 || cc < 0 || rr >= side || cc >= side) continue;
                  pick(rr * side + cc);
                }
              if (best < 0) best = kept[0];
              bytes[best][i] = Math.min(255, bytes[best][i] + v);
            }
          }
        }
      }
    }
    if (!changed) return;
  }
}

//! Guaranteed version of limitPixelBlocks (single pass, no cap): each block region (+ margin) keeps
//! its `max` strongest surfaces; a pixel keeps only the surfaces kept by EVERY region covering it,
//! the removed weight goes to its strongest allowed surface (else the closest-coloured / strongest
//! of the block). Pixels whose regions share no surface get a common "glue" surface forced into
//! those regions (as limitPerBlock in island.ts). Weights <= `tiny` are dropped first (insignificant).
//! A surface under `minShare` of a block's total weight is dropped from that block too: a 0.x %
//! residue still counts as a block material and shows as an odd-coloured block in the engine
//! (community mapping docs, "Info & Diags" merge advice).
export function enforcePixelBlocks(bytes, side, blockPx = 63, max = 4, margin = 3, cols = null, tiny = 2, minShare = 0.01, prio = null) {
  const n = bytes.length;
  if (!n || max < 1) return;
  const nb = Math.ceil((side - 1) / blockPx);
  const lo = (i) => Math.max(0, Math.ceil((i - blockPx - margin) / blockPx));
  const hi = (i) => Math.min(nb - 1, Math.floor((i + margin) / blockPx));
  const strongestAt = (i, ok) => { let b = -1; for (const k of ok) if (bytes[k][i] > 0 && (b < 0 || bytes[k][i] > bytes[b][i])) b = k; return b; };
  // insignificant weights -> strongest surface of the pixel
  for (let i = 0; i < side * side; i++) {
    let moved = 0, b = -1;
    for (let k = 0; k < n; k++) { const v = bytes[k][i]; if (!v) continue; if (v <= tiny) { moved += v; bytes[k][i] = 0; } else if (b < 0 || v > bytes[b][i]) b = k; }
    if (moved && b >= 0) bytes[b][i] = Math.min(255, bytes[b][i] + moved);
  }
  const ranked = [];
  for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
    const r0 = Math.max(0, by * blockPx - margin), r1 = Math.min(side - 1, by * blockPx + blockPx + margin);
    const c0 = Math.max(0, bx * blockPx - margin), c1 = Math.min(side - 1, bx * blockPx + blockPx + margin);
    const t = bytes.map((a, k) => { let s = 0; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) s += a[r * side + c]; return prio ? s * prio[k] : s; });
    const floor = t.reduce((a, b) => a + b, 0) * minShare;
    const r = t.map((v, k) => [v, k]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    ranked.push(r.filter(([v], j) => j === 0 || v >= floor).map(([, k]) => k));
  }
  const keep = ranked.map((l) => new Set(l.slice(0, max)));
  const single = new Map();
  const allowed = (r, c) => {
    const ra = lo(r), rb = hi(r), ca = lo(c), cb = hi(c);
    if (ra === rb && ca === cb) {
      const b = ra * nb + ca;
      let a = single.get(b);
      if (!a) single.set(b, (a = [...keep[b]]));
      return a;
    }
    const ok = [];
    for (let k = 0; k < n; k++) {
      let all = true;
      for (let by = ra; by <= rb && all; by++) for (let bx = ca; bx <= cb; bx++) if (!keep[by * nb + bx].has(k)) { all = false; break; }
      if (all) ok.push(k);
    }
    return ok;
  };
  const hasWeight = (i) => { for (let k = 0; k < n; k++) if (bytes[k][i]) return true; return false; };
  const glued = new Uint8Array(nb * nb);
  let glue = -1;
  for (let round = 0; round <= nb * nb; round++) {
    const conflicts = [];
    for (let r = 0; r < side; r++) {
      const multiR = lo(r) !== hi(r);
      for (let c = 0; c < side; c++) {
        if (!multiR && lo(c) === hi(c)) continue;
        const i = r * side + c;
        if (hasWeight(i) && !allowed(r, c).length) conflicts.push(i);
      }
    }
    if (!conflicts.length) break;
    if (glue < 0) {
      const w = new Array(n).fill(0);
      for (const i of conflicts) for (let k = 0; k < n; k++) w[k] += bytes[k][i];
      glue = w.indexOf(Math.max(...w));
    }
    for (const i of conflicts) {
      const c = i % side, r = (i - c) / side;
      for (let by = lo(r); by <= hi(r); by++) for (let bx = lo(c); bx <= hi(c); bx++) {
        const b = by * nb + bx;
        if (glued[b]) continue;
        glued[b] = 1;
        keep[b] = new Set([glue, ...ranked[b].filter((k) => k !== glue).slice(0, max - 1)]);
        single.delete(b);
      }
    }
  }
  const gap = (a, b) => (cols && cols[a] && cols[b] ? Math.hypot(cols[a][0] - cols[b][0], cols[a][1] - cols[b][1], cols[a][2] - cols[b][2]) : 1e3);
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    const i = r * side + c;
    let bad = false;
    for (let k = 0; k < n && !bad; k++) if (bytes[k][i]) bad = true;
    if (!bad) continue;
    const ok = allowed(r, c);
    const okSet = new Set(ok);
    let best = strongestAt(i, ok);
    for (let k = 0; k < n; k++) {
      const v = bytes[k][i];
      if (!v || okSet.has(k)) continue;
      bytes[k][i] = 0;
      let to = best;
      if (to < 0) { to = ok.slice().sort((a, b) => gap(k, a) - gap(k, b))[0]; best = to; }
      if (to === undefined) continue; // unreachable once the glue pass is done
      bytes[to][i] = Math.min(255, bytes[to][i] + v);
    }
  }
}
