import type { VideoContent } from "../domain/production-progress";
import type { BatchStatus, ItemCheckpoint, ItemStatus } from "../domain/production-status";

export interface ProductionItemViewDto {
  id: string;
  position: number;
  lessonTitle: string;
  videoId: string | null;
  videoTitle: string | null;
  // The length the script writer proposed for this video, and why; null until its draft is written.
  proposedDuration: { seconds: number; reason: string } | null;
  status: ItemStatus;
  checkpoint: ItemCheckpoint;
  // Why the item is waiting or failed, in the user's words; null when there is nothing to explain.
  reason: string | null;
  correction: string | null;
  // What the AI correction was asked to fix, in the words it was given; null until a correction is used.
  correctionNote: string | null;
  // The script and voice-overs the video still holds from an earlier pass while the item stands before the step that
  // writes them (a correction sent it back); null when the checkpoint already tells the whole story.
  earlierPass: VideoContent | null;
  render: { id: string; status: string } | null;
  // Where the finished video is on Drive: its folder once every file is there, the MP4 once that one is.
  archive: { status: string; folderUrl: string | null; videoUrl: string | null } | null;
  canRetry: boolean;
  canCancel: boolean;
}

export interface ProductionViewDto {
  id: string;
  book: { id: string; title: string };
  status: BatchStatus;
  minDurationSec: number;
  maxDurationSec: number;
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
  minDurationSec: number;
  maxDurationSec: number;
  itemCount: number;
  completedCount: number;
  createdAt: string;
}
