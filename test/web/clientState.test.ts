import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
import { applyServerMessage, initialClientState, setConnected, type ClientState } from "../../src/web/lib/clientState";
import type { IntroView, StateMessage } from "../../src/shared/messages";
import { remainingSeconds } from "../../src/web/lib/time";

const T0 = 1_700_000_000_000;

const baseState: StateMessage = {
  type: "state", role: "player", serverTime: T0 + 500, roomCode: "ABC123", phase: "lobby",
  participants: [{ id: "p1", nickname: "みさき", score: 0, connected: true }],
  leaderboard: [{ participantId: "p1", nickname: "みさき", score: 0, rank: 1 }],
  intro: null, question: null, questionResult: null,
  me: { id: "p1", nickname: "みさき", score: 0, connected: true, status: null },
  questionSetName: null,
  correctCount: 0,
  settings: { override: {}, effective: null, mode: null },
  buzzer: null,
};

function withState(): ClientState {
  return applyServerMessage(setConnected(initialClientState, true), baseState, T0);
}

describe("applyServerMessage", () => {
  it("state message populates everything and computes clock offset", () => {
    const s = withState();
    expect(s.ready).toBe(true);
    expect(s.role).toBe("player");
    expect(s.roomCode).toBe("ABC123");
    expect(s.clockOffsetMs).toBe(500);
    expect(s.me?.nickname).toBe("みさき");
  });

  it("participantJoined adds or replaces; participantLeft marks disconnected", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "participantJoined", participant: { id: "p2", nickname: "たろう", score: 0, connected: true } }, T0);
    expect(s.participants).toHaveLength(2);
    s = applyServerMessage(s, { type: "participantJoined", participant: { id: "p2", nickname: "タロウ", score: 0, connected: true } }, T0);
    expect(s.participants).toHaveLength(2);
    expect(s.participants[1].nickname).toBe("タロウ");
    s = applyServerMessage(s, { type: "participantLeft", participant: { id: "p2", nickname: "タロウ", score: 0, connected: false } }, T0);
    expect(s.participants[1].connected).toBe(false);
  });

  it("questionStarted sets phase/question and clears previous answer result", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "answerResult", correct: false, correctRank: null, remainingAttempts: 2, points: 0 }, T0);
    s = applyServerMessage(s, { type: "questionStarted", question: { index: 0, total: 20, mode: "anagram" as const, prompt: "ごんり", deadlineAt: T0 + 30_000, maxAttempts: 3 } }, T0);
    expect(s.phase).toBe("question");
    expect(s.question?.prompt).toBe("ごんり");
    expect(s.lastAnswerResult).toBeNull();
    expect(s.questionResult).toBeNull();
    expect(s.me?.status).toEqual({ attemptsUsed: 0, correct: false, correctRank: null });
  });

  it("deadlineSet updates the current question deadline", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "questionStarted", question: { index: 0, total: 1, mode: "anagram" as const, prompt: "x", deadlineAt: null, maxAttempts: null } }, T0);
    s = applyServerMessage(s, { type: "deadlineSet", deadlineAt: T0 + 15_000 }, T0);
    expect(s.question?.deadlineAt).toBe(T0 + 15_000);
  });

  it("answerResult updates my status and lastAnswerResult", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "questionStarted", question: { index: 0, total: 1, mode: "anagram" as const, prompt: "x", deadlineAt: null, maxAttempts: 3 } }, T0);
    s = applyServerMessage(s, { type: "answerResult", correct: false, correctRank: null, remainingAttempts: 2, points: 0 }, T0);
    expect(s.me?.status).toEqual({ attemptsUsed: 1, correct: false, correctRank: null });
    s = applyServerMessage(s, { type: "answerResult", correct: true, correctRank: 2, remainingAttempts: null, points: 130 }, T0);
    expect(s.me?.status).toEqual({ attemptsUsed: 2, correct: true, correctRank: 2 });
    expect(s.lastAnswerResult?.points).toBe(130);
  });

  it("leaderboard replaces entries and updates my score", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "leaderboard", entries: [{ participantId: "p1", nickname: "みさき", score: 150, rank: 1 }] }, T0);
    expect(s.leaderboard[0].score).toBe(150);
    expect(s.me?.score).toBe(150);
  });

  it("someoneCorrect pushes a popup and keeps the latest five", () => {
    let s = withState();
    for (let i = 1; i <= 6; i++) {
      s = applyServerMessage(s, { type: "someoneCorrect", participantId: `p${i}`, nickname: `n${i}`, correctRank: i, points: 100 }, T0 + i);
    }
    expect(s.popups).toHaveLength(5);
    expect(s.popups[0].nickname).toBe("n2");
    expect(new Set(s.popups.map((p) => p.id)).size).toBe(5);
    expect(s.correctCountThisQuestion).toBe(6);
  });

  it("correctCountThisQuestion comes from state and resets on questionStarted", () => {
    let s = applyServerMessage(initialClientState, { ...baseState, phase: "question", correctCount: 3 }, T0);
    expect(s.correctCountThisQuestion).toBe(3);
    s = applyServerMessage(s, { type: "questionStarted", question: { index: 1, total: 2, mode: "anagram" as const, prompt: "x", deadlineAt: null, maxAttempts: 3 } }, T0);
    expect(s.correctCountThisQuestion).toBe(0);
  });

  it("settings come from state and are replaced by settingsUpdated", () => {
    let s = withState();
    expect(s.settings).toEqual({ override: {}, effective: null, mode: null });
    const settings = { override: { timerSeconds: 5 }, effective: { ...DEFAULT_SETTINGS, timerSeconds: 5 }, mode: "anagram" as const };
    s = applyServerMessage(s, { type: "settingsUpdated", settings }, T0);
    expect(s.settings).toEqual(settings);
  });

  it("leaderboard also syncs scores into the participant list", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "leaderboard", entries: [{ participantId: "p1", nickname: "みさき", score: 100, rank: 1 }] }, T0);
    expect(s.participants[0].score).toBe(100);
  });

  it("participantRemoved drops the participant from the list", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "participantJoined", participant: { id: "p2", nickname: "たろう", score: 0, connected: true } }, T0);
    s = applyServerMessage(s, { type: "participantRemoved", participant: { id: "p1", nickname: "みさき", score: 0, connected: true } }, T0);
    expect(s.participants.map((p) => p.id)).toEqual(["p2"]);
  });

  it("kicked sets the kicked flag", () => {
    let s = withState();
    expect(s.kicked).toBe(false);
    s = applyServerMessage(s, { type: "kicked" }, T0);
    expect(s.kicked).toBe(true);
  });

  it("questionClosed, finalResult and error", () => {
    let s = withState();
    s = applyServerMessage(s, { type: "questionClosed", result: { answers: ["りんご"], results: [] } }, T0);
    expect(s.phase).toBe("questionResult");
    expect(s.questionResult?.answers).toEqual(["りんご"]);
    s = applyServerMessage(s, { type: "finalResult", entries: [{ participantId: "p1", nickname: "みさき", score: 150, rank: 1 }] }, T0);
    expect(s.phase).toBe("finalResult");
    expect(s.finalEntries).toHaveLength(1);
    s = applyServerMessage(s, { type: "error", code: "deadline_passed", message: "時間切れです" }, T0);
    expect(s.lastError).toEqual({ code: "deadline_passed", message: "時間切れです", at: T0 });
  });
});

