# quiz-tts スキル 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 台本ファイルに書いた早押し問題の問読み音声を Gemini 3.8 Flash TTS で生成し、「問題！」と結合した mp3 まで作る Claude Code スキル `quiz-tts` を作る。

**Architecture:** `.claude/skills/quiz-tts/scripts/tts.mjs` が CLI の入口で、処理は `scripts/lib/` の小さなモジュール（.env 読み込み、設定、台本パーサ、Gemini API クライアント、WAV ヘッダ解析、manifest 差分判定、ffmpeg 結合、コマンド本体）に分ける。API と ffmpeg はコマンド本体に注入して、テストではモックに差し替える。`SKILL.md` は台本の書き方ルールとワークフローを持ち、Claude が台本を起こしてからスクリプトを回す。

**Tech Stack:** Node 22（依存パッケージなし。`fetch`、`node:test`、`node:util` の `parseArgs`）、ffmpeg（結合と mp3 化のみ）、Gemini API `POST /v1beta/interactions`、モデル `gemini-3.8-flash-tts`。

**Spec:** `docs/superpowers/specs/2026-10-15-quiz-tts-skill-design.md`

## Global Constraints

- Node 22、依存パッケージを追加しない（`package.json` の `dependencies` / `devDependencies` を増やさない）
- モデル ID は `gemini-3.8-flash-tts`、エンドポイントは `https://generativelanguage.googleapis.com/v1beta/interactions`、ヘッダ `x-goog-api-key`
- 声はプリセット声名を `voice/config.json` の `voice` で固定する。Voice design は使わない
- API キーはリポジトリ直下の `.env` の `GEMINI_API_KEY`。`.env` はコミットしない
- git 管理: 台本・`manifest.json`・`Qnn.full.mp3`・`voice/out/mondai.wav` はコミット、`voice/out/*/Q*.wav` と `voice/out/voices/` は `.gitignore`
- 台本の ID は `Q` + 2 桁以上の数字。重複はエラー
- ハッシュ = SHA-256(JSON.stringify([model, voice, 有効 style, 読み]))
- 再試行: 429 / 5xx を 2 秒・4 秒・8 秒待って 3 回まで。同時実行は `concurrency`（既定 2）
- 生成 WAV が 1 秒未満または 60 秒超は警告
- リポジトリの vitest / tsc の対象（`test/**/*.test.ts`、`src/`）に `.claude/skills/` を混ぜない
- コミットメッセージは `feat(tts): ...` / `docs: ...` の形で英語。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- 作業ブランチは `claude/quiz-tts`（main から切る）

## Review Focus

- **Windows で保存した台本（CRLF・BOM 付き）**: 行番号もキーの判定も壊れないこと → Task 5 のテスト「CRLF と BOM」
- **読みに `<long pause>` や `<laugh>` などの余計なタグ、『』「」が残っている**: エラーではなく警告として一覧に出ること → Task 5 のテスト「lintReading」
- **API が 200 を返したが中身が WAV でない（空の data、HTML など）**: その問だけ失敗扱いになり、manifest に書かれず、他の問は続行すること → Task 8 のテスト「WAV でない応答」
- **`--only Q99` のように台本に無い ID**: 何も生成せずにエラーで止まること → Task 8 のテスト「--only の ID が無い」
- **429 が続く**: 3 回再試行してから失敗し、他の問は続行し、終了コード 1 になること → Task 4 のテスト「429 の再試行」と Task 8 のテスト「一部失敗」

---

## ファイル構成

```
.claude/skills/quiz-tts/
  SKILL.md                     スキル本体（いつ使うか・ワークフロー・台本ルール・コマンド）
  scripts/
    tts.mjs                    CLI 入口。引数解析とコマンド振り分け、終了コード
    lib/
      env.mjs                  .env の読み込みと GEMINI_API_KEY の取得
      config.mjs               voice/config.json の読み込み・既定値・検証
      script.mjs               台本 Markdown のパーサと読みの lint
      manifest.mjs             ハッシュ計算・manifest.json の読み書き・差分判定
      wav.mjs                  WAV ヘッダ解析（長さ ms）
      gemini.mjs               Gemini interactions API の呼び出し（再試行つき）
      pool.mjs                 同時実行数つきの並列処理
      join.mjs                 ffmpeg による結合（問題！＋無音＋問題文 → mp3）
      commands.mjs             voices / mondai / build / join の本体（API・ffmpeg は注入）
    test/
      helpers.mjs              テスト用の WAV 生成と一時ディレクトリ
      env.test.mjs
      config.test.mjs
      wav.test.mjs
      gemini.test.mjs
      script.test.mjs
      manifest.test.mjs
      pool.test.mjs
      join.test.mjs
      commands.test.mjs
      fixtures/sample-set.md   台本のフィクスチャ
voice/
  config.json
  sets/sample.md               作例 5 問（手動確認用）
  out/mondai.wav               Task 7 で生成してコミット
  out/sample/manifest.json, Qnn.full.mp3   Task 8・9 で生成してコミット
.env.example
.gitignore                     追記
package.json                   scripts に tts / test:tts を追加
docs/overview.md               リポジトリ構成とスコープ外の記述を更新
README.md                      問読み音声の節を追加
```

テストの実行は常にリポジトリ直下で:

```bash
npm run test:tts
```

---

### Task 1: 足場（.env.example、.gitignore、npm scripts、env.mjs）

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json`（`scripts`）
- Create: `.claude/skills/quiz-tts/scripts/lib/env.mjs`
- Create: `.claude/skills/quiz-tts/scripts/test/helpers.mjs`
- Test: `.claude/skills/quiz-tts/scripts/test/env.test.mjs`

**Interfaces:**
- Produces: `parseDotenv(text): Record<string,string>`、`loadEnv(rootDir): Record<string,string>`、`requireApiKey(rootDir): string`（無ければ `EnvError` を投げる）、`class EnvError extends Error`
- Produces（helpers）: `tmpDir(): string`（一時ディレクトリを作って返す）、`makeWav({ seconds, sampleRate = 24000, channels = 1, bitsPerSample = 16 }): Buffer`（無音の WAV）

- [ ] **Step 1: ブランチを切り、.env.example と .gitignore と package.json を直す**

```bash
git checkout -b claude/quiz-tts
printf 'GEMINI_API_KEY=\n' > .env.example
```

`.gitignore` の末尾に追記:

```
.env
voice/out/*/Q*.wav
voice/out/voices/
```

`package.json` の `scripts` に 2 行追加（`"db:migrate:remote"` の次）:

```json
    "tts": "node .claude/skills/quiz-tts/scripts/tts.mjs",
    "test:tts": "node --test \".claude/skills/quiz-tts/scripts/test/*.test.mjs\""
```

- [ ] **Step 2: テストヘルパーを書く**

`.claude/skills/quiz-tts/scripts/test/helpers.mjs`:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 空の一時ディレクトリを作って返す */
export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "quiz-tts-"));
}

/** 無音の PCM WAV を作る（RIFF ヘッダ 44 バイト + データ） */
export function makeWav({ seconds, sampleRate = 24000, channels = 1, bitsPerSample = 16 }) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const dataSize = Math.round(byteRate * seconds);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}
```

- [ ] **Step 3: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/env.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDotenv, loadEnv, requireApiKey, EnvError } from "../lib/env.mjs";
import { tmpDir } from "./helpers.mjs";

test("parseDotenv: コメント・空行・引用符を扱う", () => {
  const env = parseDotenv('# comment\n\nGEMINI_API_KEY="abc"\nOTHER=\'x y\'\nBARE=plain\n');
  assert.deepEqual(env, { GEMINI_API_KEY: "abc", OTHER: "x y", BARE: "plain" });
});

test("loadEnv: .env が無ければ空", () => {
  assert.deepEqual(loadEnv(tmpDir()), {});
});

test("requireApiKey: .env から読む", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=k123\n");
  delete process.env.GEMINI_API_KEY;
  assert.equal(requireApiKey(dir), "k123");
});

test("requireApiKey: 環境変数を優先する", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=file\n");
  process.env.GEMINI_API_KEY = "envvar";
  try {
    assert.equal(requireApiKey(dir), "envvar");
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test("requireApiKey: 無ければ EnvError で .env の作り方を案内する", () => {
  delete process.env.GEMINI_API_KEY;
  assert.throws(() => requireApiKey(tmpDir()), (err) => err instanceof EnvError && /\.env/.test(err.message));
});
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/env.mjs` が見つからない）

- [ ] **Step 5: env.mjs を書く**

`.claude/skills/quiz-tts/scripts/lib/env.mjs`:

```js
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
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS（5 件）

- [ ] **Step 7: コミット**

```bash
git add .env.example .gitignore package.json .claude/skills/quiz-tts/scripts/lib/env.mjs .claude/skills/quiz-tts/scripts/test/helpers.mjs .claude/skills/quiz-tts/scripts/test/env.test.mjs
git commit -m "feat(tts): scaffold the quiz-tts skill with .env loading and test runner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 設定（config.mjs と voice/config.json）

**Files:**
- Create: `.claude/skills/quiz-tts/scripts/lib/config.mjs`
- Create: `voice/config.json`
- Test: `.claude/skills/quiz-tts/scripts/test/config.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_CONFIG`、`validateConfig(raw): Config`、`loadConfig(rootDir): Config`、`class ConfigError extends Error`
- `Config = { model, voice, candidates: string[], style, mondaiText, sampleText, pauseMs, outDir, setsDir, concurrency }`

- [ ] **Step 1: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/config.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG, validateConfig, loadConfig, ConfigError } from "../lib/config.mjs";
import { tmpDir } from "./helpers.mjs";

test("validateConfig: 空なら既定値", () => {
  assert.deepEqual(validateConfig({}), DEFAULT_CONFIG);
});

test("validateConfig: 指定した値で上書きする", () => {
  const c = validateConfig({ voice: "Zephyr", pauseMs: 300, concurrency: 1 });
  assert.equal(c.voice, "Zephyr");
  assert.equal(c.pauseMs, 300);
  assert.equal(c.concurrency, 1);
  assert.equal(c.model, DEFAULT_CONFIG.model);
});

