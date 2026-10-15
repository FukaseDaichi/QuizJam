import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 生成結果を決める入力のハッシュ。どれかが変われば再生成する */
export function entryHash({ model, voice, style, reading }) {
  return crypto.createHash("sha256").update(JSON.stringify([model, voice, style, reading])).digest("hex");
}

export function emptyManifest(set) {
  return { version: 1, set, entries: {} };
}

export function readManifest(file, set) {
  if (!fs.existsSync(file)) return emptyManifest(set);
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (m?.version !== 1 || typeof m.entries !== "object" || m.entries === null) {
    throw new Error(`manifest の形式が不明です: ${file}`);
  }
  return m;
}

export function writeManifest(file, manifest) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
}

/** manifest のハッシュが一致し WAV もあるなら飛ばせる */
export function needsBuild(manifest, id, hash, wavExists) {
  const entry = manifest.entries[id];
  return !wavExists || !entry || entry.hash !== hash;
}
