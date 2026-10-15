import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScript, lintReading, ScriptError } from "../lib/script.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "sample-set.md"), "utf8");

test("parseScript: タイトルと問題を読む", () => {
  const { title, questions } = parseScript(fixture);
  assert.equal(title, "テスト用セット");
  assert.deepEqual(questions.map((q) => q.id), ["Q01", "Q02", "Q03"]);
  assert.equal(questions[0].answer, "『バック・トゥ・ザ・フューチャー』");
  assert.match(questions[0].reading, /^1955年にタイムスリップ/);
  assert.equal(questions[0].style, "");
  assert.equal(questions[1].style, "少し速めに");
  assert.equal(questions[0].line, 3);
});

test("parseScript: 読みが無ければ問題文を使い警告する", () => {
  const { questions, warnings } = parseScript(fixture);
  assert.equal(questions[2].reading, questions[2].prompt);
  assert.ok(warnings.some((w) => w.startsWith("Q03:") && /問題文をそのまま/.test(w)));
});

test("parseScript: CRLF と BOM", () => {
  const crlf = "﻿" + fixture.replace(/\n/g, "\r\n");
  const { questions } = parseScript(crlf);
  assert.equal(questions.length, 3);
  assert.equal(questions[0].line, 3);
  assert.equal(questions[0].answer, "『バック・トゥ・ザ・フューチャー』");
});

test("parseScript: 全角コロンも受け付ける", () => {
  const { questions } = parseScript("## Q01\n- 答え：A\n- 読み：よみ\n");
  assert.equal(questions[0].answer, "A");
  assert.equal(questions[0].reading, "よみ");
});

test("parseScript: ID が不正なら行番号つきで ScriptError", () => {
  assert.throws(() => parseScript("## Q1\n- 読み: x\n"), (e) => e instanceof ScriptError && e.line === 1 && /Q1/.test(e.message));
  assert.throws(() => parseScript("## 問題1\n- 読み: x\n"), ScriptError);
});

test("parseScript: ID 重複は ScriptError", () => {
  assert.throws(() => parseScript("## Q01\n- 読み: a\n\n## Q01\n- 読み: b\n"), (e) => e instanceof ScriptError && e.line === 4 && /重複/.test(e.message));
});

test("parseScript: 読みも問題文も無い問は ScriptError", () => {
  assert.throws(() => parseScript("## Q01\n- 答え: a\n"), (e) => e instanceof ScriptError && /Q01/.test(e.message));
});

test("parseScript: 不明なキー・形式外の行・見出し前の項目は ScriptError", () => {
  assert.throws(() => parseScript("## Q01\n- よみ: x\n"), (e) => e instanceof ScriptError && e.line === 2 && /不明なキー/.test(e.message));
  assert.throws(() => parseScript("## Q01\n読み: x\n"), (e) => e instanceof ScriptError && e.line === 2);
  assert.throws(() => parseScript("- 読み: x\n## Q01\n- 読み: y\n"), (e) => e instanceof ScriptError && e.line === 1);
});

test("parseScript: 問題が 1 つも無ければ ScriptError", () => {
  assert.throws(() => parseScript("# タイトルだけ\n"), ScriptError);
});

test("lintReading: 括弧・余計なタグ・ポーズの数を警告する", () => {
  assert.deepEqual(lintReading("Q01", "映画は、何でしょう？<short pause>"), []);
  const w1 = lintReading("Q02", "映画『タイタニック』で「ジャック」を演じた俳優は？");
  assert.ok(w1.some((w) => /『』/.test(w)) && w1.some((w) => /「」/.test(w)));
  assert.ok(lintReading("Q03", "a<long pause>b").some((w) => /long pause/.test(w)));
  assert.ok(lintReading("Q04", "a<laugh>b").some((w) => /<laugh>/.test(w)));
  assert.ok(lintReading("Q05", "a<short pause>b<short pause>c<short pause>d<short pause>e").some((w) => /4 個/.test(w)));
});

test("parseScript: lint の警告も warnings に入る", () => {
  const { warnings } = parseScript("## Q01\n- 読み: 『x』\n");
  assert.ok(warnings.some((w) => w.startsWith("Q01:") && /『』/.test(w)));
});
