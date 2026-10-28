import type { BatchStatus, ItemCheckpoint, ItemStatus } from "../domain/production-status";

export interface ProductionItemViewDto {
  id: string;
  position: number;
  lessonTitle: string;
  videoId: string | null;
  videoTitle: string | null;
  status: ItemStatus;
  checkpoint: ItemCheckpoint;
  // Why the item is waiting or failed, in the user's words; null when there is nothing to explain.
  reason: string | null;
  correction: string | null;
  render: { id: string; status: string } | null;
  archive: { status: string; folderUrl: string | null } | null;
  canRetry: boolean;
  canCancel: boolean;
}

export interface ProductionViewDto {
  id: string;
  book: { id: string; title: string };
  status: BatchStatus;
  targetDurationSec: number;
  createdAt: string;
  completedAt: string | null;
  inProgress: boolean;
  // A finished video whose Drive archive is still on its way; the page keeps following it.
  archiving: boolean;
  counts: Record<ItemStatus, number>;
  items: ProductionItemViewDto[];
}

export interface ProductionSummaryDto {
  id: string;
  book: { id: string; title: string };
  status: BatchStatus;
  targetDurationSec: number;
  itemCount: number;
  completedCount: number;
  createdAt: string;
}
