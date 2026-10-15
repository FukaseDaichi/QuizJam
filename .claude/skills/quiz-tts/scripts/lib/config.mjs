import fs from "node:fs";
import path from "node:path";

export class ConfigError extends Error {}

export const DEFAULT_CONFIG = Object.freeze({
  model: "gemini-3.8-flash-tts",
  voice: "Kore",
  candidates: ["Kore", "Zephyr", "Charon", "Sulafat"],
  style: "落ち着いたクイズ番組のアナウンサー。ゆっくり、はっきり読む",
  mondaiText: "問題！",
  sampleText:
    "1955年にタイムスリップした高校生マーティが、<short pause>若き日の両親を結びつけようと奮闘する、<short pause>マイケル・ジェイ・フォックス主演の映画は、何でしょう？",
  pauseMs: 600,
  outDir: "voice/out",
  setsDir: "voice/sets",
  questionSetsDir: "question-sets",
  concurrency: 2,
});

const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** 既定値とマージして検証する。不正なら ConfigError */
export function validateConfig(raw) {
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULT_CONFIG)) throw new ConfigError(`config.json に不明なキーがあります: ${key}`);
  }
  const c = { ...DEFAULT_CONFIG, ...raw };
  for (const key of ["model", "voice", "mondaiText", "sampleText", "outDir", "setsDir", "questionSetsDir"]) {
    if (!isNonEmptyString(c[key])) throw new ConfigError(`config.json の ${key} は空でない文字列にしてください`);
  }
  if (typeof c.style !== "string") throw new ConfigError("config.json の style は文字列にしてください");
  if (!Array.isArray(c.candidates) || c.candidates.length === 0 || !c.candidates.every(isNonEmptyString)) {
    throw new ConfigError("config.json の candidates は声名（空でない文字列）の配列にしてください");
  }
  if (!isInt(c.pauseMs, 0, 10000)) throw new ConfigError("config.json の pauseMs は 0〜10000 の整数にしてください");
  if (!isInt(c.concurrency, 1, 4)) throw new ConfigError("config.json の concurrency は 1〜4 の整数にしてください");
  return c;
}

/** rootDir/voice/config.json を読む。無ければ既定値 */
export function loadConfig(rootDir) {
  const file = path.join(rootDir, "voice", "config.json");
  if (!fs.existsSync(file)) return validateConfig({});
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`voice/config.json を読めません: ${err.message}`);
  }
  return validateConfig(raw);
}
