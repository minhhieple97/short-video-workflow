import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as OcrBudget from "@/features/extraction/services/ocr-budget.service";
import type * as OcrOperation from "@/features/extraction/services/ocr-operation.service";
import type * as DbClient from "@/server/db/client";
import { IntegrationError } from "@/server/integrations/integration-error";
import type { OcrChunkResult } from "@/server/ocr/ocr-provider";

import { FakeOcrProvider } from "../helpers/fakes/fake-ocr-provider";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let budget: typeof OcrBudget;
let operations: typeof OcrOperation;

let provider: FakeOcrProvider;
let extractionId: string;
let operationId: string;

// 4 pages at $0.001 each: 4_000 micro-USD reserved against a $3 ceiling.
const RESERVED = 4_000;
const CHUNKS = [
  { chunkId: "a", pageNumbers: [2, 3], filePath: "/unused/a.pdf", bytes: 100 },
  { chunkId: "b", pageNumbers: [4, 5], filePath: "/unused/b.pdf", bytes: 100 },
];

const ok = (chunkId: string, texts: string[]): OcrChunkResult => ({
  chunkId,
  status: "ok",
  pages: texts.map((markdown, pageIndex) => ({ pageIndex, markdown, confidence: 0.9 })),
});

const lost = () => new IntegrationError("MISTRAL_TRANSPORT", "lost answer", "UNKNOWN_OUTCOME");

async function operation() {
  return db.prisma.ocrOperation.findUniqueOrThrow({ where: { id: operationId } });
}

async function totals() {
  const row = await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } });
  return { reserved: row.reservedCostMicroUsd, actual: row.actualCostMicroUsd };
}

async function pageStates() {
  const rows = await db.prisma.extractionPage.findMany({ where: { extractionId }, orderBy: { pageNumber: "asc" } });
  return rows.map((row) => `${row.pageNumber}:${row.status}${row.errorCode ? `(${row.errorCode})` : ""}`);
}

async function submitted(): Promise<string> {
  const outcome = await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });
  if (outcome.status !== "SUBMITTED") throw new Error(`expected SUBMITTED, got ${outcome.status}`);
  return outcome.operationRef;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  budget = await import("@/features/extraction/services/ocr-budget.service");
  operations = await import("@/features/extraction/services/ocr-operation.service");
}, 60_000);

