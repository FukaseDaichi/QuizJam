#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { requireApiKey, EnvError } from "./lib/env.mjs";
import { loadConfig, ConfigError } from "./lib/config.mjs";
import { synthesize } from "./lib/gemini.mjs";
import { ScriptError } from "./lib/script.mjs";
import { CommandError, runMondai, runVoices, runBuild } from "./lib/commands.mjs";

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
    case "build": {
      withKey();
      const r = await runBuild(ctx, { setName, only: values.only ?? [], force: values.force });
      return r.failed.length > 0 ? 1 : 0;
    }
    case "join":
      console.error("join は未実装です");
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
