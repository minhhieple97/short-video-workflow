import { describe, expect, it, vi } from "vitest";

import { loadPage, mapPage, pageWindow, parsePageParam, slicePage, toPageRequest } from "@/shared/pagination";

describe("parsePageParam", () => {
  it("reads a positive whole number and falls back to the first page for anything else", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(["4", "9"])).toBe(4);
    for (const bad of [undefined, "", "0", "-2", "1.5", "abc", "1e9999", "NaN"]) expect(parsePageParam(bad)).toBe(1);
  });

  it("pairs the page with the size the list uses", () => {
    expect(toPageRequest("2", 10)).toEqual({ page: 2, pageSize: 10 });
    expect(toPageRequest(undefined)).toEqual({ page: 1, pageSize: 25 });
  });
});

describe("loadPage", () => {
  const rows = Array.from({ length: 23 }, (_, index) => index + 1);
  const source = () => ({
    count: () => Promise.resolve(rows.length),
    fetch: vi.fn(({ skip, take }: { skip: number; take: number }) => Promise.resolve(rows.slice(skip, skip + take))),
  });

  it("reads only the requested rows and reports the totals", async () => {
    const s = source();
    const page = await loadPage({ page: 2, pageSize: 10 }, s);

    expect(page).toEqual({
      items: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      total: 23,
      page: 2,
      pageSize: 10,
      pageCount: 3,
    });
    expect(s.fetch).toHaveBeenCalledWith({ skip: 10, take: 10 });
  });

  it("serves the last page when the request is past the end", async () => {
    const page = await loadPage({ page: 99, pageSize: 10 }, source());

    expect(page).toMatchObject({ items: [21, 22, 23], page: 3, pageCount: 3 });
  });

  it("does not read rows for an empty list, and still has one (empty) page", async () => {
    const fetch = vi.fn();
    const page = await loadPage({ page: 5, pageSize: 10 }, { count: () => Promise.resolve(0), fetch });

    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 10, pageCount: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("slicePage and mapPage", () => {
  it("cuts an in-memory list the same way", () => {
    const page = slicePage(["a", "b", "c", "d", "e"], { page: 2, pageSize: 2 });

    expect(page).toEqual({ items: ["c", "d"], total: 5, page: 2, pageSize: 2, pageCount: 3 });
    expect(slicePage(["a"], { page: 4, pageSize: 2 })).toMatchObject({ items: ["a"], page: 1, pageCount: 1 });
  });

  it("maps the items and keeps the page numbers", () => {
    expect(mapPage(slicePage([1, 2, 3], { page: 1, pageSize: 2 }), (n) => n * 10)).toEqual({
      items: [10, 20],
      total: 3,
      page: 1,
      pageSize: 2,
      pageCount: 2,
    });
  });
});

describe("pageWindow", () => {
  it("shows every page of a short list", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first and last page and the neighbours of the current one, with a gap marker between", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 18, 19, 20]);
  });

  it("writes out a single missing page instead of a gap marker", () => {
    expect(pageWindow(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pageWindow(6, 10)).toEqual([1, null, 4, 5, 6, 7, 8, 9, 10]);
  });
});
