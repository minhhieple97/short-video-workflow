import { readChapterContent } from "@/features/chapters/services/chapter.service";
import { AppError } from "@/shared/errors";

import { assembleCanonicalMarkdown, pageAtOffset, pagesInRange } from "../domain/canonical-document";
import { withPageMarkers } from "../domain/source-parts";
import { listExtractionPages } from "../repositories/extraction-page.repository";
import { findCompletedExtractionForBook } from "../repositories/extraction.repository";

export interface ChapterSource {
  // The chapter's text; every offset below is into it.
  text: string;
  // The PDF page an offset falls on; null for a book imported from text, which has no pages.
  pageAt(offset: number): number | null;
  // The first and last PDF page that [start, end) touches; null without pages.
  pagesIn(start: number, end: number): { first: number; last: number } | null;
  // [start, end) of the text as sent to a reader, with "[Trang N]" lines where pages begin (PDF books only).
  forReading(start: number, end: number): string;
}

interface SourceChapter {
  bookId: string;
  contentPath: string | null;
  content: string | null;
  sourceStartOffset: number | null;
  sourceEndOffset: number | null;
}

// A PDF chapter is read from the canonical document it was cut from, so offsets map back to PDF pages; a chapter of a
// text import is its own file. The original PDF is never read here.
export async function loadChapterSource(chapter: SourceChapter, sourceFormat: string): Promise<ChapterSource> {
  if (sourceFormat !== "pdf") {
    const text = await readChapterContent(chapter);
    return { text, pageAt: () => null, pagesIn: () => null, forReading: (start, end) => text.slice(start, end) };
  }
  const extraction = await findCompletedExtractionForBook(chapter.bookId);
  const { sourceStartOffset: start, sourceEndOffset: end } = chapter;
  if (!extraction?.pageCount || start === null || end === null) {
    throw new AppError("CHAPTER_SOURCE_MISSING", "Không tìm thấy văn bản đã trích xuất của chương này.", 409);
  }
  const pages = (await listExtractionPages(extraction.id)).map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text ?? "",
  }));
  const document = assembleCanonicalMarkdown(pages, extraction.pageCount);
  return {
    text: document.markdown.slice(start, end),
    pageAt: (offset) => pageAtOffset(document.pageOffsets, start + offset),
    pagesIn: (from, to) => {
      const range = pagesInRange(document.pageOffsets, start + from, start + to);
      return range && { first: range.firstPage, last: range.lastPage };
    },
    forReading: (from, to) => withPageMarkers(document.markdown, start + from, start + to, document.pageOffsets),
  };
}
