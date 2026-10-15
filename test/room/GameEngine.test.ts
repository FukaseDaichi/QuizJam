import { describe, it, expect, beforeEach } from "vitest";
import { GameEngine, type EngineState } from "../../src/room/GameEngine";
import type { QuestionSet } from "../../src/shared/types";
import type { QuestionView } from "../../src/shared/messages";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";

const T0 = 1_700_000_000_000;

function makeSet(overrides: Partial<QuestionSet["settings"]> = {}): QuestionSet {
  return {
    id: "set1",
    name: "テスト",
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    questions: [
      { id: "q1", type: "anagram", prompt: "ごんり", answers: ["りんご", "林檎"] },
      { id: "q2", type: "anagram", prompt: "なばな", answers: ["ばなな"], imageUrl: "/api/images/banana.png", explanationImageUrl: "/api/images/banana-why.png" },
    ],
  };
}

/** タイトルスライドを飛ばして第1問を開く（説明スライドの無いセット用） */
function startQuestions(e: GameEngine, set: QuestionSet, carryOverScores: boolean, now: number): QuestionView {
  e.start(set, carryOverScores);
  const r = e.next(now);
  if (r.kind !== "question") throw new Error(`expected question, got ${r.kind}`);
  return r.question;
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
    const view = startQuestions(e, makeSet({ timerMode: "fixed", timerSeconds: 20 }), false, T0);
    expect(e.phase).toBe("question");
    expect(view).toEqual({
      index: 0, total: 2, mode: "anagram", prompt: "ごんり", hint: undefined,
      deadlineAt: T0 + 20_000, maxAttempts: 3,
    });
  });
  it("passes the set's slide background to the question view", () => {
    const view = startQuestions(e, { ...makeSet(), slideBackground: "#fbf1dd" }, false, T0);
    expect(view.background).toBe("#fbf1dd");
  });
  it("has no deadline in afterFirstCorrect and none modes", () => {
    expect(startQuestions(e, makeSet({ timerMode: "afterFirstCorrect" }), false, T0).deadlineAt).toBeNull();
    const e2 = GameEngine.create("X");
    expect(startQuestions(e2, makeSet({ timerMode: "none" }), false, T0).deadlineAt).toBeNull();
  });
  it("resets scores unless carryOverScores", () => {
    startQuestions(e, makeSet(), false, T0);
    e.submitAnswer("p1", "りんご", T0 + 1000);
    expect(e.leaderboard()[0].score).toBe(150);
    startQuestions(e, makeSet(), false, T0 + 60_000);
    expect(e.leaderboard()[0].score).toBe(0);
    e.submitAnswer("p1", "りんご", T0 + 61_000);
    startQuestions(e, makeSet(), true, T0 + 120_000);
    expect(e.leaderboard()[0].score).toBe(150);
  });
  it("rejects start with an empty question set", () => {
    expect(() => startQuestions(e, { ...makeSet(), questions: [] }, false, T0)).toThrow();
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
    startQuestions(e, makeSet(), false, T0);
    expect(e.submitAnswer("p1", "リンゴ", T0 + 100)).toMatchObject({ kind: "correct", correctRank: 1, points: 150 });
    expect(e.submitAnswer("p2", "林檎", T0 + 200)).toMatchObject({ kind: "correct", correctRank: 2, points: 130 });
    expect(e.submitAnswer("p3", "りんご", T0 + 300)).toMatchObject({ kind: "correct", correctRank: 3, points: 110 });
    expect(e.submitAnswer("p4", "りんご", T0 + 400)).toMatchObject({ kind: "correct", correctRank: 4, points: 100 });
    expect(e.leaderboard().map((x) => [x.nickname, x.score, x.rank])).toEqual([
      ["みさき", 150, 1], ["たろう", 130, 2], ["ケン", 110, 3], ["ゆい", 100, 4],
    ]);
  });

  it("counts wrong attempts and blocks after maxAttempts", () => {
    startQuestions(e, makeSet({ maxAttempts: 2 }), false, T0);
    expect(e.submitAnswer("p1", "ごりら", T0 + 1)).toEqual({ kind: "wrong", remainingAttempts: 1, points: 0 });
    expect(e.submitAnswer("p1", "ばなな", T0 + 2)).toEqual({ kind: "wrong", remainingAttempts: 0, points: 0 });
    expect(e.submitAnswer("p1", "りんご", T0 + 3)).toEqual({ kind: "rejected", code: "no_attempts_left" });
  });

  it("allows unlimited attempts when maxAttempts is null", () => {
    startQuestions(e, makeSet({ maxAttempts: null }), false, T0);
    for (let i = 0; i < 10; i++) {
      expect(e.submitAnswer("p1", "ごりら", T0 + i)).toEqual({ kind: "wrong", remainingAttempts: null, points: 0 });
    }
    expect(e.submitAnswer("p1", "りんご", T0 + 11).kind).toBe("correct");
  });

  it("applies wrongPenalty", () => {
    startQuestions(e, makeSet({ wrongPenalty: 10 }), false, T0);
    expect(e.submitAnswer("p1", "ごりら", T0 + 1)).toEqual({ kind: "wrong", remainingAttempts: 2, points: -10 });
    expect(e.leaderboard().find((x) => x.participantId === "p1")?.score).toBe(-10);
  });

  it("rejects a second answer after a correct one", () => {
    startQuestions(e, makeSet(), false, T0);
    e.submitAnswer("p1", "りんご", T0 + 1);
    expect(e.submitAnswer("p1", "りんご", T0 + 2)).toEqual({ kind: "rejected", code: "already_correct" });
  });

  it("rejects answers after the deadline", () => {
    startQuestions(e, makeSet({ timerMode: "fixed", timerSeconds: 10 }), false, T0);
    expect(e.submitAnswer("p1", "りんご", T0 + 10_000)).toEqual({ kind: "rejected", code: "deadline_passed" });
  });

  it("rejects answers from unknown participants", () => {
    startQuestions(e, makeSet(), false, T0);
    expect(e.submitAnswer("ghost", "りんご", T0 + 1)).toEqual({ kind: "rejected", code: "forbidden" });
  });

  it("sets the deadline only on the first correct answer in afterFirstCorrect mode", () => {
    startQuestions(e, makeSet({ timerMode: "afterFirstCorrect", timerSeconds: 15 }), false, T0);
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
    startQuestions(e, set, false, T0);
    expect(e.submitAnswer("p1", "りんご", T0 + 1)).toMatchObject({ points: 10 });
  });

  it("reports myStatus, correctCount and allParticipantsDone", () => {
    startQuestions(e, makeSet({ maxAttempts: 1 }), false, T0);
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
    startQuestions(e, makeSet({ maxAttempts: 1 }), false, T0);
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
    startQuestions(e, makeSet(), false, T0);
    e.submitAnswer("p1", "りんご", T0 + 1);
    const e2 = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
    expect(e2.snapshot()).toEqual(e.snapshot());
    expect(e2.leaderboard()).toEqual(e.leaderboard());
  });
});

