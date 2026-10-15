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

  it("plays the rest of the audio after the whole prompt is shown while the audio has not ended", () => {
    // 最後の文字は読み始めに出るので、全文が出た後もその文字の音が残っている
    expect(audioStartMs(view({ revealedChars: 5, positionMs: 3100 }), T0 + 100, 0, 4000)).toBe(3200);
  });

  it("does not play once the playback position reaches the end of the audio", () => {
    expect(audioStartMs(view({ revealedChars: 5, positionMs: 5000 }), T0 + 100, 0, 4000)).toBeNull();
    expect(audioStartMs(view({ positionMs: 3900 }), T0 + 100, 0, 4000)).toBeNull();
  });

  it("treats a clock earlier than readingStartedAt as the segment start", () => {
    expect(audioStartMs(view({ positionMs: 2300, revealedChars: 3 }), T0 - 50)).toBe(2300);
  });
});

describe("audioStartMs with output latency", () => {
  it("starts ahead by the output latency so the sound reaches the room in step with the text", () => {
    expect(audioStartMs(view({ positionMs: 2300, revealedChars: 3 }), T0 + 100, 150)).toBe(2550);
  });
  it("still does not play while paused", () => {
    expect(audioStartMs(view({ status: "paused", readingStartedAt: null }), T0, 150)).toBeNull();
  });
});