beforeEach(async () => {
  provider = new FakeOcrProvider({ mode: "batch", usdPerPage: 0.001 });
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
    await db.prisma.bookExtraction.create({
      data: { bookId: book.id, status: "EXTRACTING", sourceHash: "pdf", pageCount: 5, costCeilingMicroUsd: 3_000_000 },
    })
  ).id;
  await db.prisma.extractionPage.createMany({
    data: [
      { extractionId, pageNumber: 1, status: "EXTRACTED", method: "TEXT", text: "Có lớp văn bản" },
      ...[2, 3, 4, 5].map((pageNumber) => ({
        extractionId,
        pageNumber,
        status: "NEEDS_OCR",
        ocrReason: "NO_TEXT_LAYER",
      })),
    ],
  });
  operationId = (await budget.planOcrOperation({ provider, extractionId, requestKey: "ext:set-1", pageCount: 4 })).id;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("submitOcrOperation", () => {
  it("submits, records the provider reference and marks the pages as sent", async () => {
    const operationRef = await submitted();

    expect(await operation()).toMatchObject({ status: "SUBMITTED", operationRef });
    expect((await operation()).submittedAt).not.toBeNull();
    expect(await pageStates()).toEqual([
      "1:EXTRACTED",
      "2:OCR_SUBMITTED",
      "3:OCR_SUBMITTED",
      "4:OCR_SUBMITTED",
      "5:OCR_SUBMITTED",
    ]);
    expect(await totals()).toEqual({ reserved: RESERVED, actual: 0 });
  });

  it("records the intent before calling the provider, so a crash mid-call leaves a trace", async () => {
    let seenDuringCall: string | null = null;
    const original = provider.start.bind(provider);
    provider.start = async (request, options) => {
      seenDuringCall = (await operation()).status;
      return original(request, options);
    };

    await submitted();

    expect(seenDuringCall).toBe("SUBMITTING");
  });

  it("keeps the reservation and reports UNKNOWN_OUTCOME when the answer is lost after the provider accepted it", async () => {
    provider.failNextStart(lost(), { applied: true });

    const outcome = await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });

    expect(outcome).toEqual({ status: "UNKNOWN_OUTCOME" });
    expect(await operation()).toMatchObject({ status: "UNKNOWN_OUTCOME", errorCode: "MISTRAL_TRANSPORT" });
    expect(await totals()).toEqual({ reserved: RESERVED, actual: 0 });
    expect(provider.submissionCount).toBe(1);
  });

  it("adopts the provider's submission after a lost answer without calling start a second time", async () => {
    let startCalls = 0;
    const original = provider.start.bind(provider);
    provider.start = async (request, options) => {
      startCalls += 1;
      return original(request, options);
    };
    provider.failNextStart(lost(), { applied: true });
    await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });

    const outcome = await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });

    expect(outcome).toMatchObject({ status: "SUBMITTED", operationRef: "fake-op-1" });
    expect(startCalls).toBe(1);
    expect(provider.submissionCount).toBe(1);
    expect(await operation()).toMatchObject({ status: "SUBMITTED", operationRef: "fake-op-1" });
  });

  it("submits for real after a lost answer when the provider never received the request", async () => {
    provider.failNextStart(lost(), { applied: false });
    await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });
    expect(provider.submissionCount).toBe(0);

    const reconciled = await operations.reconcileOcrOperation({ provider, operationId, plan: CHUNKS });
    expect(reconciled).toEqual({ status: "NOT_FOUND" });
    expect(await operation()).toMatchObject({ status: "PLANNED" });
    expect(await pageStates()).toContain("2:NEEDS_OCR");

    const outcome = await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });
    expect(outcome).toMatchObject({ status: "SUBMITTED" });
    expect(provider.submissionCount).toBe(1);
  });

  it("treats a definite rejection as final: pages fail with the reason and the reservation is released", async () => {
    provider.failNextStart(new IntegrationError("MISTRAL_HTTP_422", "bad model", "REJECTED"), { applied: false });

    const outcome = await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });

    expect(outcome).toEqual({ status: "FAILED", code: "MISTRAL_HTTP_422" });
    expect(await operation()).toMatchObject({ status: "FAILED" });
    expect(await pageStates()).toEqual([
      "1:EXTRACTED",
      "2:FAILED(MISTRAL_HTTP_422)",
      "3:FAILED(MISTRAL_HTTP_422)",
      "4:FAILED(MISTRAL_HTTP_422)",
      "5:FAILED(MISTRAL_HTTP_422)",
    ]);
    expect(await totals()).toEqual({ reserved: 0, actual: 0 });
  });

  it.each([
    ["AUTH", "MISTRAL_HTTP_401", undefined],
    ["QUOTA", "MISTRAL_HTTP_429", 12_000],
  ] as const)(
    "returns the operation to PLANNED, with its reservation, after a %s refusal",
    async (kind, code, retryAfterMs) => {
      provider.failNextStart(new IntegrationError(code, "refused", kind, { retryAfterMs }), { applied: false });

      const outcome = await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });

      expect(outcome).toEqual({
        status: "RETRY_LATER",
        kind,
        code,
        message: "refused",
        retryAfterMs: retryAfterMs ?? null,
      });
      expect(await operation()).toMatchObject({ status: "PLANNED" });
      expect(await pageStates()).toEqual(["1:EXTRACTED", "2:NEEDS_OCR", "3:NEEDS_OCR", "4:NEEDS_OCR", "5:NEEDS_OCR"]);
      expect(await totals()).toEqual({ reserved: RESERVED, actual: 0 });
    },
  );

  it("is idempotent once submitted", async () => {
    const first = await submitted();

    const again = await operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS });

    expect(again).toEqual({ status: "SUBMITTED", operationRef: first });
    expect(provider.submissionCount).toBe(1);
  });

  it("refuses to submit an operation that has already finished", async () => {
    const operationRef = await submitted();
    provider.settle(operationRef);
    await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    await expect(operations.submitOcrOperation({ provider, operationId, chunks: CHUNKS })).rejects.toMatchObject({
      code: "OCR_OPERATION_SETTLED",
    });
  });
});

