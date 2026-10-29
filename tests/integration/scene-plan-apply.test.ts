import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Apply from "@/features/productions/services/scene-plan-apply.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as DbClient from "@/server/db/client";
import { createScenePlanArtifact } from "@/server/scene-plan/handoff";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";
import type { ScenePlan } from "@/server/scene-plan/scene-plan-compiler";

import { SAMPLE_BOOK, SAMPLE_LESSON } from "../helpers/contracts/script-studio-provider-contract";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let apply: typeof Apply;
let productions: typeof ProductionRequest;
let videos: typeof VideoService;

let itemId: string;
let videoId: string;
const TOKEN = "worker-a";
const SOURCES = { lesson: SAMPLE_LESSON, book: SAMPLE_BOOK };

async function planFor(variant = "") {
  const draft = await new MockScriptStudioProvider().writeDraft({
    sources: [],
    lesson: { ...SAMPLE_LESSON, title: `${SAMPLE_LESSON.title}${variant}` },
    range: { minDurationSec: 30, maxDurationSec: 60 },
    pace: "STANDARD" as const,
    storyAngle: "PEAK_FIRST" as const,
    revisionNote: null,
  });
  const plan: ScenePlan = await new MockScenePlanCompiler().compile({
    draft,
    lesson: SAMPLE_LESSON,
    book: SAMPLE_BOOK,
    targetDurationSec: 60,
    range: { minDurationSec: 30, maxDurationSec: 60 },
    pace: "STANDARD" as const,
    revisionNote: null,
  });
  return createScenePlanArtifact({
    plan,
    draftFingerprint: "a".repeat(64),
    promptVersion: "scene-plan-v1",
    targetDurationSec: 60,
  });
}

async function setCheckpoint(checkpoint: string) {
  await db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint } });
}

