import "server-only";

import { scenePlanArtifactSchema, scriptDraftArtifactSchema } from "@/server/scene-plan/handoff";

import { CORRECTION_LABELS } from "../domain/production-labels";
import { contentFromEarlierPass, videoContentOf } from "../domain/production-progress";
import { isTerminalItemStatus, toItemCheckpoint, toItemStatus } from "../domain/production-status";
import { findProductionItemForVideo } from "../repositories/production.repository";
import type { VideoProductionDto } from "../schemas/video-production.dto";
import { storyDraftArtifactSchema, storySceneArtifactSchema } from "@/server/script-draft/artifacts";
import { z } from "zod";
import { requireGenerationRun } from "@/features/videos/services/script-generation-run.service";

// Null for a video made by hand. The stored artifacts are shown only when they still match their fingerprints.
export async function getVideoProduction(videoId: string): Promise<VideoProductionDto | null> {
  const item = await findProductionItemForVideo(videoId);
  if (!item) return null;
  const status = toItemStatus(item.status);
  const checkpoint = toItemCheckpoint(item.checkpoint);
  const draft = z.union([storyDraftArtifactSchema, scriptDraftArtifactSchema]).safeParse(item.draftArtifactJson);
  const plan = z.union([storySceneArtifactSchema, scenePlanArtifactSchema]).safeParse(item.scenePlanArtifactJson);
  const generation = item.scriptGenerationRunId ? await requireGenerationRun(item.scriptGenerationRunId) : null;
  return {
    ...(generation
      ? { generationModels: { script: generation.settings.script, scene: generation.settings.scene } }
      : {}),
    productionId: item.batchId,
    status,
    checkpoint,
    inProgress: !isTerminalItemStatus(status),
    correction: item.aiCorrectionTarget ? (CORRECTION_LABELS[item.aiCorrectionTarget] ?? null) : null,
    earlierPass: item.video ? contentFromEarlierPass(checkpoint, videoContentOf(item.video)) : null,
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
