import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { entryHash, emptyManifest, readManifest, writeManifest, needsBuild } from "../lib/manifest.mjs";
import { tmpDir } from "./helpers.mjs";

const base = { model: "m", voice: "Kore", style: "s", reading: "よみ" };

test("entryHash: 同じ入力は同じ、どれか変われば違う", () => {
  assert.equal(entryHash(base), entryHash({ ...base }));
  assert.match(entryHash(base), /^[0-9a-f]{64}$/);
  for (const key of Object.keys(base)) {
    assert.notEqual(entryHash(base), entryHash({ ...base, [key]: base[key] + "x" }));
  }
});

test("readManifest: 無ければ空、書けば読める", () => {
  const file = path.join(tmpDir(), "sample", "manifest.json");
  assert.deepEqual(readManifest(file, "sample"), emptyManifest("sample"));
  const m = emptyManifest("sample");
  m.entries.Q01 = { hash: "h", durationMs: 1200, voice: "Kore", model: "m", generatedAt: "2026-10-15T00:00:00.000Z" };
  writeManifest(file, m);
  assert.deepEqual(readManifest(file, "sample"), m);
  assert.ok(fs.readFileSync(file, "utf8").endsWith("\n"));
});

test("readManifest: 形式が違えば投げる", () => {
  const file = path.join(tmpDir(), "manifest.json");
  fs.writeFileSync(file, JSON.stringify({ version: 99 }));
  assert.throws(() => readManifest(file, "x"), /manifest/);
});

test("needsBuild: ハッシュ一致かつ WAV ありのときだけ飛ばす", () => {
  const m = emptyManifest("s");
  m.entries.Q01 = { hash: "h", durationMs: 1, voice: "v", model: "m", generatedAt: "t" };
  assert.equal(needsBuild(m, "Q01", "h", true), false);
  assert.equal(needsBuild(m, "Q01", "h", false), true);
  assert.equal(needsBuild(m, "Q01", "other", true), true);
  assert.equal(needsBuild(m, "Q02", "h", true), true);
});

test("writeManifest: entries を ID 順に並べて書く", () => {
  const file = path.join(tmpDir(), "manifest.json");
  const m = emptyManifest("s");
  const e = (ms) => ({ hash: "h", durationMs: ms, voice: "v", model: "m", generatedAt: "t" });
  m.entries.Q03 = e(3);
  m.entries.Q01 = e(1);
  m.entries.Q10 = e(10);
  m.entries.Q02 = e(2);
  writeManifest(file, m);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).entries), ["Q01", "Q02", "Q03", "Q10"]);
});