const scenes = () => db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  claim = await import("@/features/productions/repositories/production-claim.repository");
  apply = await import("@/features/productions/services/scene-plan-apply.service");
  productions = await import("@/features/productions/services/production-request.service");
  videos = await import("@/features/videos/services/video.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  const book = await db.prisma.book.create({
    data: {
      title: "Sách",
      sourceFilePath: "books/x/original.md",
      sourceFileName: "x.md",
      sourceHash: `hash-${Math.random()}`,
      sourceFormat: "md",
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
  const chapter = await db.prisma.chapter.create({
    data: { bookId: book.id, order: 1, title: "Chương", contentHash: "c", analysisStatus: "ANALYZED", content: "x" },
  });
  const lesson = await db.prisma.lesson.create({
    data: {
      bookId: book.id,
      title: "Bài",
      summary: "s",
      principle: "p",
      realLifeScenario: "r",
      commonMistake: "m",
      betterApproach: "b",
      actionableStep: "a",
      origin: "AI",
      sources: { create: { chapterId: chapter.id, sourceExcerpt: "Trích đoạn." } },
    },
  });
  const { production } = await productions.requestProduction({
    bookId: book.id,
    lessonIds: [lesson.id],
    idempotencyKey: `key-${Math.random()}`,
    minDurationSec: 30,
    maxDurationSec: 60,
  });
  itemId = production.items[0]?.id ?? "";
  videoId = production.items[0]?.videoId ?? "";
  await claim.claimProductionItem(itemId, TOKEN, 60_000);
  await setCheckpoint("COMPILED");
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("applyScenePlan", () => {
  it("stores the title, caption and hashtags Claude wrote with the plan", async () => {
    const artifact = await planFor();

    await apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact });

    const { publish } = await videos.getVideo(videoId);
    expect(publish).toMatchObject({ origin: "AI", outdated: false });
    expect(publish?.caption).toContain(`Sách: ${SAMPLE_BOOK.title} – ${SAMPLE_BOOK.author}`);
    const row = await db.prisma.videoPublishMetadata.findUniqueOrThrow({ where: { videoId } });
    expect(row.promptVersion).toBe(artifact.promptVersion);
  });

  it("still applies a plan stored before plans carried a caption", async () => {
    const { plan } = await planFor();
    const legacy = createScenePlanArtifact({
      plan: { ...plan, publish: undefined },
      draftFingerprint: "a".repeat(64),
      promptVersion: "scene-plan-v6",
      targetDurationSec: 60,
    });

    await expect(
      apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact: JSON.parse(JSON.stringify(legacy)) }),
    ).resolves.toBe("APPLIED");
    expect((await scenes()).length).toBe(6);
    expect((await videos.getVideo(videoId)).publish).toBeNull();
  });

  it("applies the scenes but drops a caption with a number found in no source", async () => {
    const { plan } = await planFor();
    const artifact = createScenePlanArtifact({
      plan: {
        ...plan,
        publish: { title: "Một tiêu đề", caption: "90% người bỏ lỡ điều này.", hashtags: ["a", "b", "c"] },
      },
      draftFingerprint: "a".repeat(64),
      promptVersion: "scene-plan-v7",
      targetDurationSec: 60,
    });

    await expect(apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact })).resolves.toBe("APPLIED");
    expect((await scenes()).length).toBe(6);
    expect((await videos.getVideo(videoId)).publish).toBeNull();
  });

  it("puts a HOOK and the story scenes on the video, and moves the item to APPLIED", async () => {
    const artifact = await planFor();

    await expect(apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact })).resolves.toBe("APPLIED");

    expect((await scenes()).map((scene) => [scene.order, scene.type])).toEqual([
      [0, "HOOK"],
      [1, "SITUATION"],
      [2, "COMMON_MISTAKE"],
      [3, "KEY_TAKEAWAY"],
      [4, "BETTER_APPROACH"],
      [5, "ACTION_STEP"],
    ]);
    const [hook] = await scenes();
    expect(hook).toMatchObject({
      title: "Hook",
      hookVariant: artifact.plan.hook.variant,
      narration: artifact.plan.hook.narration,
    });
    expect((await videos.getVideo(videoId)).scenes.map((scene) => scene.illustration)).toEqual([
      artifact.plan.hook.illustration,
      ...artifact.plan.scenes.map((scene) => scene.illustration),
    ]);
    const video = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(video.hookOptionsJson).toEqual([artifact.plan.hook]);
    expect(video).toMatchObject({ scriptVersion: 2, status: "NEEDS_REVIEW" });
    expect(await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      checkpoint: "APPLIED",
      appliedPlanFingerprint: artifact.fingerprint,
    });
  });

  it("changes nothing when the same plan is applied again, so the audio on the scenes survives a replay", async () => {
    const artifact = await planFor();
    await apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact });
    const before = await scenes();
    const asset = await db.prisma.mediaAsset.create({
      data: {
        videoId,
        sceneId: before[1]?.id,
        kind: "VOICEOVER",
        path: "x.mp3",
        mimeType: "audio/mpeg",
        fileSizeBytes: 1,
        durationMs: 1000,
      },
    });
    await db.prisma.videoScene.update({
      where: { id: before[1]?.id ?? "" },
      data: { audioAssetId: asset.id, durationFrames: 99 },
    });
    const versionBefore = (await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptVersion;

    await expect(apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact })).resolves.toBe(
      "ALREADY_APPLIED",
    );

    const after = await scenes();
    expect(after.map((scene) => scene.id)).toEqual(before.map((scene) => scene.id));
    expect(after[1]).toMatchObject({ audioAssetId: asset.id, durationFrames: 99 });
    expect(await db.prisma.mediaAsset.count({ where: { videoId } })).toBe(1);
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptVersion).toBe(versionBefore);
  });

  it("applies once when several callers race, and the rest see it as already applied", async () => {
    const artifact = await planFor();

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact })),
    );

    expect(outcomes.filter((outcome) => outcome === "APPLIED")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "ALREADY_APPLIED")).toHaveLength(4);
    expect(await scenes()).toHaveLength(6);
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptVersion).toBe(2);
  });

  it("refuses a caller that does not hold the item and leaves the video alone", async () => {
    await expect(
      apply.applyScenePlan({ ...SOURCES, itemId, claimToken: "intruder", artifact: await planFor() }),
    ).rejects.toMatchObject({
      code: "PRODUCTION_CLAIM_LOST",
      httpStatus: 409,
    });

    expect(await scenes()).toHaveLength(0);
    expect((await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).checkpoint).toBe("COMPILED");
  });

  it("refuses to apply before the plan has been compiled", async () => {
    await setCheckpoint("DRAFTED");

    await expect(
      apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact: await planFor() }),
    ).rejects.toMatchObject({
      code: "PRODUCTION_STEP_OUT_OF_ORDER",
      details: { checkpoint: "DRAFTED" },
    });
    expect(await scenes()).toHaveLength(0);
  });

  it("refuses a different plan once one is applied, until the checkpoint is deliberately moved back", async () => {
    const first = await planFor();
    await apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact: first });
    const before = await scenes();

    await expect(
      apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact: await planFor(" khác") }),
    ).rejects.toMatchObject({
      code: "PRODUCTION_STEP_OUT_OF_ORDER",
      details: { checkpoint: "APPLIED" },
    });

    expect((await scenes()).map((scene) => scene.id)).toEqual(before.map((scene) => scene.id));
  });

  it("refuses an artifact whose content no longer matches its fingerprint", async () => {
    const artifact = await planFor();
    const tampered = {
      ...artifact,
      plan: { ...artifact.plan, hook: { ...artifact.plan.hook, narration: "Bị sửa tay" } },
    };

    await expect(
      apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact: tampered }),
    ).rejects.toMatchObject({
      code: "INVALID_SCENE_PLAN_ARTIFACT",
      httpStatus: 422,
    });
    expect(await scenes()).toHaveLength(0);
  });

  it("reports an item without a video and an unknown item distinctly", async () => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { videoId: null } });
    await expect(
      apply.applyScenePlan({ ...SOURCES, itemId, claimToken: TOKEN, artifact: await planFor() }),
    ).rejects.toMatchObject({
      code: "PRODUCTION_ITEM_HAS_NO_VIDEO",
    });
    await expect(
      apply.applyScenePlan({ ...SOURCES, itemId: "missing", claimToken: TOKEN, artifact: await planFor() }),
    ).rejects.toMatchObject({
      code: "PRODUCTION_ITEM_NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("the editing lock while a production owns the video", () => {
  it.each(["PENDING", "RUNNING", "WAITING"])("blocks manual changes while the item is %s", async (status) => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status } });

    await expect(videos.assertScriptNotGenerating(videoId)).rejects.toMatchObject({
      code: "VIDEO_IN_PRODUCTION",
      httpStatus: 409,
    });
    await expect(videos.deleteVideo(videoId)).rejects.toMatchObject({ code: "VIDEO_IN_PRODUCTION" });
    expect(await db.prisma.video.count({ where: { id: videoId } })).toBe(1);
  });

  it.each(["COMPLETED", "FAILED", "CANCELLED"])("lets the user edit again once the item is %s", async (status) => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status } });

    await expect(videos.assertScriptNotGenerating(videoId)).resolves.toBeUndefined();
  });

  it("does not lock a video that no production owns", async () => {
    const book = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    const free = await db.prisma.video.create({ data: { bookId: book.bookId, title: "Tự tạo" } });

    await expect(videos.assertScriptNotGenerating(free.id)).resolves.toBeUndefined();
  });
});