test("validateConfig: 不正な値は ConfigError", () => {
  assert.throws(() => validateConfig({ voice: "" }), ConfigError);
  assert.throws(() => validateConfig({ pauseMs: -1 }), ConfigError);
  assert.throws(() => validateConfig({ pauseMs: 1.5 }), ConfigError);
  assert.throws(() => validateConfig({ concurrency: 0 }), ConfigError);
  assert.throws(() => validateConfig({ concurrency: 5 }), ConfigError);
  assert.throws(() => validateConfig({ candidates: ["Kore", ""] }), ConfigError);
  assert.throws(() => validateConfig({ unknownKey: 1 }), ConfigError);
});

test("loadConfig: voice/config.json が無ければ既定値", () => {
  assert.deepEqual(loadConfig(tmpDir()), DEFAULT_CONFIG);
});

test("loadConfig: voice/config.json を読む", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "voice"));
  fs.writeFileSync(path.join(dir, "voice", "config.json"), JSON.stringify({ voice: "Charon" }));
  assert.equal(loadConfig(dir).voice, "Charon");
});

test("loadConfig: 壊れた JSON は ConfigError", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "voice"));
  fs.writeFileSync(path.join(dir, "voice", "config.json"), "{ not json");
  assert.throws(() => loadConfig(dir), ConfigError);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/config.mjs` が見つからない）

- [ ] **Step 3: config.mjs を書く**

`.claude/skills/quiz-tts/scripts/lib/config.mjs`:

```js
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
  for (const key of ["model", "voice", "mondaiText", "sampleText", "outDir", "setsDir"]) {
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS

- [ ] **Step 5: voice/config.json を置く**

`voice/config.json`（既定値と同じ内容を明示的に書く。声を決めたらここを直す）:

```json
{
  "model": "gemini-3.8-flash-tts",
  "voice": "Kore",
  "candidates": ["Kore", "Zephyr", "Charon", "Sulafat"],
  "style": "落ち着いたクイズ番組のアナウンサー。ゆっくり、はっきり読む",
  "mondaiText": "問題！",
  "pauseMs": 600,
  "outDir": "voice/out",
  "setsDir": "voice/sets",
  "concurrency": 2
}
```

Run: `node -e "import('./.claude/skills/quiz-tts/scripts/lib/config.mjs').then(m => console.log(m.loadConfig(process.cwd()).voice))"`
Expected: `Kore`

- [ ] **Step 6: コミット**

```bash
git add .claude/skills/quiz-tts/scripts/lib/config.mjs .claude/skills/quiz-tts/scripts/test/config.test.mjs voice/config.json
git commit -m "feat(tts): load and validate voice/config.json

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: WAV ヘッダ解析（wav.mjs）

**Files:**
- Create: `.claude/skills/quiz-tts/scripts/lib/wav.mjs`
- Test: `.claude/skills/quiz-tts/scripts/test/wav.test.mjs`

**Interfaces:**
- Produces: `wavInfo(buf: Buffer): { channels, sampleRate, byteRate, bitsPerSample, dataSize, durationMs }`。WAV でなければ `Error` を投げる

- [ ] **Step 1: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/wav.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { wavInfo } from "../lib/wav.mjs";
import { makeWav } from "./helpers.mjs";

test("wavInfo: 24kHz モノラル 16bit の長さを ms で返す", () => {
  const info = wavInfo(makeWav({ seconds: 2.5 }));
  assert.equal(info.sampleRate, 24000);
  assert.equal(info.channels, 1);
  assert.equal(info.bitsPerSample, 16);
  assert.equal(info.durationMs, 2500);
});

test("wavInfo: data サイズがファイルより大きくても実サイズで計算する", () => {
  const wav = makeWav({ seconds: 1 });
  wav.writeUInt32LE(0xffffffff, 40);
  assert.equal(wavInfo(wav).durationMs, 1000);
});

test("wavInfo: WAV でなければ投げる", () => {
  assert.throws(() => wavInfo(Buffer.from("<html>error</html>")), /WAV/);
  assert.throws(() => wavInfo(Buffer.alloc(0)), /WAV/);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/wav.mjs` が見つからない）

- [ ] **Step 3: wav.mjs を書く**

`.claude/skills/quiz-tts/scripts/lib/wav.mjs`:

```js
/** RIFF/WAVE のヘッダを読んで長さを求める。チャンクは順に走査する */
export function wavInfo(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("WAV ではありません");
  }
  let pos = 12;
  let fmt = null;
  let dataSize = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt " && pos + 24 <= buf.length) {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        byteRate: buf.readUInt32LE(pos + 16),
        bitsPerSample: buf.readUInt16LE(pos + 22),
      };
    }
    if (id === "data") {
      dataSize = Math.min(size, buf.length - pos - 8);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || dataSize === null || fmt.byteRate === 0) throw new Error("WAV の fmt/data チャンクが見つかりません");
  return { ...fmt, dataSize, durationMs: Math.round((dataSize / fmt.byteRate) * 1000) };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add .claude/skills/quiz-tts/scripts/lib/wav.mjs .claude/skills/quiz-tts/scripts/test/wav.test.mjs
git commit -m "feat(tts): parse WAV headers to measure duration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Gemini API クライアント（gemini.mjs）と実 API での確認

**Files:**
- Create: `.claude/skills/quiz-tts/scripts/lib/gemini.mjs`
- Test: `.claude/skills/quiz-tts/scripts/test/gemini.test.mjs`

**Interfaces:**
- Produces: `buildRequest({ model, voice, style, text }): object`、`extractAudio(json): Buffer`、`synthesize({ model, voice, style, text }, { apiKey, fetchImpl?, sleep?, maxRetries?, endpoint? }): Promise<Buffer>`、`class GeminiError extends Error { status?, body? }`
- `synthesize` が返す Buffer は WAV のはず（検証は呼び出し側が `wavInfo` で行う）

- [ ] **Step 1: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/gemini.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, extractAudio, synthesize, GeminiError } from "../lib/gemini.mjs";

const okJson = (wavBase64) =>
  JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "audio", data: wavBase64 }] }] });

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

test("buildRequest: interactions の形で組み立てる", () => {
  const body = buildRequest({ model: "gemini-3.8-flash-tts", voice: "Kore", style: "ゆっくり", text: "問題！" });
  assert.deepEqual(body, {
    model: "gemini-3.8-flash-tts",
    input: [{ type: "user_input", content: [{ type: "text", text: "問題！", annotations: [{ type: "speech_metadata", style: "ゆっくり" }] }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: "Kore" }] },
  });
});

test("buildRequest: style が空なら annotations を付けない", () => {
  const body = buildRequest({ model: "m", voice: "Kore", style: "", text: "t" });
  assert.equal("annotations" in body.input[0].content[0], false);
});

test("extractAudio: model_output の最後の audio を base64 デコードする", () => {
  const json = { steps: [
    { type: "thought", content: [] },
    { type: "model_output", content: [{ type: "audio", data: Buffer.from("first").toString("base64") }, { type: "audio", data: Buffer.from("last").toString("base64") }] },
  ] };
  assert.equal(extractAudio(json).toString(), "last");
});

test("extractAudio: audio が無ければ GeminiError", () => {
  assert.throws(() => extractAudio({ steps: [{ type: "model_output", content: [{ type: "text", text: "x" }] }] }), GeminiError);
  assert.throws(() => extractAudio({}), GeminiError);
});

test("synthesize: ヘッダと本文を送り、音声を返す", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: okJson(Buffer.from("RIFF").toString("base64")) }]);
  const out = await synthesize({ model: "m", voice: "Kore", style: "s", text: "t" }, { apiKey: "KEY", fetchImpl: impl });
  assert.equal(out.toString(), "RIFF");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["x-goog-api-key"], "KEY");
  assert.equal(JSON.parse(calls[0].init.body).model, "m");
});

test("synthesize: 429 の再試行は 2s/4s/8s で 3 回、その後 GeminiError", async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, body: "slow down" }, { status: 429, body: "slow down" },
    { status: 429, body: "slow down" }, { status: 429, body: "slow down" },
  ]);
  const waits = [];
  await assert.rejects(
    synthesize({ model: "m", voice: "v", style: "", text: "t" }, { apiKey: "k", fetchImpl: impl, sleep: async (ms) => waits.push(ms) }),
    (err) => err instanceof GeminiError && err.status === 429,
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [2000, 4000, 8000]);
});

test("synthesize: 5xx は再試行して成功すれば返す", async () => {
  const { impl } = fakeFetch([{ status: 503, body: "busy" }, { status: 200, body: okJson(Buffer.from("ok").toString("base64")) }]);
  const out = await synthesize({ model: "m", voice: "v", style: "", text: "t" }, { apiKey: "k", fetchImpl: impl, sleep: async () => {} });
  assert.equal(out.toString(), "ok");
});

test("synthesize: 400 は再試行せず GeminiError", async () => {
  const { impl, calls } = fakeFetch([{ status: 400, body: '{"error":"bad voice"}' }]);
  await assert.rejects(
    synthesize({ model: "m", voice: "v", style: "", text: "t" }, { apiKey: "k", fetchImpl: impl, sleep: async () => {} }),
    (err) => err instanceof GeminiError && err.status === 400 && /bad voice/.test(err.message),
  );
  assert.equal(calls.length, 1);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/gemini.mjs` が見つからない）

- [ ] **Step 3: gemini.mjs を書く**

`.claude/skills/quiz-tts/scripts/lib/gemini.mjs`:

```js
export class GeminiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** 単一話者 TTS のリクエスト本文。text は逐語で読まれる。style は短い定型文 */
export function buildRequest({ model, voice, style, text }) {
  const content = { type: "text", text };
  if (style) content.annotations = [{ type: "speech_metadata", style }];
  return {
    model,
    input: [{ type: "user_input", content: [content] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }] },
  };
}

/** steps[].type === "model_output" の最後の audio content の data（base64）を Buffer にする */
export function extractAudio(json) {
  const steps = Array.isArray(json?.steps) ? json.steps : [];
  for (const step of [...steps].reverse()) {
    if (step?.type !== "model_output") continue;
    const audios = (step.content ?? []).filter((c) => c?.type === "audio" && typeof c.data === "string");
    if (audios.length > 0) return Buffer.from(audios[audios.length - 1].data, "base64");
  }
  throw new GeminiError(`応答に audio がありません: ${JSON.stringify(json).slice(0, 500)}`);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 / 5xx は 2s・4s・8s 待って maxRetries 回まで再試行。それ以外の失敗は即 GeminiError */
export async function synthesize(
  params,
  { apiKey, fetchImpl = globalThis.fetch, sleep = defaultSleep, maxRetries = 3, endpoint = ENDPOINT },
) {
  const body = JSON.stringify(buildRequest(params));
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body,
    });
    if (res.ok) return extractAudio(await res.json());
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      throw new GeminiError(`Gemini API エラー ${res.status}: ${text.slice(0, 500)}`, { status: res.status, body: text });
    }
    await sleep(2000 * 2 ** attempt);
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS

- [ ] **Step 5: 実 API で 1 回だけ確認する（リクエスト／応答の形の裏取り）**

`.env` が無ければここで止まり、ユーザーに `GEMINI_API_KEY` を `.env` に入れてもらう（キーの値はチャットに書かない）。

Run（リポジトリ直下で）:

```bash
node -e "
import('./.claude/skills/quiz-tts/scripts/lib/env.mjs').then(async ({ requireApiKey }) => {
  const { synthesize } = await import('./.claude/skills/quiz-tts/scripts/lib/gemini.mjs');
  const { wavInfo } = await import('./.claude/skills/quiz-tts/scripts/lib/wav.mjs');
  const fs = await import('node:fs');
  const wav = await synthesize({ model: 'gemini-3.8-flash-tts', voice: 'Kore', style: '落ち着いたクイズ番組のアナウンサー。ゆっくり、はっきり読む', text: '問題！' }, { apiKey: requireApiKey(process.cwd()) });
  fs.mkdirSync('voice/out', { recursive: true });
  fs.writeFileSync('voice/out/spike.wav', wav);
  console.log(wavInfo(wav));
}).catch((e) => { console.error(e); process.exit(1); });
"
```

Expected: `{ channels: 1, sampleRate: 24000, ..., durationMs: <500〜3000 程度> }` が出て `voice/out/spike.wav` ができる。

- 400 で「unknown field」などが返ったら、エラー本文を読んで `buildRequest` のキー名を直し、Step 1 のテストの期待値も同じ形に直す（公式ドキュメント https://ai.google.dev/gemini-api/docs/speech-generation の REST 例が正）
- `応答に audio がありません` なら、エラーに含まれる応答 JSON の先頭 500 文字を見て `extractAudio` の探索を直す
- `WAV ではありません` なら `response_format` に `mime_type: "audio/wav"` を足して再実行する
- 確認が済んだら `voice/out/spike.wav` を削除する（`rm voice/out/spike.wav`）

- [ ] **Step 6: コミット**

```bash
git add .claude/skills/quiz-tts/scripts/lib/gemini.mjs .claude/skills/quiz-tts/scripts/test/gemini.test.mjs
git commit -m "feat(tts): call the Gemini interactions API for single-speaker TTS with retries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 台本パーサと読みの lint（script.mjs）

**Files:**
- Create: `.claude/skills/quiz-tts/scripts/lib/script.mjs`
- Create: `.claude/skills/quiz-tts/scripts/test/fixtures/sample-set.md`
- Test: `.claude/skills/quiz-tts/scripts/test/script.test.mjs`

**Interfaces:**
- Produces: `parseScript(markdown): { title: string, questions: Question[], warnings: string[] }`、`lintReading(id, reading): string[]`、`class ScriptError extends Error { line: number }`
- `Question = { id, line, answer, prompt, reading, style }`（`reading` は空にならない。無ければ `prompt` を入れて警告）

- [ ] **Step 1: フィクスチャを書く**

`.claude/skills/quiz-tts/scripts/test/fixtures/sample-set.md`:

```markdown
# テスト用セット

## Q01
- 答え: 『バック・トゥ・ザ・フューチャー』
- 問題文: 1955年にタイムスリップした高校生マーティが、若き日の両親を結びつけようと奮闘する、マイケル・J・フォックス主演の映画は何でしょう？
- 読み: 1955年にタイムスリップした高校生マーティが、<short pause>若き日の両親を結びつけようと奮闘する、<short pause>マイケル・ジェイ・フォックス主演の映画は、何でしょう？

## Q02
- 答え: バズ・ライトイヤー
- 問題文: 映画『トイ・ストーリー』で、カウボーイ人形はウッディですが、スペース・レンジャーのおもちゃは誰でしょう？
- 読み: 映画トイ・ストーリーで、カウボーイ人形は<short pause>ウッディですが、<short pause>スペース・レンジャーのおもちゃは、誰でしょう？
- style: 少し速めに

## Q03
- 答え: レオナルド・ディカプリオ
- 問題文: ずばり、映画『タイタニック』で主人公ジャックを演じた俳優は誰でしょう？
```

- [ ] **Step 2: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/script.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScript, lintReading, ScriptError } from "../lib/script.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "sample-set.md"), "utf8");

