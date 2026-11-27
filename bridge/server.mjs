// Local bridge between the reforger-mapper web app and the Arma Reforger Workbench.
//
//   POST /apply   body = mapgen.json project
//     1. writes it to <Workbench profile>/MapGen/mapgen.json
//     2. calls the MG_ApplyProject NET API handler (addon Mapgenerator) on the Workbench
//   GET  /status  is the Workbench reachable?
//   /atelier/*  Mode Atelier: read an existing project from disk, safe writes (bridge/atelier.mjs)
//   GET  /entities  objects and shapes already in the open world (MG_ExportEntities)
//   GET  /heights?step=8   terrain height grid of the open world (MG_ExportHeights)
//   POST /surfaces  body = {addon, world: "Worlds/X"}  preload the vanilla surfaces into Worlds/X/X.terr
//                   and initialise its surface map + normal map. The world must be CLOSED in the Workbench.
//   POST /heightmap body = {minX, minZ, step, cols, rows, heights[]} (row 0 = south)  writes
//                   <profile>/MapGen/heightmap.txt and calls MG_ApplyHeightmap on the OPEN world.
//   POST /masks     body = {addon, world, terrainSize, surfaces: [{name, minX, minZ, step, cols, rows, weights[]}]}
//                   writes one PNG per surface to <profile>/MapGen/masks/<world name>/, to import with
//                   Paint -> Import/export masks (no script API for the import). With "colours" ({name: [r,g,b]})
//                   also writes satellite.png next to them (Manage -> Satellite Map -> Import, sRGB).
//                   Optional roads: [{points, half, edge, core, side?}] painted at pixel precision.
//
// Workbench side: NET API enabled, Mapgenerator addon loaded, port 5775 by default; set MAPGEN_WB_PORT when this Workbench runs on its own port (scripts/wb-ui/wb-launch.ps1).
// No dependencies: node bridge/server.mjs

import { missingBaseEntities } from "./world-setup.mjs";
import { createServer } from "node:http";
import { execFile, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listTerrainMaterials, prepareTerrain } from "./terrain-file.mjs";
import { maskSide, middlesPath, png, resetTerrainMiddles, terrainMiddles, writeMasks, writeSatellite } from "./terrain-masks.mjs";
import { handleAtelier } from "./atelier.mjs";
import { handleOutside } from "./outside.mjs";

const PORT = Number(process.env.MAPGEN_BRIDGE_PORT ?? 5780);
const WB_HOST = process.env.MAPGEN_WB_HOST ?? "127.0.0.1";
const WB_PORT = Number(process.env.MAPGEN_WB_PORT ?? 5775);
const PROFILE_DIR =
  process.env.MAPGEN_WB_PROFILE ?? join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "profile");
const PROJECT_FILE = join(PROFILE_DIR, "MapGen", "mapgen.json");
const ADDONS_DIR = process.env.MAPGEN_WB_ADDONS ?? join(PROFILE_DIR, "..", "addons");
const VANILLA_SURFACES = join(dirname(fileURLToPath(import.meta.url)), "surfaces-vanilla.txt");
const MAX_BODY = 64 * 1024 * 1024;

// --- Workbench NET API wire format: int32 version, then length-prefixed strings ---

/** the open world's file on disk: Workbench names it "{GUID}Worlds/X.ent" or "$Addon:Worlds/X.ent" */
function worldFile(world, ext = ".ent") {
  const w = String(world ?? "").replace(/^\{[0-9A-F]+\}/i, "");
  const m = w.match(/^\$([^:]+):(.+)$/);
  const rel = (m ? m[2] : w).replace(/\.ent$/i, ext);
  if (!rel || rel.includes("..")) return null;
  const addons = m ? [m[1]] : readdirSync(ADDONS_DIR);
  // a terrain sits either beside the world or in a folder named after it (Worlds/X/X.terr)
  const alt = rel.replace(/([^/]+)(\.[a-z]+)$/i, "$1/$1$2");
  for (const a of addons) for (const r of [rel, alt]) { const f = join(ADDONS_DIR, a, r); if (existsSync(f)) return f; }
  return null;
}

function pascal(s) {
  const b = Buffer.from(s, "utf-8");
  const len = Buffer.alloc(4);
  len.writeInt32LE(b.length);
  return Buffer.concat([len, b]);
}

function readPascal(buf, offset) {
  const len = buf.readInt32LE(offset);
  return { value: buf.toString("utf-8", offset + 4, offset + 4 + len), next: offset + 4 + len };
}

