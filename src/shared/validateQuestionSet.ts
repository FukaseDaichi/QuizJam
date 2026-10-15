import type { IntroSlide, Question, QuestionAudio, QuestionSet, QuestionSetMode, QuestionSettings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";
import { promptLength } from "./buzzer";

export type QuestionSetInput = Omit<QuestionSet, "id">;

const TIMER_MODES = new Set(["fixed", "afterFirstCorrect", "none"]);
const MODES = new Set<QuestionSetMode>(["anagram", "buzzer"]);

export const MIN_CHARS_PER_SECOND = 1;
export const MAX_CHARS_PER_SECOND = 30;

export function isValidCharsPerSecond(x: unknown): x is number {
  return Number.isInteger(x) && (x as number) >= MIN_CHARS_PER_SECOND && (x as number) <= MAX_CHARS_PER_SECOND;
}

/** 画像 URL は自サーバーの /api/images/<key> か https のみ許可する */
export function isValidImageUrl(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 500 && (/^\/api\/images\/[A-Za-z0-9._-]+$/.test(x) || /^https:\/\//.test(x));
}

/** 音声 URL は自サーバーの /api/audio/<key> か https のみ許可する */
export function isValidAudioUrl(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 500 && (/^\/api\/audio\/[A-Za-z0-9._-]+$/.test(x) || /^https:\/\//.test(x));
}

export const MAX_REVEAL_AT_MS = 600_000;

/** revealAtMs は問題文の文字数（コードポイント）と同じ長さで、0〜MAX_REVEAL_AT_MS の整数が前の要素以上で並ぶ */
function validateAudio(x: unknown, prompt: string): QuestionAudio | { error: string } {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return { error: "audio invalid" };
  const o = x as Record<string, unknown>;
  if (!isValidAudioUrl(o.url)) return { error: "audio.url invalid" };
  const r = o.revealAtMs;
  const ok = Array.isArray(r) && r.length === promptLength(prompt)
    && r.every((t, i) => Number.isInteger(t) && t >= 0 && t <= MAX_REVEAL_AT_MS && (i === 0 || t >= r[i - 1]));
  if (!ok) return { error: "audio.revealAtMs invalid" };
  return { url: o.url, revealAtMs: r as number[] };
}

export function isValidColor(x: unknown): x is string {
  return typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x);
}

function optionalImageUrl(x: unknown, field: string): string | undefined | { error: string } {
  if (x === undefined || x === null || x === "") return undefined;
  return isValidImageUrl(x) ? x : { error: `${field} invalid` };
}

export const MAX_INTRO_SLIDES = 20;

/** 省略・空白だけは undefined。文字列でないか長すぎれば null。前後の空白は除く */
function optionalText(x: unknown, max: number): string | undefined | null {
  if (x === undefined || x === null) return undefined;
  if (typeof x !== "string" || x.length > max) return null;
  const t = x.trim();
  return t ? t : undefined;
}

function validateIntroSlides(x: unknown): IntroSlide[] | { error: string } {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) return { error: "introSlides must be an array" };
  if (x.length > MAX_INTRO_SLIDES) return { error: `introSlides must have at most ${MAX_INTRO_SLIDES} items` };
  const out: IntroSlide[] = [];
  for (const [i, s] of (x as unknown[]).entries()) {
    if (typeof s !== "object" || s === null) return { error: `introSlides[${i}] invalid` };
    const o = s as Record<string, unknown>;
    const heading = optionalText(o.heading, 100);
    if (heading === null) return { error: `introSlides[${i}].heading invalid` };
    const body = optionalText(o.body, 1000);
    if (body === null) return { error: `introSlides[${i}].body invalid` };
    const imageUrl = optionalImageUrl(o.imageUrl, "imageUrl");
    if (typeof imageUrl === "object") return { error: `introSlides[${i}].${imageUrl.error}` };
    if (!heading && !body && !imageUrl) return { error: `introSlides[${i}] is empty` };
    out.push({ id: typeof o.id === "string" && o.id ? o.id : crypto.randomUUID(), heading, body, imageUrl });
  }
  return out;
}

function validateSettings(x: unknown, partial: boolean): QuestionSettings | Partial<QuestionSettings> | { error: string } {
  if (typeof x !== "object" || x === null) return { error: "settings must be an object" };
  const o = x as Record<string, unknown>;
  const out: Partial<QuestionSettings> = {};
  if ("timerMode" in o) { if (!TIMER_MODES.has(o.timerMode as string)) return { error: "settings.timerMode invalid" }; out.timerMode = o.timerMode as QuestionSettings["timerMode"]; }
  if ("timerSeconds" in o) { if (typeof o.timerSeconds !== "number" || o.timerSeconds < 0) return { error: "settings.timerSeconds invalid" }; out.timerSeconds = o.timerSeconds; }
  if ("basePoints" in o) { if (typeof o.basePoints !== "number") return { error: "settings.basePoints invalid" }; out.basePoints = o.basePoints; }
  if ("rankBonus" in o) { if (!Array.isArray(o.rankBonus) || !o.rankBonus.every((n) => typeof n === "number")) return { error: "settings.rankBonus invalid" }; out.rankBonus = o.rankBonus as number[]; }
  if ("wrongPenalty" in o) { if (typeof o.wrongPenalty !== "number") return { error: "settings.wrongPenalty invalid" }; out.wrongPenalty = o.wrongPenalty; }
  if ("maxAttempts" in o) { if (o.maxAttempts !== null && (typeof o.maxAttempts !== "number" || o.maxAttempts < 1)) return { error: "settings.maxAttempts invalid" }; out.maxAttempts = o.maxAttempts as number | null; }
  if ("charsPerSecond" in o) { if (!isValidCharsPerSecond(o.charsPerSecond)) return { error: "settings.charsPerSecond invalid" }; out.charsPerSecond = o.charsPerSecond; }
  return partial ? out : { ...DEFAULT_SETTINGS, ...out };
}

export function validateQuestionSetInput(x: unknown): QuestionSetInput | { error: string } {
  if (typeof x !== "object" || x === null) return { error: "body must be an object" };
  const o = x as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.trim().length === 0) return { error: "name is required" };
  let mode: QuestionSetMode | undefined;
  if (o.mode !== undefined && o.mode !== null) {
    if (!MODES.has(o.mode as QuestionSetMode)) return { error: "mode invalid" };
    if (o.mode === "buzzer") mode = "buzzer";   // anagram は既定なので省略する
  }
  const settings = validateSettings(o.settings ?? {}, false);
  if ("error" in settings) return settings;
  const coverImageUrl = optionalImageUrl(o.coverImageUrl, "coverImageUrl");
  if (typeof coverImageUrl === "object") return coverImageUrl;
  const slideBackground = o.slideBackground === undefined || o.slideBackground === null || o.slideBackground === "" ? undefined : o.slideBackground;
  if (slideBackground !== undefined && !isValidColor(slideBackground)) return { error: "slideBackground invalid" };
  const introSlides = validateIntroSlides(o.introSlides);
  if (!Array.isArray(introSlides)) return introSlides;
  if (!Array.isArray(o.questions)) return { error: "questions must be an array" };
  const questions: Question[] = [];
  for (const [i, q] of (o.questions as unknown[]).entries()) {
    if (typeof q !== "object" || q === null) return { error: `questions[${i}] invalid` };
    const qq = q as Record<string, unknown>;
    const imageUrl = optionalImageUrl(qq.imageUrl, "imageUrl");
    if (typeof imageUrl === "object") return { error: `questions[${i}].${imageUrl.error}` };
    const explanationImageUrl = optionalImageUrl(qq.explanationImageUrl, "explanationImageUrl");
    if (typeof explanationImageUrl === "object") return { error: `questions[${i}].${explanationImageUrl.error}` };
    // 出題文は画像があれば省略できる（画像の中に文字が描かれている問題）
    if (qq.prompt !== undefined && typeof qq.prompt !== "string") return { error: `questions[${i}].prompt invalid` };
    const prompt = typeof qq.prompt === "string" ? qq.prompt.trim() : "";
    // 早押しは読み上げる文章が要るので、画像があっても問題文を省略できない
    if (prompt.length === 0 && (mode === "buzzer" || !imageUrl)) return { error: `questions[${i}].prompt is required` };
    if (!Array.isArray(qq.answers) || qq.answers.length === 0 || !qq.answers.every((a) => typeof a === "string" && a.length > 0)) {
      return { error: `questions[${i}].answers must be a non-empty string array` };
    }
    let overrides: Partial<QuestionSettings> | undefined;
    if (qq.overrides !== undefined) {
      const v = validateSettings(qq.overrides, true);
      if ("error" in v) return { error: `questions[${i}].${v.error}` };
      overrides = v;
    }
    // 問読み音声は早押しでだけ使う。ほかのモードでは保存しない
    let audio: QuestionAudio | undefined;
    if (mode === "buzzer" && qq.audio !== undefined && qq.audio !== null) {
      const a = validateAudio(qq.audio, prompt);
      if ("error" in a) return { error: `questions[${i}].${a.error}` };
      audio = a;
    }
    questions.push({
      id: typeof qq.id === "string" && qq.id ? qq.id : crypto.randomUUID(),
      type: "anagram",
      prompt,
      answers: qq.answers as string[],
      hint: typeof qq.hint === "string" && qq.hint ? qq.hint : undefined,
      imageUrl,
      explanationImageUrl,
      overrides,
      audio,
    });
  }
  return {
    name: o.name.trim(), mode, coverImageUrl, slideBackground,
    introSlides: introSlides.length ? introSlides : undefined,
    settings: settings as QuestionSettings, questions,
  };
}
