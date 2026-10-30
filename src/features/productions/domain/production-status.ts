export const BATCH_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

// WAITING is an item parked on purpose (a remote step deferred or backing off); it is not running and not failed.
export const ITEM_STATUSES = ["PENDING", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

// The last step an item finished, in pipeline order. A restart resumes after it instead of redoing work.
export const ITEM_CHECKPOINTS = ["NONE", "DRAFTED", "COMPILED", "APPLIED", "VOICED", "READY", "RENDERED"] as const;
export type ItemCheckpoint = (typeof ITEM_CHECKPOINTS)[number];

const TERMINAL_ITEM_STATUSES: readonly ItemStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export function isTerminalItemStatus(status: ItemStatus): boolean {
  return TERMINAL_ITEM_STATUSES.includes(status);
}

// An item in one of these is still being made; once it leaves them the lesson may be produced again.
export const ACTIVE_ITEM_STATUSES: readonly ItemStatus[] = ITEM_STATUSES.filter(
  (status) => !isTerminalItemStatus(status),
);

export function hasReachedCheckpoint(current: ItemCheckpoint, target: ItemCheckpoint): boolean {
  return ITEM_CHECKPOINTS.indexOf(current) >= ITEM_CHECKPOINTS.indexOf(target);
}

export function nextCheckpoint(current: ItemCheckpoint): ItemCheckpoint | null {
  return ITEM_CHECKPOINTS[ITEM_CHECKPOINTS.indexOf(current) + 1] ?? null;
}

// The batch status is a read model computed from its items, never decided independently of them.
export function deriveBatchStatus(items: readonly ItemStatus[]): BatchStatus {
  if (items.length === 0) return "QUEUED";
  if (items.some((status) => !isTerminalItemStatus(status))) {
    return items.every((status) => status === "PENDING") ? "QUEUED" : "RUNNING";
  }

  const completed = items.filter((status) => status === "COMPLETED").length;
  if (completed === items.length) return "COMPLETED";
  if (completed > 0) return "PARTIAL";
  return items.every((status) => status === "CANCELLED") ? "CANCELLED" : "FAILED";
}

export function toBatchStatus(value: string): BatchStatus {
  return BATCH_STATUSES.find((status) => status === value) ?? "FAILED";
}

export function toItemStatus(value: string): ItemStatus {
  return ITEM_STATUSES.find((status) => status === value) ?? "FAILED";
}

export function toItemCheckpoint(value: string): ItemCheckpoint {
  return ITEM_CHECKPOINTS.find((checkpoint) => checkpoint === value) ?? "NONE";
}
