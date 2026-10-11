import { describe, it, expect } from "vitest";
import { introBodySizeClass } from "../../src/web/lib/slideText";

describe("introBodySizeClass", () => {
  it("shrinks the body text as it gets longer so a 1000-char body still fits the slide", () => {
    expect(introBodySizeClass(100, false)).toBe("text-[3cqw]");
    expect(introBodySizeClass(300, false)).toBe("text-[2.4cqw]");
    expect(introBodySizeClass(600, false)).toBe("text-[1.9cqw]");
    expect(introBodySizeClass(1000, false)).toBe("text-[1.5cqw]");
  });

  it("uses a smaller scale when an image shares the slide", () => {
    expect(introBodySizeClass(100, true)).toBe("text-[2.2cqw]");
    expect(introBodySizeClass(250, true)).toBe("text-[1.8cqw]");
    expect(introBodySizeClass(1000, true)).toBe("text-[1.5cqw]");
  });
});
