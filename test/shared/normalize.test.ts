import { describe, it, expect } from "vitest";
import { normalizeAnswer, isCorrect } from "../../src/shared/normalize";

describe("normalizeAnswer", () => {
  it("trims surrounding whitespace including full-width spaces", () => {
    expect(normalizeAnswer("　 りんご 　")).toBe("りんご");
  });
  it("converts katakana to hiragana", () => {
    expect(normalizeAnswer("リンゴ")).toBe("りんご");
  });
  it("converts half-width katakana to hiragana", () => {
    expect(normalizeAnswer("ﾘﾝｺﾞ")).toBe("りんご");
  });
  it("converts full-width alphanumerics to half-width", () => {
    expect(normalizeAnswer("ＡＢＣ１２３")).toBe("ABC123");
  });
  it("unifies long vowel marks", () => {
    expect(normalizeAnswer("コーヒー")).toBe("こーひー");
    expect(normalizeAnswer("こ－ひ－")).toBe("こーひー");
    expect(normalizeAnswer("こ-ひ-")).toBe("こーひー");
  });
  it("composes combining dakuten", () => {
    expect(normalizeAnswer("が")).toBe("が");
  });
  it("keeps kanji unchanged", () => {
    expect(normalizeAnswer("林檎")).toBe("林檎");
  });
});

describe("isCorrect", () => {
  it("matches any normalized candidate", () => {
    expect(isCorrect("リンゴ", ["りんご", "林檎"])).toBe(true);
    expect(isCorrect("林檎", ["りんご", "林檎"])).toBe(true);
  });
  it("normalizes the candidates too", () => {
    expect(isCorrect("りんご", ["リンゴ"])).toBe(true);
  });
  it("rejects non-matching text", () => {
    expect(isCorrect("ごりら", ["りんご"])).toBe(false);
    expect(isCorrect("", ["りんご"])).toBe(false);
  });
});
