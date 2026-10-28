import { describe, expect, it } from "vitest";

import { assembleCanonicalMarkdown } from "@/features/extraction/domain/canonical-document";
import { splitIntoParts, withPageMarkers } from "@/features/extraction/domain/source-parts";

describe("splitIntoParts", () => {
  it("cuts at paragraph breaks and covers the text exactly", () => {
    const text = ["Đoạn một dài vừa.", "Đoạn hai cũng vừa.", "Đoạn ba."].join("\n\n");
    const parts = splitIntoParts(text, 25);

    expect(parts.map(({ start, end }) => text.slice(start, end))).toEqual([
      "Đoạn một dài vừa.\n\n",
      "Đoạn hai cũng vừa.\n\n",
      "Đoạn ba.",
    ]);
    expect(parts[0]?.start).toBe(0);
    expect(parts.at(-1)?.end).toBe(text.length);
  });

  it("cuts a paragraph longer than the limit where the limit falls", () => {
    expect(splitIntoParts("a".repeat(25), 10)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 20, end: 25 },
    ]);
  });

  it("gives one part for a short text and none for an empty one", () => {
    expect(splitIntoParts("ngắn", 100)).toEqual([{ start: 0, end: 4 }]);
    expect(splitIntoParts("", 100)).toEqual([]);
    expect(() => splitIntoParts("x", 0)).toThrow(RangeError);
  });
});

describe("withPageMarkers", () => {
  const document = assembleCanonicalMarkdown(
    [
      { pageNumber: 1, text: "Trang một có chữ." },
      { pageNumber: 2, text: "" },
      { pageNumber: 3, text: "Trang ba có chữ." },
    ],
    3,
  );

  it("marks where each page with text begins, from a range that starts mid-page", () => {
    const start = document.markdown.indexOf("một");
    expect(withPageMarkers(document.markdown, start, document.markdown.length, document.pageOffsets)).toBe(
      "[Trang 1]\nmột có chữ.\n\n[Trang 3]\nTrang ba có chữ.",
    );
  });
});
