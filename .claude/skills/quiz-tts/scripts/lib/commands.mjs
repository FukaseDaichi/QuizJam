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
