export const LESSON_TEXT_FIELDS = [
  "title",
  "summary",
  "principle",
  "realLifeScenario",
  "commonMistake",
  "betterApproach",
  "actionableStep",
] as const;
export type LessonTextField = (typeof LESSON_TEXT_FIELDS)[number];
export type LessonText = Record<LessonTextField, string>;

export const LESSON_FIELD_LABELS: Record<LessonTextField, string> = {
  title: "Tiêu đề",
  summary: "Tóm tắt",
  principle: "Bài học cốt lõi",
  realLifeScenario: "Tình huống minh họa",
  commonMistake: "Sai lầm thường gặp",
  betterApproach: "Cách làm tốt hơn",
  actionableStep: "Hành động cụ thể",
};

export const LESSON_STATUSES = ["DRAFT", "APPROVED", "ARCHIVED"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const LESSON_STATUS_LABELS: Record<LessonStatus, string> = {
  DRAFT: "Bản nháp",
  APPROVED: "Đã duyệt",
  ARCHIVED: "Đã lưu trữ",
};

// Where a lesson may go from each status; the server enforces it and the bulk buttons count with it.
const LESSON_TRANSITIONS: Record<LessonStatus, readonly LessonStatus[]> = {
  DRAFT: ["APPROVED", "ARCHIVED"],
  APPROVED: ["ARCHIVED", "DRAFT"],
  ARCHIVED: ["DRAFT"],
};

export function canMoveLesson(from: LessonStatus, to: LessonStatus): boolean {
  return LESSON_TRANSITIONS[from].includes(to);
}

export const LESSON_ORIGIN_LABELS: Record<"AI" | "MANUAL", string> = {
  AI: "AI đề xuất",
  MANUAL: "Tạo thủ công",
};

export function pickLessonText(source: LessonText): LessonText {
  return Object.fromEntries(LESSON_TEXT_FIELDS.map((field) => [field, source[field]])) as LessonText;
}
