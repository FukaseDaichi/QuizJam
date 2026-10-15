import fs from "node:fs";
import path from "node:path";

export class EnvError extends Error {}

/** KEY=VALUE 形式の文字列を読む。# 行と空行は飛ばし、両端の引用符は外す */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** rootDir/.env を読む。無ければ {} */
export function loadEnv(rootDir) {
  const file = path.join(rootDir, ".env");
  if (!fs.existsSync(file)) return {};
  return parseDotenv(fs.readFileSync(file, "utf8"));
}

/** 環境変数 → .env の順で GEMINI_API_KEY を探す */
export function requireApiKey(rootDir) {
  const key = process.env.GEMINI_API_KEY || loadEnv(rootDir).GEMINI_API_KEY;
  if (!key) {
    throw new EnvError(
      "GEMINI_API_KEY が見つかりません。リポジトリ直下に .env を作り、GEMINI_API_KEY=<キー> と書いてください（.env.example 参照）",
    );
  }
  return key;
}
