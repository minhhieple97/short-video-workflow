import { AppError } from "@/shared/errors";

export interface PageText {
  pageNumber: number;
  // Empty for a valid blank page.
  text: string;
}

// [start, end) in UTF-16 code units of the canonical markdown, the same unit as the chapter offsets (`text.slice`).
export interface PageOffset {
  pageNumber: number;
  start: number;
  end: number;
}

export interface CanonicalDocument {
  markdown: string;
  pageOffsets: PageOffset[];
}

const PAGE_SEPARATOR = "\n\n";

// Joins page texts in page order into one markdown document and records where each page sits in it. Blank pages take
// no space (zero-length offsets), so they add neither text nor extra blank lines. Every page 1..pageCount must be
// present: a gap would silently shift everything after it onto the wrong page.
export function assembleCanonicalMarkdown(pages: readonly PageText[], pageCount: number): CanonicalDocument {
  const ordered = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const missing: number[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (!ordered.some((page) => page.pageNumber === pageNumber)) missing.push(pageNumber);
  }
  const hasDuplicates = new Set(ordered.map((page) => page.pageNumber)).size !== ordered.length;
  const outOfRange = ordered.filter(
    (page) => !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || page.pageNumber > pageCount,
  );
  if (missing.length > 0 || hasDuplicates || outOfRange.length > 0) {
    throw new AppError("EXTRACTION_PAGES_INVALID", "Danh sách trang không khớp số trang của PDF.", 500, {
      details: { missing, hasDuplicates, outOfRange: outOfRange.map((page) => page.pageNumber) },
    });
  }

  let markdown = "";
  const pageOffsets: PageOffset[] = [];
  for (const page of ordered) {
    if (page.text.length === 0) {
      pageOffsets.push({ pageNumber: page.pageNumber, start: markdown.length, end: markdown.length });
      continue;
    }
    if (markdown.length > 0) markdown += PAGE_SEPARATOR;
    const start = markdown.length;
    markdown += page.text;
    pageOffsets.push({ pageNumber: page.pageNumber, start, end: markdown.length });
  }
  return { markdown, pageOffsets };
}

// The page holding the character at `offset`; null for an offset in the blank gap between pages or out of range.
export function pageAtOffset(pageOffsets: readonly PageOffset[], offset: number): number | null {
  return pageOffsets.find((page) => offset >= page.start && offset < page.end)?.pageNumber ?? null;
}

// The first and last page that a range [start, end) touches, or null when it covers no page text.
export function pagesInRange(
  pageOffsets: readonly PageOffset[],
  start: number,
  end: number,
): { firstPage: number; lastPage: number } | null {
  const touched = pageOffsets.filter((page) => page.end > page.start && page.start < end && page.end > start);
  const first = touched[0];
  const last = touched[touched.length - 1];
  return first && last ? { firstPage: first.pageNumber, lastPage: last.pageNumber } : null;
}
