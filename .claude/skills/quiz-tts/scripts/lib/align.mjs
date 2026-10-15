import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { wavInfo } from "./wav.mjs";
import { CommandError, loadSet, mondaiPath, rel, selectQuestions, setDir } from "./commands.mjs";
import { computeRevealAtMs, kanaizeNumbers } from "./timing.mjs";

export function emptyTiming(set) {
  return { version: 1, set, entries: {} };
}

export function readTiming(file, set) {
  if (!fs.existsSync(file)) return emptyTiming(set);
  const t = JSON.parse(fs.readFileSync(file, "utf8"));
  if (t?.version !== 1 || typeof t.entries !== "object" || t.entries === null) throw new Error(`timing.json の形式が不明です: ${file}`);
  return t;
}

/** entries を ID 順に並べて書く */
export function writeTiming(file, timing) {
  const entries = Object.fromEntries(Object.entries(timing.entries).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...timing, entries }) + "\n");
}

/** 表示する問題文と mp3 が作ったときと同じなら、やり直さなくてよい */
export function isTimingFresh(entry, prompt, mp3Sha256) {
  return !!entry && entry.prompt === prompt && entry.mp3Sha256 === mp3Sha256;
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** question-sets/<set>.json を読み、問題 ID → 表示する問題文 */
export function loadQuestionSetPrompts(ctx, setName) {
  const file = path.resolve(ctx.root, ctx.config.questionSetsDir, `${setName}.json`);
  if (!fs.existsSync(file)) throw new CommandError(`問題セットがありません: ${rel(ctx, file)}`);
  let set;
  try {
    set = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new CommandError(`${rel(ctx, file)} を読めません: ${err.message}`);
  }
  if (!Array.isArray(set?.questions)) throw new CommandError(`${rel(ctx, file)} に questions がありません`);
  return new Map(set.questions.filter((q) => typeof q?.id === "string").map((q) => [q.id, typeof q.prompt === "string" ? q.prompt.trim() : ""]));
}

/**
 * 各問の Qnn.wav に台本の読みを強制アライメントし、問題セットの問題文の 1 文字ごとの表示時刻を timing.json に書く。
 * 時刻は Qnn.full.mp3 の頭（「問題！」の頭）からの ms。問題文と mp3 が前回と同じ問は飛ばす
 */
export async function runAlign(ctx, { setName, only = [], force = false } = {}) {
  if (!setName) throw new CommandError("セット名を指定してください: align <セット名>");
  const mondai = mondaiPath(ctx);
  if (!fs.existsSync(mondai)) throw new CommandError(`${rel(ctx, mondai)} がありません。先に mondai を実行してください`);
  if (!ctx.ffmpegAvailable()) throw new CommandError("ffmpeg が見つかりません（無音の検出に使う。https://ffmpeg.org/ から入れて PATH を通す）");
  const { questions } = loadSet(ctx, setName);
  const targets = selectQuestions(questions, only);
  const prompts = loadQuestionSetPrompts(ctx, setName);
  const dir = setDir(ctx, setName);
  const timingFile = path.join(dir, "timing.json");
  const timing = readTiming(timingFile, setName);
  const offsetMs = wavInfo(fs.readFileSync(mondai)).durationMs + ctx.config.pauseMs;
  const result = { aligned: [], skipped: [], failed: [], warnings: [], pruned: [] };

  const jobs = [];
  for (const q of targets) {
    const prompt = prompts.get(q.id);
    if (prompt === undefined) {
      result.failed.push({ id: q.id, error: `問題セットに ${q.id} がありません` });
      continue;
    }
    if (q.prompt && q.prompt !== prompt) result.warnings.push(`${q.id}: 台本の問題文と問題セットの prompt が違います（問題セットの prompt に合わせます）`);
    const wav = path.join(dir, `${q.id}.wav`);
    const mp3 = path.join(dir, `${q.id}.full.mp3`);
    if (!fs.existsSync(wav) || !fs.existsSync(mp3)) {
      result.failed.push({ id: q.id, error: "WAV か mp3 がありません。先に build と join を実行してください" });
      continue;
    }
    const mp3Sha256 = sha256File(mp3);
    if (!force && isTimingFresh(timing.entries[q.id], prompt, mp3Sha256)) {
      result.skipped.push(q.id);
      continue;
    }
    const { text, warnings } = kanaizeNumbers(q.reading.replace(/<[^<>]+>/g, ""));
    for (const w of warnings) result.warnings.push(`${q.id}: ${w}`);
    jobs.push({ id: q.id, prompt, wav, mp3Sha256, text });
  }

  if (jobs.length > 0) {
    if (!ctx.uvAvailable()) {
      ctx.log("エラー: uv が見つかりません。https://docs.astral.sh/uv/ の手順で入れてから、もう一度 align を実行してください");
      return { ...result, noUv: true };
    }
    let words = {};
    try {
      words = await ctx.alignWords(jobs.map(({ id, wav, text }) => ({ id, wav, text })));
    } catch (err) {
      for (const j of jobs) result.failed.push({ id: j.id, error: err.message });
    }
    for (const j of jobs) {
      const w = words[j.id];
      if (!w) continue;
      if (!Array.isArray(w)) {
        result.failed.push({ id: j.id, error: w.error ?? "単語の時刻を取れませんでした" });
        continue;
      }
      const { revealAtMs, warnings } = computeRevealAtMs({ prompt: j.prompt, words: w, silences: ctx.detectSilences(j.wav), offsetMs });
      for (const msg of warnings) result.warnings.push(`${j.id}: ${msg}`);
      timing.entries[j.id] = { prompt: j.prompt, mp3Sha256: j.mp3Sha256, revealAtMs };
      result.aligned.push(j.id);
      ctx.log(`${j.id}: 揃え`);
    }
  }

  // 台本から消えた問は外す（--only で絞ったときは判断できないので触らない）
  if (only.length === 0) {
    const ids = new Set(questions.map((q) => q.id));
    for (const id of Object.keys(timing.entries)) {
      if (ids.has(id)) continue;
      delete timing.entries[id];
      result.pruned.push(id);
    }
  }
  if (result.aligned.length > 0 || result.pruned.length > 0) writeTiming(timingFile, timing);

  for (const key of ["aligned", "skipped", "pruned"]) result[key].sort();
  result.failed.sort((a, b) => a.id.localeCompare(b.id));
  ctx.log(`揃え ${result.aligned.length} / 変更なし ${result.skipped.length} / 失敗 ${result.failed.length}`);
  for (const w of result.warnings) ctx.log(`警告: ${w}`);
  for (const f of result.failed) ctx.log(`失敗: ${f.id}: ${f.error}`);
  return result;
}