// comments of the web app -> CommentEntity markers in the World Editor (MG_SetComments, MG_CommentsApi.c)
// body.comments = [{ x, z, n, text, resolved }]; line format "x z resolved n text"
function pushComments(list) {
  const lines = (Array.isArray(list) ? list : []).filter((c) => Number.isFinite(c?.x) && Number.isFinite(c?.z))
    .map((c) => `${c.x.toFixed(2)} ${c.z.toFixed(2)} ${c.resolved ? 1 : 0} ${Number(c.n) || 0} ${String(c.text ?? "").replace(/\s+/g, " ").trim() || "-"}`);
  mkdirSync(join(PROFILE_DIR, "MapGen"), { recursive: true });
  writeFileSync(join(PROFILE_DIR, "MapGen", "comments.txt"), lines.join("\n") + "\n", "utf-8");
  return callWorkbench("MG_SetComments", { file: "$profile:MapGen/comments.txt" }, 15_000);
}

// MG_SetupWorld request: every step on unless explicitly false; menu paths "Menu/Item" (empty = skipped)
function setupWorldParams(o, size) {
  const b = o && typeof o === "object" ? o : {};
  return { size: Number(size) || 0, managers: b.managers !== false, bounds: b.bounds !== false, save: b.save !== false,
    normalMenu: String(b.normalMenu ?? ""), bordersMenu: String(b.bordersMenu ?? "") };
}

function callWorkbench(apiFunc, params = {}, timeoutMs = 120_000) {
  const version = Buffer.alloc(4);
  version.writeInt32LE(1);
  const request = Buffer.concat([
    version,
    pascal("reforger-mapper"),
    pascal("JsonRPC"),
    pascal(JSON.stringify({ ...params, APIFunc: apiFunc })),
  ]);

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Workbench call ${apiFunc} timed out`));
    }, timeoutMs);

    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Workbench unreachable on ${WB_HOST}:${WB_PORT} (${err.code ?? err.message})`));
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("close", () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) return reject(new Error("empty response from Workbench"));
      const status = readPascal(buf, 0);
      if (status.value !== "Ok") return reject(new Error(`Workbench error: ${status.value}`));
      const payload = status.next < buf.length ? readPascal(buf, status.next).value : "{}";
      try {
        resolve(JSON.parse(payload || "{}"));
      } catch {
        resolve({ raw: payload });
      }
    });

    socket.connect(WB_PORT, WB_HOST, () => socket.end(request));
  });
}

