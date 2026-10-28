import type { PageOffset } from "./canonical-document";

// [start, end) within the text that was split.
export interface SourcePart {
  start: number;
  end: number;
}

// Cuts a chapter into parts of at most `maxChars`, at paragraph breaks where there is one, so a long chapter is read in
// bounded pieces and no piece ends mid-sentence when it can be helped. Together the parts cover the text exactly.
export function splitIntoParts(text: string, maxChars: number): SourcePart[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new RangeError("maxChars must be a positive integer.");
  const parts: SourcePart[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      if (paragraph > start) end = paragraph + 2;
    }
    parts.push({ start, end });
    start = end;
  }
  return parts;
}

// The text of [start, end) of the canonical document with a "[Trang N]" line where each page begins, so a reader can
// say which page a passage is on. The markers are only in what is sent; offsets always refer to the unmarked text.
export function withPageMarkers(
  markdown: string,
  start: number,
  end: number,
  pageOffsets: readonly PageOffset[],
): string {
  const pages = pageOffsets.filter((page) => page.end > start && page.start < end && page.end > page.start);
  if (pages.length === 0) return markdown.slice(start, end);
  return pages
    .map(
      (page) => `[Trang ${page.pageNumber}]\n${markdown.slice(Math.max(start, page.start), Math.min(end, page.end))}`,
    )
    .join("\n\n");
}
