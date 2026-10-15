import { spawnSync } from "node:child_process";

/**
 * 確認用動画（preview）の字幕と ffmpeg 呼び出し。
 * 問題文を ASS のカラオケ（{\kNN}）で 1 文字ずつ出し、Qnn.full.mp3 と重ねて mp4 にする。
 * カラオケは各文字の頭で一瞬で色が変わる（\k）ので、未表示の色（SecondaryColour）を透明にすれば「表示時刻に現れる」になる
 */

/** 1 行の文字数。1280px 幅・44px の全角でおさまる */
export const PREVIEW_CHARS_PER_LINE = 26;

/** 最後の文字の \k（センチ秒）。表示されたまま残ればよいので長さは何でもよい */
const LAST_CHAR_CS = 300;

/** ASS の上書きブロックの記号は全角にして、そのまま文字として見せる */
const escapeAss = (s) => Array.from(s, (c) => ({ "{": "｛", "}": "｝", "\\": "＼" })[c] ?? c).join("");

/** revealAtMs（mp3 の頭からの ms）どおりに問題文が現れる ASS 字幕 */
export function buildPreviewAss({ title, prompt, revealAtMs, font }) {
  const chars = Array.from(prompt);
  const cs = revealAtMs.map((ms) => Math.round(ms / 10));
  let body = `{\\pos(60,140)}{\\k${cs[0] ?? 0}}`;
  chars.forEach((c, i) => {
    const k = i + 1 < cs.length ? cs[i + 1] - cs[i] : LAST_CHAR_CS;
    body += `{\\k${k}}${escapeAss(c)}`;
    if ((i + 1) % PREVIEW_CHARS_PER_LINE === 0 && i + 1 < chars.length) body += "\\N";
  });
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: K,${font},44,&H00FFFFFF,&HFF000000,&HFF000000,&HFF000000,1,0,0,0,100,100,0,0,1,0,0,7,60,60,0,1`,
    `Style: L,${font},24,&H0094A3B8,&H0094A3B8,&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,7,60,60,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,9:59:59.00,L,,0,0,0,,{\\pos(60,60)}${escapeAss(title)}`,
    `Dialogue: 0,0:00:00.00,9:59:59.00,K,,0,0,0,,${body}`,
    "",
  ].join("\n");
}

/** 単色の背景に字幕を焼き込み、mp3 を付けて音声の長さで切る ffmpeg の引数。ass と out は作業ディレクトリからの相対パス */
export function previewArgs({ mp3, ass, out }) {
  return [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x0f172a:s=1280x720:r=30",
    "-i", mp3,
    "-vf", `subtitles=${ass}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    out,
  ];
}

/**
 * dir で ffmpeg を動かして mp4 を作る。
 * subtitles フィルタの引数は Windows のドライブ文字（C:）の「:」がフィルタの区切りと衝突するので、作業ディレクトリからの相対パスで渡す
 */
export function renderPreview({ dir, mp3, ass, out }) {
  const r = spawnSync("ffmpeg", previewArgs({ mp3, ass, out }), { cwd: dir, encoding: "utf8" });
  if (r.error) throw new Error(`ffmpeg を実行できません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg が失敗しました: ${(r.stderr || "").trim().slice(-500)}`);
}
