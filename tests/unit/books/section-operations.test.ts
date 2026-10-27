import { describe, expect, it } from "vitest";

import { assertValidChapterRanges, normalizeChapterContent } from "@/features/books/domain/chapter-content";
import {
  canMergeWithNext,
  findParagraphStarts,
  mergeWithNext,
  moveSection,
  splitSection,
  suggestTitleAt,
  toggleSectionIncluded,
  type DraftSection,
} from "@/features/books/domain/section-operations";

const TEXT = "Chương 1\n\nĐoạn một.\n\nĐoạn hai.\n\nChương 2\n\nĐoạn ba.";

function section(id: string, start: number, end: number, overrides: Partial<DraftSection> = {}): DraftSection {
  return { id, title: id, start, end, kind: "chapter", include: true, warnings: [], ...overrides };
}

const CHAPTER_2_START = TEXT.indexOf("Chương 2");
const SECTIONS = [section("a", 0, CHAPTER_2_START), section("b", CHAPTER_2_START, TEXT.length)];

describe("section operations", () => {
  it("moves sections up and down without dropping any", () => {
    expect(moveSection(SECTIONS, "b", -1).map((s) => s.id)).toEqual(["b", "a"]);
    expect(moveSection(SECTIONS, "a", -1).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("merges only contiguous neighbours", () => {
    expect(canMergeWithNext(SECTIONS, "a")).toBe(true);
    expect(mergeWithNext(SECTIONS, "a")).toEqual([section("a", 0, TEXT.length)]);

    const reordered = moveSection(SECTIONS, "b", -1);
    expect(canMergeWithNext(reordered, "b")).toBe(false);
    expect(mergeWithNext(reordered, "b")).toEqual(reordered);
  });

  it("splits a section at an offset inside it", () => {
    const at = TEXT.indexOf("Đoạn hai.");
    const result = splitSection(SECTIONS, "a", at, { id: "c", title: "Đoạn hai" });
    expect(result.map((s) => [s.id, s.start, s.end])).toEqual([
      ["a", 0, at],
      ["c", at, CHAPTER_2_START],
      ["b", CHAPTER_2_START, TEXT.length],
    ]);
    expect(splitSection(SECTIONS, "a", 0, { id: "x", title: "x" })).toEqual(SECTIONS);
  });

  it("toggles inclusion", () => {
    expect(toggleSectionIncluded(SECTIONS, "a")[0]?.include).toBe(false);
  });

  it("lists paragraph starts inside a section as split candidates", () => {
    expect(findParagraphStarts(TEXT, 0, CHAPTER_2_START).map((p) => p.preview)).toEqual(["Đoạn một.", "Đoạn hai."]);
    expect(suggestTitleAt(TEXT, CHAPTER_2_START)).toBe("Chương 2");
  });
});

describe("chapter content", () => {
  it("removes trailing spaces and extra blank lines but keeps paragraphs", () => {
    expect(normalizeChapterContent("\n\nTiêu đề  \n\n\n\nĐoạn 1\t\nĐoạn 1b\n\n\n")).toBe("Tiêu đề\n\nĐoạn 1\nĐoạn 1b");
  });

  it("rejects empty, out-of-range and overlapping chapter ranges", () => {
    const fail = (ranges: { start: number; end: number }[]) =>
      expect(() =>
        assertValidChapterRanges(
          ranges.map((r) => ({ ...r, title: "x" })),
          100,
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_CHAPTER_RANGES" }) as Error);

    fail([]);
    fail([{ start: 10, end: 10 }]);
    fail([{ start: -1, end: 10 }]);
    fail([{ start: 0, end: 101 }]);
    fail([
      { start: 0, end: 50 },
      { start: 40, end: 60 },
    ]);
    expect(() =>
      assertValidChapterRanges(
        [
          { title: "b", start: 50, end: 100 },
          { title: "a", start: 0, end: 50 },
        ],
        100,
      ),
    ).not.toThrow();
  });
});

describe("chapterLabel", () => {
  it("prefixes the order only when the title has no marker of its own", async () => {
    const { chapterLabel } = await import("@/features/chapters/domain/analysis-status");
    expect(chapterLabel(1, "Chương 1: Ngủ đủ giấc")).toBe("Chương 1: Ngủ đủ giấc");
    expect(chapterLabel(2, "Thiết kế môi trường")).toBe("Chương 2: Thiết kế môi trường");
  });
});
