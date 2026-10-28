import type { BatchStatus, ItemCheckpoint, ItemStatus } from "../domain/production-status";

export interface ProductionItemDto {
  id: string;
  lessonId: string;
  lessonTitle: string;
  position: number;
  status: ItemStatus;
  checkpoint: ItemCheckpoint;
  videoId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ProductionDto {
  id: string;
  bookId: string;
  status: BatchStatus;
  targetDurationSec: number;
  createdAt: string;
  items: ProductionItemDto[];
}