// --- HTTP ---
function send(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    // the web app runs from the Vite dev server or a local file
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("project too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  try {
    if (await handleAtelier(req, res, send, readBody)) return; // Mode Atelier: bridge/atelier.mjs
    if (await handleOutside(req, res, send, readBody, PROFILE_DIR, callWorkbench)) return; // off-map ring: bridge/outside.mjs
    if (req.method === "POST" && req.url === "/ingamemap") {
      const { width, height, rgba } = JSON.parse(await readBody(req));
      const W = Number(width), H = Number(height), px = Buffer.from(String(rgba ?? ""), "base64");
      if (!(W > 0 && H > 0) || px.length !== W * H * 4) return send(res, 400, { error: "width/height/rgba mismatch" });
      const file = join(PROFILE_DIR, "MapGen", "ingamemap.png");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, png(W, (c, r) => px.subarray((r * W + c) * 4, (r * W + c) * 4 + 4), 4, H));
      return send(res, 200, { file, message: `ingamemap.png ${W}x${H}` });
    }
    if (req.method === "POST" && req.url === "/bench") {
      const opts = JSON.parse((await readBody(req)) || "{}");
      const newestLog = (dir) => {
        if (!dir || !existsSync(dir)) return null;
        const subs = readdirSync(dir).map((d) => join(dir, d, "console.log")).filter((f) => existsSync(f));
        subs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        return subs[0] ?? null;
      };
      const logs = [newestLog(join(PROFILE_DIR, "..", "logs"))];
      if (opts.gameLogs) logs.push(newestLog(String(opts.gameLogs)));
      const rows = [];
      for (const log of logs.filter(Boolean)) {
        for (const l of readFileSync(log, "utf-8").split(/\r?\n/)) {
          const i = l.indexOf("[MGBench]");
          if (i < 0) continue;
          const row = { source: log };
          for (const m of l.slice(i + 9).matchAll(/(\w+)=(\S+)/g)) row[m[1]] = isNaN(Number(m[2])) ? m[2] : Number(m[2]);
          rows.push(row);
        }
      }
      const dir = join(PROFILE_DIR, "MapGen", "bench");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
      writeFileSync(join(dir, `bench-${stamp}.json`), JSON.stringify(rows, null, 1), "utf-8");
      writeFileSync(join(dir, `bench-${stamp}.csv`), csv, "utf-8");
      return send(res, 200, { logs: logs.filter(Boolean), samples: rows.length, dir, stamp });
    }
    if (req.method === "GET" && req.url === "/camera") {
      // World Editor viewport camera (MG_CameraApi.c): x/y/z + yaw (0 = north, clockwise) + pitch, degrees
      try {
        const c = await callWorkbench("MG_GetCamera", {}, 2_000);
        if (!c?.ok) return send(res, 200, { ok: false, error: "no world open" });
        return send(res, 200, { ok: true, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch });
      } catch (e) {
        return send(res, 503, { ok: false, error: e.message });
      }
    }
    if (req.method === "GET" && req.url.startsWith("/camera/set")) {
      // moves the World Editor camera (MG_SetCamera): /camera/set?x=&y=&z=&yaw=&pitch= (degrees, yaw 0 = north, clockwise)
      const q = new URL(req.url, "http://x").searchParams;
      const body = {};
      // Enforce JSON parsing leaves a float field at 0 when the value is written as an integer ("3290"): nudge integers
      for (const k of ["x", "y", "z", "yaw", "pitch"]) { const n = Number(q.get(k) ?? 0); body[k] = Number.isInteger(n) ? n + 0.001 : n; }
      try {
        const c = await callWorkbench("MG_SetCamera", body, 3_000);
        return send(res, 200, { ok: !!c?.ok, ...body });
      } catch (e) {
        return send(res, 503, { ok: false, error: e.message });
      }
    }
    if (req.method === "GET" && req.url.startsWith("/materials")) {
      // declared = MATS chunk of the open world's .terr; painted coverage is not readable from the script API
      const wb = await callWorkbench("MG_ListMaterials", {});
      const q = new URL(req.url, "http://x").searchParams;
      let terr = null;
      if (q.get("addon") && q.get("world")) terr = join(ADDONS_DIR, q.get("addon"), q.get("world"), basename(q.get("world")) + ".terr");
      else if (wb?.world) terr = worldFile(wb.world, ".terr");
      if (!terr || terr.includes("..") || !existsSync(terr)) return send(res, 404, { error: "terrain .terr not found", workbench: wb });
      return send(res, 200, { terr, declared: listTerrainMaterials(terr), coverage: null, coverageNote: wb?.note ?? "painted coverage not exposed by the script API", workbench: wb });
    }
    if (req.method === "GET" && req.url === "/status") {
      const state = await callWorkbench("MG_Status", {}, 5_000).catch((e) => ({ error: e.message }));
      return send(res, 200, { bridge: "ok", projectFile: PROJECT_FILE, workbench: state });
    }

    // diagnostic after a send (Giorbev: "after each write to the Workbench"): scripts/mg-audit.mjs --live, as JSON
    if (req.method === "POST" && req.url === "/audit") {
      const out = join(tmpdir(), `mg-audit-${process.pid}.json`);
      rmSync(out, { force: true });
      const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "mg-audit.mjs");
      await new Promise((ok) => execFile(process.execPath, [script, "--live", "--json", out], { timeout: 180000 }, () => ok()));
      if (!existsSync(out)) return send(res, 500, { status: "error", message: "audit failed (Workbench closed?)" });
      const r = JSON.parse(readFileSync(out, "utf-8"));
      const counts = Object.fromEntries(Object.entries(r.findings).map(([k, l]) => [k, k === "terrain" && r.terrain ? r.terrain.bad : l.length]));
      // base entities of a playable world (Workbench's World Setup plugin list)
      let base = null;
      try {
        const wb = await callWorkbench("MG_ListMaterials", {}, 5_000);
        const f = worldFile(wb?.world);
        if (f) base = missingBaseEntities(f);
      } catch { /* Workbench busy: skip this check */ }
      if (base) { counts.base = base.length; r.findings.base = base; }
      return send(res, 200, { status: "ok", counts, terrain: r.terrain, findings: Object.fromEntries(Object.entries(r.findings).map(([k, l]) => [k, l.slice(0, 20)])) });
    }
    if (req.method === "GET" && req.url.startsWith("/heights")) {
      const step = Number(new URL(req.url, "http://x").searchParams.get("step") ?? 8);
      const result = await callWorkbench("MG_ExportHeights", { step });
      if (result.status !== "ok") return send(res, 500, result);

      const [header, ...lines] = readFileSync(join(PROFILE_DIR, "MapGen", "heights.txt"), "utf-8").trim().split(/\r?\n/);
      const [minX, minZ, cell, cols, rows, ocean] = header.split(" ").map(Number);
      const heights = lines.flatMap((l) => l.split(" ").map(Number));
      return send(res, 200, { minX, minZ, step: cell, cols, rows, ocean, heights });
    }

    if (req.method === "POST" && req.url === "/comments") {
      const body = JSON.parse(await readBody(req));
      try { return send(res, 200, await pushComments(body.comments)); }
      catch (e) { return send(res, 503, { status: "error", error: e.message }); }
    }
    if (req.method === "POST" && req.url === "/apply") {
      const text = await readBody(req);
      const project = JSON.parse(text);
      if (!Array.isArray(project.shapes)) return send(res, 400, { error: "project.shapes missing" });
      // Atelier zone send (src/atelier/zones/send.ts): entities and shapes only, the terrain is never touched
      if (project.noHeights) { delete project.setupWorld; console.log("[apply] zone send (noHeights): no world setup, no terrain write"); }
      const clear = Array.isArray(project.clear) ? project.clear.filter((x) => typeof x === "string" && /^MGZ\w*_$/.test(x)) : [];

      mkdirSync(join(PROFILE_DIR, "MapGen"), { recursive: true });
      // power grid topology (nodes / edges / feeders / consumers) next to mapgen.json, never sent to the Workbench reader
      if (project.powerTopology) { writeFileSync(join(PROFILE_DIR, "MapGen", "powergrid.topology.json"), JSON.stringify(project.powerTopology, null, 1)); delete project.powerTopology; }
      // the Workbench JSON reader gives up silently on big files (4.7 MB: 0 shapes read), so the project is
      // cut into parts of ~300 KB: mapgen.json (version, remove, first part), then mapgen.1.json, mapgen.2.json...
      // part size: body field partSize > env MG_PART_SIZE > 300 KB (lower it if the Workbench runs out of memory)
      const partSize = Math.max(10_000, Number(project.partSize) || Number(process.env.MG_PART_SIZE) || 300_000);
      const parts = [];
      let cur = { shapes: [], entities: [] }, size = 0;
      const add = (key, item) => {
        const n = JSON.stringify(item).length;
        if (size + n > partSize && (cur.shapes.length || cur.entities.length)) { parts.push(cur); cur = { shapes: [], entities: [] }; size = 0; }
        cur[key].push(item); size += n;
      };
      for (const s of project.shapes) add("shapes", s);
      // MG_ProjectEntity reads these as int (JsonApiStruct): a value with decimals is dropped, the object
      // then stands at 0 deg (1401 / 9114 objects of seed 21: vanilla port, sawmill, mine, town sites)
      const INT_FIELDS = ["yaw", "ycm", "pitch", "roll", "pitchcd", "rollcd", "scalepm"];
      for (const e of project.entities ?? []) {
        const o = { ...e };
        if (typeof o.yaw === "number" && !Number.isInteger(o.yaw)) o.yawcd = Math.round(o.yaw * 100); // exact vanilla angle (piers line up)
        for (const k of INT_FIELDS) if (typeof o[k] === "number") o[k] = Math.round(o[k]);
        add("entities", o);
      }
      parts.push(cur);
      // hand-made work to keep: profile/MapGen/locked.json = ["NAME", "PREFIX*", ...]. Honoured only once
      // MG_ApplyProjectPlugin.c reads the "locked" field (TODO addon side); unknown JSON fields are ignored until then.
      let locked = [];
      try { const l = JSON.parse(readFileSync(join(PROFILE_DIR, "MapGen", "locked.json"), "utf-8")); if (Array.isArray(l)) locked = l.filter((x) => typeof x === "string" && x); } catch {}
      if (locked.length) console.log(`[apply] ${locked.length} locked name(s)/prefix(es) passed to the Workbench`);
      for (const f of readdirSync(join(PROFILE_DIR, "MapGen"))) if (/^mapgen\.\d+\.json$/.test(f)) rmSync(join(PROFILE_DIR, "MapGen", f));
      parts.forEach((p, k) => {
        const body = k === 0 ? { version: project.version, shapes: p.shapes, entities: p.entities, remove: project.remove ?? [], ffBiome: project.ffBiome ?? 0, ...(locked.length ? { locked } : {}), ...(clear.length ? { clear } : {}) } : { version: project.version, shapes: p.shapes, entities: p.entities, remove: [] };
        writeFileSync(k === 0 ? PROJECT_FILE : join(PROFILE_DIR, "MapGen", `mapgen.${k}.json`), JSON.stringify(body), "utf-8");
      });
      console.log(`[apply] ${project.shapes.length} shapes, ${(project.entities ?? []).length} objects in ${parts.length} file(s)`);

      const sent = sentReport(project);
      writeFileSync(join(PROFILE_DIR, "MapGen", "sent.txt"), sent.lines.join("\n"), "utf-8");
      rmSync(join(PROFILE_DIR, "MapGen", "built.txt"), { force: true });
      const result = await callWorkbench("MG_ApplyProject", { file: "$profile:MapGen/mapgen.json" }, 600_000); // big worlds take minutes
      if (Array.isArray(project.comments)) await pushComments(project.comments).catch((e) => console.log("[apply] comments: " + e.message));
      // opt-in post-Apply world setup (MG_SetupWorldApi.c): managers, world-bounds rocks, save
      if (project.setupWorld && result.status !== "error") {
        const w = await callWorkbench("MG_SetupWorld", setupWorldParams(project.setupWorld, project.terrainSize ?? project.size), 300_000).catch((e) => ({ status: "error", message: e.message }));
        console.log("[apply] setup world: " + w.message);
        if (typeof result.message === "string") result.message += "\nsetup world: " + w.message;
      }
      const diff = compareBuilt(project, sent.warnings);
      writeFileSync(join(PROFILE_DIR, "MapGen", "report.txt"), diff.lines.join("\n"), "utf-8");
      console.log("[apply] " + diff.summary);
      if (result && typeof result.message === "string") result.message += "\n" + diff.summary;
      return send(res, result.status === "error" ? 500 : 200, result);
    }

    // post-Apply world setup on its own: body = {size, managers?, bounds?, save?, normalMenu?, bordersMenu?}
    if (req.method === "POST" && req.url === "/setup-world") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const r = await callWorkbench("MG_SetupWorld", setupWorldParams(b, b.size), 300_000);
      return send(res, r.status === "error" ? 500 : 200, r);
    }

    // the open world as a whole (heights + ground materials), to load a map already in progress
    if (req.method === "GET" && req.url.startsWith("/world")) {
      const step = Number(new URL(req.url, "http://x").searchParams.get("step") ?? 8);
      const h = await callWorkbench("MG_ExportHeights", { step }, 600_000);
      if (h.status !== "ok") return send(res, 500, h);
      // ground materials: MG_ExportSurfaces (terrain trace) crashed the Workbench on its first trace, off for now
      const [hHead, ...hLines] = readFileSync(join(PROFILE_DIR, "MapGen", "heights.txt"), "utf-8").trim().split(/\r?\n/);
      const [minX, minZ, cell, cols, rows, ocean] = hHead.split(" ").map(Number);
            return send(res, 200, {
        minX, minZ, step: cell, cols, rows, ocean,
        heights: hLines.flatMap((l) => l.split(" ").map(Number)),
        materials: [],
        surfaces: [],
      });
    }

    // what already stands in the open world (MG_ExportEntities): prefab objects + shapes with their generators
    if (req.method === "GET" && req.url === "/entities") {
      const r = await callWorkbench("MG_ExportEntities", {}, 600_000);
      if (r.status !== "ok") return send(res, 500, r);
      const objects = [], shapes = [];
      for (const l of readFileSync(join(PROFILE_DIR, "MapGen", "entities.txt"), "utf-8").split(/\r?\n/)) {
        const f = l.trim().split(" ");
        if (f[0] === "E" && f.length >= 9) {
          const [x, z, yaw, x0, z0, x1, z1] = f.slice(-7).map(Number);
          objects.push({ prefab: f.slice(1, -7).join(" "), x, z, yaw, box: [x0, z0, x1, z1] });
        } else if (f[0] === "S" && f.length >= 9) {
          const pts = f.slice(5).map(Number), points = [];
          for (let i = 0; i + 1 < pts.length; i += 2) points.push([pts[i], pts[i + 1]]);
          shapes.push({ generators: f[1] === "-" ? [] : f[1].split("|"), closed: f[2] === "1", origin: [Number(f[3]), Number(f[4])], points });
        }
      }
      // a generator (road, river, wall, forest prefab) is listed as an object sitting on a point of its shape:
      // hand it to that shape, it is not an obstacle box
      const free = [];
      for (const ob of objects) {
        const sh = /WEGenerators/.test(ob.prefab) && shapes.find((q) => q.points.some(([x, z]) => Math.hypot(x - ob.x, z - ob.z) < 0.5));
        if (sh) sh.generators.push(ob.prefab);
        else free.push(ob);
      }
      return send(res, 200, { objects: free, shapes });
    }

    // parcels captured by the "MapGen - Capture templates" plugin
    if (req.method === "GET" && req.url === "/templates") {
      const dir = join(PROFILE_DIR, "MapGen", "templates");
      let files = [];
      try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch {}
      const out = [];
      for (const f of files) {
        try { out.push(JSON.parse(readFileSync(join(dir, f), "utf-8"))); } catch {}
      }
      return send(res, 200, out);
    }

    // parcels saved by the "Enregistrer la sélection comme parcelle" plugin (MG_SaveParcelPlugin.c)
    if (req.method === "GET" && req.url === "/parcels") {
      const dir = join(PROFILE_DIR, "MapGen", "parcels");
      let files = [];
      try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch {}
      const out = [];
      for (const f of files) {
        try { out.push(JSON.parse(readFileSync(join(dir, f), "utf-8"))); } catch {}
      }
      return send(res, 200, out);
    }

    if (req.method === "POST" && req.url === "/surfaces") {
      const { addon, world } = JSON.parse(await readBody(req));
      // names only, no "..": the bridge must not write outside the addons folder
      if (!/^[\w .-]+$/.test(addon ?? "") || !/^[\w/ .-]+$/.test(world ?? "") || world.includes(".."))
        return send(res, 400, { error: "addon / world invalid" });
      const terr = join(ADDONS_DIR, addon, world, basename(world) + ".terr");
      const surfaces = readFileSync(VANILLA_SURFACES, "utf-8").split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
      return send(res, 200, { terr, ...prepareTerrain(terr, surfaces) });
    }

    if (req.method === "POST" && req.url === "/masks") {
      const { addon, world, terrainSize, surfaces, colours, roads = [], fileNames, readme, satSource, relief, seed } = JSON.parse(await readBody(req));
      if (!/^[\w .-]+$/.test(addon ?? "") || !/^[\w/ .-]+$/.test(world ?? "") || world.includes(".."))
        return send(res, 400, { error: "addon / world invalid" });
      if (!(terrainSize > 0) || !Array.isArray(surfaces)) return send(res, 400, { error: "terrainSize / surfaces missing" });
      const side = maskSide(join(ADDONS_DIR, addon, world, basename(world) + ".terr"));
      const dir = join(PROFILE_DIR, "MapGen", "masks", basename(world));
      const result = writeMasks(dir, side, terrainSize, surfaces, roads, colours, { fileNames, readme });
      let source = satSource === "clean" ? "clean" : "vanilla";
      if (source === "vanilla" && !vanillaTexturesReady()) { source = "clean"; result.satNote = "textures vanilla non générées: lance npm run satmap:textures"; }
      if (colours) result.satellite = writeSatellite(join(dir, "..", basename(world) + "_satellite.png"), 4096, terrainSize, surfaces, colours, undefined, roads,
        { source, relief: source === "clean" ? relief : undefined, seed });
      return send(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/heightmap") {
      const g = JSON.parse(await readBody(req));
      if (!(g.cols >= 2 && g.rows >= 2 && g.step > 0 && g.heights?.length === g.cols * g.rows))
        return send(res, 400, { error: "grid invalid (cols, rows, step, heights)" });
      const lines = [`${g.minX ?? 0} ${g.minZ ?? 0} ${g.step} ${g.cols} ${g.rows}`];
      for (let r = 0; r < g.rows; r++)
        lines.push(g.heights.slice(r * g.cols, (r + 1) * g.cols).map((h) => h.toFixed(2)).join(" "));
      mkdirSync(join(PROFILE_DIR, "MapGen"), { recursive: true });
      writeFileSync(join(PROFILE_DIR, "MapGen", "heightmap.txt"), lines.join(String.fromCharCode(10)), "utf-8");
      // finer local patches (harbour quay step at 2 m): header + one line per row each; empty file = none
      const pl = [];
      for (const q of Array.isArray(g.patches) ? g.patches : [])
        if (q.cols >= 2 && q.rows >= 2 && q.step > 0 && q.heights?.length === q.cols * q.rows)
          {
          pl.push(`${q.minX} ${q.minZ} ${q.step} ${q.cols} ${q.rows}`);
          for (let r = 0; r < q.rows; r++) pl.push(q.heights.slice(r * q.cols, (r + 1) * q.cols).map((h) => (+h).toFixed(2)).join(" "));
        }
      writeFileSync(join(PROFILE_DIR, "MapGen", "heightpatch.txt"), pl.join(String.fromCharCode(10)), "utf-8");
      const result = await callWorkbench("MG_ApplyHeightmap", { file: "$profile:MapGen/heightmap.txt" }, 600_000);
      return send(res, result.status === "error" ? 500 : 200, result);
    }

    // Copernicus DEM GLO-30 tile for the "Real place" window (the public bucket may refuse the browser: CORS).
    // Only this host and this tile name pattern are fetched; tiles are kept in <profile>/MapGen/dem/.
    if (req.method === "GET" && req.url.startsWith("/dem?")) {
      const id = new URL(req.url, "http://x").searchParams.get("tile") ?? "";
      if (!/^Copernicus_DSM_COG_10_[NS][0-9]{2}_00_[EW][0-9]{3}_00_DEM$/.test(id)) return send(res, 400, { error: "bad tile name" });
      const dir = join(PROFILE_DIR, "MapGen", "dem");
      const file = join(dir, id + ".tif");
      let buf;
      try { buf = readFileSync(file); } catch {
        const r = await fetch(`https://copernicus-dem-30m.s3.amazonaws.com/${id}/${id}.tif`);
        if (!r.ok) return send(res, r.status === 404 ? 404 : 502, { error: r.status === 404 ? "no tile here (sea or outside the coverage)" : "download failed " + r.status });
        buf = Buffer.from(await r.arrayBuffer());
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, buf);
      }
      res.writeHead(200, { "Content-Type": "image/tiff", "Content-Length": buf.length, "Access-Control-Allow-Origin": "*" });
      return res.end(buf);
    }

    // ESA WorldCover 2021 tile (3°×3° cloud-optimised GeoTIFF, about 100 MB): only the byte ranges the
    // browser asks for are forwarded (the bucket sends no CORS headers). Fixed host and tile name pattern.
    if (req.method === "GET" && req.url.startsWith("/landcover?")) {
      const id = new URL(req.url, "http://x").searchParams.get("tile") ?? "";
      if (!/^[NS][0-9]{2}[EW][0-9]{3}$/.test(id)) return send(res, 400, { error: "bad tile name" });
      const range = req.headers.range ?? "";
      if (range && !/^bytes=[0-9]+-[0-9]*$/.test(range)) return send(res, 400, { error: "bad range" });
      const r = await fetch(`https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${id}_Map.tif`, range ? { headers: { Range: range } } : {});
      if (!r.ok) return send(res, r.status === 404 || r.status === 403 ? 404 : 502, { error: r.status === 404 || r.status === 403 ? "no WorldCover tile here (open sea)" : "download failed " + r.status });
      const buf = Buffer.from(await r.arrayBuffer());
      const head = { "Content-Type": "image/tiff", "Content-Length": buf.length, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges" };
      if (r.status === 206) head["Content-Range"] = r.headers.get("content-range");
      res.writeHead(r.status, head);
      return res.end(buf);
    }

    send(res, 404, { error: "unknown route" });
  } catch (e) {
    send(res, 502, { error: e.message });
  }
});

