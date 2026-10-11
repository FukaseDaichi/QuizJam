import { describe, it, expect } from "vitest";
import { isKnownServerMessage } from "../../src/shared/messages";

describe("isKnownServerMessage", () => {
  it("accepts every type the client handles", () => {
    for (const type of ["state", "participantJoined", "participantLeft", "participantRemoved", "kicked", "settingsUpdated", "introStarted", "questionStarted", "deadlineSet", "answerResult", "someoneCorrect", "leaderboard", "questionClosed", "finalResult", "error"]) {
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