describe("GameEngine close / next / final", () => {
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
    startQuestions(e, makeSet(), false, T0);
  });

  it("closeQuestion moves to questionResult and lists correct answerers in rank order", () => {
    e.submitAnswer("p2", "りんご", T0 + 1);
    e.submitAnswer("p1", "りんご", T0 + 2);
    const result = e.closeQuestion(T0 + 5000);
    expect(e.phase).toBe("questionResult");
    expect(result).toEqual({
      answers: ["りんご", "林檎"],
      results: [
        { participantId: "p2", nickname: "たろう", correctRank: 1, points: 150 },
        { participantId: "p1", nickname: "みさき", correctRank: 2, points: 130 },
      ],
    });
    expect(e.questionResult()).toEqual(result);
  });

  it("questionResult carries the explanation image only when the question has one", () => {
    expect(e.closeQuestion(T0 + 1).explanationImageUrl).toBeUndefined();
    e.next(T0 + 2);
    expect(e.closeQuestion(T0 + 3)).toMatchObject({ answers: ["ばなな"], explanationImageUrl: "/api/images/banana-why.png" });
  });

  it("the question view never includes the explanation image", () => {
    e.closeQuestion(T0 + 1);
    const r = e.next(T0 + 2);
    if (r.kind !== "question") throw new Error("expected question");
    expect(r.question).not.toHaveProperty("explanationImageUrl");
    expect(e.currentQuestionView()).not.toHaveProperty("explanationImageUrl");
  });

  it("closeQuestion throws outside question phase", () => {
    e.closeQuestion(T0 + 1);
    expect(() => e.closeQuestion(T0 + 2)).toThrow();
  });

  it("rejects answers after manual close", () => {
    e.closeQuestion(T0 + 1);
    expect(e.submitAnswer("p1", "りんご", T0 + 2)).toEqual({ kind: "rejected", code: "not_in_question" });
  });

  it("next opens the following question with a fresh deadline and attempts", () => {
    e.submitAnswer("p1", "ごりら", T0 + 1);
    e.closeQuestion(T0 + 2);
    const r = e.next(T0 + 10_000);
    expect(r).toEqual({
      kind: "question",
      question: { index: 1, total: 2, mode: "anagram", prompt: "なばな", hint: undefined, imageUrl: "/api/images/banana.png", deadlineAt: T0 + 10_000 + 30_000, maxAttempts: 3 },
    });
    expect(e.myStatus("p1")).toEqual({ attemptsUsed: 0, correct: false, correctRank: null });
  });

  it("next after the last question returns the final leaderboard", () => {
    e.submitAnswer("p1", "りんご", T0 + 1);
    e.closeQuestion(T0 + 2);
    e.next(T0 + 3);
    e.submitAnswer("p2", "ばなな", T0 + 4);
    e.closeQuestion(T0 + 5);
    const r = e.next(T0 + 6);
    expect(r).toEqual({
      kind: "final",
      entries: [
        { participantId: "p1", nickname: "みさき", score: 150, rank: 1 },
        { participantId: "p2", nickname: "たろう", score: 150, rank: 1 },
      ],
    });
    expect(e.phase).toBe("finalResult");
    expect(e.currentQuestionView()).toBeNull();
  });

  it("next throws unless in questionResult phase", () => {
    expect(() => e.next(T0 + 1)).toThrow();
  });

  it("endGame returns to lobby keeping scores", () => {
    e.submitAnswer("p1", "りんご", T0 + 1);
    e.closeQuestion(T0 + 2);
    e.next(T0 + 3);
    e.closeQuestion(T0 + 4);
    e.next(T0 + 5);
    e.endGame();
    expect(e.phase).toBe("lobby");
    expect(e.leaderboard()[0].score).toBe(150);
    expect(e.deadlineAt).toBeNull();
  });
});

