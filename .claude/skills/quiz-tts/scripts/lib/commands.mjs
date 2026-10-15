import fs from "node:fs";
import path from "node:path";
import { wavInfo } from "./wav.mjs";
import { parseScript } from "./script.mjs";
import { entryHash, readManifest, writeManifest, needsBuild } from "./manifest.mjs";
import { runPool } from "./pool.mjs";

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
