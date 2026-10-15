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
