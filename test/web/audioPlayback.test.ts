import { describe, it, expect } from "vitest";
import { audioStartMs } from "../../src/web/lib/audioPlayback";
import type { BuzzerView } from "../../src/shared/messages";

const T0 = 1_700_000_000_000;

function view(over: Partial<BuzzerView> = {}): BuzzerView {
  return { status: "reading", readingStartedAt: T0, revealedChars: 0, positionMs: 0, promptLength: 5, charsPerSecond: 6, queue: [], lockedOut: [], ...over };
}

describe("audioStartMs", () => {
  it("plays from the segment's position plus the elapsed time while reading", () => {
    expect(audioStartMs(view(), T0)).toBe(0);
    expect(audioStartMs(view({ positionMs: 2300, revealedChars: 3 }), T0 + 120)).toBe(2420);
  });

  it("does not play before reading starts, while paused or without a buzzer", () => {
    expect(audioStartMs(view({ status: "ready", readingStartedAt: null }), T0)).toBeNull();
    expect(audioStartMs(view({ status: "paused", readingStartedAt: null, positionMs: 2500, revealedChars: 3 }), T0)).toBeNull();
    expect(audioStartMs(null, T0)).toBeNull();
  });

  it("does not play a resumed segment once the whole prompt was shown", () => {
    expect(audioStartMs(view({ revealedChars: 5, positionMs: 5000 }), T0 + 100)).toBeNull();
  });

  it("treats a clock earlier than readingStartedAt as the segment start", () => {
    expect(audioStartMs(view({ positionMs: 2300, revealedChars: 3 }), T0 - 50)).toBe(2300);
  });
});