test("parseScript: タイトルと問題を読む", () => {
  const { title, questions } = parseScript(fixture);
  assert.equal(title, "テスト用セット");
  assert.deepEqual(questions.map((q) => q.id), ["Q01", "Q02", "Q03"]);
  assert.equal(questions[0].answer, "『バック・トゥ・ザ・フューチャー』");
  assert.match(questions[0].reading, /^1955年にタイムスリップ/);
  assert.equal(questions[0].style, "");
  assert.equal(questions[1].style, "少し速めに");
  assert.equal(questions[0].line, 3);
});

test("parseScript: 読みが無ければ問題文を使い警告する", () => {
  const { questions, warnings } = parseScript(fixture);
  assert.equal(questions[2].reading, questions[2].prompt);
  assert.ok(warnings.some((w) => w.startsWith("Q03:") && /問題文をそのまま/.test(w)));
});

test("parseScript: CRLF と BOM", () => {
  const crlf = "﻿" + fixture.replace(/\n/g, "\r\n");
  const { questions } = parseScript(crlf);
  assert.equal(questions.length, 3);
  assert.equal(questions[0].line, 3);
  assert.equal(questions[0].answer, "『バック・トゥ・ザ・フューチャー』");
});

test("parseScript: 全角コロンも受け付ける", () => {
  const { questions } = parseScript("## Q01\n- 答え：A\n- 読み：よみ\n");
  assert.equal(questions[0].answer, "A");
  assert.equal(questions[0].reading, "よみ");
});

test("parseScript: ID が不正なら行番号つきで ScriptError", () => {
  assert.throws(() => parseScript("## Q1\n- 読み: x\n"), (e) => e instanceof ScriptError && e.line === 1 && /Q1/.test(e.message));
  assert.throws(() => parseScript("## 問題1\n- 読み: x\n"), ScriptError);
});

test("parseScript: ID 重複は ScriptError", () => {
  assert.throws(() => parseScript("## Q01\n- 読み: a\n\n## Q01\n- 読み: b\n"), (e) => e instanceof ScriptError && e.line === 4 && /重複/.test(e.message));
});

test("parseScript: 読みも問題文も無い問は ScriptError", () => {
  assert.throws(() => parseScript("## Q01\n- 答え: a\n"), (e) => e instanceof ScriptError && /Q01/.test(e.message));
});

test("parseScript: 不明なキー・形式外の行・見出し前の項目は ScriptError", () => {
  assert.throws(() => parseScript("## Q01\n- よみ: x\n"), (e) => e instanceof ScriptError && e.line === 2 && /不明なキー/.test(e.message));
  assert.throws(() => parseScript("## Q01\n読み: x\n"), (e) => e instanceof ScriptError && e.line === 2);
  assert.throws(() => parseScript("- 読み: x\n## Q01\n- 読み: y\n"), (e) => e instanceof ScriptError && e.line === 1);
});

test("parseScript: 問題が 1 つも無ければ ScriptError", () => {
  assert.throws(() => parseScript("# タイトルだけ\n"), ScriptError);
});

test("lintReading: 括弧・余計なタグ・ポーズの数を警告する", () => {
  assert.deepEqual(lintReading("Q01", "映画は、何でしょう？<short pause>"), []);
  const w1 = lintReading("Q02", "映画『タイタニック』で「ジャック」を演じた俳優は？");
  assert.ok(w1.some((w) => /『』/.test(w)) && w1.some((w) => /「」/.test(w)));
  assert.ok(lintReading("Q03", "a<long pause>b").some((w) => /long pause/.test(w)));
  assert.ok(lintReading("Q04", "a<laugh>b").some((w) => /<laugh>/.test(w)));
  assert.ok(lintReading("Q05", "a<short pause>b<short pause>c<short pause>d<short pause>e").some((w) => /4 個/.test(w)));
});

