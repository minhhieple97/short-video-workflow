import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { parseBookStructure } from "@/features/books/domain/book-structure";
import { normalizeChapterContent } from "@/features/books/domain/chapter-content";
import { compileExtraPatterns, parseChapterMarker } from "@/features/books/domain/chapter-markers";
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
// no chapter boundary or its chapters disagree with the book's own chapter markers: neither its whole-book fallback nor an
// uncertain structure is returned, so the detector decides instead.
export function parseChapterRanges(markdown: string, extraChapterPatterns?: readonly string[]): ChapterRange[] {
  const structure = parseBookStructure(markdown, "md", {
    extraPatterns: compileExtraPatterns(extraChapterPatterns ?? getAppConfig().import.extraChapterPatterns),
  });
  if (structure.method === "none") return [];
  const ranges = structure.sections
    .filter((section) => section.include && section.kind === "chapter")
    .map(({ title, start, end }) => ({ title, start, end }));
  return disagreesWithChapterMarkers(markdown, ranges) ? [] : ranges;
}

// A PDF mixes text-layer lines with OCR Markdown, so the parser can miss a "Chương N" marker (an OCR heading wins, or no
// blank line precedes it) or turn table-of-contents lines into chapters. Both show in the numbers: a marker whose number
// no chapter starts with, or two chapters of one part with the same number. A line that merely mentions an existing
// chapter, and numbering that restarts in each part, are not disagreements.
function disagreesWithChapterMarkers(markdown: string, ranges: readonly ChapterRange[]): boolean {
  const starts = new Set(
    ranges.map((range) => range.start + Math.max(0, markdown.slice(range.start, range.end).search(/\S/u))),
  );
  const chapterNumbers = new Set<string>();
  const markerNumbers = new Set<string>();
  let numbersInPart = new Set<string>();
  let offset = 0;
  for (const line of markdown.split("\n")) {
    const marker = parseChapterMarker(line);
    if (marker?.level === "part") numbersInPart = new Set();
    if (marker?.level === "chapter") {
      const number = marker.numeral.toLocaleLowerCase("vi");
      markerNumbers.add(number);
      if (starts.has(offset + line.search(/\S/u))) {
        if (numbersInPart.has(number)) return true;
        numbersInPart.add(number);
        chapterNumbers.add(number);
      }
    }
    offset += line.length + 1;
  }
  return [...markerNumbers].some((number) => !chapterNumbers.has(number));
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
