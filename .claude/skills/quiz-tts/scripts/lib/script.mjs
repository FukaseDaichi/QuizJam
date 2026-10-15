export class ScriptError extends Error {
  constructor(message, line) {
    super(`${line}行目: ${message}`);
    this.line = line;
  }
}

const ID_RE = /^Q\d{2,}$/;
const KEYS = { 答え: "answer", 問題文: "prompt", 読み: "reading", style: "style" };
const ITEM_RE = /^- ([^:：]+)[:：]\s*(.*)$/;
const ALLOWED_TAGS = new Set(["short pause"]);
const MAX_PAUSES = 3;

/** 読みの問題点を警告文の配列で返す（エラーにはしない） */
export function lintReading(id, reading) {
  const warnings = [];
  if (/[『』]/.test(reading)) warnings.push(`${id}: 読みに『』が残っています（括弧は読みから外す）`);
  if (/[「」]/.test(reading)) warnings.push(`${id}: 読みに「」が残っています（括弧は読みから外し、前後に <short pause>）`);
  const tags = [...reading.matchAll(/<([^<>]+)>/g)].map((m) => m[1]);
  for (const tag of tags) {
    if (tag === "long pause") warnings.push(`${id}: <long pause> は使わない（確定ポイントのヒントになる）`);
    else if (!ALLOWED_TAGS.has(tag)) warnings.push(`${id}: <${tag}> は使わない（タグは <short pause> だけ）`);
  }
  const pauses = tags.filter((t) => t === "short pause").length;
  if (pauses > MAX_PAUSES) warnings.push(`${id}: <short pause> が ${pauses} 個あります（1〜${MAX_PAUSES} 個が目安）`);
  return warnings;
}

/** 台本 Markdown を読む。1 問 1 ブロック（## Qnn と「- キー: 値」の行） */
export function parseScript(markdown) {
  const lines = markdown.replace(/^﻿/, "").split(/\r?\n/);
  let title = "";
  const questions = [];
  const warnings = [];
  const seen = new Set();
  let current = null;

  const finish = () => {
    if (!current) return;
    if (!current.reading) {
      if (!current.prompt) throw new ScriptError(`${current.id}: 読みも問題文もありません`, current.line);
      current.reading = current.prompt;
      warnings.push(`${current.id}: 読みが無いので問題文をそのまま読みます`);
    }
    warnings.push(...lintReading(current.id, current.reading));
    questions.push(current);
    current = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const no = i + 1;
    if (!line) return;
    if (line.startsWith("## ")) {
      finish();
      const id = line.slice(3).trim();
      if (!ID_RE.test(id)) throw new ScriptError(`見出しの ID が不正です: ${id}（Q01 のように Q + 2 桁以上の数字）`, no);
      if (seen.has(id)) throw new ScriptError(`ID が重複しています: ${id}`, no);
      seen.add(id);
      current = { id, line: no, answer: "", prompt: "", reading: "", style: "" };
      return;
    }
    if (line.startsWith("# ")) {
      if (!current && questions.length === 0) title = line.slice(2).trim();
      return;
    }
    const m = ITEM_RE.exec(line);
    if (!m) throw new ScriptError(`「- キー: 値」の形ではありません: ${line}`, no);
    if (!current) throw new ScriptError("「## Q01」の見出しより前に項目があります", no);
    const key = KEYS[m[1].trim()];
    if (!key) throw new ScriptError(`不明なキーです: ${m[1].trim()}（答え・問題文・読み・style のいずれか）`, no);
    current[key] = m[2].trim();
  });
  finish();
  if (questions.length === 0) throw new ScriptError("問題がありません（## Q01 の見出しが必要です）", 1);
  return { title, questions, warnings };
}