test("parseScript: lint の警告も warnings に入る", () => {
  const { warnings } = parseScript("## Q01\n- 読み: 『x』\n");
  assert.ok(warnings.some((w) => w.startsWith("Q01:") && /『』/.test(w)));
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/script.mjs` が見つからない）

- [ ] **Step 4: script.mjs を書く**

`.claude/skills/quiz-tts/scripts/lib/script.mjs`:

```js
export class ScriptError extends Error {
  constructor(message, line) {
    super(`${line}行目: ${message}`);
    this.line = line;
  }
}

const ID_RE = /^Q\d{2,}$/;
const KEYS = { 答え: "answer", 問題文: "prompt", 読み: "reading", style: "style" };
const ITEM_RE = /^- ([^:：]+)[:：]\s*(.*)$/;
const ALLOWED_TAGS = new Set(["short pause"]);
const MAX_PAUSES = 3;

/** 読みの問題点を警告文の配列で返す（エラーにはしない） */
export function lintReading(id, reading) {
  const warnings = [];
  if (/[『』]/.test(reading)) warnings.push(`${id}: 読みに『』が残っています（括弧は読みから外す）`);
  if (/[「」]/.test(reading)) warnings.push(`${id}: 読みに「」が残っています（括弧は読みから外し、前後に <short pause>）`);
  const tags = [...reading.matchAll(/<([^<>]+)>/g)].map((m) => m[1]);
  for (const tag of tags) {
    if (tag === "long pause") warnings.push(`${id}: <long pause> は使わない（確定ポイントのヒントになる）`);
    else if (!ALLOWED_TAGS.has(tag)) warnings.push(`${id}: <${tag}> は使わない（タグは <short pause> だけ）`);
  }
  const pauses = tags.filter((t) => t === "short pause").length;
  if (pauses > MAX_PAUSES) warnings.push(`${id}: <short pause> が ${pauses} 個あります（1〜${MAX_PAUSES} 個が目安）`);
  return warnings;
}

/** 台本 Markdown を読む。1 問 1 ブロック（## Qnn と「- キー: 値」の行） */
export function parseScript(markdown) {
  const lines = markdown.replace(/^﻿/, "").split(/\r?\n/);
  let title = "";
  const questions = [];
  const warnings = [];
  const seen = new Set();
  let current = null;

  const finish = () => {
    if (!current) return;
    if (!current.reading) {
      if (!current.prompt) throw new ScriptError(`${current.id}: 読みも問題文もありません`, current.line);
      current.reading = current.prompt;
      warnings.push(`${current.id}: 読みが無いので問題文をそのまま読みます`);
    }
    warnings.push(...lintReading(current.id, current.reading));
    questions.push(current);
    current = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const no = i + 1;
    if (!line) return;
    if (line.startsWith("## ")) {
      finish();
      const id = line.slice(3).trim();
      if (!ID_RE.test(id)) throw new ScriptError(`見出しの ID が不正です: ${id}（Q01 のように Q + 2 桁以上の数字）`, no);
      if (seen.has(id)) throw new ScriptError(`ID が重複しています: ${id}`, no);
      seen.add(id);
      current = { id, line: no, answer: "", prompt: "", reading: "", style: "" };
      return;
    }
    if (line.startsWith("# ")) {
      if (!current && questions.length === 0) title = line.slice(2).trim();
      return;
    }
    const m = ITEM_RE.exec(line);
    if (!m) throw new ScriptError(`「- キー: 値」の形ではありません: ${line}`, no);
    if (!current) throw new ScriptError("「## Q01」の見出しより前に項目があります", no);
    const key = KEYS[m[1].trim()];
    if (!key) throw new ScriptError(`不明なキーです: ${m[1].trim()}（答え・問題文・読み・style のいずれか）`, no);
    current[key] = m[2].trim();
  });
  finish();
  if (questions.length === 0) throw new ScriptError("問題がありません（## Q01 の見出しが必要です）", 1);
  return { title, questions, warnings };
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add .claude/skills/quiz-tts/scripts/lib/script.mjs .claude/skills/quiz-tts/scripts/test/script.test.mjs .claude/skills/quiz-tts/scripts/test/fixtures/sample-set.md
git commit -m "feat(tts): parse the reading script and lint readings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: manifest と差分判定、並列プール（manifest.mjs、pool.mjs）

**Files:**
- Create: `.claude/skills/quiz-tts/scripts/lib/manifest.mjs`
- Create: `.claude/skills/quiz-tts/scripts/lib/pool.mjs`
- Test: `.claude/skills/quiz-tts/scripts/test/manifest.test.mjs`
- Test: `.claude/skills/quiz-tts/scripts/test/pool.test.mjs`

**Interfaces:**
- Produces: `entryHash({ model, voice, style, reading }): string`、`emptyManifest(set): Manifest`、`readManifest(file, set): Manifest`、`writeManifest(file, manifest): void`、`needsBuild(manifest, id, hash, wavExists): boolean`
- `Manifest = { version: 1, set: string, entries: { [id]: { hash, durationMs, voice, model, generatedAt } } }`
- Produces: `runPool(items, limit, fn: (item, index) => Promise<T>): Promise<T[]>`（`fn` は自分で例外を処理する。プールは投げない前提）

- [ ] **Step 1: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/manifest.test.mjs`:

```js
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
```

`.claude/skills/quiz-tts/scripts/test/pool.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPool } from "../lib/pool.mjs";

test("runPool: 順序を保ち、同時実行数を超えない", async () => {
  let running = 0;
  let peak = 0;
  const out = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test("runPool: 空配列なら空", async () => {
  assert.deepEqual(await runPool([], 2, async () => 1), []);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/manifest.mjs`、`../lib/pool.mjs` が見つからない）

- [ ] **Step 3: manifest.mjs と pool.mjs を書く**

`.claude/skills/quiz-tts/scripts/lib/manifest.mjs`:

```js
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
```

`.claude/skills/quiz-tts/scripts/lib/pool.mjs`:

```js
/** items を最大 limit 並列で fn に通し、入力順の結果を返す。fn は自分で例外を処理すること */
export async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add .claude/skills/quiz-tts/scripts/lib/manifest.mjs .claude/skills/quiz-tts/scripts/lib/pool.mjs .claude/skills/quiz-tts/scripts/test/manifest.test.mjs .claude/skills/quiz-tts/scripts/test/pool.test.mjs
git commit -m "feat(tts): manifest hashing for incremental builds and a bounded worker pool

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: CLI と mondai / voices コマンド（commands.mjs、tts.mjs）

**Files:**
- Create: `.claude/skills/quiz-tts/scripts/lib/commands.mjs`（この Task では `runMondai`、`runVoices` と共通部分。`runBuild`、`runJoin` は Task 8・9 で追加）
- Create: `.claude/skills/quiz-tts/scripts/tts.mjs`
- Test: `.claude/skills/quiz-tts/scripts/test/commands.test.mjs`
- 生成してコミット: `voice/out/mondai.wav`

**Interfaces:**
- Consumes: `loadConfig`、`requireApiKey`、`synthesize`、`wavInfo`
- Produces: `Ctx = { root, config, log: (s) => void, now: () => Date, synthesize: (params) => Promise<Buffer>, ffmpegAvailable: () => boolean, joinQuestion: (opts) => void }`
- Produces: `runMondai(ctx, { force }): Promise<{ generated: boolean, durationMs? }>`、`runVoices(ctx, { text }): Promise<{ voice, ok, error? }[]>`、`class CommandError extends Error`
- 内部: `synthesizeToFile(ctx, params, file): Promise<WavInfo>`（WAV でなければ投げて、ファイルは書かない）

- [ ] **Step 1: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/commands.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../lib/config.mjs";
import { runMondai, runVoices } from "../lib/commands.mjs";
import { tmpDir, makeWav } from "./helpers.mjs";

/** テスト用の ctx。synthesize は呼び出しを記録し、seconds 秒の WAV を返す */
export function makeCtx({ seconds = 2, synthesize, config = {} } = {}) {
  const root = tmpDir();
  const calls = [];
  const logs = [];
  const ctx = {
    root,
    config: validateConfig(config),
    log: (s) => logs.push(s),
    now: () => new Date("2026-10-15T00:00:00.000Z"),
    synthesize: synthesize ?? (async (params) => { calls.push(params); return makeWav({ seconds }); }),
    ffmpegAvailable: () => true,
    joinQuestion: () => {},
  };
  return { ctx, calls, logs, root };
}

test("runMondai: 無ければ config の文と声で生成する", async () => {
  const { ctx, calls, root } = makeCtx({ seconds: 1.2 });
  const r = await runMondai(ctx, {});
  assert.equal(r.generated, true);
  assert.equal(r.durationMs, 1200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "問題！");
  assert.equal(calls[0].voice, "Kore");
  assert.equal(calls[0].style, ctx.config.style);
  assert.ok(fs.existsSync(path.join(root, "voice", "out", "mondai.wav")));
});

test("runMondai: 既にあれば生成しない。--force なら作り直す", async () => {
  const { ctx, calls } = makeCtx();
  await runMondai(ctx, {});
  const r = await runMondai(ctx, {});
  assert.equal(r.generated, false);
  assert.equal(calls.length, 1);
  await runMondai(ctx, { force: true });
  assert.equal(calls.length, 2);
});

test("runMondai: WAV でない応答は投げてファイルを残さない", async () => {
  const { ctx, root } = makeCtx({ synthesize: async () => Buffer.from("<html>") });
  await assert.rejects(runMondai(ctx, {}), /WAV/);
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "mondai.wav")), false);
});

test("runVoices: 候補ごとに同じ文で生成し、失敗した声は記録して続ける", async () => {
  const { ctx, calls, root } = makeCtx({
    config: { candidates: ["Kore", "Zephyr", "Charon"] },
    synthesize: async (params) => {
      calls.push(params);
      if (params.voice === "Zephyr") throw new Error("boom");
      return makeWav({ seconds: 1 });
    },
  });
  const results = await runVoices(ctx, { text: "聴き比べ" });
  assert.deepEqual(results.map((r) => [r.voice, r.ok]), [["Kore", true], ["Zephyr", false], ["Charon", true]]);
  assert.ok(calls.every((c) => c.text === "聴き比べ"));
  assert.ok(fs.existsSync(path.join(root, "voice", "out", "voices", "Kore.wav")));
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "voices", "Zephyr.wav")), false);
});