// localhost only: the bridge can write files and drive the Workbench
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] http://127.0.0.1:${PORT}  ->  Workbench ${WB_HOST}:${WB_PORT}`);
  console.log(`[bridge] project file: ${PROJECT_FILE}`);
});

// --- what was sent vs what Workbench built (profile/MapGen/sent.txt, built.txt, report.txt) ---
// geometry that the road generators handle badly: points on top of each other, hairpins, very long legs
function shapeWarnings(sh) {
  const p = sh.points ?? [], n = p.length / 2, out = [];
  if (n < 2) out.push("fewer than 2 points");
  for (let k = 0; k < p.length; k++) if (!Number.isFinite(p[k])) { out.push("NaN / infinite coordinate"); break; }
  let dup = 0, sharp = 0, long = 0;
  for (let k = 1; k < n; k++) {
    const dx = p[k * 2] - p[k * 2 - 2], dz = p[k * 2 + 1] - p[k * 2 - 1], d = Math.hypot(dx, dz);
    if (d < 0.5) dup++;
    if (d > 400) long++;
    if (k + 1 < n && d >= 0.5) {
      const ex = p[k * 2 + 2] - p[k * 2], ez = p[k * 2 + 3] - p[k * 2 + 1], e = Math.hypot(ex, ez);
      if (e >= 0.5 && (dx * ex + dz * ez) / (d * e) < -0.5) sharp++; // turn sharper than 120 degrees
    }
  }
  if (dup) out.push(dup + " point(s) closer than 0.5 m to the previous one");
  if (sharp && sh.kind === "spline") out.push(sharp + " hairpin turn(s) > 120 deg (spline loops)");
  if (long) out.push(long + " leg(s) longer than 400 m");
  return out;
}
function sentReport(project) {
  const lines = [], warnings = new Map();
  for (const sh of project.shapes) {
    const w = shapeWarnings(sh);
    if (w.length) warnings.set(sh.id, w);
    lines.push(`S ${sh.id} ${sh.kind} ${(sh.points ?? []).length / 2} ${sh.generator ?? ""}${w.length ? "  ! " + w.join("; ") : ""}`);
  }
  for (const e of project.entities ?? []) lines.push(`E ${e.id} ${e.prefab} ${e.x} ${e.z}`);
  return { lines, warnings };
}
function compareBuilt(project, warnings) {
  let built = [];
  try { built = readFileSync(join(PROFILE_DIR, "MapGen", "built.txt"), "utf-8").split(/\r?\n/).filter(Boolean); }
  catch { return { lines: ["no built.txt: reload the Workbench scripts (Mapgenerator plugin too old)"], summary: "No build report from Workbench (reload its scripts)." }; }
  const got = new Map();
  for (const l of built) { const [t, id, state, a, b, c] = l.split(" "); got.set(t + " " + id, { state, a, b, c }); }
  const lines = [], count = { missing: 0, failed: 0, points: 0, nogen: 0, warned: 0, entFail: 0 };
  for (const sh of project.shapes) {
    const g = got.get("S " + sh.id), sentPts = (sh.points ?? []).length / 2, w = warnings.get(sh.id);
    if (w) { count.warned++; lines.push(`WARN   ${sh.id}: ${w.join("; ")}`); }
    if (!g) { count.missing++; lines.push(`MISSING ${sh.id} (${sh.kind}, ${sentPts} pts)`); continue; }
    if (g.state !== "ok") { count.failed++; lines.push(`FAILED ${sh.id} (${sh.kind}, ${sentPts} pts, ${sh.generator})`); continue; }
    if (Number(g.b) !== sentPts) { count.points++; lines.push(`POINTS ${sh.id}: sent ${sentPts}, built ${g.b}`); }
    if (sh.generator && Number(g.c) < 1) { count.nogen++; lines.push(`NO GENERATOR ${sh.id}: ${sh.generator}`); }
  }
  for (const e of project.entities ?? []) {
    const g = got.get("E " + e.id);
    if (!g || g.state !== "ok") { count.entFail++; lines.push(`OBJECT NOT PLACED ${e.id}: ${e.prefab} at ${e.x} ${e.z}`); }
  }
  const nShapes = project.shapes.length, nEnt = (project.entities ?? []).length;
  const okShapes = nShapes - count.missing - count.failed, okEnt = nEnt - count.entFail;
  const summary = `Report: ${okShapes}/${nShapes} shapes and ${okEnt}/${nEnt} objects built` +
    (count.failed + count.missing ? `, ${count.failed + count.missing} shape(s) failed` : "") +
    (count.nogen ? `, ${count.nogen} without generator` : "") +
    (count.points ? `, ${count.points} with lost points` : "") +
    (count.warned ? `, ${count.warned} with suspect geometry` : "") +
    (count.entFail ? `, ${count.entFail} object(s) not placed` : "") +
    (lines.length ? " - details in profile/MapGen/report.txt" : "");
  return { lines: [summary, "", ...lines], summary };
}