describe("GameEngine GM live controls", () => {
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
  });

  describe("settings override", () => {
    it("starts with no override and reports the set's settings once started", () => {
      expect(e.settingsOverride()).toEqual({});
      startQuestions(e, makeSet({ timerSeconds: 30, maxAttempts: 3, wrongPenalty: 0 }), false, T0);
      expect(e.settings()).toMatchObject({ timerSeconds: 30, maxAttempts: 3, wrongPenalty: 0 });
    });

    it("override takes precedence over set settings and per-question overrides", () => {
      const set = makeSet({ timerSeconds: 30 });
      set.questions[1].overrides = { timerSeconds: 10, maxAttempts: 1 };
      startQuestions(e, set, false, T0);
      e.setSettingsOverride({ timerSeconds: 5, maxAttempts: null, wrongPenalty: 20 });
      expect(e.settingsOverride()).toEqual({ timerSeconds: 5, maxAttempts: null, wrongPenalty: 20 });
      expect(e.settings(0)).toMatchObject({ timerSeconds: 5, maxAttempts: null, wrongPenalty: 20 });
      expect(e.settings(1)).toMatchObject({ timerSeconds: 5, maxAttempts: null, wrongPenalty: 20 });
    });

    it("override can be set in the lobby and applies when the game starts", () => {
      e.setSettingsOverride({ timerSeconds: 7 });
      startQuestions(e, makeSet({ timerSeconds: 30 }), false, T0);
      expect(e.deadlineAt).toBe(T0 + 7_000);
    });

    it("override applies from the next question, not the running one", () => {
      startQuestions(e, makeSet({ timerSeconds: 30 }), false, T0);
      e.setSettingsOverride({ timerSeconds: 5 });
      expect(e.deadlineAt).toBe(T0 + 30_000);
      e.closeQuestion(T0 + 1);
      const r = e.next(T0 + 2);
      expect(r.kind).toBe("question");
      expect(e.deadlineAt).toBe(T0 + 2 + 5_000);
    });

    it("override of maxAttempts and wrongPenalty is used when judging answers", () => {
      startQuestions(e, makeSet({ maxAttempts: 3, wrongPenalty: 0 }), false, T0);
      e.setSettingsOverride({ maxAttempts: 1, wrongPenalty: 25 });
      expect(e.submitAnswer("p1", "ちがう", T0 + 1)).toEqual({ kind: "wrong", remainingAttempts: 0, points: -25 });
      expect(e.submitAnswer("p1", "りんご", T0 + 2)).toEqual({ kind: "rejected", code: "no_attempts_left" });
      expect(e.getParticipant("p1")?.score).toBe(-25);
    });

    it("override survives a snapshot round trip and endGame", () => {
      e.setSettingsOverride({ timerSeconds: 5 });
      const e2 = GameEngine.fromSnapshot(e.snapshot());
      expect(e2.settingsOverride()).toEqual({ timerSeconds: 5 });
      e2.endGame();
      expect(e2.settingsOverride()).toEqual({ timerSeconds: 5 });
    });
  });

  describe("adjustScore", () => {
    it("adds a delta to the participant's score and returns the participant", () => {
      expect(e.adjustScore("p1", 50)).toMatchObject({ id: "p1", score: 50 });
      expect(e.adjustScore("p1", -30)).toMatchObject({ id: "p1", score: 20 });
      expect(e.leaderboard()[0]).toMatchObject({ participantId: "p1", score: 20, rank: 1 });
    });
    it("returns null for an unknown participant", () => {
      expect(e.adjustScore("nobody", 10)).toBeNull();
    });
  });

  describe("removeParticipant", () => {
    it("removes the participant and returns it", () => {
      expect(e.removeParticipant("p1", T0)).toMatchObject({ id: "p1", nickname: "みさき" });
      expect(e.getParticipant("p1")).toBeNull();
      expect(e.participants().map((p) => p.id)).toEqual(["p2"]);
      expect(e.leaderboard().map((l) => l.participantId)).toEqual(["p2"]);
    });
    it("returns null for an unknown participant", () => {
      expect(e.removeParticipant("nobody", T0)).toBeNull();
    });
    it("drops the removed participant's answers so results and correct count ignore them", () => {
      startQuestions(e, makeSet(), false, T0);
      e.submitAnswer("p1", "りんご", T0 + 1);
      e.submitAnswer("p2", "りんご", T0 + 2);
      e.removeParticipant("p1", T0);
      expect(e.correctCount()).toBe(1);
      const result = e.closeQuestion(T0 + 3);
      expect(result.results.map((r) => r.participantId)).toEqual(["p2"]);
    });
    it("a removed participant can no longer answer", () => {
      startQuestions(e, makeSet(), false, T0);
      e.removeParticipant("p1", T0);
      expect(e.submitAnswer("p1", "りんご", T0 + 1)).toEqual({ kind: "rejected", code: "forbidden" });
    });
  });
});

