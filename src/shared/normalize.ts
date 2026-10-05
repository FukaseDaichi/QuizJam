// 先頭の "-" はリテラル（文字クラスの範囲と解釈されない位置に置く）
const LONG_VOWEL = /[-ー－‐‑‒–—−]/g;

function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

export function normalizeAnswer(text: string): string {
  // NFKC: 全角英数→半角、半角カナ→全角カナ、結合濁点→合成済み
  let s = text.normalize("NFKC");
  s = s.replace(/^[\s　]+|[\s　]+$/g, "");
  s = katakanaToHiragana(s);
  s = s.replace(LONG_VOWEL, "ー");
  return s;
}

export function isCorrect(text: string, answers: string[]): boolean {
  const n = normalizeAnswer(text);
  if (n.length === 0) return false;
  return answers.some((a) => normalizeAnswer(a) === n);
}