// vanilla satmap textures (BI-derived, never in the repo): generated once from the user's own game install
// (scripts/harvest-terrain-middles.ts, ENFUSION_GAME_PATH or its default path); false = fall back to clean
let triedHarvest = false;
function vanillaTexturesReady() {
  if (terrainMiddles().size) return true;
  if (triedHarvest) return false;
  triedHarvest = true;
  try {
    const game = findGameDir();
    if (!game) return false;
    spawnSync(`npx tsx scripts/harvest-terrain-middles.ts "${game}"`, { cwd: join(dirname(fileURLToPath(import.meta.url)), ".."), shell: true, stdio: "ignore", timeout: 300000 });
  } catch { /* no game install: clean mode */ }
  resetTerrainMiddles();
  return existsSync(middlesPath()) && terrainMiddles().size > 0;
}
//! installed Arma Reforger (game, not Tools): ENFUSION_GAME_PATH, then every Steam library (libraryfolders.vdf)
function findGameDir() {
  const libs = [process.env.ENFUSION_GAME_PATH ? dirname(dirname(dirname(process.env.ENFUSION_GAME_PATH))) : null];
  for (const steam of ["C:/Program Files (x86)/Steam", "C:/Program Files/Steam", "D:/Steam", "D:/SteamLibrary"]) {
    libs.push(steam);
    try { for (const m of readFileSync(join(steam, "steamapps", "libraryfolders.vdf"), "utf-8").matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\/g, "/")); } catch { /* no Steam here */ }
  }
  const cands = [process.env.ENFUSION_GAME_PATH, ...libs.filter(Boolean).map((l) => join(l, "steamapps", "common", "Arma Reforger"))];
  return cands.find((d) => d && existsSync(join(d, "addons", "data"))) ?? null;
}
