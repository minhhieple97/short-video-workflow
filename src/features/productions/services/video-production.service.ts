import "server-only";

import { scenePlanArtifactSchema, scriptDraftArtifactSchema } from "@/server/scene-plan/handoff";

import { CORRECTION_LABELS } from "../domain/production-labels";
import { isTerminalItemStatus, toItemCheckpoint, toItemStatus } from "../domain/production-status";
import { findProductionItemForVideo } from "../repositories/production.repository";
import type { VideoProductionDto } from "../schemas/video-production.dto";

// Null for a video made by hand. The stored artifacts are shown only when they still match their fingerprints.
export async function getVideoProduction(videoId: string): Promise<VideoProductionDto | null> {
  const item = await findProductionItemForVideo(videoId);
  if (!item) return null;
  const status = toItemStatus(item.status);
  const draft = scriptDraftArtifactSchema.safeParse(item.draftArtifactJson);
  const plan = scenePlanArtifactSchema.safeParse(item.scenePlanArtifactJson);
  return {
    productionId: item.batchId,
    status,
    checkpoint: toItemCheckpoint(item.checkpoint),
    inProgress: !isTerminalItemStatus(status),
    correction: item.aiCorrectionTarget ? (CORRECTION_LABELS[item.aiCorrectionTarget] ?? null) : null,
    scenePlanVersion: plan.success ? plan.data.promptVersion : null,
    draft: draft.success
      ? draft.data.draft.beats.map((beat) => ({
          beat: beat.beat,
          narration: beat.narration,
          illustrative: beat.illustrative,
          sources: beat.sourceExcerpts.map((excerpt) => ({ page: excerpt.page, text: excerpt.text })),
        }))
      : null,
  };
}
