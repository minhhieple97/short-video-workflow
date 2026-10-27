import { AppError } from "@/shared/errors";

export interface ChapterRange {
  title: string;
  start: number;
  end: number;
}

// Minimal clean-up for derived chapter files: trailing spaces and runs of blank lines. Paragraphs are preserved.
export function normalizeChapterContent(raw: string): string {
  return raw
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function assertValidChapterRanges(ranges: readonly ChapterRange[], textLength: number): void {
  const fail = (message: string) => {
    throw new AppError("INVALID_CHAPTER_RANGES", message, 400);
  };

  if (ranges.length === 0) fail("Cần ít nhất một chương.");
  ranges.forEach((range, index) => {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end))
      fail(`Chương ${index + 1}: vị trí không hợp lệ.`);
    if (range.start < 0 || range.end > textLength || range.start >= range.end) {
      fail(`Chương ${index + 1}: vị trí nằm ngoài nội dung sách.`);
    }
  });

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous && current && current.start < previous.end) fail("Các chương không được chồng lấn nội dung.");
  }
}