describe("GameEngine live settings applied to the running question", () => {
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
  });

  it("setSettingsOverride replaces the whole override (keys not sent are cleared)", () => {
    e.setSettingsOverride({ timerSeconds: 5, wrongPenalty: 20 });
    e.setSettingsOverride({ maxAttempts: null });
    expect(e.settingsOverride()).toEqual({ maxAttempts: null });
  });

  it("switching to fixed during a question without a deadline starts a countdown now", () => {
    startQuestions(e, makeSet({ timerMode: "none", timerSeconds: 60 }), false, T0);
    expect(e.deadlineAt).toBeNull();
    e.setSettingsOverride({ timerMode: "fixed", timerSeconds: 10 });
    expect(e.reconcileDeadline(T0 + 5_000)).toEqual({ changed: true, deadlineAt: T0 + 15_000 });
    expect(e.deadlineAt).toBe(T0 + 15_000);
  });

  it("switching to none during a question clears the deadline", () => {
    startQuestions(e, makeSet({ timerMode: "fixed", timerSeconds: 30 }), false, T0);
    e.setSettingsOverride({ timerMode: "none" });
    expect(e.reconcileDeadline(T0 + 1_000)).toEqual({ changed: true, deadlineAt: null });
    expect(e.deadlineAt).toBeNull();
    expect(e.submitAnswer("p1", "りんご", T0 + 60_000).kind).toBe("correct");
  });

  it("switching to afterFirstCorrect starts the countdown only if someone is already correct", () => {
    startQuestions(e, makeSet({ timerMode: "none", timerSeconds: 10 }), false, T0);
    e.setSettingsOverride({ timerMode: "afterFirstCorrect" });
    expect(e.reconcileDeadline(T0 + 1_000)).toEqual({ changed: false, deadlineAt: null });
    // 切り替え後の最初の正解は、通常の afterFirstCorrect と同じく回答時にタイマーを開始する
    expect(e.submitAnswer("p1", "りんご", T0 + 2_000)).toMatchObject({ kind: "correct", deadlineAt: T0 + 12_000, deadlineJustSet: true });
    expect(e.reconcileDeadline(T0 + 3_000)).toEqual({ changed: false, deadlineAt: T0 + 12_000 });
    // 正解者が出てから切り替えた場合も同じく「今」から数える
    const e2 = GameEngine.create("X");
    e2.addParticipant("p1", "a");
    startQuestions(e2, makeSet({ timerMode: "none", timerSeconds: 10 }), false, T0);
    e2.submitAnswer("p1", "りんご", T0 + 1_000);
    e2.setSettingsOverride({ timerMode: "afterFirstCorrect" });
    expect(e2.reconcileDeadline(T0 + 4_000)).toEqual({ changed: true, deadlineAt: T0 + 14_000 });
  });

  it("changing seconds alone leaves a running deadline untouched", () => {
    startQuestions(e, makeSet({ timerMode: "fixed", timerSeconds: 30 }), false, T0);
    e.setSettingsOverride({ timerSeconds: 5 });
    expect(e.reconcileDeadline(T0 + 1_000)).toEqual({ changed: false, deadlineAt: T0 + 30_000 });
  });

  it("does nothing outside the question phase", () => {
    e.setSettingsOverride({ timerMode: "fixed", timerSeconds: 5 });
    expect(e.reconcileDeadline(T0)).toEqual({ changed: false, deadlineAt: null });
    startQuestions(e, makeSet({ timerMode: "none" }), false, T0);
    e.closeQuestion(T0 + 1);
    expect(e.reconcileDeadline(T0 + 2)).toEqual({ changed: false, deadlineAt: T0 + 1 });
  });

  it("basePoints and rankBonus override affect new answers, and the result keeps the points actually awarded", () => {
    startQuestions(e, makeSet({ basePoints: 100, rankBonus: [50] }), false, T0);
    expect(e.submitAnswer("p1", "りんご", T0 + 1)).toMatchObject({ kind: "correct", points: 150 });
    e.setSettingsOverride({ basePoints: 10, rankBonus: [] });
    expect(e.submitAnswer("p2", "林檎", T0 + 2)).toMatchObject({ kind: "correct", points: 10 });
    const r = e.closeQuestion(T0 + 3);
    expect(r.results.map((x) => [x.participantId, x.points])).toEqual([["p1", 150], ["p2", 10]]);
    expect(e.leaderboard().map((x) => [x.participantId, x.score])).toEqual([["p1", 150], ["p2", 10]]);
  });
});

