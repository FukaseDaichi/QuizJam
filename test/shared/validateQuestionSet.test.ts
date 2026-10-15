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

  it("keeps a valid explanation image URL on the question", () => {
    const v = validateQuestionSetInput({ ...base, questions: [{ prompt: "ごんり", answers: ["りんご"], explanationImageUrl: "/api/images/why.png" }] });
    expect("error" in v ? v.error : v.questions[0].explanationImageUrl).toBe("/api/images/why.png");
  });

  it("treats an empty explanation image URL as none and rejects an invalid one", () => {
    const ok = validateQuestionSetInput({ ...base, questions: [{ prompt: "ごんり", answers: ["りんご"], explanationImageUrl: "" }] });
    expect("error" in ok ? ok.error : ok.questions[0].explanationImageUrl).toBeUndefined();
    const bad = validateQuestionSetInput({ ...base, questions: [{ prompt: "ごんり", answers: ["りんご"], explanationImageUrl: "javascript:alert(1)" }] });
    expect(bad).toEqual({ error: "questions[0].explanationImageUrl invalid" });
  });

  it("does not let an explanation image stand in for a missing prompt", () => {
    const v = validateQuestionSetInput({ ...base, questions: [{ prompt: "", answers: ["りんご"], explanationImageUrl: "/api/images/why.png" }] });
    expect(v).toEqual({ error: "questions[0].prompt is required" });
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

describe("validateQuestionSetInput introSlides", () => {
  const questions = [{ prompt: "ごんり", answers: ["りんご"] }];

  it("omits introSlides when not given", () => {
    const v = validateQuestionSetInput({ ...base, questions });
    expect("error" in v ? v.error : v.introSlides).toBeUndefined();
  });

  it("accepts slides with any of heading, body or image and assigns ids", () => {
    const v = validateQuestionSetInput({ ...base, questions, introSlides: [
      { heading: "ルール" },
      { body: "3問です\n早い者勝ち" },
      { imageUrl: "/api/images/a.png" },
      { id: "s4", heading: "見出し", body: "本文", imageUrl: "https://example.com/x.png" },
    ] });
    expect("error" in v).toBe(false);
    if ("error" in v) return;
    expect(v.introSlides).toHaveLength(4);
    expect(v.introSlides![0]).toMatchObject({ heading: "ルール", body: undefined, imageUrl: undefined });
    expect(v.introSlides![0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.introSlides![1].body).toBe("3問です\n早い者勝ち");
    expect(v.introSlides![3].id).toBe("s4");
  });

  it("rejects an empty slide", () => {
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ heading: "", body: "" }] })).toEqual({ error: "introSlides[0] is empty" });
  });

  it("rejects too many slides, long text, bad image URLs and non-arrays", () => {
    const many = Array.from({ length: 21 }, () => ({ heading: "x" }));
    expect(validateQuestionSetInput({ ...base, questions, introSlides: many })).toEqual({ error: "introSlides must have at most 20 items" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ heading: "x".repeat(101) }] })).toEqual({ error: "introSlides[0].heading invalid" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ body: "x".repeat(1001) }] })).toEqual({ error: "introSlides[0].body invalid" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ imageUrl: "javascript:alert(1)" }] })).toEqual({ error: "introSlides[0].imageUrl invalid" });
    expect(validateQuestionSetInput({ ...base, questions, introSlides: "nope" })).toEqual({ error: "introSlides must be an array" });
  });
});

describe("validateQuestionSetInput whitespace", () => {
  const questions = [{ prompt: "ごんり", answers: ["りんご"] }];

  it("treats whitespace-only heading and body as empty and trims stored text", () => {
    expect(validateQuestionSetInput({ ...base, questions, introSlides: [{ heading: "  ", body: "\n \t" }] })).toEqual({ error: "introSlides[0] is empty" });
    const v = validateQuestionSetInput({ ...base, questions, introSlides: [{ heading: " ルール ", body: " 本文\n2行目 \n" }] });
    expect("error" in v).toBe(false);
    if ("error" in v) return;
    expect(v.introSlides![0]).toMatchObject({ heading: "ルール", body: "本文\n2行目" });
  });

  it("treats a whitespace-only prompt as missing and trims the prompt", () => {
    expect(validateQuestionSetInput({ ...base, questions: [{ prompt: "   ", answers: ["りんご"] }] })).toEqual({ error: "questions[0].prompt is required" });
    const v = validateQuestionSetInput({ ...base, questions: [{ prompt: " ごんり ", answers: ["りんご"] }] });
    expect("error" in v ? v.error : v.questions[0].prompt).toBe("ごんり");
  });
});

