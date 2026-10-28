import { describe, expect, it } from "vitest";

import { normalizeOcrText, reconcileOcrResults, type PlannedOcrChunk } from "@/features/extraction/domain/ocr-results";
import type { OcrChunkResult, OcrPageResult } from "@/server/ocr/ocr-provider";

const page = (pageIndex: number, markdown: string, confidence: number | null = 0.9): OcrPageResult => ({
  pageIndex,
  markdown,
  confidence,
});
const ok = (chunkId: string, pages: OcrPageResult[]): OcrChunkResult => ({ chunkId, status: "ok", pages });

// Chunk "a" holds pages 3, 4 and 10 of the PDF: the chunks need not be contiguous.
const PLAN: PlannedOcrChunk[] = [
  { chunkId: "a", pageNumbers: [3, 4, 10] },
  { chunkId: "b", pageNumbers: [20, 21] },
];

describe("reconcileOcrResults", () => {
  it("maps OCR page indexes back to the PDF pages named by the chunk's page map", () => {
    const { pages } = reconcileOcrResults(PLAN, [
      ok("b", [page(0, "Trang hai mươi"), page(1, "Trang hai mốt")]),
      ok("a", [page(2, "Mười"), page(0, "Ba"), page(1, "Bốn")]),
    ]);

    expect(pages.map((outcome) => [outcome.pageNumber, outcome.status === "OK" ? outcome.text : outcome.code])).toEqual(
      [
        [3, "Ba"],
        [4, "Bốn"],
        [10, "Mười"],
        [20, "Trang hai mươi"],
        [21, "Trang hai mốt"],
      ],
    );
  });

  it("fails every page of a chunk the provider did not answer for, instead of dropping them", () => {
    const { pages } = reconcileOcrResults(PLAN, [ok("a", [page(0, "x"), page(1, "y"), page(2, "z")])]);

    expect(pages.filter((outcome) => outcome.status === "FAILED")).toEqual([
      { pageNumber: 20, status: "FAILED", code: "OCR_CHUNK_MISSING" },
      { pageNumber: 21, status: "FAILED", code: "OCR_CHUNK_MISSING" },
    ]);
  });

  it("carries the provider's failure code onto every page of a failed chunk and keeps the other chunks", () => {
    const { pages } = reconcileOcrResults(PLAN, [
      { chunkId: "a", status: "failed", code: "OCR_REQUEST_500", message: "x" },
      ok("b", [page(0, "x"), page(1, "y")]),
    ]);

    expect(pages.filter((outcome) => outcome.status === "FAILED").map((outcome) => outcome.pageNumber)).toEqual([
      3, 4, 10,
    ]);
    expect(pages.filter((outcome) => outcome.status === "OK").map((outcome) => outcome.pageNumber)).toEqual([20, 21]);
  });

  it.each([
    ["a repeated page index", [page(0, "x"), page(0, "y"), page(1, "z")], "OCR_DUPLICATE_PAGE"],
    ["an index beyond the chunk", [page(0, "x"), page(1, "y"), page(3, "z")], "OCR_PAGE_INDEX_OUT_OF_RANGE"],
    ["a negative index", [page(-1, "x"), page(0, "y"), page(1, "z")], "OCR_PAGE_INDEX_OUT_OF_RANGE"],
    ["fewer pages than were sent", [page(0, "x"), page(1, "y")], "OCR_PAGE_COUNT_MISMATCH"],
  ])("fails the whole chunk on %s, because page identity can no longer be trusted", (_label, pages, code) => {
    const outcomes = reconcileOcrResults([PLAN[0] as PlannedOcrChunk], [ok("a", pages)]).pages;

    expect(outcomes).toEqual([3, 4, 10].map((pageNumber) => ({ pageNumber, status: "FAILED", code })));
  });

  it("treats a blank page as a valid empty page, not as a failure", () => {
    const { pages } = reconcileOcrResults(
      [{ chunkId: "a", pageNumbers: [1, 2] }],
      [ok("a", [page(0, "   \n\t "), page(1, "Có chữ")])],
    );

    expect(pages).toEqual([
      { pageNumber: 1, status: "OK", method: "EMPTY", text: "", confidence: 0.9 },
      { pageNumber: 2, status: "OK", method: "OCR", text: "Có chữ", confidence: 0.9 },
    ]);
  });

  it("keeps confidence exactly as reported, never inventing one", () => {
    const { pages } = reconcileOcrResults(
      [{ chunkId: "a", pageNumbers: [1, 2, 3] }],
      [ok("a", [page(0, "x", null), page(1, "y", 0.42), page(2, "z", 7)])],
    );

    expect(pages.map((outcome) => (outcome.status === "OK" ? outcome.confidence : "failed"))).toEqual([
      null,
      0.42,
      null,
    ]);
  });

  it("fails a chunk reported twice rather than choosing one of the answers", () => {
    const { pages } = reconcileOcrResults(
      [{ chunkId: "a", pageNumbers: [1] }],
      [ok("a", [page(0, "x")]), ok("a", [page(0, "y")])],
    );

    expect(pages).toEqual([{ pageNumber: 1, status: "FAILED", code: "OCR_DUPLICATE_RESULT" }]);
  });

  it("reports chunks that were never planned and does not store them", () => {
    const result = reconcileOcrResults(
      [{ chunkId: "a", pageNumbers: [1] }],
      [ok("a", [page(0, "x")]), ok("ghost", [page(0, "y")])],
    );

    expect(result.unexpectedChunkIds).toEqual(["ghost"]);
    expect(result.pages).toHaveLength(1);
  });

  it("rejects a plan that sends the same page twice", () => {
    expect(() =>
      reconcileOcrResults(
        [
          { chunkId: "a", pageNumbers: [1, 2] },
          { chunkId: "b", pageNumbers: [2, 3] },
        ],
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "OCR_PLAN_INVALID" }));
  });
});

describe("normalizeOcrText", () => {
  it("composes Vietnamese diacritics (NFC) so later matching is stable", () => {
    const decomposed = "Việt Nam".normalize("NFD");

    expect(decomposed).not.toBe("Việt Nam");
    expect(normalizeOcrText(decomposed)).toBe("Việt Nam");
  });

  it("turns CRLF and CR into LF and removes a BOM and control characters but keeps tabs and newlines", () => {
    expect(normalizeOcrText("﻿a\r\nb\rc\u0000d\te\n")).toBe("a\nb\ncd\te\n");
  });
});