test("runVoices: --text が無ければ config.sampleText", async () => {
  const { ctx, calls } = makeCtx({ config: { candidates: ["Kore"] } });
  await runVoices(ctx, {});
  assert.equal(calls[0].text, ctx.config.sampleText);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/commands.mjs` が見つからない）

- [ ] **Step 3: commands.mjs（mondai / voices と共通部分）を書く**

`.claude/skills/quiz-tts/scripts/lib/commands.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { wavInfo } from "./wav.mjs";

export class CommandError extends Error {}

export const MIN_DURATION_MS = 1000;
export const MAX_DURATION_MS = 60000;

export function outDir(ctx) {
  return path.resolve(ctx.root, ctx.config.outDir);
}
export function mondaiPath(ctx) {
  return path.join(outDir(ctx), "mondai.wav");
}
export function setDir(ctx, setName) {
  return path.join(outDir(ctx), setName);
}
export function rel(ctx, file) {
  return path.relative(ctx.root, file).split(path.sep).join("/");
}

/** 合成して WAV を検証してから書く。WAV でなければ投げて書かない */
export async function synthesizeToFile(ctx, params, file) {
  const wav = await ctx.synthesize(params);
  const info = wavInfo(wav);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, wav);
  return info;
}

export function lengthWarning(id, durationMs) {
  if (durationMs < MIN_DURATION_MS) return `${id}: ${durationMs}ms と短すぎます。台本を確認してください`;
  if (durationMs > MAX_DURATION_MS) return `${id}: ${durationMs}ms と長すぎます。台本を確認してください`;
  return null;
}

/** 「問題！」を 1 回だけ生成する */
export async function runMondai(ctx, { force = false } = {}) {
  const file = mondaiPath(ctx);
  if (fs.existsSync(file) && !force) {
    ctx.log(`既にあります: ${rel(ctx, file)}（作り直すには --force）`);
    return { generated: false };
  }
  const { model, voice, style, mondaiText } = ctx.config;
  const info = await synthesizeToFile(ctx, { model, voice, style, text: mondaiText }, file);
  ctx.log(`生成: ${rel(ctx, file)} (${info.durationMs}ms)`);
  return { generated: true, durationMs: info.durationMs };
}

/** 候補の声で同じ文を生成して聴き比べ用に並べる */
export async function runVoices(ctx, { text } = {}) {
  const { model, style, candidates, sampleText } = ctx.config;
  const sample = text || sampleText;
  const results = [];
  for (const voice of candidates) {
    const file = path.join(outDir(ctx), "voices", `${voice}.wav`);
    try {
      const info = await synthesizeToFile(ctx, { model, voice, style, text: sample }, file);
      ctx.log(`${voice}: ${rel(ctx, file)} (${info.durationMs}ms)`);
      results.push({ voice, ok: true });
    } catch (err) {
      ctx.log(`${voice}: 失敗 ${err.message}`);
      results.push({ voice, ok: false, error: err.message });
    }
  }
  return results;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS

- [ ] **Step 5: tts.mjs（CLI 入口）を書く**

`.claude/skills/quiz-tts/scripts/tts.mjs`（`build` / `join` の分岐も今書いておく。関数は Task 8・9 で追加するので、それまでは import エラーにならないよう `runBuild` / `runJoin` は Task 8・9 で import に足す）:

```js
#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { requireApiKey, EnvError } from "./lib/env.mjs";
import { loadConfig, ConfigError } from "./lib/config.mjs";
import { synthesize } from "./lib/gemini.mjs";
import { ScriptError } from "./lib/script.mjs";
import { CommandError, runMondai, runVoices } from "./lib/commands.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const USAGE = `使い方: npm run tts -- <コマンド> [引数]
  voices [--text 文]                       候補の声で聴き比べ用の音声を作る
  mondai [--force]                         「問題！」を作る（既にあれば何もしない）
  build <セット名> [--only Qnn] [--force]  台本から各問の WAV を作る（変わった問だけ）
  join <セット名> [--only Qnn]             問題！＋無音＋問題文を結合した mp3 を作る`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      only: { type: "string", multiple: true },
      force: { type: "boolean", default: false },
      text: { type: "string" },
    },
  });
  const [command, setName] = positionals;
  const config = loadConfig(ROOT);
  const ctx = {
    root: ROOT,
    config,
    log: console.log,
    now: () => new Date(),
    ffmpegAvailable: () => false, // Task 9 で join.mjs の実装に差し替える
    joinQuestion: () => {},
    synthesize: null,
  };
  const withKey = () => {
    const apiKey = requireApiKey(ROOT);
    ctx.synthesize = (params) => synthesize(params, { apiKey });
  };
  switch (command) {
    case "voices": {
      withKey();
      const results = await runVoices(ctx, { text: values.text });
      return results.some((r) => !r.ok) ? 1 : 0;
    }
    case "mondai":
      withKey();
      await runMondai(ctx, { force: values.force });
      return 0;
    case "build":
    case "join":
      console.error(`${command} は未実装です`);
      return 2;
    default:
      console.error(USAGE);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof EnvError || err instanceof ConfigError || err instanceof ScriptError || err instanceof CommandError) {
      console.error(`エラー: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  },
);
```

- [ ] **Step 6: 使い方表示と、キー無しのエラーを確認する**

Run: `npm run tts`
Expected: 使い方が出て終了コード 2

Run（環境変数 `GEMINI_API_KEY` が無い状態で。`.env` の無い一時ディレクトリを root に渡す）:

```bash
node -e "import('./.claude/skills/quiz-tts/scripts/lib/env.mjs').then(m => { try { m.requireApiKey(require('os').tmpdir()) } catch (e) { console.log(e.message) } })"
```

Expected: `GEMINI_API_KEY が見つかりません。リポジトリ直下に .env を作り…` の案内文が出る

- [ ] **Step 7: 実 API で「問題！」を生成し、聴いて確認する**

Run: `npm run tts -- mondai`
Expected: `生成: voice/out/mondai.wav (<ms>)`。`voice/out/mondai.wav` を再生して「問題！」と聞こえること（Windows なら `start voice/out/mondai.wav`）。聞こえ方が違えば `voice/config.json` の `style` か `voice` を直して `npm run tts -- mondai --force`

Run: `npm run tts -- mondai`
Expected: `既にあります: voice/out/mondai.wav（作り直すには --force）`

（声を選び直したいときは `npm run tts -- voices` で `voice/out/voices/<声名>.wav` を聴き比べ、`voice/config.json` の `voice` を変えてから `mondai --force`。`voices/` は .gitignore 済み）

- [ ] **Step 8: コミット（mondai.wav を含める）**

```bash
git add .claude/skills/quiz-tts/scripts/lib/commands.mjs .claude/skills/quiz-tts/scripts/tts.mjs .claude/skills/quiz-tts/scripts/test/commands.test.mjs voice/out/mondai.wav
git commit -m "feat(tts): CLI entry with mondai and voices commands

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: build コマンド（差分生成）

**Files:**
- Modify: `.claude/skills/quiz-tts/scripts/lib/commands.mjs`（`loadSet`、`selectQuestions`、`runBuild` を追加）
- Modify: `.claude/skills/quiz-tts/scripts/tts.mjs`（`build` の分岐）
- Modify: `.claude/skills/quiz-tts/scripts/test/commands.test.mjs`（テスト追加）
- Create: `voice/sets/sample.md`
- 生成してコミット: `voice/out/sample/manifest.json`

**Interfaces:**
- Consumes: `parseScript`、`entryHash`、`readManifest`、`writeManifest`、`needsBuild`、`runPool`、`synthesizeToFile`、`lengthWarning`
- Produces: `runBuild(ctx, { setName, only = [], force = false }): Promise<{ generated: string[], skipped: string[], failed: { id, error }[], warnings: string[] }>`、`loadSet(ctx, setName): { title, questions, warnings }`、`selectQuestions(questions, only): Question[]`

- [ ] **Step 1: 失敗するテストを追加する**

`.claude/skills/quiz-tts/scripts/test/commands.test.mjs` の import に `runBuild` を足し、末尾に追加:

```js
import { runBuild } from "../lib/commands.mjs"; // 既存の import 行にまとめてよい

const SET = `# サンプル

## Q01
- 答え: A
- 読み: いち<short pause>です

## Q02
- 答え: B
- 読み: に<short pause>です
- style: 速め

## Q03
- 答え: C
- 読み: さん
`;

function writeSet(root, name, text) {
  fs.mkdirSync(path.join(root, "voice", "sets"), { recursive: true });
  fs.writeFileSync(path.join(root, "voice", "sets", `${name}.md`), text);
}

test("runBuild: 全問生成して manifest に書く。問ごとの style が優先される", async () => {
  const { ctx, calls, root } = makeCtx({ seconds: 3 });
  writeSet(root, "s", SET);
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.generated, ["Q01", "Q02", "Q03"]);
  assert.deepEqual(r.failed, []);
  assert.equal(calls.find((c) => c.text === "に<short pause>です").style, "速め");
  assert.equal(calls.find((c) => c.text === "さん").style, ctx.config.style);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "voice", "out", "s", "manifest.json"), "utf8"));
  assert.equal(manifest.set, "s");
  assert.deepEqual(Object.keys(manifest.entries).sort(), ["Q01", "Q02", "Q03"]);
  assert.equal(manifest.entries.Q01.durationMs, 3000);
  assert.equal(manifest.entries.Q01.voice, "Kore");
  assert.equal(manifest.entries.Q01.generatedAt, "2026-10-15T00:00:00.000Z");
  assert.ok(fs.existsSync(path.join(root, "voice", "out", "s", "Q01.wav")));
});

test("runBuild: 2 回目は変更なし。読みを変えた問だけ再生成。--force で全部", async () => {
  const { ctx, calls, root } = makeCtx();
  writeSet(root, "s", SET);
  await runBuild(ctx, { setName: "s" });
  const r2 = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r2.skipped, ["Q01", "Q02", "Q03"]);
  assert.equal(calls.length, 3);
  writeSet(root, "s", SET.replace("- 読み: さん", "- 読み: さんばん"));
  const r3 = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r3.generated, ["Q03"]);
  assert.equal(calls.length, 4);
  const r4 = await runBuild(ctx, { setName: "s", force: true });
  assert.equal(r4.generated.length, 3);
  assert.equal(calls.length, 7);
});

test("runBuild: WAV が消えていれば manifest が一致しても再生成する", async () => {
  const { ctx, calls, root } = makeCtx();
  writeSet(root, "s", SET);
  await runBuild(ctx, { setName: "s" });
  fs.unlinkSync(path.join(root, "voice", "out", "s", "Q02.wav"));
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.generated, ["Q02"]);
  assert.equal(calls.length, 4);
});

test("runBuild: --only で絞る。無い ID はエラーで何も生成しない", async () => {
  const { ctx, calls, root } = makeCtx();
  writeSet(root, "s", SET);
  const r = await runBuild(ctx, { setName: "s", only: ["Q02"] });
  assert.deepEqual(r.generated, ["Q02"]);
  assert.equal(calls.length, 1);
  await assert.rejects(runBuild(ctx, { setName: "s", only: ["Q99"] }), /Q99/);
  assert.equal(calls.length, 1);
});

test("runBuild: 一部失敗しても続行し、失敗した問は manifest に書かない", async () => {
  const { ctx, root } = makeCtx({
    synthesize: async (params) => {
      if (params.text.startsWith("に")) throw new Error("Gemini API エラー 429: slow down");
      return makeWav({ seconds: 2 });
    },
  });
  writeSet(root, "s", SET);
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.generated, ["Q01", "Q03"]);
  assert.deepEqual(r.failed.map((f) => f.id), ["Q02"]);
  assert.match(r.failed[0].error, /429/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "voice", "out", "s", "manifest.json"), "utf8"));
  assert.equal("Q02" in manifest.entries, false);
});

test("runBuild: WAV でない応答は失敗扱いで、ファイルも manifest も残さない", async () => {
  const { ctx, root } = makeCtx({ synthesize: async () => Buffer.from("not wav") });
  writeSet(root, "s", "## Q01\n- 読み: いち\n");
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01"]);
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "s", "Q01.wav")), false);
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "s", "manifest.json")), false);
});

test("runBuild: 短すぎ・長すぎは警告に入る", async () => {
  const { ctx, root } = makeCtx({ seconds: 0.5 });
  writeSet(root, "s", "## Q01\n- 読み: いち\n");
  const r = await runBuild(ctx, { setName: "s" });
  assert.ok(r.warnings.some((w) => /Q01/.test(w) && /短すぎ/.test(w)));
});

test("runBuild: 台本が無い・セット名が無いとき CommandError", async () => {
  const { ctx } = makeCtx();
  await assert.rejects(runBuild(ctx, { setName: "nope" }), /台本がありません/);
  await assert.rejects(runBuild(ctx, {}), /セット名/);
});

test("runBuild: 台本の警告をログに出す", async () => {
  const { ctx, logs, root } = makeCtx();
  writeSet(root, "s", "## Q01\n- 読み: 『いち』\n");
  await runBuild(ctx, { setName: "s" });
  assert.ok(logs.some((l) => /警告: Q01:.*『』/.test(l)));
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`runBuild` が export されていない）

- [ ] **Step 3: runBuild を書く**

`.claude/skills/quiz-tts/scripts/lib/commands.mjs` の import に追加:

```js
import { parseScript } from "./script.mjs";
import { entryHash, readManifest, writeManifest, needsBuild } from "./manifest.mjs";
import { runPool } from "./pool.mjs";
```

末尾に追加:

```js
/** voice/sets/<set>.md を読み、台本の警告をログに出す */
export function loadSet(ctx, setName) {
  const file = path.resolve(ctx.root, ctx.config.setsDir, `${setName}.md`);
  if (!fs.existsSync(file)) throw new CommandError(`台本がありません: ${rel(ctx, file)}`);
  const parsed = parseScript(fs.readFileSync(file, "utf8"));
  for (const w of parsed.warnings) ctx.log(`警告: ${w}`);
  return parsed;
}

