export const BOOK_IMPORT_LABELS: Record<string, string> = {
  UPLOADING: "Chờ tải đủ tệp",
  QUEUED: "Đang chờ",
  RUNNING: "Đang xử lý",
  EXTRACTING: "Đang trích xuất PDF / OCR",
  ANALYZING: "Đang lập danh sách bài học",
  PRODUCING: "Đang làm video",
  COMPLETED: "Hoàn tất",
  PARTIAL: "Hoàn tất, có sách lỗi",
  FAILED: "Cần xử lý lỗi",
  CANCELLED: "Đã huỷ",
};

export const FINISHED_BOOK_IMPORT_ITEMS = ["COMPLETED", "FAILED", "CANCELLED"];
