import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { parseBookStructure } from "@/features/books/domain/book-structure";
import { normalizeChapterContent } from "@/features/books/domain/chapter-content";
import { compileExtraPatterns } from "@/features/books/domain/chapter-markers";
import type { NewChapterRecord } from "@/features/books/repositories/book.repository";
import { chapterFilePath, writeChapterFile } from "@/features/books/services/book-files";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { createLogger } from "@/shared/logger";

import {
  completeExtractionWithChapters,
  moveExtractionStatus,
  type FinishExtractionResult,
} from "../repositories/extraction.repository";

const logger = createLogger("extraction.chapters");

export type ExtractionChaptersOutcome =
  { kind: "CREATED"; chapters: number } | { kind: "ALREADY_DONE" } | { kind: "UNDETECTED"; message: string };

export const CHAPTERS_NOT_DETECTED_MESSAGE =
  "Đã có toàn bộ chữ của sách nhưng chưa nhận diện được ranh giới chương nên chưa tạo chương.";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// Splits the canonical document into chapters with the same local parser as Markdown imports. Only a structure the
// parser actually found is used: when it finds no chapter boundary, the run stops at NEEDS_CHAPTERS instead of making
// the whole book one chapter. Offsets are into the canonical document, which maps back to PDF pages.
export async function createChaptersFromCanonical(input: {
  extractionId: string;
  bookId: string;
  markdown: string;
  extraChapterPatterns?: readonly string[];
}): Promise<ExtractionChaptersOutcome> {
  const { extractionId, bookId, markdown } = input;
  const structure = parseBookStructure(markdown, "md", {
    extraPatterns: compileExtraPatterns(input.extraChapterPatterns ?? getAppConfig().import.extraChapterPatterns),
  });
  const sections =
    structure.method === "none"
      ? []
      : structure.sections.filter((section) => section.include && section.kind === "chapter");

  const chapters: { record: NewChapterRecord; content: string }[] = [];
  for (const section of sections) {
    const content = normalizeChapterContent(markdown.slice(section.start, section.end));
    if (content.length === 0) continue;
    const id = randomUUID();
    chapters.push({
      record: {
        id,
        order: chapters.length + 1,
        title: section.title,
        contentPath: chapterFilePath(bookId, id),
        sourceStartOffset: section.start,
        sourceEndOffset: section.end,
        contentHash: sha256(content),
      },
      content,
    });
  }

  if (chapters.length === 0) {
    await moveExtractionStatus(extractionId, ["ASSEMBLING"], {
      status: "NEEDS_CHAPTERS",
      errorCode: "CHAPTERS_NOT_DETECTED",
      errorMessage: CHAPTERS_NOT_DETECTED_MESSAGE,
    });
    logger.info("No chapter boundaries found", { extractionId, method: structure.method });
    return { kind: "UNDETECTED", message: CHAPTERS_NOT_DETECTED_MESSAGE };
  }

  let result: FinishExtractionResult;
  try {
    await Promise.all(chapters.map(({ record, content }) => writeChapterFile(record.contentPath, content)));
    result = await completeExtractionWithChapters(
      extractionId,
      bookId,
      chapters.map(({ record }) => record),
    );
  } catch (error) {
    await removeChapterFiles(chapters.map(({ record }) => record.contentPath));
    throw error;
  }
  if (result !== "completed") {
    await removeChapterFiles(chapters.map(({ record }) => record.contentPath));
    return { kind: "ALREADY_DONE" };
  }
  logger.info("Chapters created from the extraction", { extractionId, bookId, chapters: chapters.length });
  return { kind: "CREATED", chapters: chapters.length };
}

async function removeChapterFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((relativePath) => fs.rm(dataPath(relativePath), { force: true })));
}
