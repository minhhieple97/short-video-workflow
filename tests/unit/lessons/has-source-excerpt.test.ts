import { describe, expect, it } from "vitest";

import { hasSourceExcerpt } from "@/features/lessons/domain/source-excerpts";

describe("hasSourceExcerpt", () => {
  it("is true when any source carries an excerpt", () => {
    expect(hasSourceExcerpt([{ sourceExcerpt: null }, { sourceExcerpt: "Một đoạn trong sách." }])).toBe(true);
  });

  it("is false for no sources, missing excerpts and excerpts that are only whitespace", () => {
    expect(hasSourceExcerpt([])).toBe(false);
    expect(hasSourceExcerpt([{ sourceExcerpt: null }])).toBe(false);
    expect(hasSourceExcerpt([{ sourceExcerpt: "" }, { sourceExcerpt: " \n\t " }])).toBe(false);
  });
});
