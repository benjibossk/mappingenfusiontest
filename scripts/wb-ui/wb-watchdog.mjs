// Workbench watchdog: detects a crashed or hung Mapgenerator Workbench and brings it back, alone.
//   node scripts/wb-ui/wb-watchdog.mjs            one check (+ recovery if needed), prints a JSON verdict
//   node scripts/wb-ui/wb-watchdog.mjs --loop 60  check every 60 s (for long unattended sends)
//   node scripts/wb-ui/wb-watchdog.mjs --check    diagnose only, never acts
// States: ok | crashed (Crash Reporter up / process gone) | hung (process up, NET API silent 3 checks in a row)
// | noworld (Workbench up, no world open).
// Recovery, Mapgenerator Workbench ONLY (its command line must contain Mapgenerator\addon.gproj; the Zimnitrita /
// ZimniOpti Workbenches are never touched): close the Crash Reporter WITHOUT sending (wb-close-crashreporter.ps1),
// kill the hung PID, relaunch with -gproj (cwd = game folder), wait for the NET API, open Worlds/MG_Test.ent.
// Never sends keys, never focuses a window. Each recovery is logged to profile/MapGen/watchdog.log.
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { Socket } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = join(process.env.USERPROFILE ?? 'C:/Users/benbo', 'Documents', 'My Games', 'ArmaReforgerWorkbench')
const GPROJ = join(DOCS, 'addons', 'Mapgenerator', 'addon.gproj')
const WB_EXE = process.env.WB_EXE ?? 'D:\\SteamLibrary\\steamapps\\common\\Arma Reforger Tools\\Workbench\\ArmaReforgerWorkbenchSteamDiag.exe'
const GAME_DIR = process.env.GAME_DIR ?? 'D:\\SteamLibrary\\steamapps\\common\\Arma Reforger'
const WORLD = process.env.WB_WORLD ?? 'Worlds/MG_Test.ent'
const LOG = join(DOCS, 'profile', 'MapGen', 'watchdog.log')
const args = process.argv.slice(2), CHECK_ONLY = args.includes('--check')
const loopAt = args.indexOf('--loop'), LOOP = loopAt >= 0 ? Number(args[loopAt + 1] ?? 60) : 0

const log = (msg) => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); try { appendFileSync(LOG, line + '\n') } catch {} }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim()

/** Workbench processes with their command line: [{ pid, mapgen }] */
function workbenches() {
  const out = ps("Get-CimInstance Win32_Process -Filter \"Name like 'ArmaReforgerWorkbench%'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }")
  return out.split(/\r?\n/).filter(Boolean).map((l) => { const [pid, ...c] = l.split('\t'); const cmd = c.join('\t'); return { pid: Number(pid), mapgen: /Mapgenerator[\\/]addon\.gproj/i.test(cmd), cmd } })
}
const crashReporterUp = () => ps("@(Get-Process CrashReporter -ErrorAction SilentlyContinue).Count") !== '0'

/** one NET API call (same framing as bridge/server.mjs) */
function netapi(apiFunc, params = {}, timeoutMs = 8000) {
  const p = (s) => { const b = Buffer.from(s, 'utf-8'), l = Buffer.alloc(4); l.writeInt32LE(b.length); return Buffer.concat([l, b]) }
  const v = Buffer.alloc(4); v.writeInt32LE(1)
  const req = Buffer.concat([v, p('reforger-mapper-watchdog'), p('JsonRPC'), p(JSON.stringify({ ...params, APIFunc: apiFunc }))])
  return new Promise((resolve, reject) => {
    const s = new Socket(), chunks = []
    const t = setTimeout(() => { s.destroy(); reject(new Error('timeout')) }, timeoutMs)
    s.on('error', (e) => { clearTimeout(t); reject(e) })
    s.on('data', (c) => chunks.push(c))
    s.on('close', () => {
      clearTimeout(t)
      const b = Buffer.concat(chunks)
      if (!b.length) return reject(new Error('empty'))
      const n = b.readInt32LE(0), st = b.toString('utf-8', 4, 4 + n)
      if (st !== 'Ok') return reject(new Error(st))
      const off = 4 + n, pl = off < b.length ? b.toString('utf-8', off + 4, off + 4 + b.readInt32LE(off)) : '{}'
      try { resolve(JSON.parse(pl || '{}')) } catch { resolve({ raw: pl }) }
    })
    s.connect(Number(process.env.WB_PORT ?? 5775), '127.0.0.1', () => s.end(req))
  })
}

