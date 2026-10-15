import { describe, it, expect } from "vitest";
import { playbackPositionMs, promptLength, revealedCount, type RevealTimeline } from "../../src/shared/buzzer";

const T0 = 1_700_000_000_000;

function reading(over: Partial<RevealTimeline> = {}): RevealTimeline {
  return { status: "reading", readingStartedAt: T0, revealedChars: 0, positionMs: 0, promptLength: 20, charsPerSecond: 6, ...over };
}

/** 5 文字の問題文。「問題！」の後、2.0 秒から出る。2・3 文字目は同時に出る */
function voiced(over: Partial<RevealTimeline> = {}): RevealTimeline {
  return reading({ promptLength: 5, revealAtMs: [2000, 2300, 2300, 2700, 3000], ...over });
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

describe("revealedCount with a timing table", () => {
  it("counts the chars whose reveal time has come at the playback position", () => {
    expect(revealedCount(voiced(), T0 + 1999)).toBe(0);
    expect(revealedCount(voiced(), T0 + 2000)).toBe(1);
    expect(revealedCount(voiced(), T0 + 2300)).toBe(3);
    expect(revealedCount(voiced(), T0 + 2999)).toBe(4);
  });
  it("adds the elapsed time onto the segment's playback position", () => {
    expect(revealedCount(voiced({ positionMs: 2300, revealedChars: 3 }), T0 + 400)).toBe(4);
  });
  it("ignores charsPerSecond", () => {
    expect(revealedCount(voiced({ charsPerSecond: 30 }), T0 + 1000)).toBe(0);
  });
  it("never exceeds the prompt length", () => {
    expect(revealedCount(voiced(), T0 + 60_000)).toBe(5);
  });
  it("never goes below the segment start after rewinding the playback position", () => {
    expect(revealedCount(voiced({ positionMs: 2000, revealedChars: 3 }), T0)).toBe(3);
  });
  it("stays at the segment start while paused or ready", () => {
    expect(revealedCount(voiced({ status: "paused", positionMs: 2900, revealedChars: 4 }), T0 + 10_000)).toBe(4);
    expect(revealedCount(voiced({ status: "ready", readingStartedAt: null }), T0 + 10_000)).toBe(0);
  });
});

describe("playbackPositionMs", () => {
  it("is the segment's position plus the elapsed time while reading", () => {
    expect(playbackPositionMs(voiced({ positionMs: 2300 }), T0 + 450)).toBe(2750);
  });
  it("treats a clock earlier than readingStartedAt as zero elapsed", () => {
    expect(playbackPositionMs(voiced({ positionMs: 2300 }), T0 - 100)).toBe(2300);
  });
  it("stays at the segment's position while paused or ready", () => {
    expect(playbackPositionMs(voiced({ status: "paused", positionMs: 2900 }), T0 + 10_000)).toBe(2900);
    expect(playbackPositionMs(voiced({ status: "ready", readingStartedAt: null }), T0 + 10_000)).toBe(0);
  });
});
