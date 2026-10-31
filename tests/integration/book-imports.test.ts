import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Db from "@/server/db/client";
import type * as Imports from "@/features/book-imports/services/book-import.service";
import type * as Run from "@/features/book-imports/services/book-import-run.service";
import type * as Control from "@/features/book-imports/services/book-import-control.service";
import type { BookImportDto } from "@/features/book-imports/schemas/book-import.dto";
import { createBookImportSchema } from "@/features/book-imports/schemas/book-import.schema";

import { buildPdf } from "../helpers/pdf-fixtures";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof Db;
let imports: typeof Imports;
let run: typeof Run;
let control: typeof Control;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  imports = await import("@/features/book-imports/services/book-import.service");
  run = await import("@/features/book-imports/services/book-import-run.service");
  control = await import("@/features/book-imports/services/book-import-control.service");
}, 60_000);
beforeEach(async () => {
  await db.prisma.productionBatch.deleteMany();
  await db.prisma.bookImportItem.deleteMany();
  await db.prisma.bookImportBatch.deleteMany();
  await db.prisma.book.deleteMany();
  await db.prisma.jobRecord.deleteMany();
});
afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

const input = (count = 2) => ({
  idempotencyKey: randomUUID(),
  fileNames: Array.from({ length: count }, (_, index) => `book-${index + 1}.pdf`),
  minDurationSec: 30 as const,
  maxDurationSec: 60 as const,
  pace: "STANDARD" as const,
});

async function upload(batch: BookImportDto, position: number) {
  const item = batch.items[position];
  if (!item) throw new Error("missing item");
  const body = buildPdf([
    {
      lines: ["Chapter 1", `Book ${position} ${randomUUID()}`, "Small habits make a big difference over a long time."],
    },
  ]);
  return imports.uploadBookImportFile(
    batch.id,
    item.id,
    new Request("http://localhost/upload", {
      method: "POST",
      body: new Uint8Array(body),
      headers: { "content-type": "application/pdf" },
    }),
  );
}

async function readyForProduction(batch: BookImportDto, count = 3) {
  const item = (await imports.getBookImport(batch.id)).items[0];
  if (!item?.bookId) throw new Error("missing book");
  await db.prisma.bookExtraction.updateMany({ where: { bookId: item.bookId }, data: { status: "COMPLETED" } });
  const chapter = await db.prisma.chapter.create({
    data: {
      bookId: item.bookId,
      title: "Chương 1",
      order: 1,
      content: "Nội dung sách",
      contentHash: "hash",
      analysisStatus: "ANALYZED",
    },
  });
  for (let index = 0; index < count; index += 1)
    await db.prisma.lesson.create({
      data: {
        bookId: item.bookId,
        title: `Bài ${index}`,
        summary: "s",
        principle: "p",
        realLifeScenario: "r",
        commonMistake: "m",
        betterApproach: "b",
        actionableStep: "a",
        origin: "AI",
        sources: { create: { chapterId: chapter.id, sourceExcerpt: "Nội dung sách" } },
      },
    });
  return item;
}

