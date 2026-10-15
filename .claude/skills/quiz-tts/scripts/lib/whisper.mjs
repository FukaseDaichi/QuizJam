import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Python 側（stable-ts + Whisper）の uv プロジェクト */
export const ALIGN_PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "align");

/** small が medium より間の後の外れが少なかった（設計時のスパイク） */
export const WHISPER_MODEL = "small";

export function uvAvailable() {
  return spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * 読みを音声に強制アライメントして単語ごとの時刻を返す。モデルは 1 回だけ読み込む。
 * jobs: [{ id, wav, text }] → { [id]: [{ w, s, e }] | { error } }（秒）。
 * 初回は uv が仮想環境を作り、Whisper のモデルをダウンロードする。その進み具合は標準エラーにそのまま出す
 */
export function alignWords(jobs, { project = ALIGN_PROJECT, model = WHISPER_MODEL } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--project", project, "python", path.join(project, "align.py"), "--model", model], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", (err) => reject(new Error(`uv を実行できません: ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`align.py が失敗しました（終了コード ${code}）`));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(new Error(`align.py の出力を読めません: ${err.message}`));
      }
    });
    child.stdin.end(JSON.stringify(jobs));
  });
}
