import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Apply from "@/features/productions/services/scene-plan-apply.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import { runPreflight } from "@/features/videos/domain/preflight";
import { toPreflightInput } from "@/features/videos/domain/render-snapshot";
import type * as RenderRepository from "@/features/videos/repositories/render.repository";
import type * as Snapshots from "@/features/videos/services/render-snapshot.service";
import type * as DbClient from "@/server/db/client";
import { createDraftArtifact } from "@/server/scene-plan/handoff";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";

import { SAMPLE_LESSON } from "../helpers/contracts/script-studio-provider-contract";

import { seedVoicedVideo } from "../helpers/voiced-video-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let snapshots: typeof Snapshots;
let renders: typeof RenderRepository;
let deps: { db: typeof DbClient; claim: typeof Claim; apply: typeof Apply; productions: typeof ProductionRequest };

let videoId: string;
let itemId: string;

async function queueRender(quality: "DRAFT" | "FINAL" = "FINAL") {
  const { snapshot, hash } = await snapshots.captureRenderSnapshot(videoId, quality);
  const id = `render-${Math.random()}`;
  const record = await renders.createRenderRecord({
    id,
    videoId,
    scriptVersion: snapshot.video.scriptVersion,
    outputPath: `videos/${videoId}/renders/${id}.mp4`,
    qualityPreset: quality,
    width: snapshot.render.width,
    height: snapshot.render.height,
    fps: snapshot.render.fps,
    snapshotJson: snapshot,
    snapshotHash: hash,
  });
  return { record, snapshot, hash };
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  snapshots = await import("@/features/videos/services/render-snapshot.service");
  renders = await import("@/features/videos/repositories/render.repository");
  deps = {
    db,
    claim: await import("@/features/productions/repositories/production-claim.repository"),
    apply: await import("@/features/productions/services/scene-plan-apply.service"),
    productions: await import("@/features/productions/services/production-request.service"),
  };
}, 60_000);

