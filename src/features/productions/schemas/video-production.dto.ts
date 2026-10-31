import type { NarrativeBeat } from "@/features/videos/domain/narrative-beats";

import type { ItemCheckpoint, ItemStatus } from "../domain/production-status";

export interface DraftBeatDto {
  beat: NarrativeBeat;
  narration: string;
  // True for a scenario the AI made up to illustrate the lesson rather than took from the book.
  illustrative: boolean;
  sources: { page: number | null; text: string }[];
}

// How a video relates to the production that made it: whether it is still being worked on (and so locked), and what its
// script was drawn from.
export interface VideoProductionDto {
  productionId: string;
  status: ItemStatus;
  checkpoint: ItemCheckpoint;
  inProgress: boolean;
  correction: string | null;
  scenePlanVersion: string | null;
  draft: DraftBeatDto[] | null;
}
