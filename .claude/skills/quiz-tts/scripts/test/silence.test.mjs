import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { detectSilences } from "../lib/silence.mjs";
import { tmpDir } from "./helpers.mjs";

test("detectSilences: 渡された ffmpeg を使う", () => {
  assert.throws(() => detectSilences("q.wav", path.join(tmpDir(), "no-ffmpeg")), /ffmpeg を実行できません/);
});
