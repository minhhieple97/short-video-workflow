import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OCR_REASONS } from "@/features/extraction/domain/page-classification";
import type * as ExtractionRepository from "@/features/extraction/repositories/extraction.repository";
import type * as TextExtraction from "@/features/extraction/services/text-extraction.service";
import type * as DbClient from "@/server/db/client";

import { buildPdf, type FixturePage } from "../helpers/pdf-fixtures";
import { popplerTestConfig } from "../helpers/poppler";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const poppler = popplerTestConfig();
let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof ExtractionRepository;
let service: typeof TextExtraction;

const TCVN3 = "Th¸i ®é t¸c ®µo t¹o thµnh c¸c th¸i quen.";
const BOOK_PAGES: FixturePage[] = [
  { lines: ["Chapter 1", "Small habits make a big difference over a long time."] },
  { image: true },
  {},
  { lines: [TCVN3] },
  { lines: ["Part Two"] },
];

async function seedPdf(pages: FixturePage[], encryption?: Parameters<typeof buildPdf>[1]) {
  const id = `book-${Math.random().toString(36).slice(2)}`;
  const { book, extraction } = await repo.createPdfBookWithExtraction(
    {
      id,
      title: "Sách PDF",
      sourceFilePath: `books/${id}/original.pdf`,
      sourceFileName: "sach.pdf",
      sourceHash: `hash-${id}`,
      sourceSizeBytes: 1,
    },
    3_000_000,
  );
  fs.mkdirSync(path.join(env.dataDir, "books", book.id), { recursive: true });
  fs.writeFileSync(path.join(env.dataDir, "books", book.id, "original.pdf"), buildPdf(pages, encryption));
  return extraction.id;
}

const deps = (maxPages = 1000) => ({ poppler: poppler ?? { binDir: undefined, timeoutMs: 30_000 }, maxPages });
const pages = (extractionId: string) =>
  db.prisma.extractionPage.findMany({ where: { extractionId }, orderBy: { pageNumber: "asc" } });
