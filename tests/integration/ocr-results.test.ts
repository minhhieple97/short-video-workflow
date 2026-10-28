import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as OcrResults from "@/features/extraction/services/ocr-results.service";
import type * as DbClient from "@/server/db/client";
import type { OcrChunkResult } from "@/server/ocr/ocr-provider";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let ocrResults: typeof OcrResults;
let extractionId: string;

const ok = (chunkId: string, texts: string[]): OcrChunkResult => ({
  chunkId,
  status: "ok",
  pages: texts.map((markdown, pageIndex) => ({ pageIndex, markdown, confidence: 0.9 })),
});

const PLAN = [{ chunkId: "a", pageNumbers: [2, 3] }];

async function pagesOf() {
  const rows = await db.prisma.extractionPage.findMany({
    where: { extractionId },
    orderBy: { pageNumber: "asc" },
  });
  return rows.map((row) => ({
    page: row.pageNumber,
    status: row.status,
    method: row.method,
    text: row.text,
    confidence: row.confidence,
    errorCode: row.errorCode,
  }));
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  ocrResults = await import("@/features/extraction/services/ocr-results.service");
}, 60_000);

beforeEach(async () => {
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
  extractionId = (
    await db.prisma.bookExtraction.create({ data: { bookId: book.id, status: "EXTRACTING", sourceHash: "pdf" } })
  ).id;
  await db.prisma.extractionPage.createMany({
    data: [
      { extractionId, pageNumber: 1, status: "EXTRACTED", method: "TEXT", text: "Có sẵn lớp văn bản" },
      { extractionId, pageNumber: 2, status: "OCR_SUBMITTED", ocrReason: "NO_TEXT_LAYER" },
      { extractionId, pageNumber: 3, status: "OCR_SUBMITTED", ocrReason: "NO_TEXT_LAYER" },
    ],
  });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("recordOcrResults", () => {
  it("stores OCR text, method and confidence on the pages that were waiting for OCR", async () => {
    const summary = await ocrResults.recordOcrResults(extractionId, PLAN, [ok("a", ["Trang hai", "   "])]);

    expect(summary).toEqual({ stored: 2, failed: 0, skipped: 0, unexpectedChunkIds: [] });
    expect(await pagesOf()).toEqual([
      { page: 1, status: "EXTRACTED", method: "TEXT", text: "Có sẵn lớp văn bản", confidence: null, errorCode: null },
      { page: 2, status: "EXTRACTED", method: "OCR", text: "Trang hai", confidence: 0.9, errorCode: null },
      { page: 3, status: "EXTRACTED", method: "EMPTY", text: "", confidence: 0.9, errorCode: null },
    ]);
  });

  it("marks a missing chunk's pages FAILED with the reason instead of leaving or blanking them", async () => {
    const summary = await ocrResults.recordOcrResults(extractionId, PLAN, []);

    expect(summary).toMatchObject({ stored: 0, failed: 2 });
    expect((await pagesOf()).slice(1)).toEqual([
      { page: 2, status: "FAILED", method: null, text: null, confidence: null, errorCode: "OCR_CHUNK_MISSING" },
      { page: 3, status: "FAILED", method: null, text: null, confidence: null, errorCode: "OCR_CHUNK_MISSING" },
    ]);
  });

  it("lets a retry replace an earlier failure with a good result", async () => {
    await ocrResults.recordOcrResults(extractionId, PLAN, []);

    await ocrResults.recordOcrResults(extractionId, PLAN, [ok("a", ["Hai", "Ba"])]);

    expect((await pagesOf()).map((page) => [page.page, page.status, page.errorCode])).toEqual([
      [1, "EXTRACTED", null],
      [2, "EXTRACTED", null],
      [3, "EXTRACTED", null],
    ]);
  });

  it("changes nothing when the same results are applied again", async () => {
    await ocrResults.recordOcrResults(extractionId, PLAN, [ok("a", ["Hai", "Ba"])]);
    const before = await pagesOf();

    const replay = await ocrResults.recordOcrResults(extractionId, PLAN, [ok("a", ["KHÁC", "KHÁC"])]);

    expect(replay).toMatchObject({ stored: 0, skipped: 2 });
    expect(await pagesOf()).toEqual(before);
  });

  it("never overwrites a page that already holds text from the PDF's text layer", async () => {
    const summary = await ocrResults.recordOcrResults(
      extractionId,
      [{ chunkId: "a", pageNumbers: [1] }],
      [ok("a", ["OCR ĐÈ LÊN"])],
    );

    expect(summary).toMatchObject({ stored: 0, skipped: 1 });
    expect((await pagesOf())[0]).toMatchObject({ page: 1, method: "TEXT", text: "Có sẵn lớp văn bản" });
  });

  it("reports chunks nobody planned without storing them", async () => {
    const summary = await ocrResults.recordOcrResults(extractionId, PLAN, [ok("a", ["Hai", "Ba"]), ok("ghost", ["x"])]);

    expect(summary.unexpectedChunkIds).toEqual(["ghost"]);
  });
});
