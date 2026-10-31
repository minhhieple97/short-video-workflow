import { readTaskExecution } from "@/server/ai/cli-task/task-files";
import { storyDraftArtifactSchema, storySceneArtifactSchema } from "@/server/script-draft/artifacts";

import type { ScriptSourceViewDto } from "../schemas/script-source-view.dto";
import { requireVideo } from "./video.service";
import { toVideoDetail } from "./video-mapper";

export async function getScriptSourceView(videoId: string): Promise<ScriptSourceViewDto | null> {
  const record = await requireVideo(videoId);
  const run = "generationRun" in record ? record.generationRun : null;
  if (!run) return null;
  const video = toVideoDetail(record);
  if (!video.generation || !video.cast) return null;
  const artifact = storyDraftArtifactSchema.parse(run.draftArtifactJson);
  const sceneArtifact = storySceneArtifactSchema.parse(run.scenePlanArtifactJson);
  const plan = sceneArtifact.plan;
  const accepted = [plan.hook, ...plan.scenes];
  // The task folders are named after the artifacts' input hashes (see `writeGenerationDraft`, `compileGenerationPlan`).
  const [draftExecution, sceneExecution] = await Promise.all([
    readTaskExecution(`script-draft-${artifact.inputHash}`),
    readTaskExecution(`scene-plan-${sceneArtifact.inputHash}`),
  ]);
  const edited =
    video.scenes.length !== accepted.length ||
    video.scenes.some((scene, index) => {
      const original = accepted[index];
      return (
        !original ||
        scene.hidden ||
        scene.narration !== original.narration ||
        scene.onScreenText !== original.onScreenText
      );
    });
  return {
    generation: video.generation,
    cast: video.cast,
    edited,
    actualModels: { script: draftExecution?.primaryModel ?? null, scene: sceneExecution?.primaryModel ?? null },
    logic: artifact.draft.logic,
    draft: artifact.draft.beats.map((beat) => ({
      beat: beat.beat,
      narration: beat.narration,
      illustrative: beat.illustrative,
      sources: beat.sourceExcerpts.map((source) => ({ page: source.page, text: source.text })),
    })),
  };
}
