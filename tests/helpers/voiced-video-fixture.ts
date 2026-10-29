import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Apply from "@/features/productions/services/scene-plan-apply.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as DbClient from "@/server/db/client";
import { createScenePlanArtifact } from "@/server/scene-plan/handoff";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";

import { SAMPLE_LESSON } from "./contracts/script-studio-provider-contract";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";
import { seedProduction } from "./production-fixture";

const TOKEN = "fixture-worker";

// A video with the story scenes applied and an audio asset on every scene, as it is after the voicing step. The hook
// lasts 90 frames and every other scene 180, so the video (33 s) sits inside a 30–60 second range.
export async function seedVoicedVideo(deps: {
  db: typeof DbClient;
  claim: typeof Claim;
  apply: typeof Apply;
  productions: typeof ProductionRequest;
}): Promise<{ bookId: string; itemId: string; videoId: string }> {
  const { db, claim, apply, productions } = deps;
  const { bookId, itemId, videoId } = await seedProduction({ db, productions });
  await claim.claimProductionItem(itemId, TOKEN, 60_000);
  await db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint: "COMPILED" } });

  const draft = await new MockScriptStudioProvider().writeDraft({
    sources: [],
    lesson: SAMPLE_LESSON,
    range: { minDurationSec: 30, maxDurationSec: 60 },
    pace: "STANDARD" as const,
    revisionNote: null,
  });
  const plan = await new MockScenePlanCompiler().compile({
    draft,
    lesson: SAMPLE_LESSON,
    targetDurationSec: 60,
    range: { minDurationSec: 30, maxDurationSec: 60 },
    pace: "STANDARD" as const,
    revisionNote: null,
  });
  await apply.applyScenePlan({
    itemId,
    claimToken: TOKEN,
    artifact: createScenePlanArtifact({
      plan,
      draftFingerprint: "a".repeat(64),
      promptVersion: "scene-plan-v1",
      targetDurationSec: 60,
    }),
  });

  const scenes = await db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });
  for (const [index, scene] of scenes.entries()) {
    const asset = await db.prisma.mediaAsset.create({
      data: {
        videoId,
        sceneId: scene.id,
        kind: "VOICEOVER",
        path: `videos/${videoId}/audio/hash-${index}.mp3`,
        mimeType: "audio/mpeg",
        fileSizeBytes: 10,
        durationMs: 2000,
        contentHash: `hash-${index}`,
        provider: "edge-tts",
      },
    });
    await db.prisma.videoScene.update({
      where: { id: scene.id },
      data: { audioAssetId: asset.id, durationFrames: index === 0 ? 90 : 180 },
    });
  }
  const video = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
  await db.prisma.video.update({ where: { id: videoId }, data: { autoReadyScriptVersion: video.scriptVersion } });
  return { bookId, itemId, videoId };
}
