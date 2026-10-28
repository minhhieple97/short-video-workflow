import type { OcrChunkResult } from "@/server/ocr/ocr-provider";
import { AppError } from "@/shared/errors";

// pageNumbers[i] is the page of the source PDF that was sent as page i of the chunk. The chunks need not be
// contiguous, which is why OCR page indexes can only be turned back into PDF pages through this map.
export interface PlannedOcrChunk {
  chunkId: string;
  pageNumbers: readonly number[];
}

export type OcrPageOutcome =
  // EMPTY is a valid blank page, deliberately distinct from a FAILED one.
  | { pageNumber: number; status: "OK"; method: "OCR" | "EMPTY"; text: string; confidence: number | null }
  | { pageNumber: number; status: "FAILED"; code: string };

export interface OcrReconciliation {
  pages: OcrPageOutcome[];
  // Chunks the provider answered for that were never planned; reported, never stored.
  unexpectedChunkIds: string[];
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f﻿]/g;

// Derived text only: NFC keeps Vietnamese matching stable, newlines become LF, stray control characters go.
export function normalizeOcrText(markdown: string): string {
  return markdown.normalize("NFC").replace(/\r\n?/g, "\n").replace(CONTROL_CHARACTERS, "");
}

function assertPlanIsDisjoint(plan: readonly PlannedOcrChunk[]): void {
  const seenChunks = new Set<string>();
  const seenPages = new Set<number>();
  for (const chunk of plan) {
    if (seenChunks.has(chunk.chunkId))
      throw new AppError("OCR_PLAN_INVALID", `Mã đoạn ${chunk.chunkId} bị trùng.`, 500);
    seenChunks.add(chunk.chunkId);
    for (const pageNumber of chunk.pageNumbers) {
      if (seenPages.has(pageNumber))
        throw new AppError("OCR_PLAN_INVALID", `Trang ${pageNumber} nằm trong hai đoạn.`, 500);
      seenPages.add(pageNumber);
    }
  }
}

const failAll = (chunk: PlannedOcrChunk, code: string): OcrPageOutcome[] =>
  chunk.pageNumbers.map((pageNumber) => ({ pageNumber, status: "FAILED", code }));

const validConfidence = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;

function outcomesForChunk(chunk: PlannedOcrChunk, results: readonly OcrChunkResult[]): OcrPageOutcome[] {
  const matching = results.filter((result) => result.chunkId === chunk.chunkId);
  if (matching.length === 0) return failAll(chunk, "OCR_CHUNK_MISSING");

  const [result] = matching;
  if (matching.length > 1 || result === undefined) return failAll(chunk, "OCR_DUPLICATE_RESULT");
  if (result.status === "failed") return failAll(chunk, result.code);

  // Page identity is only trustworthy when exactly the pages that were sent come back, each index once. Anything else
  // (a dropped page that shifted the rest, a repeated page) cannot be repaired by guessing, so the chunk is retried.
  const indexes = result.pages.map((page) => page.pageIndex);
  if (new Set(indexes).size !== indexes.length) return failAll(chunk, "OCR_DUPLICATE_PAGE");
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= chunk.pageNumbers.length)) {
    return failAll(chunk, "OCR_PAGE_INDEX_OUT_OF_RANGE");
  }
  if (result.pages.length !== chunk.pageNumbers.length) return failAll(chunk, "OCR_PAGE_COUNT_MISMATCH");

  const byIndex = new Map(result.pages.map((page) => [page.pageIndex, page]));
  return chunk.pageNumbers.map((pageNumber, index): OcrPageOutcome => {
    const page = byIndex.get(index);
    if (!page) return { pageNumber, status: "FAILED", code: "OCR_PAGE_MISSING" };
    const text = normalizeOcrText(page.markdown);
    return {
      pageNumber,
      status: "OK",
      method: text.trim().length === 0 ? "EMPTY" : "OCR",
      text: text.trim().length === 0 ? "" : text,
      confidence: validConfidence(page.confidence),
    };
  });
}

// Turns what a provider returned into one outcome for every page that was sent. Nothing is dropped: a page is either
// OK (text, or a valid blank) or FAILED with the reason, so a missing page can never pass for an empty one.
export function reconcileOcrResults(
  plan: readonly PlannedOcrChunk[],
  results: readonly OcrChunkResult[],
): OcrReconciliation {
  assertPlanIsDisjoint(plan);
  const planned = new Set(plan.map((chunk) => chunk.chunkId));
  return {
    pages: plan
      .flatMap((chunk) => outcomesForChunk(chunk, results))
      .sort((left, right) => left.pageNumber - right.pageNumber),
    unexpectedChunkIds: [...new Set(results.map((result) => result.chunkId).filter((id) => !planned.has(id)))],
  };
}
