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
