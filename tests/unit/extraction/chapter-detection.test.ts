import { describe, expect, it } from "vitest";

import { assembleCanonicalMarkdown, type PageText } from "@/features/extraction/domain/canonical-document";
import { verifyProposedChapters, type ProposedChapter } from "@/features/extraction/domain/chapter-detection";
import { buildChapterOutline } from "@/features/extraction/domain/chapter-outline";

const BODY = "Mỗi ngày tiến bộ một chút là đủ để thay đổi cả cuộc đời.";
const PAGES: PageText[] = [
  { pageNumber: 1, text: "THÓI QUEN NGUYÊN TỬ\nJames Clear" },
  {
    pageNumber: 2,
    text: "Mục lục\nSức mạnh của thói quen nhỏ .... 3\nBản sắc và thói quen .... 4\nMôi trường quyết định .... 5\nPhụ lục .... 6",
  },
  { pageNumber: 3, text: `SỨC MẠNH CỦA THÓI QUEN NHỎ\n${BODY}` },
  { pageNumber: 4, text: `**Bản sắc và   thói quen**\n${BODY}` },
  { pageNumber: 5, text: `${BODY}\nMôi trường quyết định\n${BODY}` },
  { pageNumber: 6, text: "Phụ lục\nGhi chú cuối sách." },
];
const DOCUMENT = assembleCanonicalMarkdown(PAGES, 6);

const chapter = (title: string, startPage: number, endPage: number, startAnchor = title): ProposedChapter => ({
  title,
  startPage,
  endPage,
  startAnchor,
});
const PROPOSED = [
  chapter("Sức mạnh của thói quen nhỏ", 3, 3),
  chapter("Bản sắc và thói quen", 4, 4),
  chapter("Môi trường quyết định", 5, 5),
];

describe("verifyProposedChapters", () => {
  it("places each chapter at its anchor and keeps the front matter and table of contents out of every chapter", () => {
    const result = verifyProposedChapters(PROPOSED, DOCUMENT, PAGES, 6);

    if (!result.ok) throw new Error(result.problem);
    expect(result.frontMatterPages).toEqual([1, 2]);
    expect(result.tocPages).toEqual([2]);
    const texts = result.chapters.map((range) => DOCUMENT.markdown.slice(range.start, range.end));
    expect(texts[0]?.startsWith("SỨC MẠNH CỦA THÓI QUEN NHỎ")).toBe(true);
    // Matched across emphasis and extra spaces, starting at the beginning of its line.
    expect(texts[1]?.startsWith("**Bản sắc và   thói quen**")).toBe(true);
    // A chapter that starts mid-page starts at its own line, not at the top of the page.
    expect(texts[2]?.startsWith("Môi trường quyết định")).toBe(true);
    // The last chapter ends with its last page, so the appendix on page 6 is not in it.
    expect(texts[2]).not.toContain("Phụ lục");
    expect(result.chapters.map((range) => range.startPage)).toEqual([3, 4, 5]);
  });

  it("accepts an anchor found on the page after the one proposed", () => {
    const pages = PAGES.map((page) => (page.pageNumber === 2 ? { ...page, text: "Lời nói đầu" } : page));
    const result = verifyProposedChapters(
      [chapter("Sức mạnh của thói quen nhỏ", 2, 3, "Sức mạnh của thói quen nhỏ"), ...PROPOSED.slice(1)],
      assembleCanonicalMarkdown(pages, 6),
      pages,
      6,
    );
    expect(result.ok && result.chapters[0]?.startPage).toBe(3);
  });

  it("refuses a chapter whose opening words are not on its page", () => {
    const result = verifyProposedChapters(
      [...PROPOSED.slice(0, 2), chapter("Môi trường quyết định", 5, 5, "Ý chí là tất cả")],
      DOCUMENT,
      PAGES,
      6,
    );
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("Không tìm thấy đoạn mở đầu") });
  });

  it("refuses a chapter that starts on the table of contents", () => {
    const result = verifyProposedChapters(
      [chapter("Sức mạnh của thói quen nhỏ", 2, 3), ...PROPOSED.slice(1)],
      DOCUMENT,
      PAGES,
      6,
    );
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("mục lục") });
  });

  it("refuses chapters that do not run forward, or pages outside the book", () => {
    expect(
      verifyProposedChapters(
        [chapter("Sức mạnh của thói quen nhỏ", 4, 4, "Mỗi ngày tiến bộ"), chapter("Bản sắc và thói quen", 4, 4)],
        DOCUMENT,
        PAGES,
        6,
      ).ok,
    ).toBe(false);
    expect(verifyProposedChapters([chapter("Sức mạnh của thói quen nhỏ", 3, 9)], DOCUMENT, PAGES, 6)).toEqual({
      ok: false,
      problem: expect.stringContaining("ngoài sách"),
    });
    expect(verifyProposedChapters([], DOCUMENT, PAGES, 6).ok).toBe(false);
  });

  it("refuses the whole of a long book as one chapter, but not a short book's single chapter", () => {
    const long = Array.from({ length: 30 }, (_, index) => ({
      pageNumber: index + 1,
      text: `Trang ${index + 1}\n${BODY}`,
    }));
    const longDocument = assembleCanonicalMarkdown(long, 30);
    expect(verifyProposedChapters([chapter("Toàn bộ", 1, 30, "Trang 1")], longDocument, long, 30)).toEqual({
      ok: false,
      problem: expect.stringContaining("cả cuốn sách"),
    });
    expect(verifyProposedChapters([chapter("Sức mạnh của thói quen nhỏ", 3, 6)], DOCUMENT, PAGES, 6).ok).toBe(true);
  });

  it("refuses an anchor too short to identify a place", () => {
    expect(verifyProposedChapters([chapter("A", 3, 3, "SỨ")], DOCUMENT, PAGES, 6).ok).toBe(false);
  });
});

