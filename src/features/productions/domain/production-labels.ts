import type { BatchStatus, ItemCheckpoint, ItemStatus } from "./production-status";

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

// The step an item works on next, named for the person watching; a checkpoint records the step last finished.
const NEXT_STEP: Record<ItemCheckpoint, string> = {
  NONE: "Viết bản thảo",
  DRAFTED: "Biên tập cảnh",
  COMPILED: "Áp dụng kịch bản",
  APPLIED: "Lồng tiếng",
  VOICED: "Kiểm tra tự động",
  READY: "Render bản cuối",
  RENDERED: "Đã render",
};

export const PRODUCTION_STEP_COUNT = 6;

export function productionStep(checkpoint: ItemCheckpoint): { done: number; total: number; label: string } {
  const order: readonly ItemCheckpoint[] = ["NONE", "DRAFTED", "COMPILED", "APPLIED", "VOICED", "READY", "RENDERED"];
  return { done: order.indexOf(checkpoint), total: PRODUCTION_STEP_COUNT, label: NEXT_STEP[checkpoint] };
}

export const CORRECTION_LABELS: Record<string, string> = {
  SCRIPT_STUDIO: "Đã dùng lượt sửa AI ở bản thảo",
  SCENE_COMPILER: "Đã dùng lượt sửa AI ở biên tập cảnh",
};
