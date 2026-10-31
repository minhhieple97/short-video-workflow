import { ITEM_CHECKPOINTS, type BatchStatus, type ItemCheckpoint, type ItemStatus } from "./production-status";

export type StatusTone = "slate" | "violet" | "amber" | "mint" | "rose" | "blue";

export const ITEM_STATUS_LABELS: Record<ItemStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Chờ chạy", tone: "slate" },
  RUNNING: { label: "Đang chạy", tone: "violet" },
  WAITING: { label: "Đang chờ", tone: "amber" },
  COMPLETED: { label: "Hoàn tất", tone: "mint" },
  FAILED: { label: "Lỗi", tone: "rose" },
  CANCELLED: { label: "Đã huỷ", tone: "slate" },
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, { label: string; tone: StatusTone }> = {
  QUEUED: { label: "Đang xếp hàng", tone: "slate" },
  RUNNING: { label: "Đang chạy", tone: "violet" },
  COMPLETED: { label: "Hoàn tất", tone: "mint" },
  PARTIAL: { label: "Xong một phần", tone: "amber" },
  FAILED: { label: "Lỗi", tone: "rose" },
  CANCELLED: { label: "Đã huỷ", tone: "slate" },
};

// The six steps of the pipeline in order, named for the person watching; the checkpoint an item stands at counts the steps finished.
export const PRODUCTION_STEP_LABELS = [
  "Viết bản thảo",
  "Biên tập cảnh",
  "Áp dụng kịch bản",
  "Lồng tiếng",
  "Kiểm tra tự động",
  "Render bản cuối",
] as const;

export const PRODUCTION_STEP_COUNT = PRODUCTION_STEP_LABELS.length;

export function productionStep(checkpoint: ItemCheckpoint): { done: number; total: number; label: string } {
  const done = ITEM_CHECKPOINTS.indexOf(checkpoint);
  return { done, total: PRODUCTION_STEP_COUNT, label: PRODUCTION_STEP_LABELS[done] ?? "Đã render" };
}

export const CORRECTION_LABELS: Record<string, string> = {
  SCRIPT_STUDIO: "Đã dùng lượt sửa AI ở bản thảo",
  SCENE_COMPILER: "Đã dùng lượt sửa AI ở biên tập cảnh",
};
