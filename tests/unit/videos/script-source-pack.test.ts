import { describe, expect, it } from "vitest";

import { sourceReferencesProblem, type ScriptSourcePack } from "@/features/videos/domain/script-source-pack";

const text = "Ngữ cảnh ở trang đầu. Trích đoạn ở trang kế tiếp.";
const boundary = text.indexOf("Trích");
const pack: ScriptSourcePack = {
  version: "script-source-pack-v1",
  bookId: "book",
  sources: [
    {
      id: "s1",
      lessonIds: ["lesson"],
      chapterId: "chapter",
      chapterTitle: "Chương",
      chapterHash: "hash",
      start: 0,
      end: text.length,
      text,
      excerpt: "Trích đoạn ở trang kế tiếp.",
      page: 10,
      endPage: 11,
      pages: [
        { page: 10, start: 0, end: boundary },
        { page: 11, start: boundary, end: text.length },
      ],
    },
  ],
};

describe("source citation pages", () => {
  it("uses the quote's actual page instead of the start of its context", () => {
    expect(
      sourceReferencesProblem(pack, [{ sourceId: "s1", page: 11, text: "Trích đoạn ở trang kế tiếp." }]),
    ).toBeNull();
    expect(
      sourceReferencesProblem(pack, [{ sourceId: "s1", page: 10, text: "Trích đoạn ở trang kế tiếp." }]),
    ).toContain("Trang");
  });
  it("rejects invented source IDs and quotations", () => {
    expect(
      sourceReferencesProblem(pack, [{ sourceId: "s2", page: 11, text: "Trích đoạn ở trang kế tiếp." }]),
    ).not.toBeNull();
    expect(
      sourceReferencesProblem(pack, [{ sourceId: "s1", page: 11, text: "Nguồn không hề nói điều này." }]),
    ).not.toBeNull();
  });
  it("accepts equivalent whitespace without changing the page", () => {
    expect(
      sourceReferencesProblem(pack, [{ sourceId: "s1", page: 11, text: "Trích đoạn\nở trang kế tiếp." }]),
    ).toBeNull();
  });
});