function makeSetWithIntro(): QuestionSet {
  return {
    ...makeSet(),
    coverImageUrl: "/api/images/cover.png",
    introSlides: [
      { id: "s1", heading: "ルール", body: "3回まで回答できます" },
      { id: "s2", imageUrl: "/api/images/rules.png" },
    ],
  };
}

describe("GameEngine intro", () => {
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("ABC123");
    e.addParticipant("p1", "みさき");
  });

  it("start shows the title slide with the effective settings of question 1", () => {
    e.setSettingsOverride({ maxAttempts: 5 });
    const intro = e.start(makeSetWithIntro(), false);
    expect(e.phase).toBe("intro");
    expect(e.introIndex).toBe(0);
    expect(intro).toEqual({
      index: 0, total: 3,
      slide: { kind: "title", name: "テスト", coverImageUrl: "/api/images/cover.png", questionCount: 2, settings: { ...DEFAULT_SETTINGS, maxAttempts: 5 }, mode: "anagram", audio: false },
    });
    expect(e.introView()).toEqual(intro);
    expect(e.currentQuestionView()).toBeNull();
    expect(e.questionResult()).toBeNull();
    expect(e.correctCount()).toBe(0);
    expect(e.myStatus("p1")).toBeNull();
  });

  it("next walks through the intro slides and then opens question 1", () => {
    e.start(makeSetWithIntro(), false);
    expect(e.next(T0)).toEqual({ kind: "intro", intro: { index: 1, total: 3, slide: { kind: "slide", heading: "ルール", body: "3回まで回答できます", imageUrl: undefined } } });
    expect(e.next(T0)).toMatchObject({ kind: "intro", intro: { index: 2, total: 3, slide: { kind: "slide", imageUrl: "/api/images/rules.png" } } });
    const q = e.next(T0);
    expect(q).toMatchObject({ kind: "question", question: { index: 0, prompt: "ごんり", deadlineAt: T0 + 30_000 } });
    expect(e.phase).toBe("question");
    expect(e.introView()).toBeNull();
  });

  it("without intro slides the title is followed directly by question 1", () => {
    expect(e.start(makeSet(), false).total).toBe(1);
    expect(e.next(T0).kind).toBe("question");
  });

  it("rejects answers during intro and keeps scores", () => {
    e.start(makeSet(), false);
    expect(e.submitAnswer("p1", "りんご", T0)).toEqual({ kind: "rejected", code: "not_in_question" });
    expect(e.leaderboard()[0].score).toBe(0);
  });

  it("allParticipantsDone is false during intro", () => {
    e.start(makeSet(), false);
    expect(e.allParticipantsDone()).toBe(false);
    expect(() => e.closeQuestion(T0)).toThrow();
  });

  it("endGame from intro returns to lobby and resets the intro index", () => {
    e.start(makeSetWithIntro(), false);
    e.next(T0);
    e.endGame();
    expect(e.phase).toBe("lobby");
    expect(e.introIndex).toBe(0);
    expect(e.introView()).toBeNull();
  });

  it("restores a snapshot without introIndex as 0", () => {
    const snap = e.snapshot() as Partial<EngineState>;
    delete snap.introIndex;
    expect(GameEngine.fromSnapshot(snap as EngineState).introIndex).toBe(0);
  });
});

