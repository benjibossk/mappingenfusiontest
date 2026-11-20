// Harbours copied from the vanilla maps (harbour.ts, HARBOUR_VANILLA.md): seed 21 world with the vanilla sites on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { HARBOUR_PARCELS, APRON_H, QUAY_DECK, harbourIssues } from '../../src/modules/harbour.ts'

test('harbour library: vanilla quay pieces at the deck height', () => {
  assert.ok(HARBOUR_PARCELS.length >= 6)
  for (const c of HARBOUR_PARCELS.filter((q) => Math.abs(((q as { deck?: number }).deck ?? 0) - 2.2) <= 0.8)) {
    const ys = c.items.filter((i) => /PierConcrete_01_20m\.et/.test(i.prefab)).map((i) => i.y).sort((a, b) => a - b)
    if (ys.length) assert.ok(Math.abs(ys[ys.length >> 1] - (APRON_H - QUAY_DECK)) < 1, `${c.id}: quay origin ${ys[ys.length >> 1]}`)
  }
})

test('seed 21: harbours from the vanilla library, no floating / misaligned / isolated pieces', async () => {
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed: 21, vanillaSites: true, villageTemplates: true })
  const g = w.grid, h = (x: number, z: number) => w.heights[Math.round((z - g.minZ) / g.step) * g.cols + Math.round((x - g.minX) / g.step)]
  const ports = w.zones.filter((z) => /^VAN_PORT_/.test(z.id) && z.harbour)
  assert.ok(ports.length >= 1, 'at least one harbour')
  for (const p of ports) {
    assert.ok(HARBOUR_PARCELS.some((c) => c.id === p.harbour!.compo), p.harbour!.compo)
    assert.ok(p.entities.every((e) => e.ycm !== undefined), `${p.id}: every piece at its vanilla height`)
    const is = harbourIssues(p.entities, h)
    assert.equal(is.length, 0, `${p.id}: ${JSON.stringify(is.slice(0, 4))}`)
  }
})
