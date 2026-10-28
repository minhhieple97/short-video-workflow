import { z } from "zod";

import type { PlannedOcrChunk } from "./ocr-results";

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

const chunkPlanSchema = z
  .array(
    z.object({
      chunkId: z.string().min(1),
      pageNumbers: z.array(z.number().int().positive()).min(1),
    }),
  )
  .min(1);

export function serializeChunkPlan(plan: readonly PlannedOcrChunk[]): string {
  return JSON.stringify(plan.map(({ chunkId, pageNumbers }) => ({ chunkId, pageNumbers })));
}

// The stored plan is the only map from OCR page indexes back to PDF pages, so a damaged one is refused, not guessed.
export function parseChunkPlan(json: string | null): PlannedOcrChunk[] | null {
  if (json === null) return null;
  try {
    const parsed = chunkPlanSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
