// Several projects (src/projects.ts): create / list by recency / save / rename / duplicate / remove,
// local link kept out of the exported file, legacy single autosave migrated once
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProjectStore, memoryKV } from '../src/projects.ts'

test('projects: create, recent first, save, rename, duplicate, remove', async () => {
  let t = 1000
  const s = new ProjectStore(memoryKV(), () => t++)
  const a = await s.create('Île A', { kind: 'reforger-mapper-island', version: 1 })
  const b = await s.create('Île B')
  const c = await s.create('  ')
  assert.equal(c.name, 'Sans nom')
  assert.deepEqual((await s.list()).map((p) => p.id), [c.id, b.id, a.id])
  await s.save(a.id, { kind: 'reforger-mapper-island', version: 1, roads: [] })
  assert.equal((await s.recent(1))[0].id, a.id, 'saved project comes first')
  assert.equal((await s.recent()).length, 3)
  await s.rename(b.id, 'Côte')
  assert.equal((await s.get(b.id))!.name, 'Côte')
  const d = await s.duplicate(a.id)
  assert.equal(d!.name, 'Île A (copie)')
  assert.deepEqual(d!.data, (await s.get(a.id))!.data)
  await s.setActive(a.id)
  await s.remove(a.id)
  assert.equal(await s.get(a.id), null)
  assert.equal(await s.activeId(), null, 'active cleared with its project')
  await assert.rejects(() => s.save(a.id, {}))
})

test('projects: the local Workbench link never goes into the exported file; import accepts both formats', async () => {
  const s = new ProjectStore(memoryKV())
  const a = await s.create('Carte', { kind: 'reforger-mapper-island', version: 1 })
  await s.setLink(a.id, { wbProject: 'C:\\Users\\x\\addons\\Map\\addon.gproj' })
  const f = await s.exportFile(a.id)
  assert.ok(f && !JSON.stringify(f).includes('addon.gproj'))
  assert.equal((await s.link(a.id)).wbProject, 'C:\\Users\\x\\addons\\Map\\addon.gproj')
  const b = await s.importFile(JSON.parse(JSON.stringify(f)))
  assert.equal(b.name, 'Carte')
  assert.deepEqual(await s.link(b.id), {}, 'a re-imported project has no link on this machine')
  const c = await s.importFile({ kind: 'reforger-mapper-island', version: 1 }, 'vieux.json')
  assert.equal(c.name, 'vieux.json')
})

test('projects: the old single autosave becomes "Mon projet" once', async () => {
  const s = new ProjectStore(memoryKV())
  const r = await s.migrateLegacy({ kind: 'reforger-mapper-island', version: 1 })
  assert.ok(r && r.name === 'Mon projet')
  assert.equal(await s.activeId(), r!.id)
  assert.equal(await s.migrateLegacy({ kind: 'reforger-mapper-island', version: 1 }), null)
  assert.equal((await s.list()).length, 1)
})
