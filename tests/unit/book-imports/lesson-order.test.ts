import { describe, expect, it } from "vitest";

import { orderByFirstChapter } from "@/features/book-imports/domain/lesson-order";

const lesson = (id: string, ...chapterOrders: number[]) => ({ id, chapterOrders });

describe("orderByFirstChapter", () => {
  it("puts lessons in the order of their chapters, whichever finished first", () => {
    const found = [lesson("c3-a", 3), lesson("c1-a", 1), lesson("c2-a", 2), lesson("c1-b", 1)];

    expect(orderByFirstChapter(found).map((entry) => entry.id)).toEqual(["c1-a", "c1-b", "c2-a", "c3-a"]);
  });

  it("keeps the given order among lessons of one chapter", () => {
    const found = [lesson("second", 4), lesson("first", 4), lesson("third", 4)];

    expect(orderByFirstChapter(found).map((entry) => entry.id)).toEqual(["second", "first", "third"]);
  });

  it("places a lesson that cites several chapters by the earliest, and one that cites none last", () => {
    const found = [lesson("none"), lesson("spans", 5, 2), lesson("later", 3)];

    expect(orderByFirstChapter(found).map((entry) => entry.id)).toEqual(["spans", "later", "none"]);
  });

  it("does not change the list it was given", () => {
    const found = [lesson("b", 2), lesson("a", 1)];
    orderByFirstChapter(found);
    expect(found.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});
