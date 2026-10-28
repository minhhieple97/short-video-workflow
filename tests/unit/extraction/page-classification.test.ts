import { describe, expect, it } from "vitest";

import { classifyPage, normalizePageText, OCR_REASONS } from "@/features/extraction/domain/page-classification";

const VIETNAMESE = "Mỗi hành động nhỏ là một lá phiếu cho con người bạn muốn trở thành, và thói quen được xây từ đó.";

describe("classifyPage", () => {
  it("keeps a page whose text layer reads correctly, in composed Unicode", () => {
    expect(classifyPage(VIETNAMESE.normalize("NFD"), 0)).toEqual({ method: "TEXT", text: VIETNAMESE });
    expect(classifyPage(VIETNAMESE, 3)).toMatchObject({ method: "TEXT" });
  });

  it("keeps a short page such as a chapter title, which has no picture", () => {
    expect(classifyPage("  Chương 3  \n", 0)).toEqual({ method: "TEXT", text: "Chương 3" });
  });

  it("records a page with neither letters nor pictures as blank", () => {
    expect(classifyPage(" \n 12 \n", 0)).toEqual({ method: "EMPTY", text: "" });
  });

  it("sends a picture page with little or no text to OCR as a likely scan", () => {
    expect(classifyPage("", 1)).toEqual({ method: "OCR", reason: OCR_REASONS.NO_TEXT_LAYER });
    expect(classifyPage("Trang 12", 2)).toEqual({ method: "OCR", reason: OCR_REASONS.NO_TEXT_LAYER });
  });

  it("sends text set in old Vietnamese fonts to OCR", () => {
    const tcvn3 = "Th¸i ®é t¸c ®µo t¹o thµnh c¸c th¸i quen nhá mçi ngµy.";
    const vni = "Vieät Nam laø moät öôùc môø cuûa nhieàu ngöôøi.";

    expect(classifyPage(tcvn3, 0)).toEqual({ method: "OCR", reason: OCR_REASONS.LEGACY_FONT });
    expect(classifyPage(vni, 0)).toEqual({ method: "OCR", reason: OCR_REASONS.LEGACY_FONT });
  });

  it("sends text full of replacement characters to OCR", () => {
    const broken = `${"Ch��ng ".repeat(10)}${"abc ".repeat(5)}`;

    expect(classifyPage(broken, 0)).toEqual({ method: "OCR", reason: OCR_REASONS.BROKEN_ENCODING });
  });

  it("tolerates a stray symbol in an otherwise normal page", () => {
    expect(classifyPage(`${VIETNAMESE} © 2020`, 0)).toMatchObject({ method: "TEXT" });
  });
});

describe("normalizePageText", () => {
  it("composes Unicode, drops trailing spaces and keeps at most one blank line", () => {
    expect(normalizePageText("a  \n\n\n\nb\t\n")).toBe("a\n\nb");
    expect(normalizePageText("Việt")).toBe("Việt");
  });
});
