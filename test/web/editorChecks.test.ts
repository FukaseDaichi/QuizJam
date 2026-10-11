import { describe, it, expect } from "vitest";
import { findProblem, introEmpty } from "../../src/web/lib/editorChecks";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
import type { IntroSlide } from "../../src/shared/types";

const q = { id: "q1", type: "anagram" as const, prompt: "ごんり", answers: ["りんご"] };
const draft = { name: "テスト", introSlides: [] as IntroSlide[], settings: DEFAULT_SETTINGS, questions: [q] };

describe("introEmpty", () => {
  it("is true only when heading, body and image are all blank", () => {
    expect(introEmpty({ id: "s" })).toBe(true);
    expect(introEmpty({ id: "s", heading: "  ", body: " \n" })).toBe(true);
    expect(introEmpty({ id: "s", body: "x" })).toBe(false);
    expect(introEmpty({ id: "s", imageUrl: "/api/images/a.png" })).toBe(false);
  });
});

describe("findProblem", () => {
  it("returns null for a valid draft", () => {
    expect(findProblem(draft)).toBeNull();
  });

  it("points at an empty intro slide", () => {
    const d = { ...draft, introSlides: [{ id: "a", heading: "x" }, { id: "b" }] };
    expect(findProblem(d)).toEqual({ slide: { intro: 1 }, message: "説明スライド2に見出し・本文・画像のどれかを入れてください" });
  });

  it("rejects more than 20 intro slides with a Japanese message pointing at the 21st", () => {
    const d = { ...draft, introSlides: Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, heading: "x" })) };
    expect(findProblem(d)).toEqual({ slide: { intro: 20 }, message: "説明スライドは20枚までです" });
  });

  it("points at a question without answers or prompt", () => {
    expect(findProblem({ ...draft, questions: [{ ...q, answers: [""] }] })).toEqual({ slide: 0, message: "第1問の正解を入力してください" });
    expect(findProblem({ ...draft, questions: [{ ...q, prompt: " " }] })?.slide).toBe(0);
  });
});