describe("GameEngine buzzer mode", () => {
  const PROMPT = "日本で一番高い山は何でしょう？";   // 15 文字
  function makeBuzzerSet(overrides: Partial<QuestionSet["settings"]> = {}, questions?: QuestionSet["questions"]): QuestionSet {
    return {
      id: "bz", name: "早押し", mode: "buzzer",
      settings: { ...DEFAULT_SETTINGS, charsPerSecond: 5, wrongPenalty: 20, ...overrides },
      questions: questions ?? [
        { id: "b1", type: "anagram", prompt: PROMPT, answers: ["富士山"], hint: "静岡と山梨" },
        { id: "b2", type: "anagram", prompt: "二番目は？", answers: ["北岳"] },
      ],
    };
  }
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("BZ0001");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
    e.addParticipant("p3", "ケン");
  });

  it("opens the question in ready state with no deadline even when timerMode is fixed", () => {
    const view = startQuestions(e, makeBuzzerSet({ timerMode: "fixed", timerSeconds: 20 }), false, T0);
    expect(view.mode).toBe("buzzer");
    expect(view.deadlineAt).toBeNull();
    expect(e.buzzerView()).toEqual({
      status: "ready", readingStartedAt: null, revealedChars: 0, positionMs: 0, promptLength: 15, charsPerSecond: 5, queue: [], lockedOut: [],
    });
    expect(e.reconcileDeadline(T0 + 1000)).toEqual({ changed: false, deadlineAt: null });
  });

  it("strips the prompt and hint from the player view but not from the GM view", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    expect(e.currentQuestionView("gm")).toMatchObject({ prompt: PROMPT, hint: "静岡と山梨" });
    expect(e.currentQuestionView("player")).toMatchObject({ prompt: "", hint: undefined, mode: "buzzer" });
    expect(e.currentQuestionView()).toMatchObject({ prompt: PROMPT });
  });

  it("the title slide carries the mode", () => {
    const intro = e.start(makeBuzzerSet(), false);
    expect(intro.slide).toMatchObject({ kind: "title", mode: "buzzer" });
    expect(e.start(makeSet(), false).slide).toMatchObject({ kind: "title", mode: "anagram" });
  });

  it("rejects buzzes before reading starts and text answers at any time", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    expect(e.buzz("p1", T0 + 100)).toEqual({ kind: "rejected", code: "not_reading" });
    expect(e.submitAnswer("p1", "富士山", T0 + 100)).toEqual({ kind: "rejected", code: "not_in_question" });
    expect(e.buzz("nobody", T0 + 100)).toEqual({ kind: "rejected", code: "forbidden" });
  });

  it("startReading moves to reading and only works from ready", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    const v = e.startReading(T0 + 2000);
    expect(v).toMatchObject({ status: "reading", readingStartedAt: T0 + 2000, revealedChars: 0 });
    expect(() => e.startReading(T0 + 3000)).toThrow();
  });

  it("the first buzz freezes the reveal at the server arrival time; later buzzes queue without moving it", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    expect(e.buzz("p2", T0 + 1400)).toEqual({ kind: "accepted", position: 1 });   // 1.4s × 5 = 7 文字
    expect(e.buzzerView()).toMatchObject({ status: "paused", readingStartedAt: null, revealedChars: 7 });
    expect(e.buzz("p1", T0 + 3000)).toEqual({ kind: "accepted", position: 2 });
    expect(e.buzzerView()).toMatchObject({ revealedChars: 7, queue: [{ participantId: "p2", nickname: "たろう" }, { participantId: "p1", nickname: "みさき" }] });
    expect(e.buzz("p2", T0 + 3100)).toEqual({ kind: "rejected", code: "already_buzzed" });
  });

  it("judge correct awards basePoints, records a rank-1 answer and closes the question", () => {
    startQuestions(e, makeBuzzerSet({ basePoints: 100, rankBonus: [50, 30, 10] }), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000);
    const r = e.judge("p2", true, T0 + 5000);
    expect(r).toMatchObject({ kind: "correct", participantId: "p2", points: 100 });
    expect(e.phase).toBe("questionResult");
    expect(e.buzzerView()).toBeNull();
    expect(e.questionResult()?.results).toEqual([{ participantId: "p2", nickname: "たろう", correctRank: 1, points: 100 }]);
    expect(e.getParticipant("p2")?.score).toBe(100);
    expect(e.myStatus("p2")).toEqual({ attemptsUsed: 1, correct: true, correctRank: 1 });
    expect(e.buzz("p1", T0 + 6000)).toEqual({ kind: "rejected", code: "not_in_question" });
  });

  it("judge wrong deducts wrongPenalty, locks the answerer out and passes the turn to the next in queue", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000);
    e.buzz("p1", T0 + 1200);
    const r = e.judge("p2", false, T0 + 4000);
    expect(r).toEqual({ kind: "wrong", participantId: "p2", points: -20 });
    expect(e.getParticipant("p2")?.score).toBe(-20);
    expect(e.buzzerView()).toMatchObject({ status: "paused", revealedChars: 5, queue: [{ participantId: "p1", nickname: "みさき" }], lockedOut: ["p2"] });
    expect(e.myStatus("p2")).toEqual({ attemptsUsed: 1, correct: false, correctRank: null });
    expect(e.buzz("p2", T0 + 4100)).toEqual({ kind: "rejected", code: "locked_out" });
  });

  it("judge wrong with an empty queue resumes reading from the frozen position", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000);
    e.judge("p2", false, T0 + 4000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 4000, revealedChars: 5, queue: [] });
    // 再開後 1 秒で 5 + 5 文字
    expect(e.buzz("p1", T0 + 5000)).toEqual({ kind: "accepted", position: 1 });
    expect(e.buzzerView()).toMatchObject({ status: "paused", revealedChars: 10 });
  });

  it("judge throws unless someone is answering", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    expect(() => e.judge("p1", true, T0)).toThrow();
    e.startReading(T0);
    expect(() => e.judge("p1", false, T0 + 10)).toThrow();
  });

  it("allParticipantsDone is true only when every connected participant is locked out and the queue is empty", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.setConnected("p3", false);
    e.buzz("p1", T0 + 100); e.judge("p1", false, T0 + 200);
    expect(e.allParticipantsDone()).toBe(false);
    e.buzz("p2", T0 + 300);
    expect(e.allParticipantsDone()).toBe(false);   // p2 はキューに居る
    e.judge("p2", false, T0 + 400);
    expect(e.allParticipantsDone()).toBe(true);
  });

  it("kicking the answerer passes the turn without a penalty; kicking someone further back only drops them", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000); e.buzz("p1", T0 + 1100); e.buzz("p3", T0 + 1200);
    e.removeParticipant("p1", T0 + 2000);
    expect(e.buzzerView()).toMatchObject({ status: "paused", queue: [{ participantId: "p2", nickname: "たろう" }, { participantId: "p3", nickname: "ケン" }] });
    e.removeParticipant("p2", T0 + 3000);
    expect(e.buzzerView()).toMatchObject({ status: "paused", revealedChars: 5, queue: [{ participantId: "p3", nickname: "ケン" }], lockedOut: [] });
    expect(e.leaderboard().map((x) => x.score)).toEqual([0]);
    e.removeParticipant("p3", T0 + 4000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 4000, revealedChars: 5, queue: [] });
  });

  it("rebaseReading keeps the revealed count continuous when charsPerSecond changes", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.rebaseReading(T0 + 1000);                 // 5 文字表示済み
    e.setSettingsOverride({ charsPerSecond: 10 });
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 1000, revealedChars: 5, charsPerSecond: 10 });
    e.buzz("p1", T0 + 1500);                    // + 0.5s × 10 = 5
    expect(e.buzzerView()?.revealedChars).toBe(10);
  });

  it("rebaseReading does nothing outside reading", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.rebaseReading(T0 + 1000);
    expect(e.buzzerView()).toMatchObject({ status: "ready", readingStartedAt: null, revealedChars: 0 });
  });

  it("close, next and endGame clear the buzzer state; the next question starts ready again", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p1", T0 + 500);
    e.closeQuestion(T0 + 1000);
    expect(e.buzzerView()).toBeNull();
    expect(e.snapshot().buzzer).toBeNull();
    const r = e.next(T0 + 2000);
    expect(r.kind).toBe("question");
    expect(e.buzzerView()).toMatchObject({ status: "ready", promptLength: 5, queue: [], lockedOut: [] });
    e.endGame();
    expect(e.snapshot().buzzer).toBeNull();
  });

  it("restores a snapshot without a buzzer field and round-trips one with it", () => {
    startQuestions(e, makeBuzzerSet(), false, T0);
    e.startReading(T0);
    e.buzz("p1", T0 + 500);
    const snap = JSON.parse(JSON.stringify(e.snapshot())) as EngineState;
    expect(GameEngine.fromSnapshot(snap).buzzerView()).toEqual(e.buzzerView());
    const legacy = { ...snap } as Partial<EngineState>;
    delete legacy.buzzer;
    expect(GameEngine.fromSnapshot(legacy as EngineState).snapshot().buzzer).toBeNull();
  });

  it("counts an emoji prompt by code points", () => {
    startQuestions(e, makeBuzzerSet({}, [{ id: "x", type: "anagram", prompt: "a😀b", answers: ["c"] }]), false, T0);
    expect(e.buzzerView()?.promptLength).toBe(3);
  });
});

