// What to do with one PDF page after reading its text layer: keep the text, record a blank page, or send it to OCR (and
// why, in the user's words, because OCR costs money).
export type PageClassification =
  { method: "TEXT"; text: string } | { method: "EMPTY"; text: "" } | { method: "OCR"; reason: string };

// Fewer letters than this on a page that draws a picture is most likely a scan with, at most, a page number in text.
export const MIN_TEXT_LETTERS = 20;

export const OCR_REASONS = {
  NO_TEXT_LAYER: "Trang không có lớp chữ (trang scan hoặc ảnh).",
  LEGACY_FONT: "Lớp chữ dùng font tiếng Việt cũ (TCVN3/VNI) nên đọc ra ký tự sai.",
  BROKEN_ENCODING: "Lớp chữ bị lỗi mã hoá.",
} as const;

// Characters that never occur in Vietnamese written in Unicode but fill text set in the old TCVN3 (¨ © ª « ¬ ® µ ¶ · ¸ ¹
// stand for ă â ê ô ơ đ à ả ã á ạ) and VNI (ø ï ä å ö ü ë ÿ) fonts.
const LEGACY_FONT_CHARACTERS = /[¨©ª«¬®µ¶·¸¹øïäåöüëÿ]/gu;
const BROKEN_CHARACTERS = /[�\p{Co}]/gu;
const LEGACY_FONT_RATIO = 0.02;
const BROKEN_RATIO = 0.05;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

export function normalizePageText(raw: string): string {
  return raw
    .normalize("NFC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function classifyPage(rawText: string, imageCount: number): PageClassification {
  const text = normalizePageText(rawText);
  const letters = count(text, /\p{L}/gu);
  if (letters === 0 && imageCount === 0) return { method: "EMPTY", text: "" };
  if (letters < MIN_TEXT_LETTERS && imageCount > 0) return { method: "OCR", reason: OCR_REASONS.NO_TEXT_LAYER };
  if (count(text, LEGACY_FONT_CHARACTERS) / letters > LEGACY_FONT_RATIO) {
    return { method: "OCR", reason: OCR_REASONS.LEGACY_FONT };
  }
  if (count(text, BROKEN_CHARACTERS) / Math.max(letters, 1) > BROKEN_RATIO) {
    return { method: "OCR", reason: OCR_REASONS.BROKEN_ENCODING };
  }
  return { method: "TEXT", text };
}