const extraction = (id: string) => db.prisma.bookExtraction.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/extraction/repositories/extraction.repository");
  service = await import("@/features/extraction/services/text-extraction.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe.skipIf(!poppler)("extractPdfPages (needs poppler-utils)", () => {
  it("keeps the text pages, records blank ones, and leaves only scans and old-font pages for OCR with their reason", async () => {
    const id = await seedPdf(BOOK_PAGES);

    const outcome = await service.extractPdfPages(id, deps());

    expect(outcome).toEqual({ status: "OCR_PENDING", pageCount: 5, text: 2, empty: 1, ocr: 2 });
    expect((await pages(id)).map((page) => [page.pageNumber, page.status, page.method, page.ocrReason])).toEqual([
      [1, "EXTRACTED", "TEXT", null],
      [2, "NEEDS_OCR", null, OCR_REASONS.NO_TEXT_LAYER],
      [3, "EXTRACTED", "EMPTY", null],
      [4, "NEEDS_OCR", null, OCR_REASONS.LEGACY_FONT],
      [5, "EXTRACTED", "TEXT", null],
    ]);
    expect((await pages(id))[0]?.text).toBe("Chapter 1\nSmall habits make a big difference over a long time.");
    expect(await extraction(id)).toMatchObject({ status: "OCR_PENDING", pageCount: 5 });
  });

  it("goes straight to assembling when every page has usable text", async () => {
    const id = await seedPdf([{ lines: ["Only text here, nothing to OCR at all."] }, {}]);

    expect(await service.extractPdfPages(id, deps())).toMatchObject({ status: "ASSEMBLING", ocr: 0 });
    expect((await extraction(id)).status).toBe("ASSEMBLING");
  });

  it("reads the đ and Đ that a text layer writes as ñ and ð instead of sending the book to OCR", async () => {
    const line = "ðoc gia ñoc ñen ñay, ñe ñieu ñó ñuoc ñoi.";
    const id = await seedPdf([{ lines: [line, line, line] }, { lines: ["Chuong 2", line] }]);

    expect(await service.extractPdfPages(id, deps())).toMatchObject({ status: "ASSEMBLING", ocr: 0 });

    const repaired = "Đoc gia đoc đen đay, đe đieu đó đuoc đoi.";
    expect((await pages(id)).map((page) => page.text)).toEqual([
      [repaired, repaired, repaired].join("\n"),
      ["Chuong 2", repaired].join("\n"),
    ]);
  });

  it("leaves a Spanish name alone in a book whose text layer is sound", async () => {
    const id = await seedPdf([{ lines: ["Señor Peña vive en Madrid."] }]);

    await service.extractPdfPages(id, deps());

    expect((await pages(id))[0]?.text).toBe("Señor Peña vive en Madrid.");
  });

  it("does not undo OCR progress when it runs again", async () => {
    const id = await seedPdf(BOOK_PAGES);
    await service.extractPdfPages(id, deps());
    await db.prisma.extractionPage.update({
      where: { extractionId_pageNumber: { extractionId: id, pageNumber: 2 } },
      data: { status: "EXTRACTED", method: "OCR", text: "OCR text" },
    });
    await db.prisma.bookExtraction.update({ where: { id }, data: { status: "EXTRACTING" } });

    const outcome = await service.extractPdfPages(id, deps());

    expect((await pages(id))[1]).toMatchObject({ status: "EXTRACTED", method: "OCR", text: "OCR text" });
    expect(outcome).toMatchObject({ status: "OCR_PENDING", ocr: 1, text: 3 });
  });

  it("still counts pages sent to OCR, or whose OCR failed, as waiting for OCR", async () => {
    const id = await seedPdf(BOOK_PAGES);
    await service.extractPdfPages(id, deps());
    await db.prisma.extractionPage.update({
      where: { extractionId_pageNumber: { extractionId: id, pageNumber: 2 } },
      data: { status: "OCR_SUBMITTED" },
    });
    await db.prisma.extractionPage.update({
      where: { extractionId_pageNumber: { extractionId: id, pageNumber: 4 } },
      data: { status: "FAILED", errorCode: "OCR_PAGE_FAILED" },
    });
    await db.prisma.bookExtraction.update({ where: { id }, data: { status: "EXTRACTING" } });

    expect(await service.extractPdfPages(id, deps())).toMatchObject({ status: "OCR_PENDING", ocr: 2 });
    expect((await pages(id))[3]).toMatchObject({ status: "FAILED", errorCode: "OCR_PAGE_FAILED" });
  });

  it("fails clearly, before any OCR, for a password-protected, damaged or over-long PDF", async () => {
    const locked = await seedPdf([{ lines: ["x"] }], { userPassword: "pw", ownerPassword: "o", allowCopy: true });
    expect(await service.extractPdfPages(locked, deps())).toMatchObject({ status: "FAILED", code: "PDF_ENCRYPTED" });
    expect(await extraction(locked)).toMatchObject({ status: "FAILED", errorCode: "PDF_ENCRYPTED" });
    expect(await pages(locked)).toHaveLength(0);

    const long = await seedPdf([{ lines: ["a"] }, { lines: ["b"] }, { lines: ["c"] }]);
    expect(await service.extractPdfPages(long, deps(2))).toMatchObject({
      status: "FAILED",
      code: "PDF_TOO_MANY_PAGES",
      message: "Sách có 3 trang, vượt giới hạn 2 trang (MAX_PDF_PAGES).",
    });

    const damaged = await seedPdf([{ lines: ["x"] }]);
    const book = await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: damaged }, include: { book: true } });
    fs.writeFileSync(path.join(env.dataDir, book.book.sourceFilePath), "%PDF-1.4\nbroken");
    expect(await service.extractPdfPages(damaged, deps())).toMatchObject({ status: "FAILED", code: "PDF_CORRUPT" });
  });

  it("reports a failed run as failed when asked again", async () => {
    const id = await seedPdf([{ lines: ["x"] }], { userPassword: "pw", ownerPassword: "o", allowCopy: true });
    await service.extractPdfPages(id, deps());

    expect(await service.extractPdfPages(id, deps())).toMatchObject({ status: "FAILED", code: "PDF_ENCRYPTED" });
  });
});

describe("extractPdfPages without Poppler", () => {
  it("records that Poppler must be installed, so the run can be retried after installing it", async () => {
    const id = await seedPdf([{ lines: ["x"] }]);

    const outcome = await service.extractPdfPages(id, {
      poppler: { binDir: "/nonexistent-poppler", timeoutMs: 5_000 },
      maxPages: 10,
    });

    expect(outcome).toMatchObject({ status: "FAILED", code: "PDF_TOOL_MISSING" });
    expect((await extraction(id)).errorMessage).toContain("poppler-utils");
  });
});