describe("GameEngine buzzer judge target", () => {
  it("rejects a judge whose participantId is not the current answerer, without scoring anyone", () => {
    const e = GameEngine.create("BZ0002");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
    const set: QuestionSet = {
      id: "bz", name: "早押し", mode: "buzzer", settings: { ...DEFAULT_SETTINGS, wrongPenalty: 20 },
      questions: [{ id: "b1", type: "anagram", prompt: "日本で一番高い山は何でしょう？", answers: ["富士山"] }],
    };
    startQuestions(e, set, false, T0);
    e.startReading(T0);
    e.buzz("p2", T0 + 1000);
    e.buzz("p1", T0 + 1100);
    expect(e.judge("p2", false, T0 + 2000)).toEqual({ kind: "wrong", participantId: "p2", points: -20 });
    // 二度押し: p2 はもう回答中ではないので拒否され、p1 は減点されない
    expect(e.judge("p2", false, T0 + 2100)).toEqual({ kind: "rejected", code: "invalid_state" });
    expect(e.getParticipant("p1")?.score).toBe(0);
    expect(e.buzzerView()).toMatchObject({ status: "paused", queue: [{ participantId: "p1", nickname: "みさき" }] });
    expect(e.judge("p1", true, T0 + 3000)).toMatchObject({ kind: "correct", participantId: "p1", points: 100 });
  });
});

