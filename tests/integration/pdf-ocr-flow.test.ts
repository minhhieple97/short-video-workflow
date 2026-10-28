import fs from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as ExtractionRepository from "@/features/extraction/repositories/extraction.repository";
import type * as ExtractionRun from "@/features/extraction/services/extraction-run.service";
import type * as DbClient from "@/server/db/client";
import { MistralBatchOcrProvider } from "@/server/ocr/mistral/mistral-batch-ocr-provider";
import { MistralClient } from "@/server/ocr/mistral/mistral-client";

import { FakeMistralServer } from "../helpers/fake-mistral-server";
import { buildPdf, type FixturePage } from "../helpers/pdf-fixtures";
import { popplerTestConfig } from "../helpers/poppler";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

// The whole PDF path with the real Mistral adapter against a local fake of its HTTP API: text layer, non-contiguous
// pages cut into a chunk by Poppler, Batch submit and collect, results mapped back to their pages, then chapters.
const poppler = popplerTestConfig();
let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof ExtractionRepository;
let run: typeof ExtractionRun;
let server: FakeMistralServer;

const BODY = [
  "Small habits make a big difference over a long time.",
  "Every action you take is a vote for the person you become.",
];
const BOOK: FixturePage[] = [
  { lines: ["Chapter 1", ...BODY] },
  { image: true },
  { lines: ["Chapter 2", ...BODY] },
  { lines: ["Th¸i ®é t¸c ®µo t¹o thµnh c¸c th¸i quen."] },
  { image: true },
];

async function seed() {
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
  fs.writeFileSync(path.join(env.dataDir, "books", book.id, "original.pdf"), buildPdf(BOOK));
  return { bookId: book.id, extractionId: extraction.id };
}

const deps = (): ExtractionRun.ExtractionRunDeps => ({
  poppler: poppler ?? { binDir: undefined, timeoutMs: 30_000 },
  maxPages: 1000,
  createOcrProvider: () =>
    new MistralBatchOcrProvider(new MistralClient({ apiKey: "test-key", baseUrl: server.baseUrl }), {
      model: "mistral-ocr-4-1",
      usdPer1000Pages: 2,
    }),
  extraChapterPatterns: [],
});
const pages = (extractionId: string) =>
  db.prisma.extractionPage.findMany({ where: { extractionId }, orderBy: { pageNumber: "asc" } });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/extraction/repositories/extraction.repository");
  run = await import("@/features/extraction/services/extraction-run.service");
}, 60_000);

beforeEach(async () => {
  server = await FakeMistralServer.start();
  await db.prisma.book.deleteMany();
});

afterEach(async () => {
  await server.stop();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe.skipIf(!poppler)("PDF to chapters through Mistral Batch (needs poppler-utils)", () => {
  it("sends pages 2, 4 and 5 as one batch, maps every result to its page and deletes the remote copies", async () => {
    const { bookId, extractionId } = await seed();

    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({
      kind: "WAITING",
      retryAfterMs: run.OCR_FIRST_POLL_MS,
    });
    const [job] = [...server.jobs.values()];
    expect(server.jobs.size).toBe(1);
    await expect(run.runExtraction(extractionId, deps())).resolves.toMatchObject({ kind: "WAITING" });

    server.completeJob(job?.id ?? "");
    await expect(run.runExtraction(extractionId, deps())).resolves.toEqual({ kind: "COMPLETED" });

    const stored = await pages(extractionId);
    expect(stored.map((page) => [page.pageNumber, page.method, page.text?.slice(0, 22) ?? null])).toEqual([
      [1, "TEXT", "Chapter 1\nSmall habits"],
      [2, "OCR", "Trang 1 của chunk-1"],
      [3, "TEXT", "Chapter 2\nSmall habits"],
      [4, "OCR", "Trang 2 của chunk-1"],
      [5, "OCR", "Trang 3 của chunk-1"],
    ]);
    expect(stored.find((page) => page.pageNumber === 2)?.confidence).toBe(0.97);
    // Output stored first, then the provider's files deleted: nothing of the book is left at Mistral.
    expect(server.files.size).toBe(0);
    const chapters = await db.prisma.chapter.findMany({ where: { bookId }, orderBy: { order: "asc" } });
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } })).toMatchObject({
      status: "COMPLETED",
      reservedCostMicroUsd: 0,
      actualCostMicroUsd: 6_000,
    });
  });

  it("ends PARTIAL when Mistral fails the chunk, and keeps the pages it already read", async () => {
    const { extractionId } = await seed();
    await run.runExtraction(extractionId, deps());
    const [job] = [...server.jobs.values()];
    server.completeJob(job?.id ?? "", { failChunks: ["chunk-1"] });

    await expect(run.runExtraction(extractionId, deps())).resolves.toMatchObject({
      kind: "STOPPED",
      status: "PARTIAL",
    });
    expect((await pages(extractionId)).map((page) => `${page.pageNumber}:${page.status}`)).toEqual([
      "1:EXTRACTED",
      "2:FAILED",
      "3:EXTRACTED",
      "4:FAILED",
      "5:FAILED",
    ]);
  });
});
