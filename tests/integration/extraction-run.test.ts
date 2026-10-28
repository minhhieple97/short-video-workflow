import fs from "node:fs";
import path from "node:path";

import type { Job } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ProposedChapter } from "@/features/extraction/domain/chapter-detection";
import type * as ExtractionJobs from "@/features/extraction/repositories/extraction-jobs.repository";
import type * as ExtractionRepository from "@/features/extraction/repositories/extraction.repository";
import type * as ExtractionReconcile from "@/features/extraction/services/extraction-reconcile.service";
import type * as ExtractionRun from "@/features/extraction/services/extraction-run.service";
import type * as DbClient from "@/server/db/client";
import { IntegrationError } from "@/server/integrations/integration-error";
import type { OcrProvider } from "@/server/ocr/ocr-provider";
import type * as ExtractPdfProcessor from "@/worker/processors/extract-pdf";

import { FakeOcrProvider } from "../helpers/fakes/fake-ocr-provider";
import { buildPdf, type FixturePage } from "../helpers/pdf-fixtures";
import { popplerTestConfig } from "../helpers/poppler";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const poppler = popplerTestConfig();
let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof ExtractionRepository;
let jobs: typeof ExtractionJobs;
let run: typeof ExtractionRun;
let reconcile: typeof ExtractionReconcile;
let processor: typeof ExtractPdfProcessor;
let provider: FakeOcrProvider;

const BODY = [
  "Small habits make a big difference over a long time.",
  "Every action you take is a vote for the person you become.",
  "Make it obvious, make it attractive, make it easy to start.",
];
const TCVN3 = "Th¸i ®é t¸c ®µo t¹o thµnh c¸c th¸i quen.";
const TEXT_BOOK: FixturePage[] = [
  { lines: ["Chapter 1", ...BODY] },
  { lines: BODY },
  { lines: ["Chapter 2", ...BODY] },
];
// Pages 2 and 4 need OCR: a scan and a page in a legacy Vietnamese font.
const MIXED_BOOK: FixturePage[] = [
  { lines: ["Chapter 1", ...BODY] },
  { image: true },
  { lines: ["Chapter 2", ...BODY] },
  { lines: [TCVN3] },
];

async function seedPdf(pages: FixturePage[], ceilingMicroUsd = 3_000_000) {
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
    ceilingMicroUsd,
  );
  fs.mkdirSync(path.join(env.dataDir, "books", book.id), { recursive: true });
  fs.writeFileSync(path.join(env.dataDir, "books", book.id, "original.pdf"), buildPdf(pages));
  return { bookId: book.id, extractionId: extraction.id };
}

const deps = (ocr: () => OcrProvider = () => provider): ExtractionRun.ExtractionRunDeps => ({
  poppler: poppler ?? { binDir: undefined, timeoutMs: 30_000 },
  maxPages: 1000,
  createOcrProvider: ocr,
  extraChapterPatterns: [],
});
const notConfigured = () => {
  throw new IntegrationError("OCR_NOT_CONFIGURED", "Chưa cấu hình MISTRAL_API_KEY.", "REJECTED");
};
const extraction = (id: string) => db.prisma.bookExtraction.findUniqueOrThrow({ where: { id } });
const operations = (extractionId: string) =>
  db.prisma.ocrOperation.findMany({ where: { extractionId }, orderBy: { createdAt: "asc" } });
const pageStates = async (extractionId: string) =>
  (await db.prisma.extractionPage.findMany({ where: { extractionId }, orderBy: { pageNumber: "asc" } })).map(
    (page) => `${page.pageNumber}:${page.status}${page.errorCode ? `(${page.errorCode})` : ""}`,
  );
const chapters = (bookId: string) => db.prisma.chapter.findMany({ where: { bookId }, orderBy: { order: "asc" } });
const ocrDir = (bookId: string, extractionId: string) =>
  path.join(env.dataDir, "books", bookId, "extractions", extractionId, "ocr");

// The worker marks a job FAILED when its run stops; tests that call the run directly do that by hand before a retry.
const endJobs = () => db.prisma.jobRecord.updateMany({ data: { status: "FAILED" } });