describe("GameEngine buzzer mode with question audio", () => {
  // 「問題！」と間の 2.0 秒の後に 5 文字が出る。2・3 文字目は同時
  const AUDIO = { url: "/api/audio/a.mp3", revealAtMs: [2000, 2300, 2300, 2700, 3000] };
  function makeAudioSet(): QuestionSet {
    return {
      id: "bza", name: "音声付き早押し", mode: "buzzer",
      settings: { ...DEFAULT_SETTINGS, charsPerSecond: 5, wrongPenalty: 20 },
      questions: [
        { id: "a1", type: "anagram", prompt: "あいうえお", answers: ["か"], audio: AUDIO },
        { id: "a2", type: "anagram", prompt: "音声なし", answers: ["き"] },
      ],
    };
  }
  let e: GameEngine;
  beforeEach(() => {
    e = GameEngine.create("BZA001");
    e.addParticipant("p1", "みさき");
    e.addParticipant("p2", "たろう");
    startQuestions(e, makeAudioSet(), false, T0);
  });

  it("startReading plays from the head of the audio", () => {
    expect(e.startReading(T0)).toMatchObject({ status: "reading", readingStartedAt: T0, revealedChars: 0, positionMs: 0 });
  });

  it("a buzz records the playback position and the chars revealed by the timing table", () => {
    e.startReading(T0);
    e.buzz("p1", T0 + 2500);
    expect(e.buzzerView()).toMatchObject({ status: "paused", readingStartedAt: null, revealedChars: 3, positionMs: 2500 });
  });

  it("resuming rewinds the playback to the reveal time of the last shown char and keeps the count", () => {
    e.startReading(T0);
    e.buzz("p1", T0 + 2500);
    e.judge("p1", false, T0 + 6000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 6000, revealedChars: 3, positionMs: 2300 });
    e.buzz("p2", T0 + 6450);                     // 2300 + 450 = 2750 → 4 文字
    expect(e.buzzerView()).toMatchObject({ revealedChars: 4, positionMs: 2750 });
  });

  it("a buzz during the cue resumes from the head of the audio", () => {
    e.startReading(T0);
    e.buzz("p1", T0 + 1000);
    expect(e.buzzerView()).toMatchObject({ revealedChars: 0, positionMs: 1000 });
    e.judge("p1", false, T0 + 3000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", revealedChars: 0, positionMs: 0 });
  });

  it("does not rewind once the whole prompt is shown", () => {
    e.startReading(T0);
    e.buzz("p1", T0 + 5000);
    e.judge("p1", false, T0 + 8000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", revealedChars: 5, positionMs: 5000 });
  });

  it("kicking the answerer resumes with the same rewind", () => {
    e.startReading(T0);
    e.buzz("p1", T0 + 2800);
    e.removeParticipant("p1", T0 + 4000);
    expect(e.buzzerView()).toMatchObject({ status: "reading", readingStartedAt: T0 + 4000, revealedChars: 4, positionMs: 2700 });
  });

  it("a charsPerSecond change rebases the playback position but does not change the pace", () => {
    e.startReading(T0);
    e.rebaseReading(T0 + 2500);
    e.setSettingsOverride({ charsPerSecond: 30 });
    expect(e.buzzerView()).toMatchObject({ readingStartedAt: T0 + 2500, revealedChars: 3, positionMs: 2500 });
    e.buzz("p1", T0 + 2700);                     // 2700ms → 4 文字（30 文字/秒なら全部出ている）
    expect(e.buzzerView()).toMatchObject({ revealedChars: 4, positionMs: 2700 });
  });

  it("a question without audio in the same set still uses charsPerSecond", () => {
    e.startReading(T0);
    e.buzz("p1", T0 + 100);
    e.judge("p1", true, T0 + 200);
    e.next(T0 + 300);
    e.startReading(T0 + 1000);
    e.buzz("p2", T0 + 1400);                     // 0.4s × 5 = 2 文字
    expect(e.buzzerView()).toMatchObject({ revealedChars: 2 });
  });

  it("restores a buzzer snapshot without positionMs as 0", () => {
    e.startReading(T0);
    const snap = JSON.parse(JSON.stringify(e.snapshot())) as EngineState;
    delete (snap.buzzer as Partial<NonNullable<EngineState["buzzer"]>>).positionMs;
    expect(GameEngine.fromSnapshot(snap).buzzerView()).toMatchObject({ status: "reading", positionMs: 0 });
  });
});

describe("GameEngine views with question audio", () => {
  const AUDIO = { url: "/api/audio/a.mp3", revealAtMs: [2000, 2300, 2300] };
  function set(withAudioOnAll: boolean): QuestionSet {
    return {
      id: "bzv", name: "音声", mode: "buzzer", settings: { ...DEFAULT_SETTINGS },
      questions: [
        { id: "v1", type: "anagram", prompt: "あいう", answers: ["え"], audio: AUDIO },
        { id: "v2", type: "anagram", prompt: "かきく", answers: ["け"], audio: withAudioOnAll ? AUDIO : undefined },
      ],
    };
  }

  it("sends the audio to the GM only", () => {
    const e = GameEngine.create("BZV001");
    startQuestions(e, set(false), false, T0);
    expect(e.currentQuestionView("gm")?.audio).toEqual(AUDIO);
    expect(e.currentQuestionView("player")?.audio).toBeUndefined();
  });

  it("sends no audio for a question without one", () => {
    const e = GameEngine.create("BZV002");
    e.addParticipant("p1", "みさき");
    startQuestions(e, set(false), false, T0);
    e.startReading(T0);
    e.buzz("p1", T0 + 100);
    e.judge("p1", true, T0 + 200);
    e.next(T0 + 300);
    expect(e.currentQuestionView("gm")?.audio).toBeUndefined();
  });

  it("the title slide says whether every question has audio", () => {
    expect(GameEngine.create("BZV003").start(set(true), false).slide).toMatchObject({ kind: "title", audio: true });
    expect(GameEngine.create("BZV004").start(set(false), false).slide).toMatchObject({ kind: "title", audio: false });
  });
});
