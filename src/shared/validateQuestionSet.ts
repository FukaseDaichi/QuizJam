import type { Question, QuestionSet, QuestionSettings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";

export type QuestionSetInput = Omit<QuestionSet, "id">;

const TIMER_MODES = new Set(["fixed", "afterFirstCorrect", "none"]);

/** 画像 URL は自サーバーの /api/images/<key> か https のみ許可する */
export function isValidImageUrl(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 500 && (/^\/api\/images\/[A-Za-z0-9._-]+$/.test(x) || /^https:\/\//.test(x));
}

export function isValidColor(x: unknown): x is string {
  return typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x);
}

function optionalImageUrl(x: unknown, field: string): string | undefined | { error: string } {
  if (x === undefined || x === null || x === "") return undefined;
  return isValidImageUrl(x) ? x : { error: `${field} invalid` };
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
  return partial ? out : { ...DEFAULT_SETTINGS, ...out };
}

export function validateQuestionSetInput(x: unknown): QuestionSetInput | { error: string } {
  if (typeof x !== "object" || x === null) return { error: "body must be an object" };
  const o = x as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.trim().length === 0) return { error: "name is required" };
  const settings = validateSettings(o.settings ?? {}, false);
  if ("error" in settings) return settings;
  const coverImageUrl = optionalImageUrl(o.coverImageUrl, "coverImageUrl");
  if (typeof coverImageUrl === "object") return coverImageUrl;
  const slideBackground = o.slideBackground === undefined || o.slideBackground === null || o.slideBackground === "" ? undefined : o.slideBackground;
  if (slideBackground !== undefined && !isValidColor(slideBackground)) return { error: "slideBackground invalid" };
  if (!Array.isArray(o.questions)) return { error: "questions must be an array" };
  const questions: Question[] = [];
  for (const [i, q] of (o.questions as unknown[]).entries()) {
    if (typeof q !== "object" || q === null) return { error: `questions[${i}] invalid` };
    const qq = q as Record<string, unknown>;
    const imageUrl = optionalImageUrl(qq.imageUrl, "imageUrl");
    if (typeof imageUrl === "object") return { error: `questions[${i}].${imageUrl.error}` };
    // 出題文は画像があれば省略できる（画像の中に文字が描かれている問題）
    if (qq.prompt !== undefined && typeof qq.prompt !== "string") return { error: `questions[${i}].prompt invalid` };
    const prompt = typeof qq.prompt === "string" ? qq.prompt : "";
    if (prompt.length === 0 && !imageUrl) return { error: `questions[${i}].prompt is required` };
    if (!Array.isArray(qq.answers) || qq.answers.length === 0 || !qq.answers.every((a) => typeof a === "string" && a.length > 0)) {
      return { error: `questions[${i}].answers must be a non-empty string array` };
    }
    let overrides: Partial<QuestionSettings> | undefined;
    if (qq.overrides !== undefined) {
      const v = validateSettings(qq.overrides, true);
      if ("error" in v) return { error: `questions[${i}].${v.error}` };
      overrides = v;
    }
    questions.push({
      id: typeof qq.id === "string" && qq.id ? qq.id : crypto.randomUUID(),
      type: "anagram",
      prompt,
      answers: qq.answers as string[],
      hint: typeof qq.hint === "string" && qq.hint ? qq.hint : undefined,
      imageUrl,
      overrides,
    });
  }
  return { name: o.name.trim(), coverImageUrl, slideBackground, settings: settings as QuestionSettings, questions };
}
