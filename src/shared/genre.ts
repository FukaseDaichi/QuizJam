import type { Question, QuestionSetMode } from "./types";

export const MAX_GENRE_LENGTH = 30;
export const MIN_GENRES = 3;
export const SPECIALTY_COUNT = 2;
export const OFF_SPECIALTY_MULTIPLIER = 2;

export interface GenreCount { genre: string; remaining: number }

/** 最初に現れた順のジャンル名 */
export function genresOf(questions: Pick<Question, "genre">[]): string[] {
  const out: string[] = [];
  for (const q of questions) if (q.genre !== undefined && !out.includes(q.genre)) out.push(q.genre);
  return out;
}

/** 早押しで、1 問以上あり、全問に genre がある */
export function isGenreSet(set: { mode?: QuestionSetMode; questions: Pick<Question, "genre">[] }): boolean {
  return set.mode === "buzzer" && set.questions.length > 0 && set.questions.every((q) => q.genre !== undefined);
}

/** asked（出題済みの位置）を除いたジャンルごとの残り問題数。並びは genresOf と同じ */
export function genreCounts(questions: Pick<Question, "genre">[], asked: number[] = []): GenreCount[] {
  return genresOf(questions).map((genre) => ({ genre, remaining: questions.filter((q, i) => q.genre === genre && !asked.includes(i)).length }));
}
