import { describe, expect, it } from "vitest";

import { assembleCanonicalMarkdown, pageAtOffset, pagesInRange } from "@/features/extraction/domain/canonical-document";

const pages = (...texts: string[]) => texts.map((text, index) => ({ pageNumber: index + 1, text }));

describe("assembleCanonicalMarkdown", () => {
  it("joins pages in page order, whatever order they arrive in", () => {
    const reversed = pages("Một", "Hai", "Ba").reverse();

    expect(assembleCanonicalMarkdown(reversed, 3).markdown).toBe("Một\n\nHai\n\nBa");
  });

  it("records offsets such that slicing the markdown returns exactly each page's text", () => {
    const input = pages("# Chương 1\n\nMở đầu.", "Tiếp theo 😀 có emoji.", "Hết.");
    const { markdown, pageOffsets } = assembleCanonicalMarkdown(input, 3);

    for (const { pageNumber, start, end } of pageOffsets) {
      expect(markdown.slice(start, end)).toBe(input[pageNumber - 1]?.text);
    }
  });

  it("gives blank pages zero-length offsets and no extra blank lines", () => {
    const { markdown, pageOffsets } = assembleCanonicalMarkdown(pages("A", "", "", "B"), 4);

    expect(markdown).toBe("A\n\nB");
    expect(pageOffsets.map((page) => [page.pageNumber, page.start, page.end])).toEqual([
      [1, 0, 1],
      [2, 1, 1],
      [3, 1, 1],
      [4, 3, 4],
    ]);
  });

  it("handles a document whose first pages are blank", () => {
    const { markdown, pageOffsets } = assembleCanonicalMarkdown(pages("", "", "Nội dung"), 3);

    expect(markdown).toBe("Nội dung");
    expect(pageOffsets[2]).toEqual({ pageNumber: 3, start: 0, end: 8 });
  });

  it("produces an empty document for an all-blank book", () => {
    expect(assembleCanonicalMarkdown(pages("", ""), 2).markdown).toBe("");
  });

  it.each([
    [
      "a missing page",
      [
        { pageNumber: 1, text: "A" },
        { pageNumber: 3, text: "C" },
      ],
      3,
      { missing: [2] },
    ],
    [
      "a duplicate page",
      [
        { pageNumber: 1, text: "A" },
        { pageNumber: 1, text: "A" },
        { pageNumber: 2, text: "B" },
      ],
      2,
      { hasDuplicates: true },
    ],
    [
      "a page beyond the PDF",
      [
        { pageNumber: 1, text: "A" },
        { pageNumber: 2, text: "B" },
        { pageNumber: 9, text: "Z" },
      ],
      2,
      { outOfRange: [9] },
    ],
    ["trailing pages not supplied", [{ pageNumber: 1, text: "A" }], 3, { missing: [2, 3] }],
  ])("refuses %s instead of shifting later pages onto the wrong number", (_label, input, count, detail) => {
    expect(() => assembleCanonicalMarkdown(input, count)).toThrowError(
      expect.objectContaining({ code: "EXTRACTION_PAGES_INVALID", details: expect.objectContaining(detail) }),
    );
  });
});

describe("page lookups", () => {
  const { pageOffsets } = assembleCanonicalMarkdown(pages("AAAA", "", "BBBB", "CCCC"), 4);
  // "AAAA\n\nBBBB\n\nCCCC": page 1 = [0,4), page 3 = [6,10), page 4 = [12,16)

  it("finds the page that holds an offset", () => {
    expect(pageAtOffset(pageOffsets, 0)).toBe(1);
    expect(pageAtOffset(pageOffsets, 3)).toBe(1);
    expect(pageAtOffset(pageOffsets, 6)).toBe(3);
    expect(pageAtOffset(pageOffsets, 15)).toBe(4);
  });

  it("returns null in the gap between pages, past the end and for a blank page", () => {
    expect(pageAtOffset(pageOffsets, 4)).toBeNull();
    expect(pageAtOffset(pageOffsets, 16)).toBeNull();
    expect(pageOffsets.find((page) => page.pageNumber === 2)).toMatchObject({ start: 4, end: 4 });
  });

  it("maps a range to the first and last page it touches, skipping blank pages", () => {
    expect(pagesInRange(pageOffsets, 2, 8)).toEqual({ firstPage: 1, lastPage: 3 });
    expect(pagesInRange(pageOffsets, 6, 10)).toEqual({ firstPage: 3, lastPage: 3 });
    expect(pagesInRange(pageOffsets, 0, 16)).toEqual({ firstPage: 1, lastPage: 4 });
  });

  it("treats an exclusive end exactly at a page start as not touching that page", () => {
    expect(pagesInRange(pageOffsets, 0, 6)).toEqual({ firstPage: 1, lastPage: 1 });
  });

  it("returns null for a range that covers only the gap between pages", () => {
    expect(pagesInRange(pageOffsets, 4, 6)).toBeNull();
  });
});
