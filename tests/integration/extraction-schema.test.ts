import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;

async function createBook(title: string) {
  return db.prisma.book.create({
    data: {
      title,
      sourceFilePath: `books/${title}/original.pdf`,
      sourceFileName: `${title}.pdf`,
      sourceHash: `hash-${title}`,
      sourceFormat: "pdf",
      sourceSizeBytes: 1_024,
      status: "ACTIVE",
    },
  });
}

async function createExtraction(bookId: string) {
  return db.prisma.bookExtraction.create({ data: { bookId, status: "QUEUED", sourceHash: "pdf-hash" } });
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("extraction schema", () => {
  it("keeps a page number unique within an extraction but not across extractions", async () => {
    const book = await createBook("a");
    const first = await createExtraction(book.id);
    const second = await createExtraction(book.id);
    await db.prisma.extractionPage.create({ data: { extractionId: first.id, pageNumber: 1, status: "PENDING" } });

    await expect(
      db.prisma.extractionPage.create({ data: { extractionId: first.id, pageNumber: 1, status: "PENDING" } }),
    ).rejects.toThrow();
    await expect(
      db.prisma.extractionPage.create({ data: { extractionId: second.id, pageNumber: 1, status: "PENDING" } }),
    ).resolves.toMatchObject({ pageNumber: 1 });
  });

  it("tells a valid blank page apart from a failed page", async () => {
    const book = await createBook("a");
    const extraction = await createExtraction(book.id);

    await db.prisma.extractionPage.createMany({
      data: [
        { extractionId: extraction.id, pageNumber: 1, status: "EXTRACTED", method: "EMPTY", text: "" },
        { extractionId: extraction.id, pageNumber: 2, status: "FAILED", errorCode: "PAGE_UNREADABLE" },
      ],
    });

    const pages = await db.prisma.extractionPage.findMany({
      where: { extractionId: extraction.id },
      orderBy: { pageNumber: "asc" },
    });
    expect(pages.map((page) => [page.status, page.method, page.text])).toEqual([
      ["EXTRACTED", "EMPTY", ""],
      ["FAILED", null, null],
    ]);
  });

  it("allows only one OCR operation per request key and stores money as integer micro-USD", async () => {
    const book = await createBook("a");
    const extraction = await createExtraction(book.id);
    const operation = {
      extractionId: extraction.id,
      provider: "mistral-batch",
      model: "mistral-ocr-4-1",
      requestKey: "extraction-1:chunks-1",
      status: "PLANNED",
      pageCount: 120,
      reservedCostMicroUsd: 60_000,
    };
    await db.prisma.ocrOperation.create({ data: operation });

    await expect(db.prisma.ocrOperation.create({ data: operation })).rejects.toThrow();

    const stored = await db.prisma.ocrOperation.findUniqueOrThrow({ where: { requestKey: operation.requestKey } });
    expect(stored).toMatchObject({ reservedCostMicroUsd: 60_000, actualCostMicroUsd: null, operationRef: null });
  });

  it("removes pages and OCR operations together with their extraction", async () => {
    const book = await createBook("a");
    const extraction = await createExtraction(book.id);
    await db.prisma.extractionPage.create({ data: { extractionId: extraction.id, pageNumber: 1, status: "PENDING" } });
    await db.prisma.ocrOperation.create({
      data: {
        extractionId: extraction.id,
        provider: "p",
        model: "m",
        requestKey: "k",
        status: "PLANNED",
        pageCount: 1,
        reservedCostMicroUsd: 1,
      },
    });

    await db.prisma.bookExtraction.delete({ where: { id: extraction.id } });

    expect(await db.prisma.extractionPage.count()).toBe(0);
    expect(await db.prisma.ocrOperation.count()).toBe(0);
  });

  it("leaves a book imported the old way readable, with no extraction", async () => {
    const book = await db.prisma.book.create({
      data: {
        title: "Sách cũ",
        sourceFilePath: "books/old/original.md",
        sourceFileName: "old.md",
        sourceHash: "old-hash",
        sourceFormat: "md",
        sourceSizeBytes: 10,
        status: "ACTIVE",
        chapters: {
          create: {
            order: 1,
            title: "Chương 1",
            content: "Nội dung",
            contentHash: "c",
            analysisStatus: "NOT_ANALYZED",
          },
        },
      },
    });

    const loaded = await db.prisma.book.findUniqueOrThrow({
      where: { id: book.id },
      include: { chapters: true, extractions: true },
    });

    expect(loaded.chapters).toHaveLength(1);
    expect(loaded.extractions).toEqual([]);
  });
});