describe("validateQuestionSetInput buzzer mode", () => {
  it("accepts mode buzzer and drops mode anagram", () => {
    const buzzer = validateQuestionSetInput({ ...base, mode: "buzzer", questions: [{ prompt: "日本一高い山は？", answers: ["富士山"] }] });
    expect("error" in buzzer ? buzzer.error : buzzer.mode).toBe("buzzer");
    const anagram = validateQuestionSetInput({ ...base, mode: "anagram", questions: [{ prompt: "ごんり", answers: ["りんご"] }] });
    expect("error" in anagram ? anagram.error : anagram.mode).toBeUndefined();
    expect(validateQuestionSetInput({ ...base, mode: "speed", questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "mode invalid" });
  });

  it("requires a prompt on every question in buzzer mode even when it has an image", () => {
    const v = validateQuestionSetInput({ ...base, mode: "buzzer", questions: [{ prompt: "", answers: ["富士山"], imageUrl: "/api/images/a.webp" }] });
    expect(v).toEqual({ error: "questions[0].prompt is required" });
  });

  it("fills charsPerSecond with the default and validates its range", () => {
    const ok = validateQuestionSetInput({ ...base, questions: [{ prompt: "x", answers: ["y"] }] });
    expect("error" in ok ? ok.error : ok.settings.charsPerSecond).toBe(6);
    const custom = validateQuestionSetInput({ ...base, settings: { charsPerSecond: 12 }, questions: [{ prompt: "x", answers: ["y"] }] });
    expect("error" in custom ? custom.error : custom.settings.charsPerSecond).toBe(12);
    expect(validateQuestionSetInput({ ...base, settings: { charsPerSecond: 0 }, questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "settings.charsPerSecond invalid" });
    expect(validateQuestionSetInput({ ...base, settings: { charsPerSecond: 31 }, questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "settings.charsPerSecond invalid" });
    expect(validateQuestionSetInput({ ...base, settings: { charsPerSecond: 2.5 }, questions: [{ prompt: "x", answers: ["y"] }] })).toEqual({ error: "settings.charsPerSecond invalid" });
    expect(validateQuestionSetInput({ ...base, questions: [{ prompt: "x", answers: ["y"], overrides: { charsPerSecond: 40 } }] })).toEqual({ error: "questions[0].settings.charsPerSecond invalid" });
  });
});

describe("validateQuestionSetInput question audio", () => {
  const audio = { url: "/api/audio/0a1b.mp3", revealAtMs: [2000, 2300, 2300] };
  const buzzerSet = (q: Record<string, unknown>) => validateQuestionSetInput({ ...base, mode: "buzzer", questions: [{ prompt: "あいう", answers: ["え"], ...q }] });

  it("keeps a valid audio on a buzzer question", () => {
    const v = buzzerSet({ audio });
    expect("error" in v ? v.error : v.questions[0].audio).toEqual(audio);
  });

  it("accepts an https audio URL", () => {
    const v = buzzerSet({ audio: { ...audio, url: "https://example.com/q.mp3" } });
    expect("error" in v ? v.error : v.questions[0].audio?.url).toBe("https://example.com/q.mp3");
  });

  it("matches revealAtMs against the trimmed prompt in code points", () => {
    const v = buzzerSet({ prompt: " a😀b ", audio });
    expect("error" in v ? v.error : v.questions[0].audio?.revealAtMs).toEqual(audio.revealAtMs);
  });

  it("rejects an audio URL outside /api/audio/ and https", () => {
    expect(buzzerSet({ audio: { ...audio, url: "/api/images/a.mp3" } })).toEqual({ error: "questions[0].audio.url invalid" });
    expect(buzzerSet({ audio: { ...audio, url: "javascript:alert(1)" } })).toEqual({ error: "questions[0].audio.url invalid" });
  });

  it("rejects revealAtMs that does not fit the prompt", () => {
    const bad = (revealAtMs: unknown) => buzzerSet({ audio: { ...audio, revealAtMs } });
    expect(bad([2000, 2300])).toEqual({ error: "questions[0].audio.revealAtMs invalid" });
    expect(bad([2000, 1999, 2300])).toEqual({ error: "questions[0].audio.revealAtMs invalid" });
    expect(bad([2000, 2300.5, 2400])).toEqual({ error: "questions[0].audio.revealAtMs invalid" });
    expect(bad([-1, 2300, 2400])).toEqual({ error: "questions[0].audio.revealAtMs invalid" });
    expect(bad([2000, 2300, 600_001])).toEqual({ error: "questions[0].audio.revealAtMs invalid" });
    expect(bad("2000,2300,2400")).toEqual({ error: "questions[0].audio.revealAtMs invalid" });
  });

  it("rejects an audio that is not an object", () => {
    expect(buzzerSet({ audio: "/api/audio/a.mp3" })).toEqual({ error: "questions[0].audio invalid" });
  });

  it("drops the audio outside buzzer mode", () => {
    const v = validateQuestionSetInput({ ...base, questions: [{ prompt: "あいう", answers: ["え"], audio }] });
    expect("error" in v ? v.error : v.questions[0].audio).toBeUndefined();
  });
});
