import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Apply from "@/features/productions/services/scene-plan-apply.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as Readiness from "@/features/productions/services/production-readiness.service";
import type * as RenderService from "@/features/videos/services/render.service";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as DbClient from "@/server/db/client";
import { createScenePlanArtifact } from "@/server/scene-plan/handoff";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";

import { SAMPLE_LESSON } from "../helpers/contracts/script-studio-provider-contract";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";
import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const TOKEN = "worker-a";

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let apply: typeof Apply;
let productions: typeof ProductionRequest;
let readiness: typeof Readiness;
let renders: typeof RenderService;
let videos: typeof VideoService;

let itemId: string;
let videoId: string;

async function attachAudio(frames: (index: number) => number = (index) => (index === 0 ? 90 : 180)) {
  const all = await db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });
  for (const [index, scene] of all.entries()) {
    const asset = await db.prisma.mediaAsset.create({
      data: {
        videoId,
        sceneId: scene.id,
        kind: "VOICEOVER",
        path: `a${index}.mp3`,
        mimeType: "audio/mpeg",
        fileSizeBytes: 1,
        durationMs: 2000,
      },
    });
    await db.prisma.videoScene.update({
      where: { id: scene.id },
      data: { audioAssetId: asset.id, durationFrames: frames(index) },
    });
  }
}

const video = () => db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
const checkpoint = async () => (await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).checkpoint;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  claim = await import("@/features/productions/repositories/production-claim.repository");
  apply = await import("@/features/productions/services/scene-plan-apply.service");
  productions = await import("@/features/productions/services/production-request.service");
  readiness = await import("@/features/productions/services/production-readiness.service");
  renders = await import("@/features/videos/services/render.service");
  videos = await import("@/features/videos/services/video.service");
}, 60_000);

beforeEach(async () => {
  ({ itemId, videoId } = await seedProduction({ db, productions }));
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
  await db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint: "VOICED" } });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("markProductionItemReady", () => {
  it("records readiness for the exact script version, moves the item to READY and never marks the video approved", async () => {
    await attachAudio();
    const before = await video();

    await expect(readiness.markProductionItemReady({ itemId, claimToken: TOKEN })).resolves.toEqual({
      status: "READY",
    });

    const after = await video();
    expect(after.autoReadyScriptVersion).toBe(before.scriptVersion);
    expect(after).toMatchObject({ status: "NEEDS_REVIEW", approvedScriptVersion: null });
    expect(await checkpoint()).toBe("READY");
  });

  it("lets a FINAL render pass the script gate afterwards, and stops letting it after any later change", async () => {
    await attachAudio();
    await readiness.markProductionItemReady({ itemId, claimToken: TOKEN });

    const ready = await videos.getVideo(videoId);
    expect(ready.autoReady).toBe(true);
    expect(renders.preflightFor(ready, "FINAL").blocking).toEqual([]);

    await db.prisma.video.update({ where: { id: videoId }, data: { scriptVersion: { increment: 1 } } });
    const changed = await videos.getVideo(videoId);
    expect(changed.autoReady).toBe(false);
    expect(renders.preflightFor(changed, "FINAL").blocking.map((issue) => issue.code)).toContain("SCRIPT_NOT_APPROVED");
  });

  it("is not ready while a scene has no audio, and changes nothing", async () => {
    await attachAudio();
    const first = await db.prisma.videoScene.findFirstOrThrow({ where: { videoId }, orderBy: { order: "desc" } });
    await db.prisma.videoScene.update({ where: { id: first.id }, data: { audioAssetId: null } });

    const outcome = await readiness.markProductionItemReady({ itemId, claimToken: TOKEN });

    expect(outcome).toMatchObject({ status: "NOT_READY", issues: [{ code: "AUDIO_NOT_READY" }] });
    expect((await video()).autoReadyScriptVersion).toBeNull();
    expect(await checkpoint()).toBe("VOICED");
  });

  it("is not ready when the real narration makes the hook longer than 4 seconds", async () => {
    await attachAudio((index) => (index === 0 ? 121 : 180));

    const outcome = await readiness.markProductionItemReady({ itemId, claimToken: TOKEN });

    expect(outcome).toMatchObject({ status: "NOT_READY" });
    expect(outcome.status === "NOT_READY" && outcome.issues.map((issue) => issue.code)).toContain("HOOK_TOO_LONG");
    expect(await checkpoint()).toBe("VOICED");
  });

  it("is not ready when the voiced video runs past its preset, and does not raise the preset", async () => {
    await attachAudio((index) => (index === 0 ? 90 : 400));

    const outcome = await readiness.markProductionItemReady({ itemId, claimToken: TOKEN });

    expect(outcome.status === "NOT_READY" && outcome.issues.map((issue) => issue.code)).toContain("OVER_TARGET");
    expect((await video()).targetDurationSec).toBe(60);
  });

  it("is not ready when a lesson snapshot has lost its source excerpt", async () => {
    await attachAudio();
    const link = await db.prisma.videoLesson.findFirstOrThrow({ where: { videoId } });
    await db.prisma.videoLesson.update({
      where: { id: link.id },
      data: { lessonSnapshotJson: { ...(link.lessonSnapshotJson as object), sources: [] } },
    });

    const outcome = await readiness.markProductionItemReady({ itemId, claimToken: TOKEN });

    expect(outcome).toMatchObject({ status: "NOT_READY", issues: [{ code: "SOURCE_MISSING" }] });
  });

  it("does nothing the second time and keeps the recorded version", async () => {
    await attachAudio();
    await readiness.markProductionItemReady({ itemId, claimToken: TOKEN });
    const recorded = (await video()).autoReadyScriptVersion;

    await expect(readiness.markProductionItemReady({ itemId, claimToken: TOKEN })).resolves.toEqual({
      status: "ALREADY_READY",
    });

    expect((await video()).autoReadyScriptVersion).toBe(recorded);
  });

  it("refuses before voicing is done, and a caller that does not hold the item", async () => {
    await attachAudio();
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint: "APPLIED" } });
    await expect(readiness.markProductionItemReady({ itemId, claimToken: TOKEN })).rejects.toMatchObject({
      code: "PRODUCTION_STEP_OUT_OF_ORDER",
      details: { checkpoint: "APPLIED" },
    });

    await db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint: "VOICED" } });
    await expect(readiness.markProductionItemReady({ itemId, claimToken: "intruder" })).rejects.toMatchObject({
      code: "PRODUCTION_CLAIM_LOST",
    });
  });

  it("records nothing when the script changed after it was checked", async () => {
    await attachAudio();
    const { markAutoReady } = await import("@/features/videos/repositories/video.repository");
    const stale = (await video()).scriptVersion;
    await db.prisma.video.update({ where: { id: videoId }, data: { scriptVersion: { increment: 1 } } });

    expect(await markAutoReady(videoId, stale)).toBe(false);
    expect((await video()).autoReadyScriptVersion).toBeNull();
  });

  it("leaves the human approval path exactly as it was", async () => {
    await attachAudio();
    await db.prisma.video.update({ where: { id: videoId }, data: { status: "APPROVED", approvedScriptVersion: 2 } });

    const detail = await videos.getVideo(videoId);

    expect(detail.autoReady).toBe(false);
    expect(renders.preflightFor(detail, "FINAL").blocking.map((issue) => issue.code)).not.toContain(
      "SCRIPT_NOT_APPROVED",
    );
  });
});