let silent = 0
async function diagnose() {
  const wbs = workbenches(), mg = wbs.find((w) => w.mapgen)
  if (crashReporterUp() && !mg) return { state: 'crashed', why: 'Crash Reporter open, Mapgenerator Workbench gone', wbs }
  if (!mg) return { state: 'crashed', why: 'Mapgenerator Workbench not running', wbs }
  const st = await netapi('MG_Status').catch((e) => ({ error: e.message }))
  if (st.error) { silent++; return { state: silent >= 3 ? 'hung' : 'ok', why: `NET API silent (${st.error}) ${silent}/3`, pid: mg.pid } }
  silent = 0
  if (st.world !== 'open') return { state: 'noworld', why: 'no world open', pid: mg.pid }
  return { state: 'ok', pid: mg.pid, status: st }
}

/** newest log folder's crash.log first lines (what crashed), for the report */
function lastCrash() {
  const root = join(DOCS, 'logs')
  const dirs = readdirSync(root).map((d) => join(root, d)).filter((d) => existsSync(join(d, 'crash.log'))).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!dirs.length) return ''
  try { return execFileSync('powershell', ['-NoProfile', '-Command', `Get-Content -LiteralPath '${join(dirs[0], 'crash.log')}' | Select-String -Pattern 'Reason|Function|Scripts/' | Select-Object -First 4 | ForEach-Object { $_.Line.Trim() }`], { encoding: 'utf8' }).trim().replace(/\r?\n/g, ' | ') } catch { return '' }
}

async function openWorld() {
  for (let i = 0; i < 60; i++) {
    const st = await netapi('MG_Status').catch(() => null)
    if (st) {
      if (st.world === 'open') return true
      await netapi('EMCP_WB_Resources', { action: 'open', path: WORLD }, 60000).catch((e) => log(`open world: ${e.message}`))
    }
    await wait(5000)
  }
  return false
}

async function recover(d) {
  if (d.state === 'noworld') { log('no world open: opening ' + WORLD); return openWorld() }
  if (d.state === 'crashed') log(`crash detected: ${d.why}. ${lastCrash()}`)
  if (crashReporterUp()) log(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'wb-close-crashreporter.ps1')], { encoding: 'utf8' }).trim())
  if (d.state === 'hung') {
    const mg = workbenches().find((w) => w.mapgen && w.pid === d.pid)
    if (mg) { log(`hung: killing Mapgenerator Workbench PID ${mg.pid}`); ps(`Stop-Process -Id ${mg.pid} -Force`); await wait(5000) }
  }
  if (!workbenches().some((w) => w.mapgen)) {
    log('relaunching the Mapgenerator Workbench')
    spawn(WB_EXE, ['-gproj', GPROJ, '-wbModule', 'WorldEditor'], { cwd: GAME_DIR, detached: true, stdio: 'ignore' }).unref()
  }
  const ok = await openWorld()
  silent = 0
  log(ok ? 'recovered: world open' : 'recovery FAILED: world not open after 5 min')
  return ok
}

async function once() {
  const d = await diagnose()
  if (d.state === 'ok' || CHECK_ONLY) { console.log(JSON.stringify({ state: d.state, why: d.why ?? '', pid: d.pid ?? null })); return d }
  const ok = await recover(d)
  console.log(JSON.stringify({ state: d.state, recovered: ok }))
  return d
}

if (LOOP > 0) { for (;;) { await once().catch((e) => log('watchdog error ' + e.message)); await wait(LOOP * 1000) } }
else await once()
