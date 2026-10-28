import type { PageText } from "./canonical-document";

export interface ChapterOutline {
  // One line per page with text: "[Trang N] <its first lines>". Only page heads, never the whole book.
  markdown: string;
  // Lines that look like a table of contents entry ("Chương 3 ... 45"), as hints for where chapters begin.
  hints: string[];
}

const PAGE_HEAD_CHARS = 160;
const MAX_HINTS = 200;
const MAX_HINT_CHARS = 120;
// "Title ..... 45", "Title · 45", "Title   45": a line ending in a page number after a run of dots or spaces.
const TOC_LINE = /^(.{3,}?)(?:\s*[.·…_]{2,}\s*|\s{2,}|\s+)(\d{1,4})$/u;
// A page is taken as table of contents when this many of its lines look like entries.
const TOC_MIN_LINES = 4;

const nonEmptyLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

// What NotebookLM is given to find chapter starts: the head of every page with its page number, plus the entries of any
// page that reads like a table of contents. Body text beyond a page's first lines is never included.
export function buildChapterOutline(pages: readonly PageText[]): ChapterOutline {
  const ordered = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const heads: string[] = [];
  const hints: string[] = [];
  for (const page of ordered) {
    const lines = nonEmptyLines(page.text);
    if (lines.length === 0) continue;
    heads.push(`[Trang ${page.pageNumber}] ${lines.join(" / ").slice(0, PAGE_HEAD_CHARS)}`);

    const entries = lines.filter((line) => TOC_LINE.test(line));
    if (entries.length >= TOC_MIN_LINES) {
      for (const entry of entries) {
        if (hints.length < MAX_HINTS) hints.push(entry.slice(0, MAX_HINT_CHARS));
      }
    }
  }
  return { markdown: heads.join("\n"), hints };
}