describe("buildChapterOutline", () => {
  it("gives one line per page with text, its head only, and the table-of-contents entries as hints", () => {
    const long = { pageNumber: 7, text: `Tiêu đề\n${"chữ ".repeat(200)}` };
    const outline = buildChapterOutline([...PAGES, { pageNumber: 8, text: "" }, long]);

    const lines = outline.markdown.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("[Trang 1] THÓI QUEN NGUYÊN TỬ / James Clear");
    expect(lines[6]?.startsWith("[Trang 7] Tiêu đề / chữ")).toBe(true);
    expect(lines[6]?.length).toBeLessThan(200);
    expect(outline.hints).toEqual([
      "Sức mạnh của thói quen nhỏ .... 3",
      "Bản sắc và thói quen .... 4",
      "Môi trường quyết định .... 5",
      "Phụ lục .... 6",
    ]);
  });

  it("gives no hints when no page reads like a table of contents", () => {
    expect(buildChapterOutline([{ pageNumber: 1, text: "Chương 1 .... 3\nChỉ một dòng" }]).hints).toEqual([]);
  });

  it("includes mid-page chapter markers and their following title line without the surrounding body", () => {
    const outline = buildChapterOutline([
      {
        pageNumber: 12,
        text: `${"Đoạn kết chương trước. ".repeat(40)}\nCHƯƠNG 2\nBản sắc và thói quen\nKhông gửi toàn bộ nội dung chương này.`,
      },
    ]);

    expect(outline.markdown.split("\n")).toHaveLength(2);
    expect(outline.markdown).toContain("[Trang 12] Ứng viên chương: CHƯƠNG 2 / Bản sắc và thói quen");
    expect(outline.markdown).not.toContain("Không gửi toàn bộ nội dung chương này.");
  });

  it("bounds candidate counts per page and globally, and limits each title fragment", () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({
      pageNumber: index + 1,
      text: [
        "Dòng đầu trang.",
        ...Array.from({ length: 10 }, (_, number) => `CHƯƠNG ${number + 1}\n${"Tên chương dài ".repeat(100)}`),
      ].join("\n"),
    }));
    const lines = buildChapterOutline(pages).markdown.split("\n");
    const candidates = lines.filter((line) => line.includes("Ứng viên chương:"));

    expect(candidates).toHaveLength(200);
    expect(candidates.filter((line) => line.startsWith("[Trang 1]"))).toHaveLength(3);
    expect(candidates.every((line) => line.length <= 280)).toBe(true);
    expect(lines.filter((line) => !line.includes("Ứng viên chương:"))).toHaveLength(100);
  });
});
