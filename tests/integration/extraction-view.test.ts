import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as CeilingRoute from "@/app/api/extractions/[extractionId]/ocr-ceiling/route";
import type * as RetryRoute from "@/app/api/extractions/[extractionId]/retry/route";
import type * as ExtractionRoute from "@/app/api/extractions/[extractionId]/route";
import type * as BookService from "@/features/books/services/book.service";
import type * as ExtractionRepository from "@/features/extraction/repositories/extraction.repository";
import type * as ExtractionView from "@/features/extraction/services/extraction-view.service";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof ExtractionRepository;
let view: typeof ExtractionView;
let books: typeof BookService;
let single: typeof ExtractionRoute;
let retry: typeof RetryRoute;
let ceiling: typeof CeilingRoute;

const params = (extractionId: string) => ({ params: Promise.resolve({ extractionId }) });

async function seed(status: string, data: Record<string, unknown> = {}) {
  const id = `book-${Math.random().toString(36).slice(2)}`;
  const { book, extraction, job } = await repo.createPdfBookWithExtraction(
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
  await db.prisma.bookExtraction.update({ where: { id: extraction.id }, data: { status, ...data } });
  return { bookId: book.id, extractionId: extraction.id, jobId: job.id };
}

async function addPages(extractionId: string, pages: [number, string, string | null][]) {
  for (const [pageNumber, status, method] of pages) {
    await db.prisma.extractionPage.create({ data: { extractionId, pageNumber, status, method } });
  }
}

const finishJob = (jobId: string) => db.prisma.jobRecord.update({ where: { id: jobId }, data: { status: "FAILED" } });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/extraction/repositories/extraction.repository");
  view = await import("@/features/extraction/services/extraction-view.service");
  books = await import("@/features/books/services/book.service");
  single = await import("@/app/api/extractions/[extractionId]/route");
  retry = await import("@/app/api/extractions/[extractionId]/retry/route");
  ceiling = await import("@/app/api/extractions/[extractionId]/ocr-ceiling/route");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  await db.prisma.jobRecord.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("extraction view", () => {
  it("counts pages by what happened to them and lists the failed ones", async () => {
    const { extractionId } = await seed("OCR_PENDING", { pageCount: 8 });
    await addPages(extractionId, [
      [1, "EXTRACTED", "TEXT"],
      [8, "EXTRACTED", "TEXT"],
      [2, "EXTRACTED", "OCR"],
      [3, "EXTRACTED", "EMPTY"],
      [4, "NEEDS_OCR", null],
      [5, "OCR_SUBMITTED", null],
      [6, "FAILED", null],
      [7, "FAILED", null],
    ]);

    const dto = await view.getExtraction(extractionId);

    expect(dto).toMatchObject({
      status: "OCR_PENDING",
      pageCount: 8,
      pages: { text: 2, ocr: 1, empty: 1, waitingOcr: 1, sentToOcr: 1, failed: 2 },
      failedPages: [6, 7],
      held: false,
      canRetry: false,
    });
    expect(dto.activeJob).toMatchObject({ status: "QUEUED" });
  });

  it("calls a run held only when it stopped with a reason and no job is left on it", async () => {
    const { extractionId, jobId } = await seed("OCR_PENDING", {
      errorCode: "MISTRAL_HTTP_503",
      errorMessage: "Mistral tạm lỗi.",
    });
    // A deferred job is still on the run: the reason is a note on a wait, not a stop.
    expect(await view.getExtraction(extractionId)).toMatchObject({ held: false, canRetry: false });

    await finishJob(jobId);

    expect(await view.getExtraction(extractionId)).toMatchObject({ held: true, canRetry: true, activeJob: null });
  });

  it("offers no retry for a PDF that can never be read, but does for a missing tool", async () => {
    const encrypted = await seed("FAILED", { errorCode: "PDF_ENCRYPTED", errorMessage: "mật khẩu" });
    const noTool = await seed("FAILED", { errorCode: "PDF_TOOL_MISSING", errorMessage: "thiếu Poppler" });
    await finishJob(encrypted.jobId);
    await finishJob(noTool.jobId);

    expect(await view.getExtraction(encrypted.extractionId)).toMatchObject({ canRetry: false, canSetCeiling: false });
    expect(await view.getExtraction(noTool.extractionId)).toMatchObject({ canRetry: true, canSetCeiling: false });
    const refused = await retry.POST(
      new Request("http://127.0.0.1/x", { method: "POST" }),
      params(encrypted.extractionId),
    );
    expect(refused.status).toBe(409);
    expect(await view.getExtraction(encrypted.extractionId)).toMatchObject({ status: "FAILED" });
  });

  it("offers neither retry nor a ceiling change once the text is complete", async () => {
    for (const status of ["COMPLETED", "NEEDS_CHAPTERS"]) {
      const { extractionId, jobId } = await seed(status);
      await finishJob(jobId);
      expect(await view.getExtraction(extractionId)).toMatchObject({ canRetry: false, canSetCeiling: false });
    }
  });

  it("returns null for a book imported from text, and shows a PDF book's run status in the library", async () => {
    const { bookId } = await seed("OCR_PENDING");
    const textBook = await db.prisma.book.create({
      data: {
        title: "Sách chữ",
        sourceFilePath: "books/t/original.md",
        sourceFileName: "t.md",
        sourceHash: "hash-text",
        sourceFormat: "md",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
    });

    expect(await view.getBookExtraction(textBook.id)).toBeNull();
    expect((await view.getBookExtraction(bookId))?.status).toBe("OCR_PENDING");
    const listed = await books.listBooks();
    expect(listed.find((book) => book.id === bookId)).toMatchObject({
      sourceFormat: "pdf",
      extraction: { status: "OCR_PENDING", hasError: false },
    });
    expect(listed.find((book) => book.id === textBook.id)).toMatchObject({ sourceFormat: "md", extraction: null });

    await db.prisma.bookExtraction.updateMany({ where: { bookId }, data: { errorCode: "OCR_NOT_CONFIGURED" } });
    expect((await books.listBooks()).find((book) => book.id === bookId)?.extraction).toEqual({
      status: "OCR_PENDING",
      hasError: true,
    });
  });
});

describe("extraction routes", () => {
  it("reads a run, and answers 404 for an unknown one", async () => {
    const { extractionId } = await seed("QUEUED");

    const response = await single.GET(new Request("http://127.0.0.1/x"), params(extractionId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: extractionId, status: "QUEUED" });

    const missing = await single.GET(new Request("http://127.0.0.1/x"), params("nope"));
    expect(missing.status).toBe(404);
  });

  it("retries a stopped run with 202 and refuses a finished one with 409", async () => {
    const stopped = await seed("PARTIAL", { errorCode: "OCR_PAGES_FAILED", errorMessage: "2 trang" });
    await finishJob(stopped.jobId);

    const response = await retry.POST(
      new Request("http://127.0.0.1/x", { method: "POST" }),
      params(stopped.extractionId),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ jobType: "EXTRACT_PDF", status: "QUEUED" });
    expect(await view.getExtraction(stopped.extractionId)).toMatchObject({ status: "OCR_PENDING", errorCode: null });

    const done = await seed("COMPLETED");
    await finishJob(done.jobId);
    const refused = await retry.POST(new Request("http://127.0.0.1/x", { method: "POST" }), params(done.extractionId));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "EXTRACTION_NOT_RETRYABLE" } });
  });

  const put = (extractionId: string, body: unknown) =>
    ceiling.PUT(
      new Request("http://127.0.0.1/x", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params(extractionId),
    );

  it("changes the OCR ceiling, never below what is committed and never after the text is complete", async () => {
    const { extractionId } = await seed("OCR_PENDING", {
      reservedCostMicroUsd: 1_500_000,
      actualCostMicroUsd: 500_000,
    });

    const raised = await put(extractionId, { ceilingUsd: 5 });
    expect(raised.status).toBe(200);
    expect(await raised.json()).toMatchObject({ ocr: { ceilingMicroUsd: 5_000_000 } });

    const tooLow = await put(extractionId, { ceilingUsd: 1.99 });
    expect(tooLow.status).toBe(409);
    expect(await tooLow.json()).toMatchObject({ error: { code: "OCR_CEILING_BELOW_COMMITTED" } });

    const invalid = await put(extractionId, { ceilingUsd: 1000 });
    expect(invalid.status).toBe(400);

    const done = await seed("COMPLETED");
    const finished = await put(done.extractionId, { ceilingUsd: 5 });
    expect(finished.status).toBe(409);
    expect(await finished.json()).toMatchObject({ error: { code: "EXTRACTION_FINISHED" } });
  });
});
