import type { IntroSlide, Question, QuestionSettings } from "../../shared/types";
import { MAX_INTRO_SLIDES } from "../../shared/validateQuestionSet";

/** 編集画面で選択中のスライド。"title" がタイトル、{ intro } が説明スライド、数値が問題のインデックス */
export type Selection = "title" | number | { intro: number };

export const isIntroSel = (s: Selection): s is { intro: number } => typeof s === "object";

export interface EditorDraft {
  name: string;
  coverImageUrl?: string;
  slideBackground?: string;
  introSlides: IntroSlide[];
  settings: QuestionSettings;
  questions: Question[];
}

export function introEmpty(s: IntroSlide): boolean {
  return !s.heading?.trim() && !s.body?.trim() && !s.imageUrl;
}

export function questionIncomplete(q: Question): boolean {
  return (!q.prompt.trim() && !q.imageUrl) || !q.answers.some((a) => a.trim());
}

/** 保存前チェック。問題のある最初のスライドと日本語の文言を返す */
export function findProblem(d: EditorDraft): { slide: Selection; message: string } | null {
  if (!d.name.trim()) return { slide: "title", message: "企画名を入力してください" };
  if (d.questions.length === 0) return { slide: "title", message: "問題を1問以上追加してください" };
  if (d.introSlides.length > MAX_INTRO_SLIDES) return { slide: { intro: MAX_INTRO_SLIDES }, message: `説明スライドは${MAX_INTRO_SLIDES}枚までです` };
  for (const [i, s] of d.introSlides.entries()) {
    if (introEmpty(s)) return { slide: { intro: i }, message: `説明スライド${i + 1}に見出し・本文・画像のどれかを入れてください` };
  }
  for (const [i, q] of d.questions.entries()) {
    if (!q.answers.some((a) => a.trim())) return { slide: i, message: `第${i + 1}問の正解を入力してください` };
    if (!q.prompt.trim() && !q.imageUrl) return { slide: i, message: `第${i + 1}問の出題文か画像を入れてください（出題文は「生成」で正解から作れます）` };
  }
  return null;
}
