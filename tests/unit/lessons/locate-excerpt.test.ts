import { describe, expect, it } from "vitest";

import { locateExcerpt, pageFromLocator } from "@/features/lessons/domain/source-excerpts";

describe("locateExcerpt", () => {
  const text = "Mở đầu.\nThói quen nhỏ\n  cộng dồn thành   kết quả lớn. Hết.";

  it("finds an excerpt across line breaks and extra spaces, at its offset in the original text", () => {
    const offset = locateExcerpt(text, "Thói quen nhỏ cộng dồn thành kết quả lớn.");
    expect(offset).toBe(text.indexOf("Thói quen"));
  });

  it("returns null for words that are not in the text or too short to place", () => {
    expect(locateExcerpt(text, "Ý chí là tất cả mọi thứ.")).toBeNull();
    expect(locateExcerpt(text, "Hết.")).toBeNull();
  });

  it("treats the excerpt's own punctuation literally", () => {
    expect(locateExcerpt("Giá (rẻ) là [điều] tốt nhất.", "Giá (rẻ) là [điều] tốt")).toBe(0);
  });
});

describe("pageFromLocator", () => {
  it("reads the page of a PDF locator and nothing from the others", () => {
    expect(pageFromLocator("page:12;offset:345")).toBe(12);
    expect(pageFromLocator("offset:345")).toBeNull();
    expect(pageFromLocator("offset:345;page:7")).toBe(7);
    expect(pageFromLocator("subpage:3")).toBeNull();
    expect(pageFromLocator(null)).toBeNull();
  });
});
