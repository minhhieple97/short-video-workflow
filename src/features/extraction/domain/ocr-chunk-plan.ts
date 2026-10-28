// Pages headed for OCR, in source order, cut into groups of at most `maxPages`. A group's position in this list is not
// its page numbers: each group carries the source page numbers it holds, in order, which is how results are mapped back.
export function groupOcrPages(pageNumbers: readonly number[], maxPages: number): number[][] {
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new RangeError("maxPages must be a positive integer.");
  const pages = [...new Set(pageNumbers)].sort((left, right) => left - right);
  const groups: number[][] = [];
  for (let start = 0; start < pages.length; start += maxPages) groups.push(pages.slice(start, start + maxPages));
  return groups;
}

// Halves a group that came out too large in bytes; a single page cannot be split further.
export function splitGroup(pages: readonly number[]): [number[], number[]] | null {
  if (pages.length < 2) return null;
  const middle = Math.ceil(pages.length / 2);
  return [pages.slice(0, middle), pages.slice(middle)];
}
