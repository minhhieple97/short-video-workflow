import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as OcrBudget from "@/features/extraction/services/ocr-budget.service";
import type * as DbClient from "@/server/db/client";

import { FakeOcrProvider } from "../helpers/fakes/fake-ocr-provider";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let budget: typeof OcrBudget;

// $0.001 a page, so 100 pages cost 100_000 micro-USD and the default $3 ceiling holds 3_000 pages.
const provider = new FakeOcrProvider({ mode: "batch", usdPerPage: 0.001 });
const CEILING = 3_000_000;
let extractionId: string;

async function newExtraction(ceilingMicroUsd: number | null = CEILING): Promise<string> {
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
  const extraction = await db.prisma.bookExtraction.create({
    data: { bookId: book.id, status: "QUEUED", sourceHash: "pdf", costCeilingMicroUsd: ceilingMicroUsd },
  });
  return extraction.id;
}

const totals = async (id: string) => {
  const { reservedCostMicroUsd, actualCostMicroUsd, costCeilingMicroUsd } =
    await db.prisma.bookExtraction.findUniqueOrThrow({
      where: { id },
    });
  return { reserved: reservedCostMicroUsd, actual: actualCostMicroUsd, ceiling: costCeilingMicroUsd };
};

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  budget = await import("@/features/extraction/services/ocr-budget.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  extractionId = await newExtraction();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("planOcrOperation", () => {
  it("records the operation as PLANNED and reserves its estimated cost", async () => {
    const operation = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });

    expect(operation).toMatchObject({
      status: "PLANNED",
      reservedCostMicroUsd: 100_000,
      pageCount: 100,
      operationRef: null,
    });
    expect(await totals(extractionId)).toEqual({ reserved: 100_000, actual: 0, ceiling: CEILING });
    expect(await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } })).toMatchObject({
      ocrProvider: "fake-ocr",
      ocrModel: "fake-ocr-1",
    });
  });

  it("returns the existing operation for a replayed request key without reserving twice", async () => {
    const first = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });
    const replay = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });

    expect(replay.id).toBe(first.id);
    expect((await totals(extractionId)).reserved).toBe(100_000);
    expect(await db.prisma.ocrOperation.count()).toBe(1);
  });

  it("refuses an estimate above the remaining budget and changes nothing", async () => {
    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 4_000 }),
    ).rejects.toMatchObject({
      code: "OCR_BUDGET_EXCEEDED",
      httpStatus: 409,
    });

    expect(await db.prisma.ocrOperation.count()).toBe(0);
    expect(await totals(extractionId)).toEqual({ reserved: 0, actual: 0, ceiling: CEILING });
  });

  it("allows a batch that exactly uses the remaining budget", async () => {
    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 3_000 }),
    ).resolves.toMatchObject({
      reservedCostMicroUsd: CEILING,
    });
  });

  it("opens only one batch at a time until the previous one settles", async () => {
    const first = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 10 });

    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k2", pageCount: 10 }),
    ).rejects.toMatchObject({
      code: "OCR_BATCH_IN_PROGRESS",
      details: { operationId: first.id },
    });

    await budget.settleOcrOperation(first.id, { status: "FAILED" });
    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k2", pageCount: 10 }),
    ).resolves.toMatchObject({
      status: "PLANNED",
    });
  });

  it("refuses to switch OCR provider or model once a run has used one", async () => {
    const first = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 10 });
    await budget.settleOcrOperation(first.id, { status: "CANCELLED" });

    const other = new FakeOcrProvider({ mode: "batch" });
    Object.defineProperty(other, "model", { value: "fake-ocr-2" });

    await expect(
      budget.planOcrOperation({ provider: other, extractionId, requestKey: "k2", pageCount: 10 }),
    ).rejects.toMatchObject({
      code: "OCR_PROVIDER_CHANGED",
    });
  });

  it("refuses to run without a ceiling instead of inventing one", async () => {
    const noCeiling = await newExtraction(null);

    await expect(
      budget.planOcrOperation({ provider, extractionId: noCeiling, requestKey: "k1", pageCount: 1 }),
    ).rejects.toMatchObject({ code: "OCR_CEILING_NOT_SET" });
  });

  it("reports an unknown extraction as not found", async () => {
    await expect(
      budget.planOcrOperation({ provider, extractionId: "missing", requestKey: "k1", pageCount: 1 }),
    ).rejects.toMatchObject({ code: "EXTRACTION_NOT_FOUND", httpStatus: 404 });
  });
});

