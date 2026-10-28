import { describe, expect, it } from "vitest";

import { mergeLessonCandidates } from "@/features/chapters/domain/lesson-candidates";

const lesson = (title: string, excerpts: string[], illustrative = false) => ({
  title,
  exampleIsIllustrative: illustrative,
  sourceExcerpts: excerpts.map((text, index) => ({ page: index + 1, text })),
});

describe("mergeLessonCandidates", () => {
  it("keeps the same lesson found in two parts once, with the evidence of both", () => {
    const merged = mergeLessonCandidates([
      lesson("Bắt đầu bằng hai phút", ["Câu một."]),
      lesson("Thiết kế môi trường", ["Câu hai."]),
      lesson("  bắt đầu bằng HAI phút!  ", ["Câu một.", "Câu ba."], true),
    ]);

    expect(merged.map((item) => item.title)).toEqual(["Bắt đầu bằng hai phút", "Thiết kế môi trường"]);
    expect(merged[0]?.sourceExcerpts.map((excerpt) => excerpt.text)).toEqual(["Câu một.", "Câu ba."]);
    expect(merged[0]?.exampleIsIllustrative).toBe(true);
  });

  it("leaves lessons that only look alike as they are", () => {
    expect(mergeLessonCandidates([lesson("Bắt đầu nhỏ", []), lesson("Bắt đầu nhỏ hơn", [])])).toHaveLength(2);
  });

  it("does not change the lessons it was given", () => {
    const first = lesson("A", ["x"]);
    mergeLessonCandidates([first, lesson("a", ["y"])]);
    expect(first.sourceExcerpts).toHaveLength(1);
  });
});
