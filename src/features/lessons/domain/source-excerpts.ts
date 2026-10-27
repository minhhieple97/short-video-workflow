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
