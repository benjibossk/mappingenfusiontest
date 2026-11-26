// Mode Atelier routes: read an existing Workbench project from disk, write through safewrite.mjs only.
//   GET  /atelier/status                 {root, workbenchRunning}
//   POST /atelier/open    {path}         select the project folder (must contain addon.gproj or a world)
//   GET  /atelier/list?dir=&ext=         recursive file list [{path, size}] (relative to the project)
//   GET  /atelier/file?path=             raw bytes, header X-Sha1
//   GET  /atelier/pack?dir=&ext=&prefix= many files in one answer: [u32 nameLen][name][u32 size][bytes]...
//   POST /atelier/write   {path, sha, text | base64}   safeWrite (Workbench closed, SHA, _originaux backup)
//   GET  /atelier/backups                list of _originaux backups and their state
//   POST /atelier/restore {stamp, file, force?}
// Nothing is ever written outside the selected folder.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { BACKUP_DIR, inside, isWorkbenchRunning, listBackups, restore, safeWrite, sha1 } from "./safewrite.mjs";

let root = null;
const SKIP = new Set([BACKUP_DIR, ".git", "node_modules", "Navmesh"]);
const posix = (p) => p.split(sep).join("/");

function walk(dir, ext, max = 20000, depth = 8, out = []) {
  if (depth < 0 || out.length >= max) return out;
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, ext, max, depth - 1, out);
    else if (!ext || ext.some((e) => n.toLowerCase().endsWith(e))) out.push({ path: posix(relative(root, p)), size: st.size });
    if (out.length >= max) break;
  }
  return out;
}

// same rules as src/atelier/source.ts tilePrefixOf / terrainFor (kept in sync, tested there)
function tilePrefixOf(names, terrName) {
  const count = new Map();
  for (const f of names) {
    const m = /^(.*?)(\d+)\.ttile$/i.exec(f); if (!m) continue;
    const k = m[1].toLowerCase(), c = count.get(k); if (c) c.n++; else count.set(k, { prefix: m[1], n: 1 });
  }
  const want = count.get((terrName + "_").toLowerCase());
  if (want) return { prefix: want.prefix, tiles: want.n };
  let best = null;
  for (const c of count.values()) if (!best || c.n > best.n) best = c;
  return best ? { prefix: best.prefix, tiles: best.n } : { prefix: terrName + "_", tiles: 0 };
}
function terrainFor(terrains, ent) {
  const base = ent.slice(0, -4), name = (base.split("/").pop() ?? "").toLowerCase();
  const wdir = ent.includes("/") ? ent.slice(0, ent.lastIndexOf("/")) : "";
  const low = (s) => s.toLowerCase();
  return terrains.find((t) => low(t.name) === name)
    ?? terrains.find((t) => low(t.name).startsWith(name) || name.startsWith(low(t.name)))
    ?? terrains.find((t) => t.dir === wdir || t.dir.startsWith(base))
    ?? (terrains.length === 1 ? terrains[0] : undefined);
}

function describe() {
  const files = walk(root, [".ent", ".layer", ".terr", ".topo", ".emat", ".conf", ".gproj", ".et"], 60000);
  const by = (e) => files.filter((f) => f.path.toLowerCase().endsWith(e));
  const terrains = by(".terr").map((f) => {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    const name = basename(f.path, ".terr"), data = join(root, dir, ".Data");
    let names = [];
    try { names = readdirSync(data); } catch { /* none */ }
    const { prefix, tiles } = tilePrefixOf(names, name);
    return { terr: f.path, dir, name, dataDir: posix(join(dir, ".Data")), tilePrefix: prefix, tiles };
  });
  const worlds = by(".ent").map((f) => {
    const base = f.path.slice(0, -4), name = basename(base);
    const layersDir = existsSync(join(root, base + "_Layers")) ? base + "_Layers" : null;
    const layers = layersDir ? files.filter((g) => g.path.startsWith(layersDir + "/") && g.path.endsWith(".layer")) : [];
    const terrain = terrainFor(terrains, f.path) ?? null;
    return { ent: f.path, name, layersDir, layers: layers.length, layersSize: layers.reduce((s, l) => s + l.size, 0), terrain: terrain?.terr ?? null };
  });
  const gproj = by(".gproj")[0]?.path ?? null;
  let title = basename(root);
  if (gproj) { const m = /TITLE\s+"([^"]+)"/.exec(readFileSync(join(root, gproj), "utf-8")); if (m) title = m[1]; }
  return {
    root, title, gproj, worlds, terrains,
    topo: by(".topo").map((f) => f.path), emat: by(".emat").length,
    mapConfigs: by(".conf").filter((f) => /map/i.test(f.path)).map((f) => f.path).slice(0, 50),
    hasBackups: existsSync(join(root, BACKUP_DIR)),
  };
}