/** --only の ID で絞る。台本に無い ID があればエラー */
export function selectQuestions(questions, only) {
  if (!only || only.length === 0) return questions;
  const ids = new Set(questions.map((q) => q.id));
  for (const id of only) if (!ids.has(id)) throw new CommandError(`台本に ${id} がありません`);
  return questions.filter((q) => only.includes(q.id));
}

/** 台本の各問を生成する。ハッシュが一致し WAV がある問は飛ばす */
export async function runBuild(ctx, { setName, only = [], force = false } = {}) {
  if (!setName) throw new CommandError("セット名を指定してください: build <セット名>");
  const { questions } = loadSet(ctx, setName);
  const targets = selectQuestions(questions, only);
  const dir = setDir(ctx, setName);
  const manifestFile = path.join(dir, "manifest.json");
  const manifest = readManifest(manifestFile, setName);
  const { model, voice } = ctx.config;
  const result = { generated: [], skipped: [], failed: [], warnings: [] };

  await runPool(targets, ctx.config.concurrency, async (q) => {
    const style = q.style || ctx.config.style;
    const hash = entryHash({ model, voice, style, reading: q.reading });
    const file = path.join(dir, `${q.id}.wav`);
    if (!force && !needsBuild(manifest, q.id, hash, fs.existsSync(file))) {
      result.skipped.push(q.id);
      ctx.log(`${q.id}: 変更なし`);
      return;
    }
    try {
      const info = await synthesizeToFile(ctx, { model, voice, style, text: q.reading }, file);
      manifest.entries[q.id] = { hash, durationMs: info.durationMs, voice, model, generatedAt: ctx.now().toISOString() };
      writeManifest(manifestFile, manifest);
      result.generated.push(q.id);
      ctx.log(`${q.id}: 生成 (${info.durationMs}ms)`);
      const warning = lengthWarning(q.id, info.durationMs);
      if (warning) result.warnings.push(warning);
    } catch (err) {
      result.failed.push({ id: q.id, error: err.message });
      ctx.log(`${q.id}: 失敗 ${err.message}`);
    }
  });

  // 並列で順序が前後するので ID 順に揃える
  for (const key of ["generated", "skipped"]) result[key].sort();
  result.failed.sort((a, b) => a.id.localeCompare(b.id));
  ctx.log(`生成 ${result.generated.length} / 変更なし ${result.skipped.length} / 失敗 ${result.failed.length}`);
  for (const w of result.warnings) ctx.log(`警告: ${w}`);
  for (const f of result.failed) ctx.log(`失敗: ${f.id}: ${f.error}`);
  return result;
}
```

`tts.mjs` の import を `import { CommandError, runMondai, runVoices, runBuild } from "./lib/commands.mjs";` にし、`case "build":` を次に置き換える（`case "join":` は未実装のまま残す）:

```js
    case "build": {
      withKey();
      const r = await runBuild(ctx, { setName, only: values.only ?? [], force: values.force });
      return r.failed.length > 0 ? 1 : 0;
    }
    case "join":
      console.error("join は未実装です");
      return 2;
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS

- [ ] **Step 5: 作例の台本を置く**

`voice/sets/sample.md`:

```markdown
# 映画早押し 作例

## Q01
- 答え: 『バック・トゥ・ザ・フューチャー』
- 問題文: 1955年にタイムスリップした高校生マーティが、若き日の両親を結びつけようと奮闘する、マイケル・J・フォックス主演の映画は何でしょう？
- 読み: 1955年にタイムスリップした高校生マーティが、<short pause>若き日の両親を結びつけようと奮闘する、<short pause>マイケル・ジェイ・フォックス主演の映画は、何でしょう？

## Q02
- 答え: 『ハリー・ポッターと秘密の部屋』
- 問題文: 『ハリー・ポッター』シリーズの映画第1作は『賢者の石』ですが、第2作は何でしょう？
- 読み: ハリー・ポッターシリーズの映画、第1作は<short pause>賢者の石ですが、<short pause>第2作は、何でしょう？

## Q03
- 答え: バズ・ライトイヤー
- 問題文: 映画『トイ・ストーリー』で、カウボーイ人形はウッディですが、スペース・レンジャーのおもちゃは誰でしょう？
- 読み: 映画トイ・ストーリーで、カウボーイ人形は<short pause>ウッディですが、<short pause>スペース・レンジャーのおもちゃは、誰でしょう？

## Q04
- 答え: 『となりのトトロ』
- 問題文: カンタ、まっくろくろすけ、ネコバスといえば、どれも登場する宮崎駿監督のジブリ映画は何でしょう？
- 読み: カンタ、まっくろくろすけ、ネコバスといえば、<short pause>どれも登場する、宮崎駿監督のジブリ映画は、何でしょう？

## Q05
- 答え: レオナルド・ディカプリオ
- 問題文: ずばり、映画『タイタニック』で主人公ジャックを演じた俳優は誰でしょう？
- 読み: ずばり、<short pause>映画タイタニックで、主人公ジャックを演じた俳優は、誰でしょう？
```

- [ ] **Step 6: 実 API で作例を生成し、聴いて確認する**

Run: `npm run tts -- build sample`
Expected: `Q01: 生成 (…ms)` × 5、`生成 5 / 変更なし 0 / 失敗 0`。`voice/out/sample/Q01.wav` を再生して読み上げが自然か、`<short pause>` が間として聞こえるか確認する。タグが読み上げられてしまう（「ショートポーズ」と聞こえる）場合は、SKILL.md のルールを「ポーズは読点と `…` で表す」に変え、作例の `<short pause>` を `、` に置き換え、`lintReading` のタグ判定は残す

Run: `npm run tts -- build sample`
Expected: `変更なし` × 5

Run: `npm run tts -- build sample --only Q99`
Expected: `エラー: 台本に Q99 がありません`、終了コード 1

- [ ] **Step 7: コミット（manifest を含め、WAV は含めない）**

```bash
git status --short   # voice/out/sample/Q*.wav が出ないこと（.gitignore 済み）
git add .claude/skills/quiz-tts/scripts/lib/commands.mjs .claude/skills/quiz-tts/scripts/tts.mjs .claude/skills/quiz-tts/scripts/test/commands.test.mjs voice/sets/sample.md voice/out/sample/manifest.json
git commit -m "feat(tts): build command generates changed questions from a reading script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: join コマンド（ffmpeg で 問題！＋無音＋問題文 → mp3）

**Files:**
- Create: `.claude/skills/quiz-tts/scripts/lib/join.mjs`
- Modify: `.claude/skills/quiz-tts/scripts/lib/commands.mjs`（`runJoin` を追加）
- Modify: `.claude/skills/quiz-tts/scripts/tts.mjs`（`join` の分岐、ffmpeg 実装の注入）
- Test: `.claude/skills/quiz-tts/scripts/test/join.test.mjs`
- Modify: `.claude/skills/quiz-tts/scripts/test/commands.test.mjs`（`runJoin` のテスト追加）
- 生成してコミット: `voice/out/sample/Q01.full.mp3` 〜 `Q05.full.mp3`

**Interfaces:**
- Produces（join.mjs）: `ffmpegAvailable(): boolean`、`ffmpegArgs({ mondaiWav, questionWav, pauseMs, outMp3, sampleRate = 24000 }): string[]`、`joinQuestion(opts): void`（失敗は `Error`）、`needsJoin(outMp3, inputs: string[]): boolean`
- Produces（commands.mjs）: `runJoin(ctx, { setName, only = [] }): Promise<{ joined: string[], skipped: string[], failed: { id, error }[], noFfmpeg?: true }>`

- [ ] **Step 1: 失敗するテストを書く**

`.claude/skills/quiz-tts/scripts/test/join.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ffmpegAvailable, ffmpegArgs, joinQuestion, needsJoin } from "../lib/join.mjs";
import { tmpDir, makeWav } from "./helpers.mjs";