async function runUntilSubmitted(extractionId: string) {
  const outcome = await run.runExtraction(extractionId, deps());
  expect(outcome).toEqual({ kind: "WAITING", retryAfterMs: run.OCR_FIRST_POLL_MS });
  const [operation] = await operations(extractionId);
  if (!operation?.operationRef) throw new Error("expected a submitted operation");
  return operation;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  Object.assign(process.env, { MISTRAL_API_KEY: "", POPPLER_BIN_DIR: poppler?.binDir ?? "" });
  db = await import("@/server/db/client");
  repo = await import("@/features/extraction/repositories/extraction.repository");
  jobs = await import("@/features/extraction/repositories/extraction-jobs.repository");
  run = await import("@/features/extraction/services/extraction-run.service");
  reconcile = await import("@/features/extraction/services/extraction-reconcile.service");
  processor = await import("@/worker/processors/extract-pdf");
}, 60_000);

beforeEach(async () => {
  provider = new FakeOcrProvider({ mode: "batch", usdPerPage: 0.001 });
  await db.prisma.book.deleteMany();
  await db.prisma.jobRecord.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe.skipIf(!poppler)("runExtraction (needs poppler-utils)", () => {
  it("takes a PDF with a usable text layer straight to chapters, without any OCR", async () => {
    const { bookId, extractionId } = await seedPdf(TEXT_BOOK);

    const outcome = await run.runExtraction(extractionId, deps(notConfigured));

    expect(outcome).toEqual({ kind: "COMPLETED" });
    expect(await extraction(extractionId)).toMatchObject({
      status: "COMPLETED",
      canonicalPath: `books/${bookId}/extractions/${extractionId}/canonical.md`,
      errorCode: null,
    });
    const created = await chapters(bookId);
    expect(created.map((chapter) => [chapter.order, chapter.title, chapter.analysisStatus])).toEqual([
      [1, "Chapter 1", "NOT_ANALYZED"],
      [2, "Chapter 2", "NOT_ANALYZED"],
    ]);
    const canonical = fs.readFileSync(
      path.join(env.dataDir, "books", bookId, "extractions", extractionId, "canonical.md"),
      "utf8",
    );
    const [first] = created;
    expect(first?.sourceStartOffset).toBe(0);
    expect(canonical.slice(first?.sourceStartOffset ?? 0, first?.sourceEndOffset ?? 0)).toContain("Chapter 1");
    const chapterFile = fs.readFileSync(path.join(env.dataDir, first?.contentPath ?? ""), "utf8");
    // Chapter 1 runs over page 2, which has no heading of its own.
    expect(chapterFile.match(/Small habits/g)).toHaveLength(2);
    expect(await operations(extractionId)).toEqual([]);
  });

  it("is a no-op once completed: running again creates no second set of chapters", async () => {
    const { bookId, extractionId } = await seedPdf(TEXT_BOOK);
    await run.runExtraction(extractionId, deps());

    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({ kind: "COMPLETED" });
    expect(await chapters(bookId)).toHaveLength(2);
  });

  it("sends only the pages that need OCR as one batch, waits for it without blocking, and finishes once it is done", async () => {
    const { bookId, extractionId } = await seedPdf(MIXED_BOOK);

    const operation = await runUntilSubmitted(extractionId);
    expect(JSON.parse(operation.chunkPlanJson ?? "null")).toEqual([{ chunkId: "chunk-1", pageNumbers: [2, 4] }]);
    expect(operation).toMatchObject({ status: "SUBMITTED", pageCount: 2, requestKey: `${extractionId}-ocr-1` });
    expect(await pageStates(extractionId)).toEqual([
      "1:EXTRACTED",
      "2:OCR_SUBMITTED",
      "3:EXTRACTED",
      "4:OCR_SUBMITTED",
    ]);
    expect(fs.existsSync(path.join(ocrDir(bookId, extractionId), operation.requestKey, "chunk-1.pdf"))).toBe(true);

    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({ kind: "WAITING", retryAfterMs: 1_000 });
    expect(await extraction(extractionId)).toMatchObject({ status: "OCR_PENDING" });

    provider.settle(operation.operationRef ?? "");
    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({ kind: "COMPLETED" });

    expect(provider.submissionCount).toBe(1);
    expect(provider.cleanedOperations.has(operation.operationRef ?? "")).toBe(true);
    expect(await pageStates(extractionId)).toEqual(["1:EXTRACTED", "2:EXTRACTED", "3:EXTRACTED", "4:EXTRACTED"]);
    expect(fs.existsSync(ocrDir(bookId, extractionId))).toBe(false);
    const created = await chapters(bookId);
    expect(created.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    // The OCR text of page 2 belongs to chapter 1, page 4 to chapter 2.
    const content = created.map((chapter) =>
      fs.readFileSync(path.join(env.dataDir, chapter.contentPath ?? ""), "utf8"),
    );
    expect(content[0]).toContain("Trang 1 của chunk-1");
    expect(content[1]).toContain("Trang 2 của chunk-1");
    expect(await extraction(extractionId)).toMatchObject({
      status: "COMPLETED",
      reservedCostMicroUsd: 0,
      actualCostMicroUsd: 2_000,
    });
  });

  it("holds the run with its reason when no OCR provider is configured, and a retry carries on from there", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);

    const held = await run.runExtraction(extractionId, deps(notConfigured));

    expect(held).toEqual({
      kind: "STOPPED",
      status: "OCR_PENDING",
      code: "OCR_NOT_CONFIGURED",
      message: "Chưa cấu hình MISTRAL_API_KEY.",
    });
    expect(await extraction(extractionId)).toMatchObject({ status: "OCR_PENDING", errorCode: "OCR_NOT_CONFIGURED" });
    expect(await operations(extractionId)).toEqual([]);

    await endJobs();
    const retried = await jobs.resetExtractionForRetry(extractionId);
    expect(retried.kind).toBe("started");
    expect(await extraction(extractionId)).toMatchObject({ status: "OCR_PENDING", errorCode: null });
    await runUntilSubmitted(extractionId);
  });

  it("refuses to plan a batch over the cost ceiling and keeps no chunk files", async () => {
    // Two pages at $0.001 each against a $0.0015 ceiling.
    const { bookId, extractionId } = await seedPdf(MIXED_BOOK, 1_500);

    const outcome = await run.runExtraction(extractionId, deps());

    expect(outcome).toMatchObject({ kind: "STOPPED", status: "OCR_PENDING", code: "OCR_BUDGET_EXCEEDED" });
    expect(provider.submissionCount).toBe(0);
    expect(await operations(extractionId)).toEqual([]);
    expect(await extraction(extractionId)).toMatchObject({ errorCode: "OCR_BUDGET_EXCEEDED", reservedCostMicroUsd: 0 });
    expect(fs.readdirSync(ocrDir(bookId, extractionId))).toEqual([]);
  });

  it("ends PARTIAL naming the pages OCR could not read, and a retry sends only those pages", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    const first = await runUntilSubmitted(extractionId);
    provider.completeWith(first.operationRef ?? "", [
      { chunkId: "chunk-1", status: "ok", pages: [{ pageIndex: 0, markdown: "Trang quét", confidence: 0.8 }] },
    ]);

    const outcome = await run.runExtraction(extractionId, deps());

    expect(outcome).toMatchObject({ kind: "STOPPED", status: "PARTIAL", code: "OCR_PAGES_FAILED" });
    expect(await pageStates(extractionId)).toEqual([
      "1:EXTRACTED",
      "2:FAILED(OCR_PAGE_COUNT_MISMATCH)",
      "3:EXTRACTED",
      "4:FAILED(OCR_PAGE_COUNT_MISMATCH)",
    ]);
    expect((await extraction(extractionId)).errorMessage).toContain("trang 2, 4");

    await endJobs();
    await expect(jobs.resetExtractionForRetry(extractionId)).resolves.toMatchObject({ kind: "started" });
    expect(await extraction(extractionId)).toMatchObject({ status: "OCR_PENDING", errorCode: null });
    expect(await pageStates(extractionId)).toEqual(["1:EXTRACTED", "2:NEEDS_OCR", "3:EXTRACTED", "4:NEEDS_OCR"]);
    const second = await runExtractionToSecondBatch(extractionId);
    expect(JSON.parse(second.chunkPlanJson ?? "null")).toEqual([{ chunkId: "chunk-1", pageNumbers: [2, 4] }]);
    expect(second.requestKey).toBe(`${extractionId}-ocr-2`);
  });

  it("marks a page too large to send as failed instead of skipping it", async () => {
    provider = new FakeOcrProvider({ mode: "batch", limits: { maxPages: 50, maxBytes: 64 } });
    const { extractionId } = await seedPdf(MIXED_BOOK);

    const outcome = await run.runExtraction(extractionId, deps());

    expect(outcome).toMatchObject({ kind: "STOPPED", status: "PARTIAL" });
    expect(provider.submissionCount).toBe(0);
    expect(await pageStates(extractionId)).toEqual([
      "1:EXTRACTED",
      "2:FAILED(OCR_PAGE_TOO_LARGE)",
      "3:EXTRACTED",
      "4:FAILED(OCR_PAGE_TOO_LARGE)",
    ]);
  });

  it("waits out a temporary refusal and rebuilds missing chunk files from the stored plan", async () => {
    const { bookId, extractionId } = await seedPdf(MIXED_BOOK);
    provider.failNextStart(new IntegrationError("MISTRAL_HTTP_503", "Mistral tạm lỗi.", "TRANSIENT"), {
      applied: false,
    });

    const waiting = await run.runExtraction(extractionId, deps());

    expect(waiting).toEqual({ kind: "WAITING", retryAfterMs: run.ocrBackoffMs(1) });
    const [planned] = await operations(extractionId);
    expect(planned).toMatchObject({ status: "PLANNED" });
    expect(await extraction(extractionId)).toMatchObject({ transientFailures: 1, errorCode: "MISTRAL_HTTP_503" });
    fs.rmSync(ocrDir(bookId, extractionId), { recursive: true, force: true });

    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({
      kind: "WAITING",
      retryAfterMs: run.OCR_FIRST_POLL_MS,
    });
    expect(provider.submissionCount).toBe(1);
    expect(await operations(extractionId)).toHaveLength(1);
    expect(fs.existsSync(path.join(ocrDir(bookId, extractionId), planned?.requestKey ?? "", "chunk-1.pdf"))).toBe(true);
    expect(await extraction(extractionId)).toMatchObject({ transientFailures: 0, errorCode: null });
  });

  it("reconciles a submission whose answer was lost instead of sending it again", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    provider.failNextStart(new IntegrationError("MISTRAL_TRANSPORT", "mất phản hồi", "UNKNOWN_OUTCOME"), {
      applied: true,
    });

    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({
      kind: "WAITING",
      retryAfterMs: run.ocrBackoffMs(1),
    });
    expect((await operations(extractionId))[0]).toMatchObject({ status: "UNKNOWN_OUTCOME" });

    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({
      kind: "WAITING",
      retryAfterMs: run.OCR_FIRST_POLL_MS,
    });
    expect(provider.submissionCount).toBe(1);
    expect((await operations(extractionId))[0]).toMatchObject({ status: "SUBMITTED", operationRef: "fake-op-1" });
  });

  it("holds the run, keeping the planned batch and its reservation, when the provider refuses the key on submit", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    provider.failNextStart(new IntegrationError("MISTRAL_HTTP_401", "Khoá Mistral bị từ chối.", "AUTH"), {
      applied: false,
    });

    await expect(run.runExtraction(extractionId, deps())).resolves.toMatchObject({
      kind: "STOPPED",
      status: "OCR_PENDING",
      code: "MISTRAL_HTTP_401",
    });
    expect((await operations(extractionId))[0]).toMatchObject({ status: "PLANNED" });
    expect(await extraction(extractionId)).toMatchObject({ reservedCostMicroUsd: 2_000, transientFailures: 0 });
  });

  it("holds the run when the provider refuses the key while a batch is out, keeping the batch", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    await runUntilSubmitted(extractionId);
    provider.failNextPoll(new IntegrationError("MISTRAL_HTTP_401", "Khoá Mistral bị từ chối.", "AUTH"));

    await expect(run.runExtraction(extractionId, deps())).resolves.toMatchObject({
      kind: "STOPPED",
      status: "OCR_PENDING",
      code: "MISTRAL_HTTP_401",
    });
    expect((await operations(extractionId))[0]).toMatchObject({ status: "SUBMITTED" });
  });

  it("stops waiting after too many temporary failures in a row", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    await runUntilSubmitted(extractionId);
    await db.prisma.bookExtraction.update({
      where: { id: extractionId },
      data: { transientFailures: run.MAX_OCR_TRANSIENT_FAILURES },
    });
    provider.failNextPoll(new IntegrationError("MISTRAL_HTTP_503", "Mistral tạm lỗi.", "TRANSIENT"));

    const outcome = await run.runExtraction(extractionId, deps());

    expect(outcome).toMatchObject({ kind: "STOPPED", status: "OCR_PENDING", code: "MISTRAL_HTTP_503" });
    expect(outcome.kind === "STOPPED" && outcome.message).toContain(`đã thử lại ${run.MAX_OCR_TRANSIENT_FAILURES} lần`);
  });

  it("does not switch an open batch to another OCR model by itself", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    await runUntilSubmitted(extractionId);
    const other = Object.assign(Object.create(provider) as FakeOcrProvider, { model: "fake-ocr-2" });

    await expect(
      run.runExtraction(
        extractionId,
        deps(() => other),
      ),
    ).resolves.toMatchObject({
      kind: "STOPPED",
      code: "OCR_PROVIDER_CHANGED",
    });
    expect((await operations(extractionId))[0]).toMatchObject({ status: "SUBMITTED" });
  });

  it("leaves resending to the user when a batch was cancelled at the provider", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    const operation = await runUntilSubmitted(extractionId);
    await provider.cancel(operation.operationRef ?? "");

    await expect(run.runExtraction(extractionId, deps())).resolves.toMatchObject({
      kind: "STOPPED",
      status: "OCR_PENDING",
      code: "OCR_CANCELLED_REMOTELY",
    });
    expect(provider.submissionCount).toBe(1);
    expect(await pageStates(extractionId)).toEqual(["1:EXTRACTED", "2:NEEDS_OCR", "3:EXTRACTED", "4:NEEDS_OCR"]);
    expect((await operations(extractionId))[0]).toMatchObject({ status: "CANCELLED", reservedCostMicroUsd: 2_000 });
    expect(await extraction(extractionId)).toMatchObject({ reservedCostMicroUsd: 0, actualCostMicroUsd: 0 });
  });

  it("sends again a page left marked as sent when no batch holds it", async () => {
    const { extractionId } = await seedPdf(MIXED_BOOK);
    await run.runExtraction(extractionId, deps(notConfigured));
    await db.prisma.extractionPage.updateMany({
      where: { extractionId, pageNumber: 2 },
      data: { status: "OCR_SUBMITTED" },
    });

    const operation = await runUntilSubmitted(extractionId);

    expect(JSON.parse(operation.chunkPlanJson ?? "null")).toEqual([{ chunkId: "chunk-1", pageNumbers: [2, 4] }]);
  });

  it("creates the chapters only once when the chapter step runs twice", async () => {
    const { bookId, extractionId } = await seedPdf(TEXT_BOOK);
    await db.prisma.bookExtraction.update({
      where: { id: extractionId },
      data: { status: "ASSEMBLING", pageCount: 3 },
    });
    const chaptersService = await import("@/features/extraction/services/extraction-chapters.service");
    const markdown = ["Chapter 1", ...BODY, "", "Chapter 2", ...BODY].join("\n");
    const input = { extractionId, bookId, markdown, extraChapterPatterns: [] };

    await expect(chaptersService.createChaptersFromCanonical(input)).resolves.toEqual({ kind: "CREATED", chapters: 2 });
    await expect(chaptersService.createChaptersFromCanonical(input)).resolves.toEqual({ kind: "ALREADY_DONE" });

    expect(await chapters(bookId)).toHaveLength(2);
    expect(fs.readdirSync(path.join(env.dataDir, "books", bookId, "chapters"))).toHaveLength(2);
  });

  const UNMARKED_BOOK: FixturePage[] = [
    { lines: ["Introduction to habits", ...BODY] },
    { lines: ["Why identity matters", ...BODY] },
  ];
  const firstProposal = {
    title: "Introduction to habits",
    startPage: 1,
    endPage: 1,
    startAnchor: "Introduction to habits",
  };
  const secondProposal = {
    title: "Why identity matters",
    startPage: 2,
    endPage: 2,
    startAnchor: "Why identity matters",
  };
  const proposals = [firstProposal, secondProposal];
  const detector = (answer: () => Promise<ProposedChapter[]>) => {
    const asked: string[] = [];
    return {
      asked,
      detector: {
        detect: async (input: { extractionId: string; outline: { markdown: string } }) => {
          asked.push(input.outline.markdown);
          return answer();
        },
      },
    };
  };

  it("asks the detector when the local parser finds no chapter and creates the chapters it proposes once they check out", async () => {
    const { bookId, extractionId } = await seedPdf(UNMARKED_BOOK);
    const { asked, detector: chapterDetector } = detector(async () => proposals);

    await expect(run.runExtraction(extractionId, { ...deps(), chapterDetector })).resolves.toEqual({
      kind: "COMPLETED",
    });

    expect(asked).toHaveLength(1);
    // Page heads only: what follows a page's first 160 characters is not sent.
    expect(asked[0]?.split("\n")).toHaveLength(2);
    expect(asked[0]).toContain("[Trang 1] Introduction to habits");
    expect(asked[0]).not.toContain("easy to start");
    expect((await chapters(bookId)).map((chapter) => chapter.title)).toEqual([
      "Introduction to habits",
      "Why identity matters",
    ]);
  });

  it("creates nothing from proposals that do not match the text, and a retry asks again", async () => {
    const { bookId, extractionId } = await seedPdf(UNMARKED_BOOK);
    const wrong = detector(async () => [{ ...firstProposal, startAnchor: "Words that are nowhere" }, secondProposal]);

    const outcome = await run.runExtraction(extractionId, { ...deps(), chapterDetector: wrong.detector });

    expect(outcome).toMatchObject({ kind: "STOPPED", status: "NEEDS_CHAPTERS", code: "CHAPTER_DETECTION_REJECTED" });
    expect(await chapters(bookId)).toEqual([]);
    expect(await extraction(extractionId)).toMatchObject({ status: "NEEDS_CHAPTERS" });

    await endJobs();
    await expect(jobs.resetExtractionForRetry(extractionId)).resolves.toMatchObject({ kind: "started" });
    expect(await extraction(extractionId)).toMatchObject({ status: "DETECTING_CHAPTERS", errorCode: null });
    const right = detector(async () => proposals);
    await expect(run.runExtraction(extractionId, { ...deps(), chapterDetector: right.detector })).resolves.toEqual({
      kind: "COMPLETED",
    });
    expect(await chapters(bookId)).toHaveLength(2);
  });

  it("waits out a temporary NotebookLM failure and stops on a refused sign-in", async () => {
    const { extractionId } = await seedPdf(UNMARKED_BOOK);
    const busy = detector(async () => {
      throw new IntegrationError("NOTEBOOKLM_RATE_LIMITED", "NotebookLM đang giới hạn.", "QUOTA", {
        retryAfterMs: 90_000,
      });
    });

    await expect(run.runExtraction(extractionId, { ...deps(), chapterDetector: busy.detector })).resolves.toEqual({
      kind: "WAITING",
      retryAfterMs: 90_000,
    });
    expect(await extraction(extractionId)).toMatchObject({ status: "DETECTING_CHAPTERS", transientFailures: 1 });

    const signedOut = detector(async () => {
      throw new IntegrationError("NOTEBOOKLM_AUTH_REQUIRED", "Cần đăng nhập NotebookLM.", "AUTH");
    });
    await expect(
      run.runExtraction(extractionId, { ...deps(), chapterDetector: signedOut.detector }),
    ).resolves.toMatchObject({
      kind: "STOPPED",
      status: "NEEDS_CHAPTERS",
      code: "NOTEBOOKLM_AUTH_REQUIRED",
    });
  });

  it("stops at NEEDS_CHAPTERS rather than making the whole book one chapter", async () => {
    const { bookId, extractionId } = await seedPdf([{ lines: BODY }, { lines: BODY }]);

    const outcome = await run.runExtraction(extractionId, deps());

    expect(outcome).toMatchObject({ kind: "NEEDS_CHAPTERS" });
    expect(await extraction(extractionId)).toMatchObject({
      status: "NEEDS_CHAPTERS",
      errorCode: "CHAPTERS_NOT_DETECTED",
      errorMessage: expect.stringContaining("NOTEBOOKLM_PROFILE"),
    });
    expect((await extraction(extractionId)).canonicalPath).not.toBeNull();
    expect(await chapters(bookId)).toEqual([]);
    expect(fs.existsSync(path.join(env.dataDir, "books", bookId, "chapters"))).toBe(false);
  });

  it("reports a PDF that cannot be read as a failed run", async () => {
    const { extractionId } = await seedPdf(TEXT_BOOK);
    const book = await db.prisma.bookExtraction.findUniqueOrThrow({
      where: { id: extractionId },
      include: { book: true },
    });
    const file = path.join(env.dataDir, book.book.sourceFilePath);
    fs.writeFileSync(file, "%PDF-1.4 không phải PDF thật");

    await expect(run.runExtraction(extractionId, deps())).resolves.toMatchObject({
      kind: "STOPPED",
      status: "FAILED",
      code: "PDF_CORRUPT",
    });
  });
});

