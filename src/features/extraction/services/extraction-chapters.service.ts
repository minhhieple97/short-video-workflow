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

export type ExtractionChaptersOutcome = { kind: "CREATED"; chapters: number } | { kind: "ALREADY_DONE" };

export const CHAPTERS_NOT_DETECTED_MESSAGE =
  "Đã có toàn bộ chữ của sách nhưng chưa nhận diện được ranh giới chương nên chưa tạo chương.";

export interface ChapterRange {
  title: string;
  // [start, end) in the canonical document.
  start: number;
  end: number;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// The chapters the local parser (the same one Markdown imports use) finds in the canonical document. Empty when it finds
// no chapter boundary: its whole-book fallback is never returned as a structure.
export function parseChapterRanges(markdown: string, extraChapterPatterns?: readonly string[]): ChapterRange[] {
  const structure = parseBookStructure(markdown, "md", {
    extraPatterns: compileExtraPatterns(extraChapterPatterns ?? getAppConfig().import.extraChapterPatterns),
  });
  if (structure.method === "none") return [];
  return structure.sections
    .filter((section) => section.include && section.kind === "chapter")
    .map(({ title, start, end }) => ({ title, start, end }));
}

// Writes one chapter file per range and creates the chapters while completing the run, in one transaction that moves the
// run on from `from` first, so a replayed step finds it finished instead of creating the chapters twice. Offsets are into
// the canonical document, which maps back to PDF pages.
export async function createChaptersFromRanges(input: {
  extractionId: string;
  bookId: string;
  markdown: string;
  ranges: readonly ChapterRange[];
  from: "ASSEMBLING" | "DETECTING_CHAPTERS";
}): Promise<ExtractionChaptersOutcome> {
  const { extractionId, bookId, markdown } = input;
  const chapters: { record: NewChapterRecord; content: string }[] = [];
  for (const range of input.ranges) {
    const content = normalizeChapterContent(markdown.slice(range.start, range.end));
    if (content.length === 0) continue;
    const id = randomUUID();
    chapters.push({
      record: {
        id,
        order: chapters.length + 1,
        title: range.title,
        contentPath: chapterFilePath(bookId, id),
        sourceStartOffset: range.start,
        sourceEndOffset: range.end,
        contentHash: sha256(content),
      },
      content,
    });
  }

  let result: FinishExtractionResult;
  try {
    await Promise.all(chapters.map(({ record, content }) => writeChapterFile(record.contentPath, content)));
    result = await completeExtractionWithChapters(
      extractionId,
      bookId,
      input.from,
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

// The local parser's chapters; when it finds none, the run moves on to chapter detection instead of making the whole
// book one chapter.
export async function createChaptersFromCanonical(input: {
  extractionId: string;
  bookId: string;
  markdown: string;
  extraChapterPatterns?: readonly string[];
}): Promise<ExtractionChaptersOutcome | { kind: "UNDETECTED" }> {
  const ranges = parseChapterRanges(input.markdown, input.extraChapterPatterns).filter(
    (range) => normalizeChapterContent(input.markdown.slice(range.start, range.end)).length > 0,
  );
  if (ranges.length === 0) {
    await moveExtractionStatus(input.extractionId, ["ASSEMBLING"], { status: "DETECTING_CHAPTERS" });
    logger.info("No chapter boundaries found by the local parser", { extractionId: input.extractionId });
    return { kind: "UNDETECTED" };
  }
  return createChaptersFromRanges({ ...input, ranges, from: "ASSEMBLING" });
}

async function removeChapterFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((relativePath) => fs.rm(dataPath(relativePath), { force: true })));
}
