import type { ExtractionStatus } from "./extraction-status";

type Tone = "mint" | "amber" | "violet" | "blue" | "rose" | "slate";

export const EXTRACTION_STATUS_LABELS: Record<ExtractionStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: "Đang chờ xử lý", tone: "amber" },
  INSPECTING: { label: "Đang kiểm tra PDF", tone: "violet" },
  EXTRACTING: { label: "Đang đọc lớp chữ", tone: "violet" },
  OCR_PENDING: { label: "Đang OCR", tone: "blue" },
  ASSEMBLING: { label: "Đang ghép văn bản", tone: "violet" },
  NEEDS_CHAPTERS: { label: "Chưa xác định chương", tone: "amber" },
  COMPLETED: { label: "Đã trích xuất", tone: "mint" },
  PARTIAL: { label: "Còn trang lỗi", tone: "rose" },
  FAILED: { label: "Lỗi", tone: "rose" },
  CANCELLED: { label: "Đã huỷ", tone: "slate" },
};

export const HELD_LABEL: { label: string; tone: Tone } = { label: "Cần xử lý", tone: "amber" };

export type ExtractionStepState = "done" | "current" | "blocked" | "todo";

export interface ExtractionStep {
  key: "read" | "ocr" | "assemble" | "chapters";
  label: string;
  state: ExtractionStepState;
}

const STEP_LABELS: Record<ExtractionStep["key"], string> = {
  read: "Đọc PDF",
  ocr: "OCR trang cần thiết",
  assemble: "Ghép văn bản",
  chapters: "Tạo chương",
};

const STEP_ORDER: readonly ExtractionStep["key"][] = ["read", "ocr", "assemble", "chapters"];

function stepOf(status: ExtractionStatus, hasPages: boolean): ExtractionStep["key"] {
  switch (status) {
    case "QUEUED":
    case "INSPECTING":
    case "EXTRACTING":
      return "read";
    case "OCR_PENDING":
    case "PARTIAL":
      return "ocr";
    case "ASSEMBLING":
      return "assemble";
    case "NEEDS_CHAPTERS":
    case "COMPLETED":
      return "chapters";
    case "FAILED":
    case "CANCELLED":
      return hasPages ? "ocr" : "read";
  }
}

// Where the run stands, as four steps rather than a percentage: the time a PDF takes depends on how many pages need OCR
// and how long the provider's batch queue is, so a percentage would only be a guess.
export function extractionSteps(input: {
  status: ExtractionStatus;
  hasPages: boolean;
  held: boolean;
}): ExtractionStep[] {
  const current = stepOf(input.status, input.hasPages);
  const currentIndex = STEP_ORDER.indexOf(current);
  const stopped = input.held || ["PARTIAL", "FAILED", "CANCELLED", "NEEDS_CHAPTERS"].includes(input.status);
  return STEP_ORDER.map((key, index) => {
    let state: ExtractionStepState = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
    if (state === "current" && input.status === "COMPLETED") state = "done";
    else if (state === "current" && stopped) state = "blocked";
    return { key, label: STEP_LABELS[key], state };
  });
}
