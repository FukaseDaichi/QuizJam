import { describe, it, expect } from "vitest";
import { promptLength, revealedCount, type RevealTimeline } from "../../src/shared/buzzer";

const T0 = 1_700_000_000_000;

function reading(over: Partial<RevealTimeline> = {}): RevealTimeline {
  return { status: "reading", readingStartedAt: T0, revealedChars: 0, promptLength: 20, charsPerSecond: 6, ...over };
}

describe("promptLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(promptLength("あいう")).toBe(3);
    expect(promptLength("a😀b")).toBe(3);
    expect(promptLength("")).toBe(0);
  });
});

describe("revealedCount", () => {
  it("advances with elapsed time at charsPerSecond and floors", () => {
    expect(revealedCount(reading(), T0)).toBe(0);
    expect(revealedCount(reading(), T0 + 999)).toBe(5);
    expect(revealedCount(reading(), T0 + 1000)).toBe(6);
    expect(revealedCount(reading({ charsPerSecond: 10 }), T0 + 1500)).toBe(15);
  });
  it("adds the elapsed chars onto the segment start", () => {
    expect(revealedCount(reading({ revealedChars: 8 }), T0 + 1000)).toBe(14);
  });
  it("never exceeds the prompt length", () => {
    expect(revealedCount(reading(), T0 + 60_000)).toBe(20);
    expect(revealedCount(reading({ revealedChars: 25 }), T0)).toBe(20);
  });
  it("stays at the segment start while paused or ready, even with a stale readingStartedAt", () => {
    expect(revealedCount(reading({ status: "paused", revealedChars: 7 }), T0 + 10_000)).toBe(7);
    expect(revealedCount(reading({ status: "ready", readingStartedAt: null }), T0 + 10_000)).toBe(0);
  });
  it("treats a clock earlier than readingStartedAt as zero elapsed", () => {
    expect(revealedCount(reading({ revealedChars: 3 }), T0 - 5000)).toBe(3);
  });
});