describe.skipIf(!poppler)("extraction jobs (needs poppler-utils)", () => {
  const job = (extractionId: string) => ({ data: { jobRecordId: "record", extractionId } }) as unknown as Job;

  it("completes the job for a text PDF and fails it with the stored reason when OCR has no key", async () => {
    const text = await seedPdf(TEXT_BOOK);
    const scanned = await seedPdf(MIXED_BOOK);
    const context = (extractionId: string) => ({
      job: job(extractionId),
      jobRecordId: "record",
      signal: new AbortController().signal,
      reportProgress: async () => {},
    });

    await expect(processor.processExtractPdf(context(text.extractionId))).resolves.toEqual({
      extractionId: text.extractionId,
      outcome: "COMPLETED",
    });
    await expect(processor.processExtractPdf(context(scanned.extractionId))).rejects.toMatchObject({
      code: "OCR_NOT_CONFIGURED",
    });
  });
});

describe("extraction job bookkeeping", () => {
  it("gives a runnable extraction whose job was lost a new one at start-up, and only one", async () => {
    const { extractionId } = await seedPdf(TEXT_BOOK);
    const [original] = await db.prisma.jobRecord.findMany({ where: { entityId: extractionId } });
    await db.prisma.jobRecord.update({ where: { id: original?.id }, data: { status: "FAILED" } });

    await expect(reconcile.reconcileExtractions()).resolves.toBe(1);
    await expect(reconcile.reconcileExtractions()).resolves.toBe(0);
    const records = await db.prisma.jobRecord.findMany({ where: { entityId: extractionId, status: "QUEUED" } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ jobType: "EXTRACT_PDF", entityType: "EXTRACTION" });
  });

  it("does not restart a finished, stopped or cancelled run at start-up", async () => {
    for (const status of ["COMPLETED", "PARTIAL", "NEEDS_CHAPTERS", "CANCELLED", "FAILED"]) {
      const { extractionId } = await seedPdf(TEXT_BOOK);
      await db.prisma.bookExtraction.update({ where: { id: extractionId }, data: { status } });
    }
    await endJobs();

    await expect(reconcile.reconcileExtractions()).resolves.toBe(0);
  });

  it("retries a stopped run from where its data stands and refuses to retry a finished one", async () => {
    const fresh = await seedPdf(TEXT_BOOK);
    await db.prisma.bookExtraction.update({
      where: { id: fresh.extractionId },
      data: { status: "FAILED", errorCode: "PDF_TOOL_MISSING", errorMessage: "x" },
    });
    await endJobs();

    const retried = await jobs.resetExtractionForRetry(fresh.extractionId);

    expect(retried.kind).toBe("started");
    expect(await extraction(fresh.extractionId)).toMatchObject({
      status: "QUEUED",
      errorCode: null,
      errorMessage: null,
    });
    await expect(jobs.resetExtractionForRetry(fresh.extractionId)).resolves.toMatchObject({ kind: "running" });

    await db.prisma.bookExtraction.update({ where: { id: fresh.extractionId }, data: { status: "COMPLETED" } });
    await db.prisma.jobRecord.updateMany({ data: { status: "COMPLETED" } });
    await expect(jobs.resetExtractionForRetry(fresh.extractionId)).resolves.toEqual({
      kind: "not_retryable",
      status: "COMPLETED",
    });
  });

  it("cancelling stops an unfinished run and leaves a finished one alone", async () => {
    const running = await seedPdf(TEXT_BOOK);
    const done = await seedPdf(TEXT_BOOK);
    await db.prisma.bookExtraction.update({ where: { id: done.extractionId }, data: { status: "COMPLETED" } });

    await jobs.cancelExtraction(running.extractionId);
    await jobs.cancelExtraction(done.extractionId);

    expect(await extraction(running.extractionId)).toMatchObject({
      status: "CANCELLED",
      errorCode: "EXTRACTION_CANCELLED",
    });
    expect(await extraction(done.extractionId)).toMatchObject({ status: "COMPLETED" });
  });
});

async function runExtractionToSecondBatch(extractionId: string) {
  await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({
    kind: "WAITING",
    retryAfterMs: run.OCR_FIRST_POLL_MS,
  });
  const all = await operations(extractionId);
  expect(all).toHaveLength(2);
  const second = all[1];
  if (!second) throw new Error("expected a second operation");
  return second;
}
