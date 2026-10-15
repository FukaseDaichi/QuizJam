import { test } from "node:test";
import assert from "node:assert/strict";
import {
  numberToKana, kanaizeNumbers, parseSilences, snapWordStarts, readingCharTimes,
  diffOpcodes, displayCharTimes, wordWarnings, computeRevealAtMs,
} from "../lib/timing.mjs";

test("numberToKana: 1〜9999 を読みのかなにする（音便を含む）", () => {
  assert.equal(numberToKana(1955), "せんきゅうひゃくごじゅうご");
  assert.equal(numberToKana(2016), "にせんじゅうろく");
  assert.equal(numberToKana(1), "いち");
  assert.equal(numberToKana(10), "じゅう");
  assert.equal(numberToKana(300), "さんびゃく");
  assert.equal(numberToKana(600), "ろっぴゃく");
  assert.equal(numberToKana(800), "はっぴゃく");
  assert.equal(numberToKana(3000), "さんぜん");
  assert.equal(numberToKana(8000), "はっせん");
  assert.equal(numberToKana(1999), "せんきゅうひゃくきゅうじゅうきゅう");
});

test("kanaizeNumbers: 数字の並びをかなに直し、直せない数字は残して警告する", () => {
  assert.deepEqual(kanaizeNumbers("1955年に2016年"), { text: "せんきゅうひゃくごじゅうご年ににせんじゅうろく年", warnings: [] });
  const big = kanaizeNumbers("人口12345人と007");
  assert.equal(big.text, "人口12345人と007");
  assert.equal(big.warnings.length, 2);
  assert.match(big.warnings[0], /12345/);
  assert.match(big.warnings[1], /007/);
});

test("parseSilences: silencedetect の出力から無音区間を取り、0.05 秒未満のすき間はつなぐ", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 0",
    "[silencedetect @ 0x1] silence_end: 0.225958 | silence_duration: 0.225958",
    "[silencedetect @ 0x1] silence_start: 3.834208",
    "[silencedetect @ 0x1] silence_end: 4.252583 | silence_duration: 0.418375",
    "[silencedetect @ 0x1] silence_start: 4.254042",
    "[silencedetect @ 0x1] silence_end: 4.903 | silence_duration: 0.648958",
    "[silencedetect @ 0x1] silence_start: 16.57",
  ].join("\n");
  assert.deepEqual(parseSilences(stderr), [[0, 0.225958], [3.834208, 4.903]]);
});

test("snapWordStarts: 頭の 0.3 秒前〜単語の中で無音が明けていれば、頭を明けに寄せる", () => {
  const words = [
    { w: "東", s: 0.36, e: 0.36 },   // 冒頭の無音 0〜0.226 の明けへ
    { w: "京", s: 0.36, e: 0.72 },   // 直前の頭 + 0.02 以下の明けは使わない
    { w: "山", s: 4.94, e: 5.14 },   // 3.83〜4.90 の明けへ
    { w: "ア", s: 14.78, e: 15.08 }, // 頭が無音 14.82〜14.95 の直前 → 明けへ
    { w: "何", s: 16.5, e: 16.6 },   // 0.3 秒より前に明けた無音は使わない
  ];
  const silences = [[0, 0.226], [3.83, 4.9], [14.82, 14.95], [15.8, 16.1]];
  assert.deepEqual(snapWordStarts(words, silences).map((w) => w.s), [0.226, 0.36, 4.9, 14.95, 16.5]);
  assert.equal(words[0].s, 0.36, "元の配列は変えない");
});

test("readingCharTimes: 単語の中の文字を区間に等間隔で割り振り、空白は捨てる", () => {
  const r = readingCharTimes([{ w: " 東", s: 0, e: 0.4 }, { w: "京に", s: 0.4, e: 0.8 }]);
  assert.deepEqual(r.chars, ["東", "京", "に"]);
  assert.deepEqual(r.times, [0, 0.4, 0.6000000000000001]);
});

