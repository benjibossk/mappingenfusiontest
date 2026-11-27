// Forests sent in batches: one Apply of every ForestGenerator at once took the Workbench to 12.7 GB (map from
// picture 119, ~124 ha of drawn woods). Each batch is its own Apply (the world is saved in between). The Workbench
// replaces the previous objects of each family sent (name prefix up to the first "_"): every batch is FOREST_, so
// the batches already sent are locked (bridge `locked`, names never removed) while batch 1 clears the old forests.

/** forest shapes -> batches of at most `perBatch` shapes, renamed FOREST_B<k>_..., with the prefixes to keep */
export function forestBatches<S extends { id: string }>(shapes: S[], perBatch: number): { shapes: S[]; locked: string[] }[] {
  const n = perBatch > 0 ? Math.floor(perBatch) : shapes.length || 1
  const out: { shapes: S[]; locked: string[] }[] = []
  for (let i = 0, k = 1; i < shapes.length; i += n, k++) {
    const rename = (id: string) => `FOREST_B${k}_${id.startsWith('FOREST_') ? id.slice(7) : id}`
    out.push({
      shapes: shapes.slice(i, i + n).map((s) => ({ ...s, id: rename(s.id) })),
      locked: Array.from({ length: k - 1 }, (_, j) => `FOREST_B${j + 1}_*`),
    })
  }
  return out
}

/** the whole "Envoyer les forêts" run: every batch (or one send), then the forest ground masks rewritten from the
 *  same final forest set (picture 119 round 9: batches sent, masks on disk still the previous forests). A mask
 *  failure is reported, never undoes the forests sent. */
export async function sendForests<S extends { id: string }>(shapes: S[], perBatch: number, io: {
  send: (shapes: S[], k: number, n: number, locked: string[] | undefined) => Promise<string>
  masks?: () => Promise<string>
  pause?: () => Promise<void>
}): Promise<string> {
  const out: string[] = []
  if (!perBatch || shapes.length <= perBatch) out.push(await io.send(shapes, 0, 1, undefined))
  else {
    const b = forestBatches(shapes, perBatch)
    for (let k = 0; k < b.length; k++) {
      out.push(await io.send(b[k].shapes, k, b.length, b[k].locked))
      if (k + 1 < b.length && io.pause) await io.pause()
    }
  }
  if (io.masks) {
    try { out.push(await io.masks()) } catch (err) { out.push('masks: ' + (err as Error).message) }
  }
  return out.join('\n')
}
