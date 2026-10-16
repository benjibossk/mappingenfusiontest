// Local bridge between the reforger-mapper web app and the Arma Reforger Workbench.
//
//   POST /apply   body = mapgen.json project
//     1. writes it to <Workbench profile>/MapGen/mapgen.json
//     2. calls the MG_ApplyProject NET API handler (addon Mapgenerator) on the Workbench
//   GET  /status  is the Workbench reachable?
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
// Workbench side: NET API enabled in Options (port 5775), Mapgenerator addon loaded.
// No dependencies: node bridge/server.mjs

import { createServer } from "node:http";
import { Socket } from "node:net";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTerrain } from "./terrain-file.mjs";
import { maskSide, writeMasks, writeSatellite } from "./terrain-masks.mjs";

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
    if (req.method === "GET" && req.url === "/status") {
      const state = await callWorkbench("MG_Status", {}, 5_000).catch((e) => ({ error: e.message }));
      return send(res, 200, { bridge: "ok", projectFile: PROJECT_FILE, workbench: state });
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

    if (req.method === "POST" && req.url === "/apply") {
      const text = await readBody(req);
      const project = JSON.parse(text);
      if (!Array.isArray(project.shapes)) return send(res, 400, { error: "project.shapes missing" });

      mkdirSync(join(PROFILE_DIR, "MapGen"), { recursive: true });
      writeFileSync(PROJECT_FILE, JSON.stringify(project, null, 1), "utf-8");

      const result = await callWorkbench("MG_ApplyProject", { file: "$profile:MapGen/mapgen.json" });
      return send(res, result.status === "error" ? 500 : 200, result);
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
      const { addon, world, terrainSize, surfaces, colours, roads = [] } = JSON.parse(await readBody(req));
      if (!/^[\w .-]+$/.test(addon ?? "") || !/^[\w/ .-]+$/.test(world ?? "") || world.includes(".."))
        return send(res, 400, { error: "addon / world invalid" });
      if (!(terrainSize > 0) || !Array.isArray(surfaces)) return send(res, 400, { error: "terrainSize / surfaces missing" });
      const side = maskSide(join(ADDONS_DIR, addon, world, basename(world) + ".terr"));
      const dir = join(PROFILE_DIR, "MapGen", "masks", basename(world));
      const result = writeMasks(dir, side, terrainSize, surfaces, roads, colours);
      if (colours) result.satellite = writeSatellite(join(dir, "..", basename(world) + "_satellite.png"), 4096, terrainSize, surfaces, colours, undefined, roads);
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
