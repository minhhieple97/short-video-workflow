import { describe, expect, it } from "vitest";

import { truncateText } from "@/lib/format";

describe("truncateText", () => {
  it("leaves a short text alone and collapses its whitespace", () => {
    expect(truncateText("  Chương   một \n tiếp ", 60)).toBe("Chương một tiếp");
  });

  it("cuts a long text at a word and marks the cut", () => {
    const result = truncateText("chính tôi cũng không biết rõ nhưng trước đó rất lâu tôi đã hiểu rằng", 30);
    expect(result).toBe("chính tôi cũng không biết rõ…");
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it("cuts mid-word when the text has no usable space", () => {
    const result = truncateText("a".repeat(100), 20);
    expect(result).toBe(`${"a".repeat(19)}…`);
  });

  it("keeps a text exactly at the limit", () => {
    expect(truncateText("abcde", 5)).toBe("abcde");
  });
});
