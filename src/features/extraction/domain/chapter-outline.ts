import { parseChapterMarker } from "@/features/books/domain/chapter-markers";

import type { PageText } from "./canonical-document";

export interface ChapterOutline {
  // Page heads and bounded chapter-marker candidates, each labelled "[Trang N]"; never the whole book.
  markdown: string;
  // Lines that look like a table of contents entry ("Chương 3 ... 45"), as hints for where chapters begin.
  hints: string[];
}

const PAGE_HEAD_CHARS = 160;
const MAX_HINTS = 200;
const MAX_HINT_CHARS = 120;
const MAX_MARKERS_PER_PAGE = 3;
const MAX_MARKERS = 200;
// "Title ..... 45", "Title · 45", "Title   45": a line ending in a page number after a run of dots or spaces.
const TOC_LINE = /^(.{3,}?)(?:\s*[.·…_]{2,}\s*|\s{2,}|\s+)(\d{1,4})$/u;
// A page is taken as table of contents when this many of its lines look like entries.
const TOC_MIN_LINES = 4;

const nonEmptyLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

// Chapter markers can start mid-page after the previous chapter's last paragraph; the page head alone misses them.
export function buildChapterOutline(pages: readonly PageText[]): ChapterOutline {
  const ordered = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const heads: string[] = [];
  const hints: string[] = [];
  let markerCount = 0;
  for (const page of ordered) {
    const lines = nonEmptyLines(page.text);
    if (lines.length === 0) continue;
    heads.push(`[Trang ${page.pageNumber}] ${lines.join(" / ").slice(0, PAGE_HEAD_CHARS)}`);

    let pageMarkerCount = 0;
    for (const [index, line] of lines.entries()) {
      if (markerCount >= MAX_MARKERS || pageMarkerCount >= MAX_MARKERS_PER_PAGE) break;
      if (parseChapterMarker(line)?.level !== "chapter") continue;
      const fragment = lines
        .slice(index, index + 2)
        .map((part) => part.slice(0, MAX_HINT_CHARS))
        .join(" / ");
      heads.push(`[Trang ${page.pageNumber}] Ứng viên chương: ${fragment}`);
      markerCount += 1;
      pageMarkerCount += 1;
    }

    const entries = lines.filter((line) => TOC_LINE.test(line));
    if (entries.length >= TOC_MIN_LINES) {
      for (const entry of entries) {
        if (hints.length < MAX_HINTS) hints.push(entry.slice(0, MAX_HINT_CHARS));
      }
    }
  }
  return { markdown: heads.join("\n"), hints };
}
