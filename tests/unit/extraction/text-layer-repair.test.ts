import { describe, expect, it } from "vitest";

import { repairMisencodedDStroke, repairTextLayer } from "@/features/extraction/domain/text-layer-repair";

const MANGLED_PAGE = "ðộc giả ñã ñọc ñến ñây, ñể ñiều ñó ñược ñổi. ".repeat(4);
const SOUND_PAGE = "Độc giả đã đọc đến đây, để điều đó được đổi. ".repeat(4);

describe("repairMisencodedDStroke", () => {
  it("turns ñ into đ and ð into Đ, leaving the other letters alone", () => {
    expect(repairMisencodedDStroke("Chương 7 / Bầy thú ñiện tử")).toBe("Chương 7 / Bầy thú điện tử");
    expect(repairMisencodedDStroke("MUA ðÀI LOAN, ðƯỢC ĂN CẢ")).toBe("MUA ĐÀI LOAN, ĐƯỢC ĂN CẢ");
    expect(repairMisencodedDStroke("ðông Nam Á ñang ñổi")).toBe("Đông Nam Á đang đổi");
  });

  it("reads Ñ and Ð, the capital đ of the VNI and Windows-1258 conventions, as Đ", () => {
    expect(repairMisencodedDStroke("Ñây là Ðiều")).toBe("Đây là Điều");
  });

  it("keeps the length, so offsets into the text stay valid", () => {
    expect(repairMisencodedDStroke(MANGLED_PAGE)).toHaveLength(MANGLED_PAGE.length);
  });

  it("finds ñ written as n plus a combining tilde", () => {
    expect(repairMisencodedDStroke("ñồng".normalize("NFD"))).toBe("đồng");
  });
});

describe("which books are repaired", () => {
  const repairs = (pages: string[]) => repairTextLayer(pages).repairedCharacters > 0;

  it("is true for a book whose text layer never writes đ", () => {
    expect(repairs([MANGLED_PAGE])).toBe(true);
  });

  it("is false for a sound book, even one that quotes a Spanish name", () => {
    expect(repairs([SOUND_PAGE.repeat(50), "Señor Peña và señorita Muñoz."])).toBe(false);
  });

  it("proves nothing from a handful of letters", () => {
    expect(repairs(["ñi ñây ñó ñã ñể"])).toBe(false);
  });

  it("is true when only some of the book's fonts misread, and false when they are a rare exception", () => {
    expect(repairs([SOUND_PAGE.repeat(3), MANGLED_PAGE.repeat(3)])).toBe(true);
    expect(repairs([SOUND_PAGE.repeat(60), MANGLED_PAGE])).toBe(false);
  });
});

describe("repairTextLayer", () => {
  it("repairs every page of a book that needs it and counts what it changed", () => {
    const result = repairTextLayer([MANGLED_PAGE, "Chương 2", "ñổi"]);

    const onFirstPage = MANGLED_PAGE.match(/[ñð]/g)?.length ?? 0;

    expect(result.texts).toEqual([SOUND_PAGE, "Chương 2", "đổi"]);
    expect(result.repairedCharacters).toBe(onFirstPage + 1);
  });

  it("hands back the pages as they were when the book is sound", () => {
    const pages = [SOUND_PAGE, "Señor Peña"];

    expect(repairTextLayer(pages)).toEqual({ texts: pages, repairedCharacters: 0 });
  });
});
