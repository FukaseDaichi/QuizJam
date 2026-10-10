import { describe, it, expect } from "vitest";
import { validateQuestionSetInput } from "../../src/shared/validateQuestionSet";

const base = { name: "セット", settings: {} };

describe("validateQuestionSetInput", () => {
  it("requires a prompt when the question has no image", () => {
    const v = validateQuestionSetInput({ ...base, questions: [{ prompt: "", answers: ["りんご"] }] });
    expect(v).toEqual({ error: "questions[0].prompt is required" });
  });

  it("allows an empty prompt when the question has an image", () => {
    const v = validateQuestionSetInput({ ...base, questions: [{ answers: ["りんご"], imageUrl: "/api/images/a.webp" }] });
    expect("error" in v).toBe(false);
    if (!("error" in v)) expect(v.questions[0].prompt).toBe("");
  });

  it("still rejects an empty prompt with an invalid image URL", () => {
    const v = validateQuestionSetInput({ ...base, questions: [{ prompt: "", answers: ["りんご"], imageUrl: "javascript:alert(1)" }] });
    expect(v).toEqual({ error: "questions[0].imageUrl invalid" });
  });

  it("accepts a #rrggbb slide background and rejects other values", () => {
    const questions = [{ prompt: "ごんり", answers: ["りんご"] }];
    const ok = validateQuestionSetInput({ ...base, slideBackground: "#FBF1DD", questions });
    expect("error" in ok ? ok.error : ok.slideBackground).toBe("#FBF1DD");
    const empty = validateQuestionSetInput({ ...base, slideBackground: "", questions });
    expect("error" in empty ? empty.error : empty.slideBackground).toBeUndefined();
    expect(validateQuestionSetInput({ ...base, slideBackground: "red; x", questions })).toEqual({ error: "slideBackground invalid" });
  });
});
