import { describe, it, expect } from "vitest";
import { shuffleAnagram } from "../../src/shared/anagram";

describe("shuffleAnagram", () => {
  it("returns a permutation of the same characters", () => {
    const out = shuffleAnagram("たこやき", () => 0.5);
    expect([...out].sort()).toEqual([..."たこやき"].sort());
  });
  it("never returns the original word when length >= 2", () => {
    for (let i = 0; i < 50; i++) {
      expect(shuffleAnagram("あい")).not.toBe("あい");
    }
  });
  it("returns single characters as-is", () => {
    expect(shuffleAnagram("あ")).toBe("あ");
  });
  it("handles surrogate pairs as single characters", () => {
    const out = shuffleAnagram("𠮷野家", () => 0);
    expect([...out].length).toBe(3);
  });
});