describe("remainingSeconds", () => {
  it("returns null without a deadline", () => {
    expect(remainingSeconds(null, 0, T0)).toBeNull();
  });
  it("rounds up and clamps at zero using the clock offset", () => {
    expect(remainingSeconds(T0 + 10_000, 0, T0)).toBe(10);
    expect(remainingSeconds(T0 + 9_001, 0, T0)).toBe(10);
    expect(remainingSeconds(T0 + 10_000, 500, T0)).toBe(10); // サーバーは T0+500 なので残り 9.5s → 10
    expect(remainingSeconds(T0 - 1, 0, T0)).toBe(0);
  });
});

describe("live settings during a question", () => {
  const question = { index: 0, total: 2, mode: "anagram" as const, prompt: "ごんり", deadlineAt: null, maxAttempts: 3 };
  const effective = { timerMode: "fixed" as const, timerSeconds: 10, basePoints: 100, rankBonus: [50], wrongPenalty: 0, maxAttempts: null, charsPerSecond: 6 };

  it("settingsUpdated applies the new maxAttempts to the running question", () => {
    let s = applyServerMessage(withState(), { type: "questionStarted", question }, T0);
    s = applyServerMessage(s, { type: "settingsUpdated", settings: { override: { maxAttempts: null }, effective, mode: "anagram" } }, T0);
    expect(s.settings.effective).toEqual(effective);
    expect(s.question?.maxAttempts).toBeNull();
  });

  it("settingsUpdated without a running question only stores the settings", () => {
    const s = applyServerMessage(withState(), { type: "settingsUpdated", settings: { override: {}, effective: null, mode: null } }, T0);
    expect(s.question).toBeNull();
    expect(s.settings).toEqual({ override: {}, effective: null, mode: null });
  });

  it("deadlineSet with null clears the countdown", () => {
    let s = applyServerMessage(withState(), { type: "questionStarted", question: { ...question, deadlineAt: T0 + 5_000 } }, T0);
    s = applyServerMessage(s, { type: "deadlineSet", deadlineAt: null }, T0);
    expect(s.question?.deadlineAt).toBeNull();
  });
});

