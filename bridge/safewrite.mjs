// Safe writes into a Workbench project folder (Mode Atelier). The only module that writes project files.
// Same guarantees as giorbev's eau_layers.appliquer / restaurer (MIT, Copyright (c) giorbev):
//   1. refuse while the Workbench runs (it re-saves the layers when it closes and would undo the change)
//   2. refuse when the file's SHA-1 is not the one the browser read (changed since the analysis)
//   3. copy the original into <project>/_originaux/<timestamp>/<same path> first, check the copy, then
//      replace through a temporary file; every operation is logged in _originaux/journal.jsonl
//   4. never write outside the selected project folder, never inside _originaux except backups
//   Restore puts a backup back (same checks: Workbench closed, file still the one we wrote).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const BACKUP_DIR = "_originaux";

export const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

/** true when an ArmaReforgerWorkbench*.exe process is running (Windows tasklist) */
export function isWorkbenchRunning() {
  if (process.env.MAPGEN_FAKE_WB === "1") return Promise.resolve(true);
  if (process.env.MAPGEN_FAKE_WB === "0" || process.platform !== "win32") return Promise.resolve(false);
  return new Promise((res) => {
    execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 15000 }, (err, out) => {
      res(!err && /armareforgerworkbench/i.test(String(out)));
    });
  });
}

/** absolute path of `rel` inside `root`, or throws (no "..", no absolute path, no drive change) */
export function inside(root, rel) {
  if (typeof rel !== "string" || !rel || isAbsolute(rel) || /(^|[\/])\.\.([\/]|$)/.test(rel)) throw new Error(`refused path: ${rel}`);
  const abs = resolve(root, rel), r = relative(resolve(root), abs);
  if (!r || r.startsWith("..") || isAbsolute(r)) throw new Error(`refused path outside the project: ${rel}`);
  return abs;
}

const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const journal = (root, entry) => {
  mkdirSync(join(root, BACKUP_DIR), { recursive: true });
  appendFileSync(join(root, BACKUP_DIR, "journal.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
};
const replace = (abs, data) => {
  const tmp = abs + ".rm_tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, abs);
};

/**
 * Write `data` to root/rel. `expectSha` = SHA-1 of the file as read before the change (null = new file).
 * opts.wbRunning: injectable check (tests). Returns {ok, backup, sha}.
 */
export async function safeWrite(root, rel, data, expectSha, opts = {}) {
  const wb = opts.wbRunning ?? isWorkbenchRunning;
  if (rel.split(/[\/]/)[0] === BACKUP_DIR) throw new Error("refused: _originaux is reserved for backups");
  const abs = inside(root, rel);
  if (await wb()) throw new Error("WORKBENCH_RUNNING: close the Workbench first (it re-saves the layers when it closes)");
  const exists = existsSync(abs);
  if (exists) {
    const cur = sha1(readFileSync(abs));
    if (expectSha !== undefined && cur !== expectSha) throw new Error(`SHA_MISMATCH: ${rel} changed since it was read, analyse again`);
  } else if (expectSha) throw new Error(`SHA_MISMATCH: ${rel} no longer exists`);
  let backup = null;
  if (exists) {
    const st = opts.stamp ?? stamp();
    backup = join(BACKUP_DIR, st, rel).split(sep).join("/");
    const bak = join(root, BACKUP_DIR, st, rel);
    mkdirSync(dirname(bak), { recursive: true });
    if (!existsSync(bak)) copyFileSync(abs, bak);
    if (sha1(readFileSync(bak)) !== sha1(readFileSync(abs))) throw new Error(`backup of ${rel} is wrong: nothing replaced`);
  }
  mkdirSync(dirname(abs), { recursive: true });
  replace(abs, data);
  const sha = sha1(data);
  journal(root, { op: "write", file: rel, backup, before: expectSha ?? null, after: sha });
  return { ok: true, backup, sha };
}

/** backups available: [{stamp, file, size, current: "original" | "written" | "changed" | "missing"}] */
export function listBackups(root) {
  const base = join(root, BACKUP_DIR), out = [];
  if (!existsSync(base)) return out;
  const written = new Map();
  try {
    for (const l of readFileSync(join(base, "journal.jsonl"), "utf-8").split(/\r?\n/).filter(Boolean)) {
      const j = JSON.parse(l);
      if (j.op === "write" && j.backup) written.set(j.backup, j.after);
    }
  } catch { /* no journal yet */ }
  for (const st of readdirSync(base)) {
    const d = join(base, st);
    if (!statSync(d).isDirectory()) continue;
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        const rel = relative(d, p).split(sep).join("/"), abs = join(root, rel);
        const key = join(BACKUP_DIR, st, rel).split(sep).join("/");
        let current = "missing";
        if (existsSync(abs)) {
          const cur = sha1(readFileSync(abs));
          current = cur === sha1(readFileSync(p)) ? "original" : cur === written.get(key) ? "written" : "changed";
        }
        out.push({ stamp: st, file: rel, size: statSync(p).size, current });
      }
    };
    walk(d);
  }
  return out.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
}

/** put root/_originaux/<stamp>/<rel> back in place. force: also when the file changed since our write */
export async function restore(root, st, rel, opts = {}) {
  const wb = opts.wbRunning ?? isWorkbenchRunning;
  if (!/^[\w-]+$/.test(st)) throw new Error("bad backup name");
  const abs = inside(root, rel), bak = inside(root, join(BACKUP_DIR, st, rel));
  if (!existsSync(bak)) throw new Error(`no backup ${st}/${rel}`);
  if (await wb()) throw new Error("WORKBENCH_RUNNING: close the Workbench first");
  const item = listBackups(root).find((b) => b.stamp === st && b.file === rel);
  if (item?.current === "changed" && !opts.force) throw new Error(`CHANGED: ${rel} was modified after our write; restore with force or by hand (${bak})`);
  const data = readFileSync(bak);
  replace(abs, data);
  journal(root, { op: "restore", file: rel, backup: join(BACKUP_DIR, st, rel).split(sep).join("/"), after: sha1(data) });
  return { ok: true, sha: sha1(data) };
}
