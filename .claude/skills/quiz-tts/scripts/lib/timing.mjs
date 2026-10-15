/**
 * 問読み音声のタイミング表を作る計算（入出力なし）。
 * Whisper の単語ごとの時刻 → 無音の明けへの寄せ → 読みの 1 文字ごとの時刻 → 表示する問題文の 1 文字ごとの時刻
 */

const DIGITS = ["", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];
const THOUSANDS = { 1: "せん", 3: "さんぜん", 8: "はっせん" };
const HUNDREDS = { 1: "ひゃく", 3: "さんびゃく", 6: "ろっぴゃく", 8: "はっぴゃく" };

/** 1〜9999 の整数の読みを桁ごとのかなに分ける（"1955" → せん・きゅうひゃく・ごじゅう・ご）。0 の桁は "" */
export function numberKanaParts(digits) {
  const len = digits.length;
  return Array.from(digits).map((ch, p) => {
    const d = Number(ch);
    const place = len - 1 - p;
    if (d === 0) return "";
    if (place === 3) return THOUSANDS[d] ?? DIGITS[d] + "せん";
    if (place === 2) return HUNDREDS[d] ?? DIGITS[d] + "ひゃく";
    if (place === 1) return d === 1 ? "じゅう" : DIGITS[d] + "じゅう";
    return DIGITS[d];
  });
}

/** 1〜9999 の整数の読み（かな） */
export function numberToKana(n) {
  return numberKanaParts(String(n)).join("");
}

/** かなに直せる数字の並び（1〜9999 で 0 始まりでない） */
const isKanaizable = (m) => !m.startsWith("0") && Number(m) >= 1 && Number(m) <= 9999;

/**
 * 読みの中の数字をかなに直す。Whisper は数字に長さ 0 を割り当てるため（「1955」が 0 秒になる）。
 * 1〜9999 の整数だけを直し、それ以外（0 始まり・5 桁以上）はそのまま残して警告する
 */
export function kanaizeNumbers(text) {
  const warnings = [];
  const out = text.replace(/\d+/g, (m) => {
    if (!isKanaizable(m)) {
      warnings.push(`読みの数字「${m}」はかなに直せないのでそのまま当てはめます（タイミングがずれていれば読みをかなで書く）`);
      return m;
    }
    return numberToKana(Number(m));
  });
  return { text: out, warnings };
}

/** 無音区間のすき間がこれ未満ならつなぐ（息継ぎなどの小さな音で割れた間） */
export const MERGE_GAP_S = 0.05;

/** ffmpeg silencedetect の出力から無音区間 [始まり, 明け]（秒）を取る。明けの無い最後の区間は捨てる */
export function parseSilences(stderr) {
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const out = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    const prev = out[out.length - 1];
    if (prev && starts[i] - prev[1] < MERGE_GAP_S) prev[1] = ends[i];
    else out.push([starts[i], ends[i]]);
  }
  return out;
}

export const SNAP_BEFORE_S = 0.3;
const SNAP_SLACK_S = 0.05;
const SNAP_MIN_GAP_S = 0.02;

/**
 * 単語の頭を、近くで明けた無音の明け（＝実際に声が出た時刻）に寄せる。Whisper は間の後で 0.1〜0.2 秒遅れる癖がある。
 * 条件: 無音の始まり ≤ 頭 + 0.05 秒、頭 − 0.3 秒 ≤ 明け ≤ 単語の終わり、明けが直前の単語の頭より 0.02 秒以上後。
 * 複数あれば頭に最も近い明け
 */
export function snapWordStarts(words, silences) {
  const out = words.map((w) => ({ ...w }));
  out.forEach((w, k) => {
    const prevStart = k > 0 ? out[k - 1].s : 0;
    const cands = silences
      .filter(([a, b]) => a <= w.s + SNAP_SLACK_S && b >= w.s - SNAP_BEFORE_S && b <= w.e && b > prevStart + SNAP_MIN_GAP_S)
      .map(([, b]) => b);
    if (cands.length) w.s = cands.reduce((best, b) => (Math.abs(b - w.s) < Math.abs(best - w.s) ? b : best));
  });
  return out;
}

/** 単語の中の文字を単語の区間に等間隔で割り振り、読みの 1 文字（コードポイント）ごとの開始時刻にする。空白は捨てる */
export function readingCharTimes(words) {
  const chars = [];
  const times = [];
  for (const w of words) {
    const cs = Array.from(w.w).filter((c) => !/\s/.test(c));
    cs.forEach((c, k) => {
      chars.push(c);
      times.push(w.s + ((w.e - w.s) * k) / cs.length);
    });
  }
  return { chars, times };
}

/** a[alo..ahi) と b[blo..bhi) で最も長く連続して一致する区間 [i, j, 長さ]。同じ長さなら a で先、次に b で先のもの */
function longestMatch(a, alo, ahi, b, blo, bhi) {
  let best = [alo, blo, 0];
  let prev = new Array(bhi - blo + 1).fill(0);
  for (let i = alo; i < ahi; i++) {
    const cur = new Array(bhi - blo + 1).fill(0);
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const k = prev[j - blo] + 1;
      cur[j - blo + 1] = k;
      if (k > best[2]) best = [i - k + 1, j - k + 1, k];
    }
    prev = cur;
  }
  return best;
}

