import { createHash, randomUUID } from "node:crypto";

import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { parseBookStructure } from "../domain/book-structure";
import { assertValidChapterRanges, normalizeChapterContent } from "../domain/chapter-content";
import { compileExtraPatterns } from "../domain/chapter-markers";
import {
  assertAcceptedMimeType,
  assertWithinSizeLimit,
  decodeSourceText,
  detectSourceFormat,
  sanitizeFileName,
  titleFromFileName,
  type SourceFormat,
} from "../domain/source-file";
import { createBookWithChapters, findActiveBookBySourceHash } from "../repositories/book.repository";
import type { ImportPreview } from "../schemas/book.dto";
import type { ConfirmImportInput } from "../schemas/book.schema";
import {
  bookDirectory,
  chapterFilePath,
  originalFilePath,
  removeBookDirectory,
  writeChapterFile,
  writeOriginalFile,
} from "./book-files";
import { discardStagedImport, loadStagedImport, purgeStaleImports, stageImport } from "./import-staging";

const logger = createLogger("books.import");

export type ImportUpload =
  | { kind: "file"; fileName: string; mimeType: string; bytes: Uint8Array }
  | { kind: "text"; text: string; format: SourceFormat };

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

function normalizeUpload(upload: ImportUpload): { fileName: string; format: SourceFormat; bytes: Uint8Array } {
  if (upload.kind === "text") {
    return {
      fileName: `van-ban-dan.${upload.format}`,
      format: upload.format,
      bytes: new TextEncoder().encode(upload.text),
    };
  }
  const fileName = sanitizeFileName(upload.fileName);
  assertAcceptedMimeType(upload.mimeType);
  return { fileName, format: detectSourceFormat(fileName), bytes: upload.bytes };
}

export async function previewImport(upload: ImportUpload): Promise<ImportPreview> {
  const config = getAppConfig().import;
  const { fileName, format, bytes } = normalizeUpload(upload);
  assertWithinSizeLimit(bytes.byteLength, config.maxSizeBytes);

  const text = decodeSourceText(bytes);
  const sourceHash = sha256(bytes);
  const structure = parseBookStructure(text, format, {
    extraPatterns: compileExtraPatterns(config.extraChapterPatterns),
  });
  const duplicate = await findActiveBookBySourceHash(sourceHash);

  await purgeStaleImports().catch((error: unknown) =>
    logger.warn("Could not purge stale imports", { error: toSafeErrorMessage(error) }),
  );
  const importId = randomUUID();
  await stageImport(
    { importId, fileName, format, sizeBytes: bytes.byteLength, sourceHash, createdAt: new Date().toISOString() },
    bytes,
  );
  logger.info("Import staged", { importId, sourceHash, format, sections: structure.sections.length });

  return {
    importId,
    fileName,
    format,
    sizeBytes: bytes.byteLength,
    sourceHash,
    text,
    suggestedTitle: structure.suggestedTitle ?? titleFromFileName(fileName),
    method: structure.method,
    headingDepth: structure.headingDepth,
    sections: structure.sections,
    warnings: structure.warnings,
    duplicateOf: duplicate ? { id: duplicate.id, title: duplicate.title } : null,
  };
}

export async function confirmImport(input: ConfirmImportInput): Promise<{ bookId: string }> {
  const { meta, bytes } = await loadStagedImport(input.importId);
  const text = decodeSourceText(bytes);
  assertValidChapterRanges(input.chapters, text.length);

  if (!input.allowDuplicate) {
    const duplicate = await findActiveBookBySourceHash(meta.sourceHash);
    if (duplicate) {
      throw new AppError("DUPLICATE_BOOK", `Tệp này đã được nhập thành sách "${duplicate.title}".`, 409, {
        details: { bookId: duplicate.id, title: duplicate.title },
      });
    }
  }

  const bookId = randomUUID();
  const chapters = input.chapters.map((chapter, index) => {
    const content = normalizeChapterContent(text.slice(chapter.start, chapter.end));
    if (content.length === 0) {
      throw new AppError("EMPTY_CHAPTER", `Chương ${index + 1} ("${chapter.title}") không có nội dung.`, 400);
    }
    const id = randomUUID();
    return {
      record: {
        id,
        order: index + 1,
        title: chapter.title,
        contentPath: chapterFilePath(bookId, id),
        sourceStartOffset: chapter.start,
        sourceEndOffset: chapter.end,
        contentHash: sha256(content),
      },
      content,
    };
  });

  const sourceFilePath = originalFilePath(bookId, meta.format);
  try {
    await writeOriginalFile(sourceFilePath, bytes);
    await Promise.all(chapters.map(({ record, content }) => writeChapterFile(record.contentPath, content)));
    await createBookWithChapters(
      {
        id: bookId,
        title: input.title,
        author: input.author,
        description: input.description,
        sourceFilePath,
        sourceFileName: meta.fileName,
        sourceHash: meta.sourceHash,
        sourceFormat: meta.format,
        sourceSizeBytes: meta.sizeBytes,
      },
      chapters.map(({ record }) => record),
    );
  } catch (error) {
    await removeBookDirectory(bookId);
    throw error;
  }

  await discardStagedImport(input.importId).catch((error: unknown) =>
    logger.warn("Could not discard staged import", { importId: input.importId, error: toSafeErrorMessage(error) }),
  );
  logger.info("Book imported", { bookId, directory: bookDirectory(bookId), chapters: chapters.length });
  return { bookId };
}