describe("settleOcrOperation", () => {
  it("keeps the reservation while the outcome is unknown, and the budget stays committed", async () => {
    const operation = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 2_000 });
    await db.prisma.ocrOperation.update({ where: { id: operation.id }, data: { status: "UNKNOWN_OUTCOME" } });

    expect(await totals(extractionId)).toEqual({ reserved: 2_000_000, actual: 0, ceiling: CEILING });
    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k2", pageCount: 10 }),
    ).rejects.toMatchObject({
      code: "OCR_BATCH_IN_PROGRESS",
    });
  });

  it("counts the provider's reported cost as the spend and releases the reservation", async () => {
    const operation = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });

    const settled = await budget.settleOcrOperation(operation.id, { status: "COMPLETED", reportedMicroUsd: 80_000 });

    expect(settled).toMatchObject({ status: "COMPLETED", actualCostMicroUsd: 80_000 });
    expect(await totals(extractionId)).toEqual({ reserved: 0, actual: 80_000, ceiling: CEILING });
  });

  it("keeps the estimate as the spend when the provider reports no cost, without recording it as reported", async () => {
    const operation = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });

    const settled = await budget.settleOcrOperation(operation.id, { status: "COMPLETED", reportedMicroUsd: null });

    expect(settled.actualCostMicroUsd).toBeNull();
    expect(await totals(extractionId)).toEqual({ reserved: 0, actual: 100_000, ceiling: CEILING });
  });

  it("releases the whole reservation for a batch that was never billed", async () => {
    const operation = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });

    await budget.settleOcrOperation(operation.id, { status: "FAILED" });

    expect(await totals(extractionId)).toEqual({ reserved: 0, actual: 0, ceiling: CEILING });
  });

  it("is idempotent: settling twice does not change the totals", async () => {
    const operation = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });
    await budget.settleOcrOperation(operation.id, { status: "COMPLETED", reportedMicroUsd: 80_000 });

    await budget.settleOcrOperation(operation.id, { status: "COMPLETED", reportedMicroUsd: 80_000 });
    await budget.settleOcrOperation(operation.id, { status: "FAILED" });

    expect(await totals(extractionId)).toEqual({ reserved: 0, actual: 80_000, ceiling: CEILING });
    expect((await db.prisma.ocrOperation.findUniqueOrThrow({ where: { id: operation.id } })).status).toBe("COMPLETED");
  });

  it("rejects an unknown operation", async () => {
    await expect(budget.settleOcrOperation("missing", { status: "FAILED" })).rejects.toMatchObject({
      code: "OCR_OPERATION_NOT_FOUND",
    });
  });

  it("never raises the ceiling by itself, even when real spend exceeds the reservation", async () => {
    const operation = await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 100 });

    await budget.settleOcrOperation(operation.id, { status: "COMPLETED", reportedMicroUsd: 5_000_000 });

    expect(await totals(extractionId)).toEqual({ reserved: 0, actual: 5_000_000, ceiling: CEILING });
    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k2", pageCount: 1 }),
    ).rejects.toMatchObject({
      code: "OCR_BUDGET_EXCEEDED",
    });
  });
});

describe("setOcrCostCeiling", () => {
  it("raises the ceiling only when asked, which unblocks a batch that did not fit", async () => {
    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 4_000 }),
    ).rejects.toMatchObject({
      code: "OCR_BUDGET_EXCEEDED",
    });

    await budget.setOcrCostCeiling(extractionId, 5);

    expect((await totals(extractionId)).ceiling).toBe(5_000_000);
    await expect(
      budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 4_000 }),
    ).resolves.toMatchObject({
      status: "PLANNED",
    });
  });

  it("refuses a ceiling below what is already spent or reserved", async () => {
    await budget.planOcrOperation({ provider, extractionId, requestKey: "k1", pageCount: 1_000 });

    await expect(budget.setOcrCostCeiling(extractionId, 0.5)).rejects.toMatchObject({
      code: "OCR_CEILING_BELOW_COMMITTED",
    });
    expect((await totals(extractionId)).ceiling).toBe(CEILING);
  });
});
