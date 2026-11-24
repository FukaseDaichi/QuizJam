import { describe, expect, it } from "vitest";
import { shouldShowJudgePairing } from "../../src/web/lib/judgePairing";

describe("shouldShowJudgePairing", () => {
  const p = { expiresAt: 10_000 };
  it("hides without a pairing", () => expect(shouldShowJudgePairing(null, null, 0, 0)).toBe(false));
  it("shows before expiry", () => expect(shouldShowJudgePairing(p, null, 0, 9_999)).toBe(true));
  it("hides at and after expiry", () => {
    expect(shouldShowJudgePairing(p, null, 0, 10_000)).toBe(false);
    expect(shouldShowJudgePairing(p, null, 0, 20_000)).toBe(false);
  });
  it("uses the server clock offset", () => {
    // server is 5s ahead of the local clock: local 6s = server 11s, already expired
    expect(shouldShowJudgePairing(p, null, 5_000, 6_000)).toBe(false);
    expect(shouldShowJudgePairing(p, null, -5_000, 6_000)).toBe(true);
  });
  it("stays hidden once dismissed, but a new pairing shows", () => {
    expect(shouldShowJudgePairing(p, 10_000, 0, 0)).toBe(false);
    expect(shouldShowJudgePairing({ expiresAt: 20_000 }, 10_000, 0, 0)).toBe(true);
  });
});
