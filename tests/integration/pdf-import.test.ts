import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as PdfImport from "@/features/extraction/services/pdf-import.service";
import type * as PdfRoute from "@/app/api/books/import/pdf/route";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let pdfImport: typeof PdfImport;
let route: typeof PdfRoute;

const SMALL_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

function streamOf(chunks: Uint8Array[], onPull?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      onPull?.();
      const chunk = chunks[index];
      index += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
}

function listDirectory(relative: string): string[] {
  try {
    return fs.readdirSync(path.join(env.dataDir, relative));
  } catch {
    return [];
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeAll(async () => {
  env = setupTestEnvironment();
  // About 1 KiB: large enough for SMALL_PDF, small enough to test the size limit without big buffers.
  process.env.MAX_PDF_SIZE_MB = "0.001";
  db = await import("@/server/db/client");
  pdfImport = await import("@/features/extraction/services/pdf-import.service");
  route = await import("@/app/api/books/import/pdf/route");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  fs.rmSync(path.join(env.dataDir, "books"), { recursive: true, force: true });
  fs.rmSync(path.join(env.dataDir, "imports"), { recursive: true, force: true });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("importPdfBook", () => {
  it("stores the PDF unchanged and read-only, then creates the book with a queued extraction and its job", async () => {
    const result = await pdfImport.importPdfBook({
      fileName: "Atomic Habits.pdf",
      body: streamOf([SMALL_PDF.subarray(0, 10), SMALL_PDF.subarray(10)]),
    });

    expect(result).toMatchObject({ status: "QUEUED" });
    const book = await db.prisma.book.findUniqueOrThrow({
      where: { id: result.bookId },
      include: { extractions: true },
    });
    expect(book).toMatchObject({
      title: "Atomic Habits",
      sourceFormat: "pdf",
      sourceHash: sha256(SMALL_PDF),
      sourceSizeBytes: SMALL_PDF.byteLength,
      status: "ACTIVE",
    });
    expect(book.extractions).toHaveLength(1);
    expect(book.extractions[0]).toMatchObject({
      id: result.extractionId,
      status: "QUEUED",
      sourceHash: sha256(SMALL_PDF),
      costCeilingMicroUsd: 3_000_000,
    });
    // The job that runs the extraction was recorded with the book, waiting in the outbox for the worker.
    const job = await db.prisma.jobRecord.findUniqueOrThrow({
      where: { id: result.jobId },
      include: { dispatch: true },
    });
    expect(job).toMatchObject({
      jobType: "EXTRACT_PDF",
      entityType: "EXTRACTION",
      entityId: result.extractionId,
      status: "QUEUED",
    });
    expect(JSON.parse(job.dispatch?.payloadJson ?? "{}")).toEqual({ extractionId: result.extractionId });

    const stored = path.join(env.dataDir, book.sourceFilePath);
    expect(fs.readFileSync(stored)).toEqual(Buffer.from(SMALL_PDF));
    expect(fs.statSync(stored).mode & 0o222).toBe(0);
    expect(listDirectory("imports")).toEqual([]);
  });

  it("recognises the signature even when its bytes arrive in separate chunks", async () => {
    const chunks = Array.from(SMALL_PDF, (byte) => Uint8Array.of(byte));

    await expect(pdfImport.importPdfBook({ fileName: "a.pdf", body: streamOf(chunks) })).resolves.toMatchObject({
      status: "QUEUED",
    });
  });

  it("rejects a file that is not a PDF, whatever its name says, and keeps nothing", async () => {
    await expect(
      pdfImport.importPdfBook({ fileName: "a.pdf", body: streamOf([new TextEncoder().encode("Chỉ là văn bản")]) }),
    ).rejects.toMatchObject({ code: "INVALID_PDF", httpStatus: 415 });

    expect(await db.prisma.book.count()).toBe(0);
    expect(listDirectory("imports")).toEqual([]);
    expect(listDirectory("books")).toEqual([]);
  });

  it("rejects an empty body", async () => {
    await expect(pdfImport.importPdfBook({ fileName: "a.pdf", body: streamOf([]) })).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
    expect(listDirectory("imports")).toEqual([]);
  });

  it("stops reading as soon as the size limit is exceeded instead of buffering the whole body", async () => {
    const chunk = new Uint8Array(512).fill(0x41);
    chunk.set(new TextEncoder().encode("%PDF-"));
    const chunks = Array.from({ length: 200 }, () => chunk);
    let pulls = 0;

    await expect(
      pdfImport.importPdfBook({ fileName: "big.pdf", body: streamOf(chunks, () => (pulls += 1)) }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", httpStatus: 413 });

    expect(pulls).toBeLessThan(10);
    expect(await db.prisma.book.count()).toBe(0);
    expect(listDirectory("imports")).toEqual([]);
  });

  it("keeps nothing when the upload is cancelled part-way", async () => {
    const controller = new AbortController();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(streamController) {
        pulls += 1;
        if (pulls === 3) controller.abort();
        streamController.enqueue(pulls === 1 ? SMALL_PDF.subarray(0, 8) : new Uint8Array([0x20, 0x20]));
      },
    });

    await expect(pdfImport.importPdfBook({ fileName: "a.pdf", body, signal: controller.signal })).rejects.toThrow();

    expect(await db.prisma.book.count()).toBe(0);
    expect(listDirectory("imports")).toEqual([]);
    expect(listDirectory("books")).toEqual([]);
  });

  it("rejects a file whose name is not .pdf without opening the body", async () => {
    const body = streamOf([SMALL_PDF]);

    await expect(pdfImport.importPdfBook({ fileName: "a.txt", body })).rejects.toMatchObject({
      code: "UNSUPPORTED_FILE_TYPE",
    });

    expect(body.locked).toBe(false);
  });

  it("refuses to import the same PDF twice and leaves the first book alone", async () => {
    const first = await pdfImport.importPdfBook({ fileName: "a.pdf", body: streamOf([SMALL_PDF]) });

    await expect(pdfImport.importPdfBook({ fileName: "copy.pdf", body: streamOf([SMALL_PDF]) })).rejects.toMatchObject({
      code: "DUPLICATE_BOOK",
      httpStatus: 409,
    });

    expect(await db.prisma.book.count()).toBe(1);
    expect(listDirectory("books")).toEqual([first.bookId]);
    expect(listDirectory("imports")).toEqual([]);
  });
});

describe("POST /api/books/import/pdf", () => {
  const post = (query: string, body: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
    route.POST(new Request(`http://127.0.0.1/api/books/import/pdf${query}`, { method: "POST", body, headers }));

  it("answers 202 with the ids to follow", async () => {
    const response = await post("?fileName=sach.pdf&title=Sách%20mẫu", SMALL_PDF, {
      "content-type": "application/pdf",
    });

    expect(response.status).toBe(202);
    const body = (await response.json()) as { bookId: string; extractionId: string; status: string };
    expect(body.status).toBe("QUEUED");
    const book = await db.prisma.book.findUniqueOrThrow({ where: { id: body.bookId } });
    expect(book.title).toBe("Sách mẫu");
  });

  it("answers 415 for a body that is not a PDF", async () => {
    const response = await post("?fileName=a.pdf", new TextEncoder().encode("không phải pdf"));

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_PDF" } });
  });

  it("answers 413 from the declared length before reading anything", async () => {
    const response = await post("?fileName=a.pdf", SMALL_PDF, { "content-length": String(50 * 1024 * 1024) });

    expect(response.status).toBe(413);
    expect(await db.prisma.book.count()).toBe(0);
  });

  it("answers 499 and records nothing when the client has already gone away", async () => {
    const controller = new AbortController();
    controller.abort();

    const response = await route.POST(
      new Request("http://127.0.0.1/api/books/import/pdf?fileName=a.pdf", {
        method: "POST",
        body: SMALL_PDF,
        signal: controller.signal,
      }),
    );

    expect(response.status).toBe(499);
    expect(await db.prisma.book.count()).toBe(0);
  });

  it("answers 400 when the file name is missing", async () => {
    const response = await post("", SMALL_PDF);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
