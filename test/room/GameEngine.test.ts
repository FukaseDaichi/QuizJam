import { describe, it, expect, beforeEach } from "vitest";
import { GameEngine } from "../../src/room/GameEngine";
import type { QuestionSet } from "../../src/shared/types";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";

const T0 = 1_700_000_000_000;

function makeSet(overrides: Partial<QuestionSet["settings"]> = {}): QuestionSet {
  return {
    id: "set1",
    name: "テスト",
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    questions: [
      { id: "q1", type: "anagram", prompt: "ごんり", answers: ["りんご", "林檎"] },
      { id: "q2", type: "anagram", prompt: "なばな", answers: ["ばなな"] },
    ],
  };
}

describe("GameEngine participants", () => {
  it("adds participants with zero score and returns them in leaderboard", () => {
    const e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
    expect(e.leaderboard()).toEqual([
      { participantId: "p1", nickname: "みさき", score: 0, rank: 1 },
      { participantId: "p2", nickname: "たろう", score: 0, rank: 1 },
    ]);
  });
  it("re-adding the same id updates nickname and keeps score", () => {
    const e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    const p = e.addParticipant("p1", "ミサキ");
    expect(p.nickname).toBe("ミサキ");
    expect(Object.keys(e.snapshot().participants)).toHaveLength(1);
  });
  it("tracks connection state", () => {
    const e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    expect(e.setConnected("p1", false)?.connected).toBe(false);
    expect(e.setConnected("nope", false)).toBeNull();
  });
});

describe("GameEngine start", () => {
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
  });

  it("moves to question phase and sets a fixed deadline", () => {
    const view = e.start(makeSet({ timerMode: "fixed", timerSeconds: 20 }), false, T0);
    expect(e.phase).toBe("question");
    expect(view).toEqual({
      index: 0, total: 2, prompt: "ごんり", hint: undefined,
      deadlineAt: T0 + 20_000, maxAttempts: 3,
    });
  });
  it("has no deadline in afterFirstCorrect and none modes", () => {
    expect(e.start(makeSet({ timerMode: "afterFirstCorrect" }), false, T0).deadlineAt).toBeNull();
    const e2 = GameEngine.create("X");
    expect(e2.start(makeSet({ timerMode: "none" }), false, T0).deadlineAt).toBeNull();
  });
  it("resets scores unless carryOverScores", () => {
    e.start(makeSet(), false, T0);
    e.submitAnswer("p1", "りんご", T0 + 1000);
    expect(e.leaderboard()[0].score).toBe(150);
    e.start(makeSet(), false, T0 + 60_000);
    expect(e.leaderboard()[0].score).toBe(0);
    e.submitAnswer("p1", "りんご", T0 + 61_000);
    e.start(makeSet(), true, T0 + 120_000);
    expect(e.leaderboard()[0].score).toBe(150);
  });
  it("rejects start with an empty question set", () => {
    expect(() => e.start({ ...makeSet(), questions: [] }, false, T0)).toThrow();
  });
});

