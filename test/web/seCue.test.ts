import { describe, expect, it } from "vitest";
import type { BuzzerView } from "../../src/shared/messages";
import { buzzerSe } from "../../src/web/lib/seCue";

const view = (over: Partial<BuzzerView> = {}): BuzzerView => ({
  status: "reading", readingStartedAt: 0, revealedChars: 0, positionMs: 0, promptLength: 10, charsPerSecond: 5,
  queue: [], lockedOut: [], sittingOut: [], ...over,
});
const a = { participantId: "a", nickname: "A" };
const b = { participantId: "b", nickname: "B" };

describe("buzzerSe", () => {
  it("誰かが押して待ち行列が伸びたら buzz（2 人目も）", () => {
    expect(buzzerSe(view(), view({ status: "paused", queue: [a] }))).toBe("buzz");
    expect(buzzerSe(view({ status: "paused", queue: [a] }), view({ status: "paused", queue: [a, b] }))).toBe("buzz");
  });

  it("お手付きの人が増えたら incorrect（次の人が回答中になっても、読み上げに戻っても）", () => {
    expect(buzzerSe(view({ status: "paused", queue: [a, b] }), view({ status: "paused", queue: [b], lockedOut: ["a"] }))).toBe("incorrect");
    expect(buzzerSe(view({ status: "paused", queue: [a] }), view({ lockedOut: ["a"] }))).toBe("incorrect");
  });

  it("読み上げの開始・速さの変更など、押した人が増えない変化では鳴らさない", () => {
    expect(buzzerSe(view({ status: "ready", readingStartedAt: null }), view())).toBeNull();
    expect(buzzerSe(view(), view({ charsPerSecond: 8 }))).toBeNull();
    expect(buzzerSe(view({ status: "paused", queue: [a] }), view({ status: "paused", queue: [a] }))).toBeNull();
  });

  it("問題の開始直後・再接続（前の状態が無い）や、問題が閉じたときは鳴らさない", () => {
    expect(buzzerSe(null, view({ status: "paused", queue: [a] }))).toBeNull();
    expect(buzzerSe(view({ status: "paused", queue: [a] }), null)).toBeNull();
  });
});
