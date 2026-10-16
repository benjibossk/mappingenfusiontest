// Local bridge between the reforger-mapper web app and the Arma Reforger Workbench.
//
//   POST /apply   body = mapgen.json project
//     1. writes it to <Workbench profile>/MapGen/mapgen.json
//     2. calls the MG_ApplyProject NET API handler (addon Mapgenerator) on the Workbench
//   GET  /status  is the Workbench reachable?
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    "Access-Control-Allow-Headers": "Content-Type",
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
      const state = await callWorkbench("EMCP_WB_GetState", {}, 5_000).catch((e) => ({ error: e.message }));
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
