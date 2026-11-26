import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error plain JS bridge module
import { missingInText } from '../bridge/world-setup.mjs'

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
