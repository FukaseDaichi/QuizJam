import { describe, it, expect } from "vitest";
import { buzzerScreenPromptSizeClass, buzzerSlidePromptSizeClass, introBodySizeClass } from "../../src/web/lib/slideText";

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

describe("buzzer prompt size", () => {
  it("steps down as the prompt gets longer (slide, cqw units)", () => {
    expect(buzzerSlidePromptSizeClass(0)).toBe("text-[5cqw]");
    expect(buzzerSlidePromptSizeClass(40)).toBe("text-[5cqw]");
    expect(buzzerSlidePromptSizeClass(41)).toBe("text-[4cqw]");
    expect(buzzerSlidePromptSizeClass(100)).toBe("text-[4cqw]");
    expect(buzzerSlidePromptSizeClass(101)).toBe("text-[3cqw]");
  });
  it("steps down as the prompt gets longer (GM screen)", () => {
    expect(buzzerScreenPromptSizeClass(40)).toBe("text-5xl");
    expect(buzzerScreenPromptSizeClass(100)).toBe("text-4xl");
    expect(buzzerScreenPromptSizeClass(101)).toBe("text-3xl");
  });
});
