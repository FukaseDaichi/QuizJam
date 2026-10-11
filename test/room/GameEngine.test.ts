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
      { id: "q2", type: "anagram", prompt: "なばな", answers: ["ばなな"], imageUrl: "/api/images/banana.png" },
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
      index: 0, total: 2, prompt: "ごんり", hint: undefined,
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
      question: { index: 1, total: 2, prompt: "なばな", hint: undefined, imageUrl: "/api/images/banana.png", deadlineAt: T0 + 10_000 + 30_000, maxAttempts: 3 },
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
      expect(e.removeParticipant("p1")).toMatchObject({ id: "p1", nickname: "みさき" });
      expect(e.getParticipant("p1")).toBeNull();
      expect(e.participants().map((p) => p.id)).toEqual(["p2"]);
      expect(e.leaderboard().map((l) => l.participantId)).toEqual(["p2"]);
    });
    it("returns null for an unknown participant", () => {
      expect(e.removeParticipant("nobody")).toBeNull();
    });
    it("drops the removed participant's answers so results and correct count ignore them", () => {
      startQuestions(e, makeSet(), false, T0);
      e.submitAnswer("p1", "りんご", T0 + 1);
      e.submitAnswer("p2", "りんご", T0 + 2);
      e.removeParticipant("p1");
      expect(e.correctCount()).toBe(1);
      const result = e.closeQuestion(T0 + 3);
      expect(result.results.map((r) => r.participantId)).toEqual(["p2"]);
    });
    it("a removed participant can no longer answer", () => {
      startQuestions(e, makeSet(), false, T0);
      e.removeParticipant("p1");
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
      slide: { kind: "title", name: "テスト", coverImageUrl: "/api/images/cover.png", questionCount: 2, settings: { ...DEFAULT_SETTINGS, maxAttempts: 5 } },
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