describe("collectOcrOperation", () => {
  it("reports pending without changing anything but the poll time", async () => {
    await submitted();

    const outcome = await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    expect(outcome).toEqual({ status: "PENDING", retryAfterMs: 1_000 });
    expect((await operation()).lastPolledAt).not.toBeNull();
    expect(await totals()).toEqual({ reserved: RESERVED, actual: 0 });
  });

  it("refuses to collect an operation that was never submitted", async () => {
    await expect(operations.collectOcrOperation({ provider, operationId, plan: CHUNKS })).rejects.toMatchObject({
      code: "OCR_OPERATION_NOT_SUBMITTED",
    });
  });

  it("stores the text first, then settles the budget, and only then cleans the provider up", async () => {
    const operationRef = await submitted();
    provider.completeWith(operationRef, [ok("a", ["Hai", "Ba"]), ok("b", ["Bốn", "   "])]);
    let storedWhenCleaned: string[] = [];
    provider.onCleanup = async () => {
      storedWhenCleaned = await pageStates();
    };

    const outcome = await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    expect(outcome).toMatchObject({ status: "COMPLETED", stored: 4, failed: 0, skipped: 0 });
    expect(storedWhenCleaned).toEqual(["1:EXTRACTED", "2:EXTRACTED", "3:EXTRACTED", "4:EXTRACTED", "5:EXTRACTED"]);
    const finished = await operation();
    expect(finished).toMatchObject({ status: "COMPLETED", actualCostMicroUsd: null });
    expect(finished.outputStoredAt).not.toBeNull();
    expect(finished.cleanedAt).not.toBeNull();
    expect(provider.cleanedOperations.has(operationRef)).toBe(true);
    expect(await totals()).toEqual({ reserved: 0, actual: RESERVED });
  });

  it("keeps the stored text and the completed status when the provider cleanup fails", async () => {
    const operationRef = await submitted();
    provider.completeWith(operationRef, [ok("a", ["Hai", "Ba"]), ok("b", ["Bốn", "Năm"])]);
    provider.failCleanupWith(new IntegrationError("MISTRAL_TRANSPORT", "down", "TRANSIENT"));

    const outcome = await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    expect(outcome).toMatchObject({ status: "COMPLETED", stored: 4 });
    const finished = await operation();
    expect(finished).toMatchObject({ status: "COMPLETED" });
    expect(finished.outputStoredAt).not.toBeNull();
    expect(finished.cleanedAt).toBeNull();
  });

  it("fails only the pages of a chunk that failed and leaves the rest extracted", async () => {
    const operationRef = await submitted();
    provider.completeWith(operationRef, [
      ok("a", ["Hai", "Ba"]),
      { chunkId: "b", status: "failed", code: "OCR_REQUEST_500", message: "x" },
    ]);

    const outcome = await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    expect(outcome).toMatchObject({ status: "COMPLETED", stored: 2, failed: 2 });
    expect(await pageStates()).toEqual([
      "1:EXTRACTED",
      "2:EXTRACTED",
      "3:EXTRACTED",
      "4:FAILED(OCR_REQUEST_500)",
      "5:FAILED(OCR_REQUEST_500)",
    ]);
  });

  it("retries only the failed pages: they return to the queue, the others are untouched", async () => {
    const operationRef = await submitted();
    provider.completeWith(operationRef, [
      ok("a", ["Hai", "Ba"]),
      { chunkId: "b", status: "failed", code: "X", message: "x" },
    ]);
    await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    const retried = await operations.resetFailedOcrPagesForRetry(extractionId);

    expect(retried).toEqual([4, 5]);
    expect(await pageStates()).toEqual(["1:EXTRACTED", "2:EXTRACTED", "3:EXTRACTED", "4:NEEDS_OCR", "5:NEEDS_OCR"]);
  });

  it("does not reset a page that failed for a reason other than OCR", async () => {
    await db.prisma.extractionPage.create({
      data: { extractionId, pageNumber: 6, status: "FAILED", errorCode: "PAGE_UNREADABLE" },
    });

    expect(await operations.resetFailedOcrPagesForRetry(extractionId)).toEqual([]);
  });

  it("releases the reservation and fails the pages when the whole batch failed", async () => {
    const operationRef = await submitted();
    provider.failOperation(operationRef, { code: "MISTRAL_BATCH_TIMEOUT", retryable: true });

    const outcome = await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    expect(outcome).toEqual({ status: "FAILED", code: "MISTRAL_BATCH_TIMEOUT", retryable: true });
    expect(await operation()).toMatchObject({ status: "FAILED" });
    expect((await pageStates()).slice(1)).toEqual(
      Array.from({ length: 4 }, (_, i) => `${i + 2}:FAILED(MISTRAL_BATCH_TIMEOUT)`),
    );
    expect(await totals()).toEqual({ reserved: 0, actual: 0 });
  });

  it("returns the pages to the queue and releases the reservation when the batch was cancelled", async () => {
    const operationRef = await submitted();
    await provider.cancel(operationRef);

    const outcome = await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    expect(outcome).toEqual({ status: "CANCELLED" });
    expect(await operation()).toMatchObject({ status: "CANCELLED" });
    expect(await pageStates()).toEqual(["1:EXTRACTED", "2:NEEDS_OCR", "3:NEEDS_OCR", "4:NEEDS_OCR", "5:NEEDS_OCR"]);
    expect(await totals()).toEqual({ reserved: 0, actual: 0 });
  });

  it("does not change the spend when the same completed batch is collected twice", async () => {
    const operationRef = await submitted();
    provider.completeWith(operationRef, [ok("a", ["Hai", "Ba"]), ok("b", ["Bốn", "Năm"])]);
    await operations.collectOcrOperation({ provider, operationId, plan: CHUNKS });

    await expect(operations.collectOcrOperation({ provider, operationId, plan: CHUNKS })).rejects.toMatchObject({
      code: "OCR_OPERATION_NOT_SUBMITTED",
    });

    expect(await totals()).toEqual({ reserved: 0, actual: RESERVED });
  });
});
