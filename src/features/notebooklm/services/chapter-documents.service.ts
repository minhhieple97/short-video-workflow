import { splitIntoParts } from "@/features/extraction/domain/source-parts";
import { loadChapterSource, type ChapterSource } from "@/features/extraction/services/chapter-source.service";

import type { NotebookDocument } from "./notebook-studio.service";

// A chapter is read by NotebookLM in parts of at most this many characters, each its own source.
export const CHAPTER_PART_MAX_CHARS = 40_000;

export interface ChapterPartDocument {
  document: NotebookDocument;
  partNumber: number;
  partCount: number;
  // PDF pages the part covers; null for a book without pages.
  pages: { first: number; last: number } | null;
}

interface PartChapter {
  id: string;
  bookId: string;
  title: string;
  contentPath: string | null;
  content: string | null;
  sourceStartOffset: number | null;
  sourceEndOffset: number | null;
}

// The same parts, with the same keys and text, whoever asks (cataloguing a chapter, drafting a script from it), so each
// part is uploaded to NotebookLM once per revision of its text.
export async function chapterPartDocuments(
  chapter: PartChapter,
  sourceFormat: string,
): Promise<{ source: ChapterSource; parts: ChapterPartDocument[] }> {
  const source = await loadChapterSource(chapter, sourceFormat);
  const ranges = splitIntoParts(source.text, CHAPTER_PART_MAX_CHARS);
  const parts = ranges.map((range, index) => ({
    document: {
      key: `chapter:${chapter.id}:part:${index + 1}`,
      title: `${chapter.title} — phần ${index + 1}/${ranges.length}`,
      markdown: source.forReading(range.start, range.end),
    },
    partNumber: index + 1,
    partCount: ranges.length,
    pages: source.pagesIn(range.start, range.end),
  }));
  return { source, parts };
}
