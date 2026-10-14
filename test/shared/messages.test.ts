import { describe, it, expect } from "vitest";
import { isKnownServerMessage, parseClientMessage } from "../../src/shared/messages";

describe("isKnownServerMessage", () => {
  it("accepts every type the client handles", () => {
    for (const type of ["state", "participantJoined", "participantLeft", "participantRemoved", "kicked", "settingsUpdated", "introStarted", "questionStarted", "deadlineSet", "answerResult", "someoneCorrect", "leaderboard", "questionClosed", "finalResult", "buzzerUpdated", "error"]) {
      expect(isKnownServerMessage({ type })).toBe(true);
    }
  });

  it("rejects unknown types and non-objects, so a stale client can tell the server is newer", () => {
    expect(isKnownServerMessage({ type: "somethingNew" })).toBe(false);
    expect(isKnownServerMessage({})).toBe(false);
    expect(isKnownServerMessage(null)).toBe(false);
    expect(isKnownServerMessage("state")).toBe(false);
  });
});

describe("parseClientMessage buzzer messages", () => {
  it("parses startReading and buzz without payload", () => {
    expect(parseClientMessage(JSON.stringify({ type: "startReading" }))).toEqual({ type: "startReading" });
    expect(parseClientMessage(JSON.stringify({ type: "buzz" }))).toEqual({ type: "buzz" });
  });
  it("parses judge only with a boolean correct and a string participantId", () => {
    expect(parseClientMessage(JSON.stringify({ type: "judge", participantId: "p1", correct: true }))).toEqual({ type: "judge", participantId: "p1", correct: true });
    expect(parseClientMessage(JSON.stringify({ type: "judge", participantId: "p1", correct: false }))).toEqual({ type: "judge", participantId: "p1", correct: false });
    expect(parseClientMessage(JSON.stringify({ type: "judge", participantId: "p1" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "judge", correct: true }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "judge", participantId: "p1", correct: "yes" }))).toBeNull();
  });
  it("accepts charsPerSecond in live settings within 1..30 integers", () => {
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 8 } }))).toEqual({ type: "updateSettings", settings: { charsPerSecond: 8 } });
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 0 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 31 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "updateSettings", settings: { charsPerSecond: 1.5 } }))).toBeNull();
  });
});
