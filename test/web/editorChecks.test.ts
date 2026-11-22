import { describe, it, expect } from "vitest";
import { findProblem, introEmpty, questionIncomplete } from "../../src/web/lib/editorChecks";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
import type { IntroSlide } from "../../src/shared/types";

const q = { id: "q1", type: "anagram" as const, prompt: "ごんり", answers: ["りんご"] };
const draft = { name: "テスト", mode: "anagram" as const, introSlides: [] as IntroSlide[], settings: DEFAULT_SETTINGS, questions: [q] };

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

describe("buzzer mode checks", () => {
  it("an image-only question is complete for anagram but incomplete for buzzer", () => {
    const imageOnly = { ...q, prompt: "", imageUrl: "/api/images/a.png" };
    expect(questionIncomplete(imageOnly, "anagram")).toBe(false);
    expect(questionIncomplete(imageOnly, "buzzer")).toBe(true);
    expect(questionIncomplete({ ...q, prompt: "富士山は？" }, "buzzer")).toBe(false);
  });

  it("findProblem demands a prompt for every buzzer question", () => {
    const d = { ...draft, mode: "buzzer" as const, questions: [q, { ...q, id: "q2", prompt: "  ", imageUrl: "/api/images/a.png" }] };
    expect(findProblem(d)).toEqual({ slide: 1, message: "第2問の問題文を入力してください" });
    expect(findProblem({ ...draft, mode: "buzzer" as const })).toBeNull();
  });
});

describe("question audio checks", () => {
  const audio = { url: "/api/audio/a.mp3", revealAtMs: [2000, 2300, 2600] };

  it("findProblem points at a buzzer question whose prompt no longer fits its audio", () => {
    const d = { ...draft, mode: "buzzer" as const, questions: [{ ...q, audio }, { ...q, id: "q2", prompt: "ごんりんご", audio }] };
    expect(findProblem(d)).toEqual({ slide: 1, message: "第2問の問題文が音声と合っていません。「音声を外す」で音声を外してください" });
  });

  it("does not complain in anagram mode, where the audio is dropped on save", () => {
    expect(findProblem({ ...draft, questions: [{ ...q, prompt: "ごんりんご", audio }] })).toBeNull();
  });
});

describe("genre checks", () => {
  const buzzer = { ...draft, mode: "buzzer" as const };
  const gq = (id: string, genre?: string) => ({ ...q, id, prompt: "富士山は？", genre });

  it("points at the first question without a genre when only some have one", () => {
    const d = { ...buzzer, questions: [gq("a", "動物"), gq("b"), gq("c", "植物"), gq("d")] };
    expect(findProblem(d)).toEqual({ slide: 1, message: "第2問のジャンルを入力してください（ジャンルは全問に付けるか、どの問題にも付けません）" });
  });

  it("treats a whitespace-only genre as not set", () => {
    const d = { ...buzzer, questions: [gq("a", "動物"), gq("b", "  "), gq("c", "植物")] };
    expect(findProblem(d)?.slide).toBe(1);
  });

  it("demands at least 3 genres when every question has one, counted after trimming", () => {
    const two = { ...buzzer, questions: [gq("a", "動物"), gq("b", "植物"), gq("c", "動物")] };
    expect(findProblem(two)).toEqual({ slide: "title", message: "ジャンルは3種類以上にしてください" });
    const trimmed = { ...buzzer, questions: [gq("a", "動物"), gq("b", "植物"), gq("c", " 動物 ")] };
    expect(findProblem(trimmed)?.slide).toBe("title");
  });

  it("accepts a full set of 3 genres, and sets without any genre", () => {
    expect(findProblem({ ...buzzer, questions: [gq("a", "動物"), gq("b", "植物"), gq("c", "地理")] })).toBeNull();
    expect(findProblem({ ...buzzer, questions: [gq("a"), gq("b")] })).toBeNull();
  });

  it("ignores genres in anagram mode", () => {
    expect(findProblem({ ...draft, questions: [{ ...q, genre: "動物" }, { ...q, id: "q2" }] })).toBeNull();
  });
});
