import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseBookStructure, type BookStructure } from "@/features/books/domain/book-structure";
import { parseChapterMarker } from "@/features/books/domain/chapter-markers";

const SAMPLE_MARKDOWN = fs.readFileSync(
  path.join(import.meta.dirname, "../../fixtures/atomic-habits-sample.md"),
  "utf8",
);

const LONG_BODY = [
  "Đây là một đoạn nội dung đủ dài để được xem như thân chương thật sự, có nhiều câu và nhiều ý.",
  "Nó không bị nhận nhầm là mục lục hay tiêu đề phụ trong sách, vì một chương thật luôn có nhiều đoạn văn.",
].join(" ");

function chapterTitles(structure: BookStructure): string[] {
  return structure.sections.filter((section) => section.include).map((section) => section.title);
}

function expectFullCoverage(text: string, structure: BookStructure): void {
  const ordered = [...structure.sections].sort((a, b) => a.start - b.start);
  expect(ordered[0]?.start).toBe(0);
  expect(ordered.at(-1)?.end).toBe(text.length);
  ordered.forEach((section, index) => {
    if (index > 0) expect(section.start).toBe(ordered[index - 1]?.end);
  });
  expect(ordered.map((section) => text.slice(section.start, section.end)).join("")).toBe(text);
}

describe("parseChapterMarker", () => {
  it.each([
    ["Chương 1", "chapter", "1", ""],
    ["CHƯƠNG IV: Thói quen", "chapter", "IV", "Thói quen"],
    ["Chương Một - Khởi đầu", "chapter", "Một", "Khởi đầu"],
    ["Chapter One", "chapter", "One", ""],
    ["Chapter 12. The End", "chapter", "12", "The End"],
    ["Phần 2", "part", "2", ""],
    ["## Chương 3: Dễ thực hiện", "chapter", "3", "Dễ thực hiện"],
  ])("recognises %s", (line, level, numeral, title) => {
    expect(parseChapterMarker(line)).toMatchObject({ level, numeral, title });
  });

  it.each([
    "Chương trình học hôm nay rất dài",
    "Part mix of ideas",
    "Phần mềm quản lý",
    "chapter in progress",
    "Chương",
    `Chương 1 ${"rất dài ".repeat(30)}`,
  ])("ignores %s", (line) => {
    expect(parseChapterMarker(line)).toBeNull();
  });
});

describe("parseBookStructure — Markdown", () => {
  it("detects exactly the three chapters of the sample and keeps front matter out", () => {
    const structure = parseBookStructure(SAMPLE_MARKDOWN, "md");

    expect(structure.method).toBe("markdown-headings");
    expect(structure.headingDepth).toBe(2);
    expect(structure.suggestedTitle).toBe("Atomic Habits — bản tóm lược minh họa");
    expect(chapterTitles(structure)).toEqual([
      "Chương 1: Sức mạnh của những thay đổi rất nhỏ",
      "Chương 2: Thiết kế môi trường cho thói quen tốt",
      "Chương 3: Làm cho thói quen dễ thực hiện",
    ]);
    expect(structure.sections.map((section) => section.kind)).toEqual([
      "front-matter",
      "table-of-contents",
      "front-matter",
      "chapter",
      "chapter",
      "chapter",
    ]);
    expectFullCoverage(SAMPLE_MARKDOWN, structure);
  });

  it("does not turn ### sub-headings or list items of a table of contents into chapters", () => {
    const structure = parseBookStructure(SAMPLE_MARKDOWN, "md");
    expect(structure.sections.some((section) => section.title === "Ý chính")).toBe(false);
    expect(structure.sections.filter((section) => section.kind === "chapter")).toHaveLength(3);
  });

  it("uses H1 headings as chapters when there are several H1s", () => {
    const text = `# Một\n\n${LONG_BODY}\n\n# Hai\n\n${LONG_BODY}\n`;
    const structure = parseBookStructure(text, "md");
    expect(structure.headingDepth).toBe(1);
    expect(chapterTitles(structure)).toEqual(["Một", "Hai"]);
    expectFullCoverage(text, structure);
  });

  it("falls back to text markers when the Markdown has no headings", () => {
    const text = `Tên sách\n\nChương 1\n\n${LONG_BODY}\n\nChương 2\n\n${LONG_BODY}\n`;
    const structure = parseBookStructure(text, "md");
    expect(structure.method).toBe("text-patterns");
    expect(chapterTitles(structure)).toHaveLength(2);
  });
});

