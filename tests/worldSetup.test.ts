import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error plain JS bridge module
import { missingInText, missingBaseEntities } from '../bridge/world-setup.mjs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('missingInText: hand-placed light / fog / camera / probe (no prefab) count as present', () => {
  const text = [
    'GenericWorldFogEntity {', 'GenericWorldLightEntity Lighting {', 'CameraManager CameraManager1 {', 'EnvironmentProbeEntity MainProbe {',
  ].join('\n')
  const miss: string[] = missingInText(text)
  for (const n of ['CameraManager', 'Lighting', 'FogHaze', 'EnvProbe']) assert.ok(!miss.includes(n), n)
  assert.ok(miss.includes('MapEntity'))
})

test('missingInText: prefab path still detected, unrelated names are not', () => {
  assert.ok(!missingInText(' x : "{0000}Prefabs/World/DefaultWorld/Lighting_Everon.et" {').includes('Lighting'))
  assert.ok(missingInText('SomeCameraManagerHelper {').includes('CameraManager'))
})

test('missingBaseEntities: managers added live by the send (world not saved yet) are not reported missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mgws-'))
  const ent = join(dir, 'W.ent')
  writeFileSync(ent, 'GenericTerrainEntity {\n')
  const before: string[] = missingBaseEntities(ent)
  assert.ok(before.includes('RadioBroadcastManager') && before.includes('MusicManager') && before.includes('MapEntity'))
  const live = ['E {66B93BC296E2F977}Prefabs/World/Game/RadioBroadcastManager.et 0 0 0', 'E {359452CCDBDD03F6}Prefabs/Sounds/Music/MusicManager.et 0 0 0', 'E {731564B66F91B107}Prefabs/World/Game/MapEntity.et 0 0 0'].join('\n')
  const after: string[] = missingBaseEntities(ent, live)
  for (const n of ['RadioBroadcastManager', 'MusicManager', 'MapEntity']) assert.ok(!after.includes(n), n)
  assert.equal(after.length, before.length - 3)
})