test("diffOpcodes: 一致・置き換え・削除・挿入の区間を返す", () => {
  assert.deepEqual(diffOpcodes([..."abcd"], [..."abxd"]), [["equal", 0, 2, 0, 2], ["replace", 2, 3, 2, 3], ["equal", 3, 4, 3, 4]]);
  assert.deepEqual(diffOpcodes([..."xab"], [..."ab"]), [["delete", 0, 1, 0, 0], ["equal", 1, 3, 0, 2]]);
  assert.deepEqual(diffOpcodes([..."ab"], [..."a、b"]), [["equal", 0, 1, 0, 1], ["insert", 1, 1, 1, 2], ["equal", 1, 2, 2, 3]]);
});

test("displayCharTimes: 一致する文字は読みの時刻、表記の違う所は比例配分", () => {
  const reading = [..."男子のタキと"];
  const times = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  assert.deepEqual(displayCharTimes("男子・瀧と", reading, times, 1.2), [0, 0.2, 0.4, 0.6, 1.0]);
});

test("displayCharTimes: よく出る文字（の）は長く連続して一致する所に合わせる（「生・三葉の体」↔「生のミツハの体」）", () => {
  const reading = [..."生のミツハの体"];
  const times = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
  // 「の」を読みの 1 つ目（0.2）に合わせると「三葉の」がまとめて早く出てしまう
  assert.deepEqual(displayCharTimes("生・三葉の体", reading, times, 1.4), [0, 0.2, 0.4, 0.6, 1.0, 1.2]);
});

test("displayCharTimes: 表示の数字は読みと同じかなに直して対応づけ、各桁はその桁の読み始めに出す", () => {
  const reading = [..."せんきゅうひゃくごじゅうご年"];
  const times = reading.map((_, k) => k / 10);
  // 1→せん 9→きゅうひゃく 5→ごじゅう 5→ご
  assert.deepEqual(displayCharTimes("1955年", reading, times, 2), [0, 0.2, 0.8, 1.2, 1.3]);
  const r2 = [..."にせんじゅうろく年"];
  // 2→にせん 0→（読まない。次の桁と同時） 1→じゅう 6→ろく
  assert.deepEqual(displayCharTimes("2016年", r2, r2.map((_, k) => k / 10), 2), [0, 0.3, 0.3, 0.6, 0.8]);
});

test("displayCharTimes: 読みにだけある読点は置き換え区間の端から外す（「監督の、新海まこと」）", () => {
  const reading = [..."の、まこと監"];
  const times = [0, 0.3, 1.0, 1.2, 1.4, 1.6];
  // 「誠」は「、」(0.3) ではなく「ま」(1.0) から
  assert.deepEqual(displayCharTimes("の誠監", reading, times, 2), [0, 1.0, 1.6]);
});

test("displayCharTimes: 表示にだけある文字は次に読む文字と同時に出す（「I'll be back」）", () => {
  const reading = [..."アイ、の"];
  const times = [0.3, 0.5, 0.8, 1.2];
  assert.deepEqual(displayCharTimes("「Ib（アイ）」の", reading, times, 1.5), [0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 0.8, 0.8, 1.2]);
});

test("displayCharTimes: 表示の末尾が読みより長ければ終わりの時刻、前の文字より早くはならない", () => {
  assert.deepEqual(displayCharTimes("あいう？", [..."あいう"], [0, 0.5, 0.4], 0.9), [0, 0.5, 0.5, 0.9]);
});

test("wordWarnings: 2 文字以上で長さ 0 の単語と 1.5 秒を超える単語を挙げる（1 文字の長さ 0 はよくあるので挙げない）", () => {
  const w = wordWarnings([{ w: " 1955", s: 0.2, e: 0.2 }, { w: "東", s: 0.2, e: 0.2 }, { w: "京", s: 0.2, e: 0.5 }, { w: "年", s: 1, e: 2.6 }]);
  assert.equal(w.length, 2);
  assert.match(w[0], /1955/);
  assert.match(w[1], /年/);
});

test("computeRevealAtMs: 寄せ・対応づけ・オフセットをまとめて整数 ms にする", () => {
  const r = computeRevealAtMs({
    prompt: "瀧と山",
    words: [{ w: "タキ", s: 0.4, e: 0.8 }, { w: "と、", s: 0.8, e: 1.0 }, { w: "山", s: 1.6, e: 1.9 }],
    silences: [[0, 0.3], [1.0, 1.5]],
    offsetMs: 2000,
  });
  assert.deepEqual(r.revealAtMs, [2300, 2800, 3500]);
  assert.deepEqual(r.warnings, []);
});