test("ffmpegArgs: 3 入力を concat して mp3 にする", () => {
  const args = ffmpegArgs({ mondaiWav: "m.wav", questionWav: "q.wav", pauseMs: 600, outMp3: "o.mp3" });
  assert.deepEqual(args, [
    "-y", "-loglevel", "error",
    "-i", "m.wav",
    "-f", "lavfi", "-t", "0.600", "-i", "anullsrc=r=24000:cl=mono",
    "-i", "q.wav",
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
    "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "4",
    "o.mp3",
  ]);
});

test("needsJoin: mp3 が無いか入力より古いときだけ true", () => {
  const dir = tmpDir();
  const a = path.join(dir, "a.wav");
  const b = path.join(dir, "b.wav");
  const out = path.join(dir, "o.mp3");
  fs.writeFileSync(a, "x");
  fs.writeFileSync(b, "x");
  assert.equal(needsJoin(out, [a, b]), true);
  fs.writeFileSync(out, "x");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(a, past, past);
  fs.utimesSync(b, past, past);
  assert.equal(needsJoin(out, [a, b]), false);
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(b, future, future);
  assert.equal(needsJoin(out, [a, b]), true);
});

test("joinQuestion: ffmpeg で実際に結合できる", { skip: !ffmpegAvailable() && "ffmpeg が無い" }, () => {
  const dir = tmpDir();
  const m = path.join(dir, "m.wav");
  const q = path.join(dir, "q.wav");
  const out = path.join(dir, "o.mp3");
  fs.writeFileSync(m, makeWav({ seconds: 0.5 }));
  fs.writeFileSync(q, makeWav({ seconds: 1 }));
  joinQuestion({ mondaiWav: m, questionWav: q, pauseMs: 600, outMp3: out });
  assert.ok(fs.statSync(out).size > 1000);
});

test("joinQuestion: 入力が無ければ投げる", { skip: !ffmpegAvailable() && "ffmpeg が無い" }, () => {
  const dir = tmpDir();
  assert.throws(
    () => joinQuestion({ mondaiWav: path.join(dir, "none.wav"), questionWav: path.join(dir, "none2.wav"), pauseMs: 600, outMp3: path.join(dir, "o.mp3") }),
    /ffmpeg/,
  );
});
```

`.claude/skills/quiz-tts/scripts/test/commands.test.mjs` の import に `runJoin` を足し、末尾に追加:

```js
test("runJoin: mondai.wav が無ければ CommandError", async () => {
  const { ctx, root } = makeCtx();
  writeSet(root, "s", SET);
  await assert.rejects(runJoin(ctx, { setName: "s" }), /mondai/);
});

test("runJoin: ffmpeg が無ければ警告して何もしない", async () => {
  const { ctx, logs, root } = makeCtx();
  writeSet(root, "s", SET);
  await runMondai(ctx, {});
  ctx.ffmpegAvailable = () => false;
  const r = await runJoin(ctx, { setName: "s" });
  assert.equal(r.noFfmpeg, true);
  assert.ok(logs.some((l) => /ffmpeg/.test(l)));
});

