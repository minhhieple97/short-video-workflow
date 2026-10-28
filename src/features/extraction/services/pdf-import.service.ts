import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { ImportFileError, sanitizeFileName, titleFromFileName } from "@/features/books/domain/source-file";
import { findActiveBookBySourceHash } from "@/features/books/repositories/book.repository";
import { bookDirectory, removeBookDirectory } from "@/features/books/services/book-files";
import { purgeStaleImports } from "@/features/books/services/import-staging";
import { streamToFile } from "@/server/storage/stream-to-file";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { assertPdfFileName, assertPdfSignature, PDF_HEAD_BYTES } from "../domain/pdf-upload";
import { createPdfBookWithExtraction } from "../repositories/extraction.repository";

const logger = createLogger("extraction.pdf-import");
const READ_ONLY = 0o444;

export interface PdfImportInput {
  fileName: string;
  title?: string;
  body: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
}

export interface PdfImportResult {
  bookId: string;
  extractionId: string;
  status: "QUEUED";
}

const stagingPath = (importId: string) => `imports/${importId}/upload.pdf`;
const originalPdfPath = (bookId: string) => `${bookDirectory(bookId)}/original.pdf`;

// Streams the PDF to a staging file (validating signature and size as the bytes arrive), then moves it, unchanged and
// read-only, to the book folder and creates the book with its first extraction run. Nothing is kept on any failure.
export async function importPdfBook(input: PdfImportInput): Promise<PdfImportResult> {
  const fileName = sanitizeFileName(input.fileName);
  assertPdfFileName(fileName);
  const { maxSizeBytes } = getAppConfig().pdf;

  await purgeStaleImports().catch((error: unknown) =>
    logger.warn("Could not purge stale imports", { error: toSafeErrorMessage(error) }),
  );

  const importId = randomUUID();
  const staged = dataPath(stagingPath(importId));
  const bookId = randomUUID();
  try {
    const { bytes, sha256 } = await streamToFile(input.body, staged, {
      maxBytes: maxSizeBytes,
      headBytes: PDF_HEAD_BYTES,
      validateHead: assertPdfSignature,
      onTooLarge: () =>
        new ImportFileError(
          "FILE_TOO_LARGE",
          `Tệp PDF vượt quá giới hạn ${Math.round(maxSizeBytes / 1024 / 1024)} MB.`,
          413,
        ),
      signal: input.signal,
    });

    const duplicate = await findActiveBookBySourceHash(sha256);
    if (duplicate) {
      throw new AppError("DUPLICATE_BOOK", `Tệp này đã được nhập thành sách "${duplicate.title}".`, 409, {
        details: { bookId: duplicate.id, title: duplicate.title },
      });
    }

    const original = dataPath(originalPdfPath(bookId));
    await fs.mkdir(dataPath(bookDirectory(bookId)), { recursive: true });
    await fs.rename(staged, original);
    await fs.chmod(original, READ_ONLY);

    // The OCR ceiling is copied onto the run now, so changing the setting later cannot silently raise it.
    const { book, extraction } = await createPdfBookWithExtraction(
      {
        id: bookId,
        title: input.title ?? titleFromFileName(fileName),
        sourceFilePath: originalPdfPath(bookId),
        sourceFileName: fileName,
        sourceHash: sha256,
        sourceSizeBytes: bytes,
      },
      getAppConfig().ocr.costCeilingMicroUsd,
    );
    logger.info("PDF imported", { bookId: book.id, extractionId: extraction.id, sourceHash: sha256, bytes });
    return { bookId: book.id, extractionId: extraction.id, status: "QUEUED" };
  } catch (error) {
    await removeBookDirectory(bookId);
    throw error;
  } finally {
    await fs.rm(dataPath("imports", importId), { recursive: true, force: true });
  }
}
