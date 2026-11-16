// safeWrite: refuses while the Workbench runs (mocked), SHA check, path guard, backup / restore byte-identical.
// Works on a COPY in the OS temp folder, never on a real addon. Run: node --test tests/atelier/
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inside, listBackups, restore, safeWrite, sha1 } from "../../bridge/safewrite.mjs";

const SRC = "C:/Users/benbo/Documents/My Games/ArmaReforgerWorkbench/addons/Normandy_Edit/Worlds/TESTIsland_Layers/Rocks.layer";
function project() {
  const root = mkdtempSync(join(tmpdir(), "rm-atelier-"));
  mkdirSync(join(root, "Worlds/W_Layers"), { recursive: true });
  const f = join(root, "Worlds/W_Layers/Rocks.layer");
  if (existsSync(SRC)) cpSync(SRC, f); else writeFileSync(f, "GenericEntity : \"{0000000000000000}x.et\" {\n coords 1 2 3\n}\n");
  return { root, rel: "Worlds/W_Layers/Rocks.layer", orig: readFileSync(f) };
}
const closed = { wbRunning: async () => false }, open = { wbRunning: async () => true };

test("refuses while the Workbench is running and leaves the file untouched", async () => {
  const { root, rel, orig } = project();
  await assert.rejects(safeWrite(root, rel, Buffer.from("x"), sha1(orig), open), /WORKBENCH_RUNNING/);
  assert.deepEqual(readFileSync(join(root, rel)), orig);
  assert.ok(!existsSync(join(root, "_originaux")));
});

test("refuses when the SHA differs (file changed since read)", async () => {
  const { root, rel, orig } = project();
  await assert.rejects(safeWrite(root, rel, Buffer.from("x"), "0".repeat(40), closed), /SHA_MISMATCH/);
  assert.deepEqual(readFileSync(join(root, rel)), orig);
});

test("refuses paths outside the project and inside _originaux", async () => {
  const { root } = project();
  for (const p of ["../evil.txt", "a/../../evil.txt", "C:/Windows/evil.txt", "/etc/x", "_originaux/x/y.layer"])
    await assert.rejects(safeWrite(root, p, Buffer.from("x"), undefined, closed), /refused/);
  assert.throws(() => inside(root, ".."), /refused/);
});

test("backup + restore round trip is byte-identical, journal written", async () => {
  const { root, rel, orig } = project();
  const changed = Buffer.concat([orig, Buffer.from("\n// changed\n")]);
  const r = await safeWrite(root, rel, changed, sha1(orig), { ...closed, stamp: "2026-11-16_140200" });
  assert.equal(r.backup, "_originaux/2026-11-16_140200/" + rel);
  assert.deepEqual(readFileSync(join(root, rel)), changed);
  assert.deepEqual(readFileSync(join(root, r.backup)), orig);
  assert.equal(listBackups(root)[0].current, "written");
  await assert.rejects(restore(root, "2026-11-16_140200", rel, open), /WORKBENCH_RUNNING/);
  await restore(root, "2026-11-16_140200", rel, closed);
  assert.deepEqual(readFileSync(join(root, rel)), orig);
  assert.equal(sha1(readFileSync(join(root, rel))), sha1(orig));
  assert.equal(listBackups(root)[0].current, "original");
  const j = readFileSync(join(root, "_originaux/journal.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(j.map((e) => e.op), ["write", "restore"]);
});

test("restore refuses a file modified after our write unless forced", async () => {
  const { root, rel, orig } = project();
  await safeWrite(root, rel, Buffer.from("ours"), sha1(orig), { ...closed, stamp: "s1" });
  writeFileSync(join(root, rel), "someone else");
  assert.equal(listBackups(root)[0].current, "changed");
  await assert.rejects(restore(root, "s1", rel, closed), /CHANGED/);
  await restore(root, "s1", rel, { ...closed, force: true });
  assert.deepEqual(readFileSync(join(root, rel)), orig);
});

test("new files (no previous version) are written without backup", async () => {
  const { root } = project();
  const r = await safeWrite(root, "Configs/Map/x.conf", Buffer.from("a"), null, closed);
  assert.equal(r.backup, null);
  assert.equal(readFileSync(join(root, "Configs/Map/x.conf"), "utf-8"), "a");
});