test("runJoin: build 済みの問を結合し、WAV が無い問は失敗。2 回目は変更なし", async () => {
  const { ctx, root } = makeCtx();
  writeSet(root, "s", SET);
  await runMondai(ctx, {});
  await runBuild(ctx, { setName: "s", only: ["Q01", "Q02"] });
  const joins = [];
  ctx.joinQuestion = (opts) => {
    joins.push(opts);
    fs.writeFileSync(opts.outMp3, "mp3");
  };
  const r = await runJoin(ctx, { setName: "s" });
  assert.deepEqual(r.joined, ["Q01", "Q02"]);
  assert.deepEqual(r.failed.map((f) => f.id), ["Q03"]);
  assert.equal(joins[0].pauseMs, 600);
  assert.equal(path.basename(joins[0].mondaiWav), "mondai.wav");
  assert.equal(path.basename(joins[0].outMp3), "Q01.full.mp3");
  const past = new Date(Date.now() - 60_000);
  for (const f of ["Q01.wav", "Q02.wav"]) fs.utimesSync(path.join(root, "voice", "out", "s", f), past, past);
  fs.utimesSync(path.join(root, "voice", "out", "mondai.wav"), past, past);
  const r2 = await runJoin(ctx, { setName: "s", only: ["Q01", "Q02"] });
  assert.deepEqual(r2.skipped, ["Q01", "Q02"]);
  assert.equal(joins.length, 2);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:tts`
Expected: FAIL（`../lib/join.mjs` が見つからない、`runJoin` が無い）

- [ ] **Step 3: join.mjs と runJoin を書く**

`.claude/skills/quiz-tts/scripts/lib/join.mjs`:

```js
import fs from "node:fs";
import { spawnSync } from "node:child_process";

export function ffmpegAvailable() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

/** 問題！ → 無音 pauseMs → 問題文 を concat して mp3 にする ffmpeg の引数 */
export function ffmpegArgs({ mondaiWav, questionWav, pauseMs, outMp3, sampleRate = 24000 }) {
  return [
    "-y", "-loglevel", "error",
    "-i", mondaiWav,
    "-f", "lavfi", "-t", (pauseMs / 1000).toFixed(3), "-i", `anullsrc=r=${sampleRate}:cl=mono`,
    "-i", questionWav,
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
    "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "4",
    outMp3,
  ];
}

export function joinQuestion(opts) {
  const r = spawnSync("ffmpeg", ffmpegArgs(opts), { encoding: "utf8" });
  if (r.error) throw new Error(`ffmpeg を実行できません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg が失敗しました: ${(r.stderr || "").trim().slice(0, 500)}`);
}

/** 出力が無いか、入力のどれかが出力より新しければ結合し直す */
export function needsJoin(outMp3, inputs) {
  if (!fs.existsSync(outMp3)) return true;
  const outTime = fs.statSync(outMp3).mtimeMs;
  return inputs.some((f) => fs.statSync(f).mtimeMs > outTime);
}
```

`.claude/skills/quiz-tts/scripts/lib/commands.mjs` の import に `import { needsJoin } from "./join.mjs";` を足し、末尾に追加:

```js
/** build 済みの WAV を「問題！」と結合して mp3 にする */
export async function runJoin(ctx, { setName, only = [] } = {}) {
  if (!setName) throw new CommandError("セット名を指定してください: join <セット名>");
  const mondai = mondaiPath(ctx);
  if (!fs.existsSync(mondai)) throw new CommandError(`${rel(ctx, mondai)} がありません。先に mondai を実行してください`);
  if (!ctx.ffmpegAvailable()) {
    ctx.log("警告: ffmpeg が見つからないので結合を飛ばします（https://ffmpeg.org/ から入れて PATH を通す）");
    return { joined: [], skipped: [], failed: [], noFfmpeg: true };
  }
  const { questions } = loadSet(ctx, setName);
  const targets = selectQuestions(questions, only);
  const dir = setDir(ctx, setName);
  const result = { joined: [], skipped: [], failed: [] };
  for (const q of targets) {
    const wav = path.join(dir, `${q.id}.wav`);
    const mp3 = path.join(dir, `${q.id}.full.mp3`);
    if (!fs.existsSync(wav)) {
      result.failed.push({ id: q.id, error: "WAV がありません。先に build を実行してください" });
      continue;
    }
    if (!needsJoin(mp3, [wav, mondai])) {
      result.skipped.push(q.id);
      continue;
    }
    try {
      ctx.joinQuestion({ mondaiWav: mondai, questionWav: wav, pauseMs: ctx.config.pauseMs, outMp3: mp3 });
      result.joined.push(q.id);
      ctx.log(`${q.id}: 結合 → ${rel(ctx, mp3)}`);
    } catch (err) {
      result.failed.push({ id: q.id, error: err.message });
      ctx.log(`${q.id}: 失敗 ${err.message}`);
    }
  }
  ctx.log(`結合 ${result.joined.length} / 変更なし ${result.skipped.length} / 失敗 ${result.failed.length}`);
  for (const f of result.failed) ctx.log(`失敗: ${f.id}: ${f.error}`);
  return result;
}
```

`tts.mjs`: import に `import { ffmpegAvailable, joinQuestion } from "./lib/join.mjs";` を足し、`runJoin` も commands から import。`ctx` の `ffmpegAvailable: () => false` と `joinQuestion: () => {}` を `ffmpegAvailable, joinQuestion` に置き換え、`case "join":` を次に置き換える:

```js
    case "join": {
      const r = await runJoin(ctx, { setName, only: values.only ?? [] });
      return r.failed.length > 0 ? 1 : 0;
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:tts`
Expected: PASS（ffmpeg が無い環境では join の実行テスト 2 件が skip）。ffmpeg 入りで `joinQuestion` が `concat` の形式不一致で失敗する場合は、`ffmpegArgs` の `-filter_complex` を `"[0:a]aformat=sample_fmts=s16:sample_rates=24000:channel_layouts=mono[a0];[1:a]aformat=sample_fmts=s16:sample_rates=24000:channel_layouts=mono[a1];[2:a]aformat=sample_fmts=s16:sample_rates=24000:channel_layouts=mono[a2];[a0][a1][a2]concat=n=3:v=0:a=1[out]"` に変え、テストの期待値も同じ文字列に直す

- [ ] **Step 5: 作例を結合して聴く**

Run: `npm run tts -- join sample`
Expected: `Q01: 結合 → voice/out/sample/Q01.full.mp3` × 5。`Q01.full.mp3` を再生して「問題！」→ 間 → 問題文 と聞こえること。間が短い／長いなら `voice/config.json` の `pauseMs` を変えて再実行（mp3 は `mondai.wav` / `Qnn.wav` より新しいので、作り直すには mp3 を消すか `touch voice/out/mondai.wav`）

Run: `npm run tts -- join sample`
Expected: `結合 0 / 変更なし 5 / 失敗 0`

- [ ] **Step 6: コミット（mp3 を含める）**

```bash
git add .claude/skills/quiz-tts/scripts/lib/join.mjs .claude/skills/quiz-tts/scripts/lib/commands.mjs .claude/skills/quiz-tts/scripts/tts.mjs .claude/skills/quiz-tts/scripts/test/join.test.mjs .claude/skills/quiz-tts/scripts/test/commands.test.mjs voice/out/sample/*.full.mp3
git commit -m "feat(tts): join command concatenates the cue, a pause and the question into mp3

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: SKILL.md と設計書の反映

**Files:**
- Create: `.claude/skills/quiz-tts/SKILL.md`
- Modify: `docs/overview.md`（「スコープ外」の読み上げ音声の行、「リポジトリ構成」）
- Modify: `README.md`（問読み音声の節）
- Delete: `docs/superpowers/specs/2026-10-15-quiz-tts-skill-design.md`、`docs/superpowers/plans/2026-10-15-quiz-tts-skill.md`（`docs/AGENTS.md` の規則: 完了したら設計の結論を docs/ 直下に蒸留して元ファイルは削除）

- [ ] **Step 1: SKILL.md を書く**

`.claude/skills/quiz-tts/SKILL.md`:

````markdown
---
name: quiz-tts
description: 早押しクイズの問題文から問読み（読み上げ）音声を Gemini 3.8 Flash TTS で生成する。「問読みの音声を作って」「この問題セットの読み上げを生成して」「台本を書いて音声にして」「声を選びたい」と言われたとき、または voice/sets/ の台本を書いたり直したりするときに使う。QuizJam アプリ本体には触らない。
---

# quiz-tts: 早押し問読み音声の生成

問題文 → 読み上げ台本（人がレビュー） → Gemini TTS → 「問題！」と結合した mp3、までを作る。
声と話し方は `voice/config.json` で全問固定する。API キーはリポジトリ直下の `.env` の `GEMINI_API_KEY`（無ければユーザーに `.env.example` をコピーして入れてもらう。キーの値はチャットに書かない）。

## ワークフロー

1. **台本を書く／直す**: `voice/sets/<セット名>.md`。問題文から「読み」を下のルールで起こし、チェックリストで見直す。出題文が決まっていない問題は、先に作問（前フリ→後フリ→問いかけ、40〜60 文字、答えが 1 つに決まる）を済ませてから
2. `voice/out/mondai.wav` が無ければ `npm run tts -- mondai`
3. `npm run tts -- build <セット名>`（変わった問だけ生成。台本の警告が出たら台本を直して再実行）
4. `npm run tts -- join <セット名>`（`Qnn.full.mp3` ができる）
5. 出力の `生成 n / 変更なし n / 失敗 n` と警告（短すぎ・長すぎ）を確認。失敗や警告があれば台本を直して 3 へ
6. 台本・`voice/out/<セット名>/manifest.json`・`Qnn.full.mp3` をコミットする（`Qnn.wav` は .gitignore 済み）

## 台本ファイルの形

```markdown
# セットのタイトル

## Q01
- 答え: 『バック・トゥ・ザ・フューチャー』
- 問題文: 1955年にタイムスリップした高校生マーティが、若き日の両親を結びつけようと奮闘する、マイケル・J・フォックス主演の映画は何でしょう？
- 読み: 1955年にタイムスリップした高校生マーティが、<short pause>若き日の両親を結びつけようと奮闘する、<short pause>マイケル・ジェイ・フォックス主演の映画は、何でしょう？
- style: （省略可。config の既定を上書きする短い文。原則書かない）
```

- ID は `Q` + 2 桁以上の数字。重複はエラー
- `答え` と `問題文` は表示・判定用で、音声には使わない
- `読み` が TTS に渡す逐語テキスト。無ければ `問題文` をそのまま読む（警告が出る）
- 1 行 1 項目。コロンは半角・全角どちらでもよい

## 読みの書き方ルール

1. **下読み**: 固有名詞・数字・記号の読みを確認し、誤読しそうな語はカタカナや平易な表記に直す（`マイケル・J・フォックス` → `マイケル・ジェイ・フォックス`、`II` → `ツー`、`1955年` はそのまま）
2. **『』「」は外す**: API は text を逐語で読むので括弧は入れない。「」の中（セリフ・引用）は前後に `<short pause>` を置いて区切る
3. **フリの切れ目にポーズ**: 前フリ → 後フリ → 問いかけの境目に `<short pause>`。「何でしょう？」の直前は読点で区切る
4. **パラレル（ですが問題）**: 対比する語（「日本で」「第1作」など）の直後に `<short pause>`。「ですが、」の後にも `<short pause>`。文字単位の強弱指定は無いので、ポーズで代用する
5. **速さ**: 既定 style が「落ち着いたクイズ番組のアナウンサー。ゆっくり、はっきり読む」。問ごとの `style` は原則空にする（声の揺れを防ぐ）
6. **確定ポイント付近で速さを変えない**: `<long pause>` は使わない（読み手の癖がヒントになる）
7. **タグは `<short pause>` だけ**: `<laugh>` などの感情タグは使わない。1 問につき 1〜3 個

### チェックリスト（台本レビュー時）

- [ ] 読みに『』「」が残っていない
- [ ] 固有名詞の読みが確認済み
- [ ] 1 問につき `<short pause>` が 1〜3 個
- [ ] 答えが読みに含まれていない（前フリの言い換えで漏れていないか）
- [ ] 問題文は前フリ → 後フリの順で、後ろほど有名な情報になっている

## コマンド

```bash
npm run tts -- voices [--text 文]                       # 候補の声で聴き比べ（voice/out/voices/<声名>.wav）
npm run tts -- mondai [--force]                         # 「問題！」を 1 回だけ生成（voice/out/mondai.wav）
npm run tts -- build <セット名> [--only Qnn] [--force]  # 台本から各問の WAV（変わった問だけ）
npm run tts -- join <セット名> [--only Qnn]             # 問題！＋無音＋問題文 → Qnn.full.mp3（ffmpeg）
npm run test:tts                                        # スクリプトのテスト
```

- 終了コード 1 = どれかの問が失敗（出力の `失敗:` 行を見る）。429 / 5xx は 2・4・8 秒待って 3 回まで自動で再試行する
- 声を変えたいとき: `voices` で聴き比べ → `voice/config.json` の `voice` を変更 → `mondai --force` → `build <セット名> --force`（ハッシュに声が入っているので、`--force` が無くても全問が再生成される）→ `join`
- 間の長さは `voice/config.json` の `pauseMs`（ms）。変えたら mp3 を消して `join`

## 設定（voice/config.json）

| キー | 意味 |
|---|---|
| `model` | `gemini-3.8-flash-tts` |
| `voice` | プリセット声名（`Kore` など 30 種）。全問共通 |
| `candidates` | `voices` で聴き比べる声名 |
| `style` | 全問共通の話し方。短い定型文にする |
| `mondaiText` | 「問題！」の文 |
| `pauseMs` | 「問題！」と問題文の間の無音（ms） |
| `concurrency` | 同時リクエスト数（1〜4） |

## 制限

- 文字単位のアクセント・速度の数値指定は Gemini TTS に無い。ポーズと style で近づける
- Voice design（専用声）は使わない。プリセット声は有効期限がなく、作り直しても同じ声になる
- QuizJam アプリ内での再生・文字送りとの同期は対象外（`manifest.json` に問ごとの長さを残してあるので、組み込むときに使う）
````

- [ ] **Step 2: docs/overview.md と README.md を更新する**

`docs/overview.md` の「スコープ外」の行 `- 早押しの読み上げ音声（文字送りの時刻はサーバーが持つので、後から音声を同期して乗せられる）` を次に置き換える:

```markdown
- 早押しの読み上げ音声のアプリ内再生（音声ファイル自体は `.claude/skills/quiz-tts/` の Claude Code スキルで生成する。文字送りの時刻はサーバーが持つので、後から音声を同期して乗せられる）
```

`docs/overview.md` の「リポジトリ構成」のコードブロックに 2 行足す（`docs/       設計書` の後）:

```
voice/      早押し問読み音声の台本（sets/）と生成物（out/: mondai.wav・manifest.json・Qnn.full.mp3）
.claude/skills/quiz-tts/  問読み音声を Gemini TTS で生成する Claude Code スキル（アプリからは独立。Node 22、依存なし）
```

`README.md` の「## 構成」の前に節を足す:

````markdown
## 早押しの問読み音声

`voice/sets/<セット名>.md` に台本（問題文と読み）を書き、Gemini 3.8 Flash TTS で読み上げ音声を作る。手順と台本の書き方は `.claude/skills/quiz-tts/SKILL.md`。

```bash
cp .env.example .env              # GEMINI_API_KEY を入れる
npm run tts -- mondai             # 「問題！」を 1 回だけ生成
npm run tts -- build sample       # 台本から各問の WAV
npm run tts -- join sample        # 問題！＋無音＋問題文 の mp3（ffmpeg が必要）
npm run test:tts
```
````

- [ ] **Step 3: 全テストを通し、スキルが呼べることを確認する**

Run: `npm run test:tts`
Expected: PASS（全件）

Run: `npm test && npm run typecheck`
Expected: PASS（既存のテストと型チェックに影響が無いこと）

Run: `npm run tts -- build sample && npm run tts -- join sample`
Expected: 全問 `変更なし`

- [ ] **Step 4: 設計書・計画書を削除してコミット**

```bash
git rm docs/superpowers/specs/2026-10-15-quiz-tts-skill-design.md docs/superpowers/plans/2026-10-15-quiz-tts-skill.md
git add .claude/skills/quiz-tts/SKILL.md docs/overview.md README.md
git commit -m "docs: add the quiz-tts skill guide and fold the design into docs/

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: ブランチを仕上げる**

superpowers:finishing-a-development-branch に従い、`claude/quiz-tts` を main にマージする（このリポジトリは `claude/<topic>` ブランチを main に直接マージしてきた）。マージ後に `npm run test:tts` と `npm test` を main で再実行する。
