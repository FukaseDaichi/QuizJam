import { describe, it, expect } from "vitest";
import { genresOf, genreCounts, isGenreSet } from "../../src/shared/genre";

const qs = [{ genre: "海" }, { genre: "山" }, { genre: "海" }, { genre: "空" }];

describe("genre helpers", () => {
  it("lists genres in order of first appearance", () => {
    expect(genresOf(qs)).toEqual(["海", "山", "空"]);
  });
  it("counts remaining questions per genre, excluding asked positions", () => {
    expect(genreCounts(qs)).toEqual([{ genre: "海", remaining: 2 }, { genre: "山", remaining: 1 }, { genre: "空", remaining: 1 }]);
    expect(genreCounts(qs, [0, 1])).toEqual([{ genre: "海", remaining: 1 }, { genre: "山", remaining: 0 }, { genre: "空", remaining: 1 }]);
  });
  it("detects genre sets", () => {
    expect(isGenreSet({ mode: "buzzer", questions: qs })).toBe(true);
    expect(isGenreSet({ mode: "buzzer", questions: [{ genre: "海" }, {}] })).toBe(false);
    expect(isGenreSet({ questions: qs })).toBe(false);
    expect(isGenreSet({ mode: "buzzer", questions: [] })).toBe(false);
  });
});