describe("intro slides", () => {
  const intro: IntroView = { index: 0, total: 1, slide: { kind: "title", name: "テスト", questionCount: 1, settings: DEFAULT_SETTINGS, mode: "anagram", audio: false } };

  it("introStarted sets phase and intro and clears question state", () => {
    let s = applyServerMessage(withState(), { type: "questionStarted", question: { index: 0, total: 1, mode: "anagram" as const, prompt: "x", deadlineAt: null, maxAttempts: 3 } }, T0);
    s = applyServerMessage(s, { type: "answerResult", correct: false, correctRank: null, remainingAttempts: 2, points: 0 }, T0);
    s = applyServerMessage(s, { type: "introStarted", intro }, T0);
    expect(s.phase).toBe("intro");
    expect(s.intro).toEqual(intro);
    expect(s.question).toBeNull();
    expect(s.questionResult).toBeNull();
    expect(s.lastAnswerResult).toBeNull();
    expect(s.finalEntries).toBeNull();
    expect(s.correctCountThisQuestion).toBe(0);
  });

  it("introStarted with the title slide tells the client the question set name", () => {
    const s = applyServerMessage(withState(), { type: "introStarted", intro }, T0);
    expect(s.questionSetName).toBe("テスト");
  });

  it("questionStarted clears intro", () => {
    let s = applyServerMessage(withState(), { type: "introStarted", intro }, T0);
    s = applyServerMessage(s, { type: "questionStarted", question: { index: 0, total: 1, mode: "anagram" as const, prompt: "x", deadlineAt: null, maxAttempts: 3 } }, T0);
    expect(s.intro).toBeNull();
    expect(s.phase).toBe("question");
  });

  it("state message carries intro", () => {
    const s = applyServerMessage(initialClientState, { ...baseState, phase: "intro", intro }, T0);
    expect(s.phase).toBe("intro");
    expect(s.intro).toEqual(intro);
  });
});

describe("unknown server messages", () => {
  it("leaves the state untouched instead of wiping it", () => {
    const s = withState();
    const msg = { type: "somethingFromANewerServer", payload: 1 } as unknown as Parameters<typeof applyServerMessage>[1];
    expect(applyServerMessage(s, msg, T0)).toBe(s);
  });
});

describe("buzzer mode", () => {
  const question = { index: 0, total: 2, mode: "buzzer" as const, prompt: "", deadlineAt: null, maxAttempts: 3 };
  const buzzer = { status: "reading" as const, readingStartedAt: T0, revealedChars: 0, positionMs: 0, promptLength: 15, charsPerSecond: 5, queue: [], lockedOut: [] };

  it("state carries the buzzer view", () => {
    const s = applyServerMessage(initialClientState, { ...baseState, phase: "question", question, buzzer }, T0);
    expect(s.buzzer).toEqual(buzzer);
  });

  it("buzzerUpdated replaces the view; questionStarted and questionClosed clear it", () => {
    let s = applyServerMessage(withState(), { type: "questionStarted", question }, T0);
    expect(s.buzzer).toBeNull();
    s = applyServerMessage(s, { type: "buzzerUpdated", buzzer }, T0);
    expect(s.buzzer?.status).toBe("reading");
    s = applyServerMessage(s, { type: "buzzerUpdated", buzzer: { ...buzzer, status: "paused", revealedChars: 7, readingStartedAt: null, queue: [{ participantId: "p1", nickname: "みさき" }] } }, T0);
    expect(s.buzzer).toMatchObject({ status: "paused", revealedChars: 7 });
    s = applyServerMessage(s, { type: "questionClosed", result: { answers: ["富士山"], results: [] } }, T0);
    expect(s.buzzer).toBeNull();
    s = applyServerMessage(s, { type: "buzzerUpdated", buzzer }, T0);
    s = applyServerMessage(s, { type: "questionStarted", question: { ...question, index: 1 } }, T0);
    expect(s.buzzer).toBeNull();
  });

  it("introStarted and finalResult clear the buzzer view", () => {
    const intro: IntroView = { index: 0, total: 1, slide: { kind: "title", name: "早押し", questionCount: 1, settings: DEFAULT_SETTINGS, mode: "buzzer", audio: false } };
    let s = applyServerMessage(withState(), { type: "buzzerUpdated", buzzer }, T0);
    expect(applyServerMessage(s, { type: "introStarted", intro }, T0).buzzer).toBeNull();
    s = applyServerMessage(s, { type: "finalResult", entries: [] }, T0);
    expect(s.buzzer).toBeNull();
  });
});
