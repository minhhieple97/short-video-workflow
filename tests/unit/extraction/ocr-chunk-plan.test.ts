import { describe, expect, it } from "vitest";

import { groupOcrPages, splitGroup } from "@/features/extraction/domain/ocr-chunk-plan";

describe("groupOcrPages", () => {
  it("cuts the pages, sorted and without repeats, into groups of at most maxPages", () => {
    expect(groupOcrPages([9, 2, 5, 2, 7, 1], 2)).toEqual([[1, 2], [5, 7], [9]]);
    expect(groupOcrPages([3, 4], 50)).toEqual([[3, 4]]);
    expect(groupOcrPages([], 50)).toEqual([]);
  });

  it("refuses a page limit that is not a positive whole number", () => {
    expect(() => groupOcrPages([1], 0)).toThrow(RangeError);
    expect(() => groupOcrPages([1], 1.5)).toThrow(RangeError);
  });
});

describe("splitGroup", () => {
  it("halves a group, the first half taking the extra page, and cannot split one page", () => {
    expect(splitGroup([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(splitGroup([4, 8])).toEqual([[4], [8]]);
    expect(splitGroup([4])).toBeNull();
  });
});
