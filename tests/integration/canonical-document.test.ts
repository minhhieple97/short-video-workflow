import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Canonical from "@/features/extraction/services/canonical-document.service";
import type * as ExtractionChapters from "@/features/extraction/services/extraction-chapters.service";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let canonical: typeof Canonical;
let extractionChapters: typeof ExtractionChapters;
let bookId: string;
let extractionId: string;

async function seed(pages: { text: string | null; status?: string }[], pageCount: number | null = pages.length) {
  await db.prisma.book.deleteMany();
  const book = await db.prisma.book.create({
    data: {
      title: "Sách",
      sourceFilePath: "books/x/original.pdf",
      sourceFileName: "x.pdf",
      sourceHash: `hash-${Math.random()}`,
      sourceFormat: "pdf",
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
  bookId = book.id;
  extractionId = (
    await db.prisma.bookExtraction.create({ data: { bookId, status: "ASSEMBLING", sourceHash: "pdf", pageCount } })
  ).id;
  await db.prisma.extractionPage.createMany({
    data: pages.map((page, index) => ({
      extractionId,
      pageNumber: index + 1,
      status: page.status ?? "EXTRACTED",
      method: "TEXT",
      text: page.text,
    })),
  });
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  canonical = await import("@/features/extraction/services/canonical-document.service");
  extractionChapters = await import("@/features/extraction/services/extraction-chapters.service");
}, 60_000);

beforeEach(() => {
  fs.rmSync(path.join(env.dataDir, "books"), { recursive: true, force: true });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("PDF local chapter boundaries", () => {
  const body = "Nội dung chương được giữ nguyên. ".repeat(10);

  it("keeps complete plain-text and Markdown boundaries local, including leading whitespace", () => {
    for (const prefix of ["", "# "]) {
      const text = `\n  ${prefix}CHƯƠNG 1\n${body}\n\n${prefix}CHƯƠNG 2\n${body}`;
      const ranges = extractionChapters.parseChapterRanges(text, []);

      expect(ranges.map((range) => range.title)).toEqual(["CHƯƠNG 1", "CHƯƠNG 2"]);
      expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual([
        expect.stringContaining("CHƯƠNG 1"),
        expect.stringContaining("CHƯƠNG 2"),
      ]);
    }
  });

  it("defers when OCR Markdown headings hide explicit text-layer chapter markers", () => {
    const text = `# Bìa OCR\n${body}\nCHƯƠNG 1\nTiêu đề thứ nhất\n${body}\n\nCHƯƠNG 2\n${body}`;

    expect(extractionChapters.parseChapterRanges(text, [])).toEqual([]);
  });

  it("defers when a marker without a preceding blank line was missed", () => {
    const text = `${body}\nCHƯƠNG 1\n${body}\n\nCHƯƠNG 2\n${body}`;

    expect(extractionChapters.parseChapterRanges(text, [])).toEqual([]);
  });

  it("defers repeated chapter numbers from a trailing table of contents even if every marker was parsed", () => {
    const text = `CHƯƠNG 1\n${body}\n\nCHƯƠNG 2\n${body}\n\nMỤC LỤC\n\nCHƯƠNG 1\nTiêu đề thứ nhất\n\nCHƯƠNG 2\nTiêu đề thứ hai`;

    expect(extractionChapters.parseChapterRanges(text, [])).toEqual([]);
  });

  it("defers when a leading table of contents is split into chapters of its own", () => {
    const text = `Mục lục\n\nChương 1: Một ........ 3\nChương 2: Hai ........ 9\n\nChương 1: Một\n\n${body}\n\nChương 2: Hai\n\n${body}`;

    expect(extractionChapters.parseChapterRanges(text, [])).toEqual([]);
  });

  it("stays local when a printed line merely starts by mentioning an existing chapter, in any letter case", () => {
    for (const [first, second, mention] of [
      ["1", "2", "1"],
      ["MỘT", "HAI", "một"],
    ]) {
      const text = `CHƯƠNG ${first}\n${body}\n\nCHƯƠNG ${second}\n${body}\nNhư đã thấy ở\nChương ${mention} thói quen nhỏ rất quan trọng.\n${body}`;

      expect(extractionChapters.parseChapterRanges(text, []).map((range) => range.title)).toEqual([
        `CHƯƠNG ${first}`,
        `CHƯƠNG ${second}`,
      ]);
    }
  });

  it("stays local when each part numbers its chapters from one again", () => {
    const text = [
      `Phần 1: Nền tảng\n\nChương 1: Một\n\n${body}\n\nChương 2: Hai\n\n${body}`,
      `Phần 2: Thực hành\n\nChương 1: Ba\n\n${body}\n\nChương 2: Bốn\n\n${body}`,
    ].join("\n\n");

    expect(extractionChapters.parseChapterRanges(text, []).map((range) => range.title)).toEqual([
      "Chương 1: Một",
      "Chương 2: Hai",
      "Chương 1: Ba",
      "Chương 2: Bốn",
    ]);
  });
});

describe("assembleExtractionDocument", () => {
  it("writes the canonical markdown under the book and records its relative path", async () => {
    await seed([{ text: "# Chương 1\n\nMở đầu" }, { text: "" }, { text: "Trang ba" }]);

    const result = await canonical.assembleExtractionDocument(extractionId);

    expect(result.markdown).toBe("# Chương 1\n\nMở đầu\n\nTrang ba");
    expect(result.path).toBe(`books/${bookId}/extractions/${extractionId}/canonical.md`);
    expect(fs.readFileSync(path.join(env.dataDir, result.path), "utf8")).toBe(result.markdown);
    expect((await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } })).canonicalPath).toBe(
      result.path,
    );
    expect(result.pageOffsets.map((page) => [page.pageNumber, page.start, page.end])).toEqual([
      [1, 0, 18],
      [2, 18, 18],
      [3, 20, 28],
    ]);
  });

  it("produces the same document and offsets when run again", async () => {
    await seed([{ text: "A" }, { text: "B" }]);

    const first = await canonical.assembleExtractionDocument(extractionId);
    const second = await canonical.assembleExtractionDocument(extractionId);

    expect(second).toEqual(first);
  });

  it("refuses, naming the pages, while any page has no result, and writes nothing", async () => {
    await seed([{ text: "A" }, { text: null, status: "FAILED" }, { text: null, status: "NEEDS_OCR" }]);

    await expect(canonical.assembleExtractionDocument(extractionId)).rejects.toMatchObject({
      code: "EXTRACTION_INCOMPLETE",
      httpStatus: 409,
      details: { unfinishedPages: [2, 3] },
    });

    expect(fs.existsSync(path.join(env.dataDir, "books", bookId))).toBe(false);
    expect(
      (await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } })).canonicalPath,
    ).toBeNull();
  });

  it("refuses when fewer pages are stored than the PDF has", async () => {
    await seed([{ text: "A" }, { text: "B" }], 3);

    await expect(canonical.assembleExtractionDocument(extractionId)).rejects.toMatchObject({
      code: "EXTRACTION_INCOMPLETE",
      details: { storedPages: 2, expectedPages: 3 },
    });
  });

  it("refuses before the PDF has been inspected", async () => {
    await seed([{ text: "A" }], null);

    await expect(canonical.assembleExtractionDocument(extractionId)).rejects.toMatchObject({
      code: "EXTRACTION_NOT_INSPECTED",
    });
  });

  it("reports an unknown extraction as not found", async () => {
    await expect(canonical.assembleExtractionDocument("missing")).rejects.toMatchObject({
      code: "EXTRACTION_NOT_FOUND",
    });
  });
});