const need = () => { if (!root) throw new Error("NO_PROJECT: open a project folder first"); return root; };

export async function handleAtelier(req, res, send, readBody) {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/atelier/")) return false;
  const q = (k) => url.searchParams.get(k) ?? "";
  const route = req.method + " " + url.pathname;
  try {
    if (route === "GET /atelier/status") { send(res, 200, { root, workbenchRunning: await isWorkbenchRunning() }); return true; }
    if (route === "POST /atelier/open") {
      const { path } = JSON.parse(await readBody(req));
      const p = resolve(String(path ?? "").trim().replace(/^"|"$/g, ""));
      if (!p || !existsSync(p) || !statSync(p).isDirectory()) throw new Error(`NOT_FOUND: ${path}`);
      const prev = root; root = p;
      const d = describe();
      if (!d.gproj && !d.worlds.length && !d.terrains.length) { root = prev; throw new Error("NOT_A_PROJECT: no addon.gproj, .ent or .terr in this folder"); }
      send(res, 200, { ...d, workbenchRunning: await isWorkbenchRunning() });
      return true;
    }
    if (route === "GET /atelier/list") {
      const r = need(), dir = q("dir") ? inside(r, q("dir")) : r;
      const ext = q("ext") ? q("ext").split(",").map((e) => e.toLowerCase()) : null;
      send(res, 200, { files: walk(dir, ext) });
      return true;
    }
    if (route === "GET /atelier/file") {
      const buf = readFileSync(inside(need(), q("path")));
      res.writeHead(200, { "Content-Type": "application/octet-stream", "X-Sha1": sha1(buf), "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Sha1" });
      res.end(buf);
      return true;
    }
    if (route === "GET /atelier/pack") {
      const r = need(), dir = inside(r, q("dir")), ext = q("ext").toLowerCase(), prefix = q("prefix");
      const parts = [];
      for (const n of readdirSync(dir)) {
        if ((ext && !n.toLowerCase().endsWith(ext)) || (prefix && !n.toLowerCase().startsWith(prefix.toLowerCase()))) continue;
        const b = readFileSync(join(dir, n)), nm = Buffer.from(n, "utf-8"), h = Buffer.alloc(4), s = Buffer.alloc(4);
        h.writeUInt32LE(nm.length); s.writeUInt32LE(b.length);
        parts.push(h, nm, s, b);
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Access-Control-Allow-Origin": "*" });
      res.end(Buffer.concat(parts));
      return true;
    }
    if (route === "POST /atelier/write") {
      const b = JSON.parse(await readBody(req));
      const data = b.base64 !== undefined ? Buffer.from(b.base64, "base64") : Buffer.from(String(b.text ?? ""), "utf-8");
      send(res, 200, await safeWrite(need(), String(b.path), data, b.sha ?? undefined));
      return true;
    }
    if (route === "GET /atelier/backups") { send(res, 200, { backups: listBackups(need()) }); return true; }
    if (route === "POST /atelier/restore") {
      const b = JSON.parse(await readBody(req));
      send(res, 200, await restore(need(), String(b.stamp), String(b.file), { force: !!b.force }));
      return true;
    }
    send(res, 404, { error: "unknown atelier route" });
  } catch (e) {
    const code = /^(WORKBENCH_RUNNING|SHA_MISMATCH|CHANGED)/.test(e.message) ? 409 : /^(NOT_FOUND|NO_PROJECT|NOT_A_PROJECT|refused)/.test(e.message) ? 400 : 500;
    send(res, code, { error: e.message });
  }
  return true;
}
