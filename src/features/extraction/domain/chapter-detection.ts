import type { CanonicalDocument, PageText } from "./canonical-document";

export interface ProposedChapter {
  title: string;
  startPage: number;
  endPage: number;
  // Words the chapter starts with, as the proposer read them.
  startAnchor: string;
}

export interface VerifiedChapterRange {
  title: string;
  // [start, end) in the canonical document.
  start: number;
  end: number;
  startPage: number;
}

export type ChapterVerification =
  | {
      ok: true;
      chapters: VerifiedChapterRange[];
      // Pages before the first chapter (cover, foreword, table of contents…); they belong to no chapter.
      frontMatterPages: number[];
      // Pages that list the chapter titles; a chapter never starts on one.
      tocPages: number[];
    }
  | { ok: false; problem: string };

// A single chapter over almost every page of a book this long is the whole-book fallback, not a structure.
const WHOLE_BOOK_MIN_PAGES = 20;
const WHOLE_BOOK_SHARE = 0.9;
const MIN_ANCHOR_CHARS = 4;
const TOC_MIN_TITLES = 3;
const MAX_TITLE_CHARS = 200;

const fold = (value: string) =>
  value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/[#*_>`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches the anchor's words in order, whatever whitespace or Markdown emphasis sits between them.
function anchorPattern(anchor: string): RegExp | null {
  const words = fold(anchor).split(" ").filter(Boolean);
  if (words.join(" ").length < MIN_ANCHOR_CHARS) return null;
  return new RegExp(words.map(escapeRegExp).join("[\\s#*_>`]+"), "iu");
}

function pageRange(document: CanonicalDocument, pageNumber: number): { start: number; end: number } | null {
  const offset = document.pageOffsets.find((page) => page.pageNumber === pageNumber);
  return offset ? { start: offset.start, end: offset.end } : null;
}

// Where in the canonical document the chapter starts: the anchor on its start page (or the page after, since a proposer
// may count a page break differently), moved back to the start of its line.
function locateAnchor(document: CanonicalDocument, chapter: ProposedChapter): { offset: number; page: number } | null {
  const pattern = anchorPattern(chapter.startAnchor);
  if (!pattern) return null;
  for (const page of [chapter.startPage, chapter.startPage + 1]) {
    const range = pageRange(document, page);
    if (!range || range.end === range.start) continue;
    const match = pattern.exec(document.markdown.slice(range.start, range.end));
    if (!match) continue;
    const found = range.start + match.index;
    const lineStart = document.markdown.lastIndexOf("\n", found - 1) + 1;
    return { offset: Math.max(range.start, lineStart), page };
  }
  return null;
}

function findTocPages(pages: readonly PageText[], titles: readonly string[]): number[] {
  const folded = titles.map(fold).filter((title) => title.length >= MIN_ANCHOR_CHARS);
  return pages
    .filter((page) => {
      const text = fold(page.text);
      return folded.filter((title) => text.includes(title)).length >= TOC_MIN_TITLES;
    })
    .map((page) => page.pageNumber);
}

// Checks chapters proposed by a model against the extracted text before anything is created from them: every chapter must
// start where the proposer says, with words that really are on that page; none may start on the table of contents; the
// starts must run forward through the book; and one chapter spanning a long book is refused as the whole-book fallback.
export function verifyProposedChapters(
  proposed: readonly ProposedChapter[],
  document: CanonicalDocument,
  pages: readonly PageText[],
  pageCount: number,
): ChapterVerification {
  if (proposed.length === 0) return { ok: false, problem: "Không có chương nào được đề xuất." };
  const ordered = [...proposed].sort((left, right) => left.startPage - right.startPage);

  const first = ordered[0];
  if (
    ordered.length === 1 &&
    first &&
    pageCount >= WHOLE_BOOK_MIN_PAGES &&
    first.endPage - first.startPage + 1 >= pageCount * WHOLE_BOOK_SHARE
  ) {
    return { ok: false, problem: "Đề xuất coi gần như cả cuốn sách là một chương." };
  }

  const tocPages = findTocPages(
    pages,
    ordered.map((chapter) => chapter.title),
  );
  const located: { chapter: ProposedChapter; offset: number; page: number }[] = [];
  for (const chapter of ordered) {
    const label = `"${chapter.title.slice(0, 60)}" (trang ${chapter.startPage})`;
    if (chapter.startPage < 1 || chapter.endPage > pageCount || chapter.endPage < chapter.startPage) {
      return { ok: false, problem: `Chương ${label} có số trang ngoài sách.` };
    }
    if (tocPages.includes(chapter.startPage)) {
      return { ok: false, problem: `Chương ${label} bắt đầu ở trang mục lục.` };
    }
    const anchor = locateAnchor(document, chapter);
    if (!anchor) return { ok: false, problem: `Không tìm thấy đoạn mở đầu của chương ${label} trong văn bản.` };
    const previous = located.at(-1);
    if (previous && anchor.offset <= previous.offset) {
      return { ok: false, problem: `Chương ${label} không nằm sau chương trước nó.` };
    }
    located.push({ chapter, offset: anchor.offset, page: anchor.page });
  }

  const chapters = located.map(({ chapter, offset, page }, index) => {
    const next = located[index + 1];
    // The last chapter ends with its last page, which leaves back matter (index, notes) out of it.
    const end = next ? next.offset : (pageRange(document, chapter.endPage)?.end ?? document.markdown.length);
    return {
      title: chapter.title.trim().slice(0, MAX_TITLE_CHARS),
      start: offset,
      end: Math.max(end, offset),
      startPage: page,
    };
  });
  const firstPage = chapters[0]?.startPage ?? 1;
  return {
    ok: true,
    chapters,
    frontMatterPages: pages.filter((page) => page.pageNumber < firstPage).map((page) => page.pageNumber),
    tocPages,
  };
}