beforeEach(async () => {
  ({ videoId, itemId } = await seedVoicedVideo(deps));
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("captureRenderSnapshot", () => {
  it("carries the current title, caption and hashtags, and leaves out a set written for an earlier script", async () => {
    const { snapshot } = await snapshots.captureRenderSnapshot(videoId, "FINAL");
    expect(snapshot.publish?.hashtags).toEqual(expect.arrayContaining(["sachhay", "booktok"]));
    expect(Object.keys(snapshot.publish ?? {}).sort()).toEqual(["caption", "hashtags", "title"]);

    await db.prisma.videoScene.updateMany({
      where: { videoId, type: "SITUATION" },
      data: { narration: "Một tình huống khác hẳn." },
    });
    const { snapshot: later } = await snapshots.captureRenderSnapshot(videoId, "FINAL");
    expect(later.publish).toBeUndefined();
  });

  it("records the scenes in order with their audio, the lesson sources and the gate state", async () => {
    const { snapshot, hash } = await snapshots.captureRenderSnapshot(videoId, "FINAL");

    expect(snapshot.scenes.map((scene) => [scene.order, scene.type])).toEqual([
      [0, "HOOK"],
      [1, "SITUATION"],
      [2, "COMMON_MISTAKE"],
      [3, "KEY_TAKEAWAY"],
      [4, "BETTER_APPROACH"],
      [5, "ACTION_STEP"],
    ]);
    expect(snapshot.audio).toHaveLength(6);
    expect(snapshot.audio[0]).toMatchObject({
      path: `videos/${videoId}/audio/hash-0.mp3`,
      contentHash: "hash-0",
      provider: "edge-tts",
    });
    expect(snapshot.lessons).toEqual([
      {
        lessonId: expect.any(String),
        title: "Bài",
        sources: [{ chapterId: expect.any(String), chapterTitle: "Chương", excerpt: "Trích đoạn." }],
      },
    ]);
    expect(snapshot.video).toMatchObject({ targetDurationSec: 60, status: "NEEDS_REVIEW", autoReady: true });
    expect(snapshot.video.scriptVersion).toBeGreaterThan(1);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks the made-up scenarios: the draft's illustrative beats, or the situation when there is no draft", async () => {
    const illustrativeTypes = async () =>
      (await snapshots.captureRenderSnapshot(videoId, "FINAL")).snapshot.scenes
        .filter((scene) => scene.illustrative)
        .map((scene) => scene.type);
    expect(await illustrativeTypes()).toEqual(["SITUATION"]);

    const draft = await new MockScriptStudioProvider().writeDraft({
      sources: [],
      lesson: SAMPLE_LESSON,
      range: { minDurationSec: 30, maxDurationSec: 60 },
      pace: "STANDARD" as const,
      revisionNote: null,
    });
    const storeDraft = (illustrative: string[]) =>
      db.prisma.productionItem.update({
        where: { id: itemId },
        data: {
          draftArtifactJson: createDraftArtifact({
            draft: {
              ...draft,
              beats: draft.beats.map((beat) => ({ ...beat, illustrative: illustrative.includes(beat.beat) })),
            },
            lessonContentHash: null,
            targetDurationSec: 60,
          }),
        },
      });

    await storeDraft(["MISTAKE", "RESOLUTION"]);
    expect(await illustrativeTypes()).toEqual(["COMMON_MISTAKE", "BETTER_APPROACH"]);
    await storeDraft([]);
    expect(await illustrativeTypes()).toEqual([]);
  });

  it("records the render size for the quality asked: 1080x1920 for FINAL, 720x1280 for DRAFT", async () => {
    expect((await snapshots.captureRenderSnapshot(videoId, "FINAL")).snapshot.render).toEqual({
      quality: "FINAL",
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect((await snapshots.captureRenderSnapshot(videoId, "DRAFT")).snapshot.render).toEqual({
      quality: "DRAFT",
      width: 720,
      height: 1280,
      fps: 30,
    });
  });

  it("refuses a visible scene whose audio no longer exists, but ignores one on a hidden scene", async () => {
    const scenes = await db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });
    await db.prisma.videoScene.update({ where: { id: scenes[2]?.id ?? "" }, data: { audioAssetId: "gone" } });

    await expect(snapshots.captureRenderSnapshot(videoId, "FINAL")).rejects.toMatchObject({
      code: "RENDER_AUDIO_MISSING",
      details: { sceneIds: [scenes[2]?.id] },
    });

    await db.prisma.videoScene.update({ where: { id: scenes[2]?.id ?? "" }, data: { hidden: true } });
    await expect(snapshots.captureRenderSnapshot(videoId, "FINAL")).resolves.toBeDefined();
  });
});

describe("resolveRenderSnapshot", () => {
  it("returns the stored snapshot untouched when the video is edited after the render was requested", async () => {
    const { record, snapshot } = await queueRender();
    const scenes = await db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });

    await db.prisma.videoScene.update({
      where: { id: scenes[1]?.id ?? "" },
      data: { narration: "Đã sửa sau khi xếp hàng", durationFrames: 999 },
    });
    await db.prisma.mediaAsset.deleteMany({ where: { videoId } });
    await db.prisma.video.update({
      where: { id: videoId },
      data: { scriptVersion: { increment: 5 }, targetDurationSec: 30, title: "Đổi tên" },
    });
    const link = await db.prisma.videoLesson.findFirstOrThrow({ where: { videoId } });
    await db.prisma.videoLesson.update({
      where: { id: link.id },
      data: { lessonSnapshotJson: { ...(link.lessonSnapshotJson as object), title: "Bài khác", sources: [] } },
    });

    const resolved = await snapshots.resolveRenderSnapshot(record);

    expect(resolved).toEqual(snapshot);
    expect(resolved.scenes[1]?.narration).not.toBe("Đã sửa sau khi xếp hàng");
    expect(resolved.audio).toHaveLength(6);
    expect(resolved.video).toMatchObject({ title: expect.not.stringContaining("Đổi tên"), targetDurationSec: 60 });
  });

  it("is judged by the preflight on the captured facts even when the live video has since become invalid", async () => {
    const { record } = await queueRender();
    const first = await db.prisma.videoScene.findFirstOrThrow({ where: { videoId }, orderBy: { order: "asc" } });
    await db.prisma.videoScene.update({ where: { id: first.id }, data: { durationFrames: 400 } });

    const resolved = await snapshots.resolveRenderSnapshot(record);

    expect(runPreflight(toPreflightInput(resolved), "FINAL").blocking).toEqual([]);
  });

  it("refuses a stored snapshot whose content no longer matches its hash", async () => {
    const { record, snapshot } = await queueRender();
    const tampered = await db.prisma.renderRecord.update({
      where: { id: record.id },
      data: { snapshotJson: { ...snapshot, video: { ...snapshot.video, title: "Bị sửa tay" } } },
    });

    await expect(snapshots.resolveRenderSnapshot(tampered)).rejects.toMatchObject({ code: "RENDER_SNAPSHOT_CORRUPT" });
  });

  it("refuses a stored snapshot that is no longer valid JSON for its schema", async () => {
    const { record } = await queueRender();
    const broken = await db.prisma.renderRecord.update({
      where: { id: record.id },
      data: { snapshotJson: { schemaVersion: "other" } },
    });

    await expect(snapshots.resolveRenderSnapshot(broken)).rejects.toMatchObject({ code: "RENDER_SNAPSHOT_CORRUPT" });
  });

  it("captures and stores a snapshot for a render queued before snapshots existed, then keeps that one", async () => {
    const legacy = await renders.createRenderRecord({
      id: `legacy-${Math.random()}`,
      videoId,
      scriptVersion: 1,
      outputPath: "videos/x/renders/legacy.mp4",
      qualityPreset: "DRAFT",
      width: 720,
      height: 1280,
      fps: 30,
    });
    expect(legacy.snapshotJson).toBeNull();

    const first = await snapshots.resolveRenderSnapshot(legacy);
    const scenes = await db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });
    await db.prisma.videoScene.update({
      where: { id: scenes[0]?.id ?? "" },
      data: { narration: "Sửa sau khi đã lưu" },
    });
    const stored = await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: legacy.id } });
    const second = await snapshots.resolveRenderSnapshot(stored);

    expect(first.render.quality).toBe("DRAFT");
    expect(stored.snapshotHash).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("never replaces a snapshot that is already stored", async () => {
    const { record, snapshot, hash } = await queueRender();

    await renders.saveRenderSnapshotIfMissing(
      record.id,
      { ...snapshot, capturedAt: "2030-01-01T00:00:00.000Z" },
      "f".repeat(64),
    );

    const stored = await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(stored.snapshotHash).toBe(hash);
    expect(stored.snapshotJson).toEqual(snapshot);
  });
});