describe("GameEngine submitAnswer", () => {
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
    e.addParticipant("p3", "ケン");
    e.addParticipant("p4", "ゆい");
  });

  it("rejects answers outside question phase", () => {
    expect(e.submitAnswer("p1", "りんご", T0)).toEqual({ kind: "rejected", code: "not_in_question" });
  });

  it("awards base points plus rank bonus in server arrival order", () => {
    e.start(makeSet(), false, T0);
    expect(e.submitAnswer("p1", "リンゴ", T0 + 100)).toMatchObject({ kind: "correct", correctRank: 1, points: 150 });
    expect(e.submitAnswer("p2", "林檎", T0 + 200)).toMatchObject({ kind: "correct", correctRank: 2, points: 130 });
    expect(e.submitAnswer("p3", "りんご", T0 + 300)).toMatchObject({ kind: "correct", correctRank: 3, points: 110 });
    expect(e.submitAnswer("p4", "りんご", T0 + 400)).toMatchObject({ kind: "correct", correctRank: 4, points: 100 });
    expect(e.leaderboard().map((x) => [x.nickname, x.score, x.rank])).toEqual([
      ["みさき", 150, 1], ["たろう", 130, 2], ["ケン", 110, 3], ["ゆい", 100, 4],
    ]);
  });

  it("counts wrong attempts and blocks after maxAttempts", () => {
    e.start(makeSet({ maxAttempts: 2 }), false, T0);
    expect(e.submitAnswer("p1", "ごりら", T0 + 1)).toEqual({ kind: "wrong", remainingAttempts: 1, points: 0 });
    expect(e.submitAnswer("p1", "ばなな", T0 + 2)).toEqual({ kind: "wrong", remainingAttempts: 0, points: 0 });
    expect(e.submitAnswer("p1", "りんご", T0 + 3)).toEqual({ kind: "rejected", code: "no_attempts_left" });
  });

  it("allows unlimited attempts when maxAttempts is null", () => {
    e.start(makeSet({ maxAttempts: null }), false, T0);
    for (let i = 0; i < 10; i++) {
      expect(e.submitAnswer("p1", "ごりら", T0 + i)).toEqual({ kind: "wrong", remainingAttempts: null, points: 0 });
    }
    expect(e.submitAnswer("p1", "りんご", T0 + 11).kind).toBe("correct");
  });

  it("applies wrongPenalty", () => {
    e.start(makeSet({ wrongPenalty: 10 }), false, T0);
    expect(e.submitAnswer("p1", "ごりら", T0 + 1)).toEqual({ kind: "wrong", remainingAttempts: 2, points: -10 });
    expect(e.leaderboard().find((x) => x.participantId === "p1")?.score).toBe(-10);
  });

  it("rejects a second answer after a correct one", () => {
    e.start(makeSet(), false, T0);
    e.submitAnswer("p1", "りんご", T0 + 1);
    expect(e.submitAnswer("p1", "りんご", T0 + 2)).toEqual({ kind: "rejected", code: "already_correct" });
  });

  it("rejects answers after the deadline", () => {
    e.start(makeSet({ timerMode: "fixed", timerSeconds: 10 }), false, T0);
    expect(e.submitAnswer("p1", "りんご", T0 + 10_000)).toEqual({ kind: "rejected", code: "deadline_passed" });
  });

  it("rejects answers from unknown participants", () => {
    e.start(makeSet(), false, T0);
    expect(e.submitAnswer("ghost", "りんご", T0 + 1)).toEqual({ kind: "rejected", code: "forbidden" });
  });

  it("sets the deadline only on the first correct answer in afterFirstCorrect mode", () => {
    e.start(makeSet({ timerMode: "afterFirstCorrect", timerSeconds: 15 }), false, T0);
    expect(e.submitAnswer("p1", "ごりら", T0 + 1)).toMatchObject({ kind: "wrong" });
    expect(e.deadlineAt).toBeNull();
    expect(e.submitAnswer("p2", "りんご", T0 + 2)).toMatchObject({
      kind: "correct", deadlineAt: T0 + 2 + 15_000, deadlineJustSet: true,
    });
    expect(e.submitAnswer("p3", "りんご", T0 + 3)).toMatchObject({ deadlineAt: T0 + 2 + 15_000, deadlineJustSet: false });
    expect(e.submitAnswer("p4", "りんご", T0 + 2 + 15_000)).toEqual({ kind: "rejected", code: "deadline_passed" });
  });

  it("uses per-question overrides", () => {
    const set = makeSet();
    set.questions[0].overrides = { basePoints: 10, rankBonus: [] };
    e.start(set, false, T0);
    expect(e.submitAnswer("p1", "りんご", T0 + 1)).toMatchObject({ points: 10 });
  });

  it("reports myStatus, correctCount and allParticipantsDone", () => {
    e.start(makeSet({ maxAttempts: 1 }), false, T0);
    expect(e.myStatus("p1")).toEqual({ attemptsUsed: 0, correct: false, correctRank: null });
    e.submitAnswer("p1", "りんご", T0 + 1);
    e.submitAnswer("p2", "ごりら", T0 + 2);
    expect(e.myStatus("p1")).toEqual({ attemptsUsed: 1, correct: true, correctRank: 1 });
    expect(e.myStatus("p2")).toEqual({ attemptsUsed: 1, correct: false, correctRank: null });
    expect(e.correctCount()).toBe(1);
    expect(e.allParticipantsDone()).toBe(false);
    e.submitAnswer("p3", "りんご", T0 + 3);
    e.submitAnswer("p4", "ごりら", T0 + 4);
    expect(e.correctCount()).toBe(2);
    expect(e.allParticipantsDone()).toBe(true);
  });

  it("correctCount is 0 outside a question", () => {
    expect(e.correctCount()).toBe(0);
  });

  it("ignores disconnected participants in allParticipantsDone", () => {
    e.start(makeSet({ maxAttempts: 1 }), false, T0);
    e.setConnected("p3", false);
    e.setConnected("p4", false);
    e.submitAnswer("p1", "りんご", T0 + 1);
    e.submitAnswer("p2", "ごりら", T0 + 2);
    expect(e.allParticipantsDone()).toBe(true);
  });
});

describe("GameEngine snapshot", () => {
  it("round-trips through snapshot/fromSnapshot", () => {
    const e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    e.start(makeSet(), false, T0);
    e.submitAnswer("p1", "りんご", T0 + 1);
    const e2 = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
    expect(e2.snapshot()).toEqual(e.snapshot());
    expect(e2.leaderboard()).toEqual(e.leaderboard());
  });
});