describe("multi-book import", () => {
  it("limits a request to 15 PDFs and recognises an idempotent request", async () => {
    expect(createBookImportSchema.safeParse(input(15)).success).toBe(true);
    expect(createBookImportSchema.safeParse(input(16)).success).toBe(false);
    expect(createBookImportSchema.safeParse({ ...input(), fileNames: ["x.txt"] }).success).toBe(false);
    const request = input();
    const first = await imports.requestBookImport(request);
    expect((await imports.requestBookImport(request)).id).toBe(first.id);
    await expect(imports.requestBookImport({ ...request, fileNames: ["other.pdf"] })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("stores immutable PDFs first, starts only the first book, and does not duplicate extraction jobs", async () => {
    const batch = await imports.requestBookImport(input());
    await upload(batch, 0);
    await upload(batch, 1);
    expect(await db.prisma.jobRecord.count()).toBe(0);
    expect(await db.prisma.bookExtraction.count({ where: { status: "STAGED" } })).toBe(2);
    await imports.beginBookImport(batch.id);
    await run.sweepBookImports();
    await run.sweepBookImports();
    expect(await db.prisma.jobRecord.count({ where: { jobType: "EXTRACT_PDF" } })).toBe(1);
    expect(await db.prisma.bookExtraction.count({ where: { status: "STAGED" } })).toBe(1);
    const replay = await uploadReplay(batch);
    expect(replay).toMatchObject({ code: "BOOK_IMPORT_CLOSED" });
  });

  it("does not begin an incomplete upload and reuses an upload after its answer was lost", async () => {
    const batch = await imports.requestBookImport(input());
    const first = await upload(batch, 0);
    expect(await upload(batch, 0)).toMatchObject({ bookId: first.bookId, reused: true });
    await expect(imports.beginBookImport(batch.id)).rejects.toMatchObject({ code: "BOOK_IMPORT_INCOMPLETE" });
    expect(await db.prisma.book.count()).toBe(1);
  });

  it("queues one chapter at a time and waits through a deferred analysis", async () => {
    const batch = await imports.requestBookImport(input(1));
    await upload(batch, 0);
    await imports.beginBookImport(batch.id);
    const item = await readyForProduction(batch, 0);
    await db.prisma.chapter.updateMany({
      where: { bookId: item.bookId ?? "" },
      data: { analysisStatus: "NOT_ANALYZED" },
    });
    await run.sweepBookImports();
    await run.sweepBookImports();
    const job = await db.prisma.jobRecord.findFirstOrThrow({ where: { jobType: "ANALYZE_CHAPTER" } });
    await db.prisma.chapter.updateMany({ where: { bookId: item.bookId ?? "" }, data: { analysisStatus: "FAILED" } });
    await run.sweepBookImports();
    expect((await imports.getBookImport(batch.id)).items[0]?.status).toBe("ANALYZING");
    expect(await db.prisma.jobRecord.count({ where: { jobType: "ANALYZE_CHAPTER" } })).toBe(1);
    expect(job.status).toBe("QUEUED");
  });

  it("creates a video for every lesson, including catalogues above 100, without duplicate outputs on replay", async () => {
    const batch = await imports.requestBookImport(input(1));
    await upload(batch, 0);
    await imports.beginBookImport(batch.id);
    await readyForProduction(batch, 103);
    await run.sweepBookImports();
    await run.sweepBookImports();
    expect(await db.prisma.productionBatch.count()).toBe(2);
    expect(await db.prisma.productionItem.count()).toBe(103);
    expect(await db.prisma.jobDispatch.count({ where: { jobRecord: { jobType: "RUN_PRODUCTION_ITEM" } } })).toBe(103);
    expect(await db.prisma.lesson.count({ where: { status: "APPROVED" } })).toBe(103);
    expect(await db.prisma.lesson.count({ where: { status: { not: "APPROVED" } } })).toBe(0);
  }, 30_000);

  it("approves every lesson it makes a video of, and leaves archived lessons archived and unproduced", async () => {
    const batch = await imports.requestBookImport(input(1));
    await upload(batch, 0);
    await imports.beginBookImport(batch.id);
    const item = await readyForProduction(batch, 3);
    const lessons = await db.prisma.lesson.findMany({
      where: { bookId: item.bookId ?? "" },
      orderBy: { title: "asc" },
    });
    await db.prisma.lesson.update({ where: { id: lessons[0]?.id ?? "" }, data: { status: "ARCHIVED" } });
    await db.prisma.lesson.update({ where: { id: lessons[1]?.id ?? "" }, data: { status: "APPROVED" } });

    await run.sweepBookImports();
    await run.sweepBookImports();

    const status = async (index: number) =>
      (await db.prisma.lesson.findUniqueOrThrow({ where: { id: lessons[index]?.id ?? "" } })).status;
    expect(await status(0)).toBe("ARCHIVED");
    expect(await status(1)).toBe("APPROVED");
    expect(await status(2)).toBe("APPROVED");
    expect(await db.prisma.productionItem.count()).toBe(2);
    expect(await db.prisma.productionItem.count({ where: { lessonId: lessons[0]?.id ?? "" } })).toBe(0);
  });

  it("counts the videos that are on Drive and says whether Drive is connected", async () => {
    const { CONNECTED_CREDENTIAL } = await import("../helpers/archive-fixture");
    const store = await import("@/server/archive/google-drive/drive-credential-store");
    const batch = await imports.requestBookImport(input(1));
    await upload(batch, 0);
    await imports.beginBookImport(batch.id);
    await readyForProduction(batch, 3);
    await run.sweepBookImports();
    await run.sweepBookImports();
    const items = await db.prisma.productionItem.findMany({ orderBy: { position: "asc" } });
    const onDrive = async (item: (typeof items)[number], archiveStatus: string) => {
      const render = await db.prisma.renderRecord.create({
        data: {
          videoId: item.videoId ?? "",
          scriptVersion: 1,
          outputPath: "x.mp4",
          status: "COMPLETED",
          qualityPreset: "FINAL",
          width: 1080,
          height: 1920,
          fps: 30,
        },
      });
      await db.prisma.productionItem.update({ where: { id: item.id }, data: { renderId: render.id } });
      await db.prisma.renderArchive.create({
        data: { renderId: render.id, provider: "google-drive", destinationKey: "account-1", status: archiveStatus },
      });
    };
    await onDrive(items[0] as (typeof items)[number], "COMPLETED");
    await onDrive(items[1] as (typeof items)[number], "RUNNING");

    const withoutDrive = await imports.getBookImport(batch.id);
    expect(withoutDrive.items[0]).toMatchObject({ videosTotal: 3, videosOnDrive: 1 });
    expect(withoutDrive.driveConnected).toBe(false);

    await store.writeDriveCredential(CONNECTED_CREDENTIAL);
    try {
      expect((await imports.getBookImport(batch.id)).driveConnected).toBe(true);
    } finally {
      await store.deleteDriveCredential();
    }
  });

  it("moves on after a permanent book failure and keeps its reason", async () => {
    const batch = await imports.requestBookImport(input());
    await upload(batch, 0);
    await upload(batch, 1);
    await imports.beginBookImport(batch.id);
    await run.sweepBookImports();
    const first = (await imports.getBookImport(batch.id)).items[0];
    await db.prisma.bookExtraction.updateMany({
      where: { bookId: first?.bookId ?? "" },
      data: { status: "FAILED", errorCode: "PDF_CORRUPT", errorMessage: "PDF hỏng" },
    });
    await db.prisma.jobRecord.updateMany({ data: { status: "FAILED" } });
    await run.sweepBookImports();
    await run.sweepBookImports();
    const progress = await imports.getBookImport(batch.id);
    expect(progress.items[0]).toMatchObject({ status: "FAILED", errorMessage: "PDF hỏng" });
    expect(progress.items[1]?.status).toBe("EXTRACTING");
  });

  it("cancels queued work while preserving the original PDF", async () => {
    const batch = await imports.requestBookImport(input(1));
    await upload(batch, 0);
    await imports.beginBookImport(batch.id);
    await run.sweepBookImports();
    const book = await db.prisma.book.findFirstOrThrow();
    await control.controlBookImport(batch.id, "cancel");
    await run.sweepBookImports();
    expect((await imports.getBookImport(batch.id)).status).toBe("CANCELLED");
    expect((await db.prisma.jobRecord.findFirstOrThrow()).status).toBe("CANCELLED");
    expect(fs.existsSync(path.join(env.dataDir, book.sourceFilePath))).toBe(true);
  });
});

async function uploadReplay(batch: BookImportDto) {
  try {
    await upload(batch, 0);
    return null;
  } catch (error) {
    return error;
  }
}