/**
 * 2 つの文字列（コードポイントの配列）の差分を、difflib と同じ形の区間 [op, i1, i2, j1, j2] で返す。
 * difflib の SequenceMatcher と同じく、最も長く連続して一致する区間を先に決めてから左右を調べる。
 * 「の」のような 1 文字の一致を先に拾うと、表記の違う所（三葉↔ミツハ）がずれた位置に対応づくため
 */
export function diffOpcodes(a, b) {
  const blocks = [];
  const walk = (alo, ahi, blo, bhi) => {
    const [i, j, k] = longestMatch(a, alo, ahi, b, blo, bhi);
    if (k === 0) return;
    walk(alo, i, blo, j);
    blocks.push([i, j, k]);
    walk(i + k, ahi, j + k, bhi);
  };
  walk(0, a.length, 0, b.length);
  const ops = [];
  let i = 0, j = 0;
  for (const [ai, bj, k] of [...blocks, [a.length, b.length, 0]]) {
    if (i < ai && j < bj) ops.push(["replace", i, ai, j, bj]);
    else if (i < ai) ops.push(["delete", i, ai, j, j]);
    else if (j < bj) ops.push(["insert", i, i, j, bj]);
    if (k > 0) ops.push(["equal", ai, ai + k, bj, bj + k]);
    i = ai + k;
    j = bj + k;
  }
  return ops;
}

const READING_ONLY_PUNCT = new Set(["、", "。"]);

/**
 * 表示と読みの文字を対応づけ、表示の 1 文字ごとの時刻（秒）にする。
 * 一致する文字は読みの文字の時刻。置き換え（瀧↔タキ）は読みの区間に比例配分し、区間の端にある読みだけの読点は外す。
 * 表示にだけある文字（『』「」、I'll be back（）は次に読む文字と同時
 */
function mapTimes(disp, readingChars, times, endTime) {
  const at = (j) => (j < times.length ? times[j] : endTime);
  const out = new Array(disp.length).fill(0);
  for (const [op, i1, i2, j1, j2] of diffOpcodes(disp, readingChars)) {
    let b1 = j1, b2 = j2;
    if (op === "replace") {
      while (b1 < b2 - 1 && READING_ONLY_PUNCT.has(readingChars[b1])) b1++;
      while (b2 - 1 > b1 && READING_ONLY_PUNCT.has(readingChars[b2 - 1])) b2--;
    }
    for (let i = i1; i < i2; i++) {
      if (op === "equal") out[i] = at(b1 + i - i1);
      else if (op === "replace") out[i] = at(b1 + Math.floor(((i - i1) * (b2 - b1)) / (i2 - i1)));
      else if (op === "delete") out[i] = at(b1);
    }
  }
  return out;
}

/**
 * 表示する問題文の 1 文字ごとの表示時刻（秒）。前の文字より早くはしない。
 * 表示の数字は読みと同じかなに展開してから対応づけ、各桁はその桁の読み始めに出す（0 の桁は次の桁と同時）。
 * 比例配分だと「1955」の「9」が「きゅうひゃく」の途中に来てしまうため
 */
export function displayCharTimes(display, readingChars, times, endTime) {
  const disp = Array.from(display);
  const expanded = [];
  const owner = [];   // expanded[k] が表示の何文字目から来たか
  for (let i = 0; i < disp.length; ) {
    let k = i;
    while (k < disp.length && /\d/.test(disp[k])) k++;
    const run = disp.slice(i, k).join("");
    if (k > i && isKanaizable(run)) {
      numberKanaParts(run).forEach((part, p) => {
        for (const c of part) { expanded.push(c); owner.push(i + p); }
      });
      i = k;
    } else {
      expanded.push(disp[i]);
      owner.push(i);
      i++;
    }
  }
  const expandedTimes = mapTimes(expanded, readingChars, times, endTime);
  const first = new Array(disp.length).fill(-1);
  owner.forEach((o, k) => { if (first[o] < 0) first[o] = k; });
  const out = new Array(disp.length);
  for (let i = disp.length - 1, next = endTime; i >= 0; i--) {
    if (first[i] >= 0) next = expandedTimes[first[i]];
    out[i] = next;
  }
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out;
}

export const LONG_WORD_S = 1.5;

/** 読みと表記が大きく違う箇所の目安。長さ 0 の単語と長すぎる単語 */
export function wordWarnings(words) {
  const out = [];
  for (const w of words) {
    const d = w.e - w.s;
    // 1 文字の単語が長さ 0 になるのはよくあるので、2 文字以上（「1955」など）だけ挙げる
    if (d <= 0 && Array.from(w.w.trim()).length >= 2) out.push(`「${w.w.trim()}」の長さが 0 秒です（${w.s.toFixed(2)} 秒）`);
    else if (d > LONG_WORD_S) out.push(`「${w.w.trim()}」が ${d.toFixed(2)} 秒あります（${w.s.toFixed(2)} 秒〜）`);
  }
  return out;
}

/** 単語の時刻と無音区間から、問題文の各文字を出す時刻（mp3 の頭からの整数 ms）を作る */
export function computeRevealAtMs({ prompt, words, silences, offsetMs }) {
  const snapped = snapWordStarts(words, silences);
  const { chars, times } = readingCharTimes(snapped);
  const end = snapped.length ? snapped[snapped.length - 1].e : 0;
  const revealAtMs = displayCharTimes(prompt, chars, times, end).map((t) => Math.round(offsetMs + t * 1000));
  return { revealAtMs, warnings: wordWarnings(snapped) };
}
