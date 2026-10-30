export interface ExcerptCandidate {
  chapterId: string;
  text: string;
}

export interface VerifiedExcerpt {
  text: string;
  offset: number;
}

const collapse = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();

// Keeps only excerpts that really occur in the analysed chapter (whitespace-insensitive), so the AI cannot invent sources.
export function verifyExcerpts(
  candidates: readonly ExcerptCandidate[],
  chapterId: string,
  chapterContent: string,
): { verified: VerifiedExcerpt[]; rejected: number } {
  const haystack = collapse(chapterContent);
  const verified: VerifiedExcerpt[] = [];
  let rejected = 0;

  for (const candidate of candidates) {
    const needle = collapse(candidate.text);
    const offset = needle.length >= 8 && candidate.chapterId === chapterId ? haystack.indexOf(needle) : -1;
    if (offset === -1 || verified.some((excerpt) => excerpt.offset === offset)) {
      rejected += 1;
      continue;
    }
    verified.push({ text: needle, offset });
  }
  return { verified, rejected };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Where an excerpt starts in the text, whitespace-insensitive, as an offset into the text itself (not a collapsed copy),
// so it can be mapped to a page. Null when it is not there or too short to identify a place.
export function locateExcerpt(text: string, excerpt: string): number | null {
  const words = collapse(excerpt).split(" ").filter(Boolean);
  if (words.join(" ").length < 8) return null;
  const match = new RegExp(words.map(escapeRegExp).join("\\s+"), "u").exec(text.normalize("NFC"));
  return match ? match.index : null;
}

// The PDF page recorded in a source locator ("page:12;offset:345"); null for locators without one (text imports, v1.1).
export function pageFromLocator(locator: string | null): number | null {
  const page = /(?:^|;)page:(\d+)(?:;|$)/.exec(locator ?? "")?.[1];
  return page ? Number(page) : null;
}

// A video can be traced back to the book only when at least one source of its lesson carries an excerpt.
export function hasSourceExcerpt(sources: readonly { sourceExcerpt: string | null }[]): boolean {
  return sources.some((source) => (source.sourceExcerpt ?? "").trim().length > 0);
}
