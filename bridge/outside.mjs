// POST /outside { text }: off-map terrain ring (src/modules/outside.ts, docs/OUTSIDE_TERRAIN.md).
// Writes <profile>/MapGen/outside.txt (header "OTC 1 count", then per chunk "x z size res" + heights)
// and asks the Workbench to place the chunks (MG_ApplyOutside, needs the Outside Terrain Core mod).
// If the handler is not loaded the file is still written and the reply says so.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function checkOutsideText(text) {
  if (typeof text !== "string") return "text missing";
  const lines = text.split("\n");
  const m = /^OTC 1 (\d+)$/.exec(lines[0] ?? "");
  if (!m) return "bad header";
  const n = Number(m[1]);
  if (lines.length !== 1 + 2 * n) return `expected ${1 + 2 * n} lines, got ${lines.length}`;
  for (let i = 0; i < n; i++) {
    const [, , size, res] = lines[1 + 2 * i].split(" ").map(Number);
    if (!(size > 0 && res >= 2 && res <= 33)) return `chunk ${i}: bad size/res`;
    if (lines[2 + 2 * i].split(" ").length !== res * res) return `chunk ${i}: expected ${res * res} heights`;
  }
  return "";
}

export async function handleOutside(req, res, send, readBody, profileDir, callWorkbench) {
  if (!(req.method === "POST" && req.url === "/outside")) return false;
  const { text } = JSON.parse(await readBody(req));
  const err = checkOutsideText(text);
  if (err) { send(res, 400, { error: err }); return true; }
  mkdirSync(join(profileDir, "MapGen"), { recursive: true });
  const file = join(profileDir, "MapGen", "outside.txt");
  writeFileSync(file, text, "utf-8");
  let message = "written to profile/MapGen/outside.txt";
  try {
    const r = await callWorkbench("MG_ApplyOutside", { file: "$profile:MapGen/outside.txt" }, 300_000);
    message += " - Workbench: " + (r.message ?? r.status ?? JSON.stringify(r));
  } catch (e) {
    message += " - Workbench not reached (" + String(e?.message ?? e) + ")";
  }
  send(res, 200, { message, file });
  return true;
}