describe("parseBookStructure — TXT", () => {
  it("recognises mixed Vietnamese and English markers and uses the next line as subtitle", () => {
    const text = [
      "THÓI QUEN NHỎ",
      "",
      "CHƯƠNG 1",
      "SỨC MẠNH CỦA LÃI KÉP",
      "",
      LONG_BODY,
      "",
      "CHƯƠNG II: Môi trường",
      "",
      LONG_BODY,
      "",
      "Chapter Three - Make it easy",
      "",
      LONG_BODY,
    ].join("\n");
    const structure = parseBookStructure(text, "txt");

    expect(structure.method).toBe("text-patterns");
    expect(chapterTitles(structure)).toEqual([
      "CHƯƠNG 1: SỨC MẠNH CỦA LÃI KÉP",
      "CHƯƠNG II: Môi trường",
      "Chapter Three - Make it easy",
    ]);
    expect(structure.sections[0]).toMatchObject({ kind: "front-matter", include: false });
    expectFullCoverage(text, structure);
  });

  it("collapses a table of contents written as separate marker lines instead of creating ghost chapters", () => {
    const text = [
      "MỤC LỤC",
      "",
      "Chương 1: Bắt đầu nhỏ",
      "",
      "Chương 2: Môi trường",
      "",
      "Chương 1: Bắt đầu nhỏ",
      "",
      LONG_BODY,
      "",
      "Chương 2: Môi trường",
      "",
      LONG_BODY,
    ].join("\n");
    const structure = parseBookStructure(text, "txt");

    expect(chapterTitles(structure)).toEqual(["Chương 1: Bắt đầu nhỏ", "Chương 2: Môi trường"]);
    expect(structure.sections.find((section) => section.kind === "table-of-contents")).toBeDefined();
    expectFullCoverage(text, structure);
  });

  it("ignores marker-like words inside wrapped prose lines", () => {
    const text = `Chương 1\n\n${LONG_BODY}\ntrong chương 2 tôi sẽ nói thêm.\n\nChương 2\n\n${LONG_BODY}`;
    expect(chapterTitles(parseBookStructure(text, "txt"))).toEqual(["Chương 1", "Chương 2"]);
  });

  it("treats parts as non-chapter sections when chapters exist", () => {
    const text = `Phần 1\n\nChương 1\n\n${LONG_BODY}\n\nPhần 2\n\nChương 2\n\n${LONG_BODY}`;
    const structure = parseBookStructure(text, "txt");
    expect(chapterTitles(structure)).toEqual(["Chương 1", "Chương 2"]);
    expect(structure.sections.filter((section) => section.kind === "part")).toHaveLength(2);
  });

  it("returns one section with a warning when no chapter markers exist", () => {
    const text = `${LONG_BODY}\n\n${LONG_BODY}`;
    const structure = parseBookStructure(text, "txt");
    expect(structure.method).toBe("none");
    expect(structure.sections).toEqual([
      { title: "Toàn bộ nội dung", start: 0, end: text.length, kind: "chapter", include: true, warnings: [] },
    ]);
    expect(structure.warnings[0]).toMatch(/thủ công/);
  });

  it("accepts configured extra patterns", () => {
    const text = `BÀI 1\n\n${LONG_BODY}\n\nBÀI 2\n\n${LONG_BODY}`;
    const structure = parseBookStructure(text, "txt", { extraPatterns: [/^bài\s+\d+$/iu] });
    expect(chapterTitles(structure)).toEqual(["BÀI 1", "BÀI 2"]);
  });
});
