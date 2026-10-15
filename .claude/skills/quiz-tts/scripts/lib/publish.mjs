import fs from "node:fs";
import path from "node:path";
import { CommandError, rel, setDir } from "./commands.mjs";
import { isTimingFresh, readTiming, sha256File } from "./align.mjs";

/** JSON の値を 1 行で書く（{ "k": v } と [a, b]） */
function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}

/** 問題セット JSON を「1 問 1 行」で書く（question-sets/*.json の書式） */
export function formatQuestionSet(set) {
  const lines = Object.entries(set)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (k === "questions" && Array.isArray(v) && v.length > 0) {
        return `  "questions": [\n${v.map((q) => `    ${inline(q)}`).join(",\n")}\n  ]`;
      }
      return `  ${JSON.stringify(k)}: ${inline(v)}`;
    });
  return `{\n${lines.join(",\n")}\n}\n`;
}

/**
 * Qnn.full.mp3 をアプリの /api/audio に上げ、question-sets/<set>.json の各問に audio（url と revealAtMs）を書き込む。
 * timing.json が古い・無い問が 1 つでもあれば何も上げない。アップロードに失敗した問があれば問題セットは書き換えない
 */
export async function runPublish(ctx, { setName, baseUrl, passphrase } = {}) {
  if (!setName) throw new CommandError("セット名を指定してください: publish <セット名>");
  const setFile = path.resolve(ctx.root, ctx.config.questionSetsDir, `${setName}.json`);
  if (!fs.existsSync(setFile)) throw new CommandError(`問題セットがありません: ${rel(ctx, setFile)}`);
  let set;
  try {
    set = JSON.parse(fs.readFileSync(setFile, "utf8"));
  } catch (err) {
    throw new CommandError(`${rel(ctx, setFile)} を読めません: ${err.message}`);
  }
  if (!Array.isArray(set?.questions)) throw new CommandError(`${rel(ctx, setFile)} に questions がありません`);
  const dir = setDir(ctx, setName);
  const timing = readTiming(path.join(dir, "timing.json"), setName);
  const result = { published: [], stale: [], failed: [] };

  const jobs = [];
  for (const q of set.questions) {
    const mp3 = path.join(dir, `${q.id}.full.mp3`);
    const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
    const entry = timing.entries[q.id];
    if (!fs.existsSync(mp3) || !isTimingFresh(entry, prompt, sha256File(mp3))) {
      result.stale.push(q.id);
      continue;
    }
    jobs.push({ q, mp3, revealAtMs: entry.revealAtMs });
  }
  if (result.stale.length > 0) {
    ctx.log(`timing.json が古いか無い問があるので、何も上げていません: ${result.stale.join(", ")}（先に join と align を実行してください）`);
    return result;
  }

  for (const j of jobs) {
    try {
      const res = await ctx.fetch(`${baseUrl}/api/audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${passphrase}`, "Content-Type": "audio/mpeg" },
        body: fs.readFileSync(j.mp3),
      });
      if (!res.ok) throw new Error(`アップロードに失敗しました（HTTP ${res.status}）`);
      const { url } = await res.json();
      j.q.audio = { url, revealAtMs: j.revealAtMs };
      result.published.push(j.q.id);
      ctx.log(`${j.q.id}: ${url}`);
    } catch (err) {
      result.failed.push({ id: j.q.id, error: err.message });
    }
  }
  if (result.failed.length > 0) {
    for (const f of result.failed) ctx.log(`失敗: ${f.id}: ${f.error}`);
    ctx.log(`${rel(ctx, setFile)} は書き換えていません`);
    return result;
  }
  fs.writeFileSync(setFile, formatQuestionSet(set));
  ctx.log(`${rel(ctx, setFile)} に ${result.published.length} 問分の音声を書き込みました`);
  ctx.log("管理画面で問題セットの編集画面を開き、「インポート」でこのファイルを読み込んで保存してください");
  return result;
}
