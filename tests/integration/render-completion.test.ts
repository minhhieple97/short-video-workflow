import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Apply from "@/features/productions/services/scene-plan-apply.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as RenderRepository from "@/features/videos/repositories/render.repository";
import type * as Runner from "@/features/videos/services/render-runner";
import type * as Snapshots from "@/features/videos/services/render-snapshot.service";
import type * as DbClient from "@/server/db/client";
import type { MediaProbe } from "@/server/media/ffprobe";

import { seedVoicedVideo } from "../helpers/voiced-video-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let snapshots: typeof Snapshots;
let renders: typeof RenderRepository;
let runner: typeof Runner;
let deps: { db: typeof DbClient; claim: typeof Claim; apply: typeof Apply; productions: typeof ProductionRequest };

let videoId: string;

const probeFor = (width: number, height: number, durationMs = 10_000): MediaProbe => ({
  durationMs,
  sizeBytes: 4,
  video: { codec: "h264", width, height, fps: 30 },
  audio: { codec: "aac" },
});

// A stand-in renderer that writes a file where the real one would, optionally failing after it has.
const fakeDeps = (
  options: { fail?: Error; probe?: MediaProbe; onRender?: () => void } = {},
): Runner.RenderDeps & { renderCalls: () => number } => {
  let calls = 0;
  return {
    renderCalls: () => calls,
    renderVideo: async ({ outputFile }) => {
      calls += 1;
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, "mp4 bytes");
      options.onRender?.();
      if (options.fail) throw options.fail;
    },
    probe: async () => options.probe ?? probeFor(1080, 1920),
  };
};

async function queueRender(quality: "DRAFT" | "FINAL") {
  const { snapshot, hash } = await snapshots.captureRenderSnapshot(videoId, quality);
  for (const audio of snapshot.audio) {
    fs.mkdirSync(path.dirname(path.join(env.dataDir, audio.path)), { recursive: true });
    fs.writeFileSync(path.join(env.dataDir, audio.path), "audio");
  }
  const id = `render-${Math.random()}`;
  const outputPath = `videos/${videoId}/renders/${id}.mp4`;
  await renders.createRenderRecord({
    id,
    videoId,
    scriptVersion: snapshot.video.scriptVersion,
    outputPath,
    qualityPreset: quality,
    width: snapshot.render.width,
    height: snapshot.render.height,
    fps: snapshot.render.fps,
    snapshotJson: snapshot,
    snapshotHash: hash,
  });
  return { id, file: path.join(env.dataDir, outputPath) };
}

const record = (id: string) => db.prisma.renderRecord.findUniqueOrThrow({ where: { id } });
const renderAssets = () => db.prisma.mediaAsset.count({ where: { videoId, kind: "RENDER" } });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  snapshots = await import("@/features/videos/services/render-snapshot.service");
  renders = await import("@/features/videos/repositories/render.repository");
  runner = await import("@/features/videos/services/render-runner");
  deps = {
    db,
    claim: await import("@/features/productions/repositories/production-claim.repository"),
    apply: await import("@/features/productions/services/scene-plan-apply.service"),
    productions: await import("@/features/productions/services/production-request.service"),
  };
}, 60_000);

beforeEach(async () => {
  ({ videoId } = await seedVoicedVideo(deps));
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("runRender completion", () => {
  it("records a FINAL render as complete together with the intent to archive it", async () => {
    const { id, file } = await queueRender("FINAL");

    await expect(runner.runRender({ renderId: id, onProgress: async () => undefined }, fakeDeps())).resolves.toEqual({
      renderId: id,
      durationMs: 10_000,
    });

    const done = await record(id);
    expect(done).toMatchObject({ status: "COMPLETED", durationMs: 10_000 });
    expect(done.archiveIntentAt).not.toBeNull();
    expect(done.archiveIntentAt?.getTime()).toBe(done.completedAt?.getTime());
    expect(fs.existsSync(file)).toBe(true);
    expect(await renderAssets()).toBe(1);
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).latestRenderId).toBe(id);
  });

  it("does not ask for a draft render to be archived", async () => {
    const { id } = await queueRender("DRAFT");

    await runner.runRender(
      { renderId: id, onProgress: async () => undefined },
      fakeDeps({ probe: probeFor(720, 1280) }),
    );

    expect(await record(id)).toMatchObject({ status: "COMPLETED", archiveIntentAt: null });
  });

  it("keeps a completed MP4 and its archive intent when reporting the final progress fails", async () => {
    const { id, file } = await queueRender("FINAL");
    const reported: number[] = [];

    await expect(
      runner.runRender(
        {
          renderId: id,
          onProgress: async (percent) => {
            reported.push(percent);
            if (percent === 100) throw new Error("Redis went away");
          },
        },
        fakeDeps(),
      ),
    ).resolves.toMatchObject({ renderId: id });

    expect(reported).toContain(100);
    expect(await record(id)).toMatchObject({ status: "COMPLETED", errorMessage: null });
    expect((await record(id)).archiveIntentAt).not.toBeNull();
    expect(fs.existsSync(file)).toBe(true);
    expect(await renderAssets()).toBe(1);
  });

  it("removes the partial file and records no archive intent when rendering fails", async () => {
    const { id, file } = await queueRender("FINAL");

    await expect(
      runner.runRender(
        { renderId: id, onProgress: async () => undefined },
        fakeDeps({ fail: new Error("chromium crashed") }),
      ),
    ).rejects.toThrow("chromium crashed");

    expect(await record(id)).toMatchObject({
      status: "FAILED",
      archiveIntentAt: null,
      errorMessage: "chromium crashed",
    });
    expect(fs.existsSync(file)).toBe(false);
    expect(await renderAssets()).toBe(0);
  });

  it("rejects an MP4 that fails verification, removing it and recording no archive intent", async () => {
    const { id, file } = await queueRender("FINAL");

    await expect(
      runner.runRender({ renderId: id, onProgress: async () => undefined }, fakeDeps({ probe: probeFor(1920, 1080) })),
    ).rejects.toMatchObject({ code: "RENDER_VERIFICATION_FAILED" });

    expect(await record(id)).toMatchObject({ status: "FAILED", archiveIntentAt: null });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rejects a FINAL MP4 longer than the preset", async () => {
    const { id } = await queueRender("FINAL");

    await expect(
      runner.runRender(
        { renderId: id, onProgress: async () => undefined },
        fakeDeps({ probe: probeFor(1080, 1920, 61_000) }),
      ),
    ).rejects.toMatchObject({ code: "RENDER_VERIFICATION_FAILED" });

    expect((await record(id)).archiveIntentAt).toBeNull();
  });

  it("marks a render cancelled while it runs and removes its file", async () => {
    const { id, file } = await queueRender("FINAL");
    const controller = new AbortController();

    await expect(
      runner.runRender(
        { renderId: id, signal: controller.signal, onProgress: async () => undefined },
        fakeDeps({ fail: new Error("aborted"), onRender: () => controller.abort() }),
      ),
    ).rejects.toMatchObject({ code: "JOB_CANCELLED" });

    expect(await record(id)).toMatchObject({ status: "CANCELLED", archiveIntentAt: null });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("does not render again or touch the file when the render is already complete", async () => {
    const { id, file } = await queueRender("FINAL");
    await runner.runRender({ renderId: id, onProgress: async () => undefined }, fakeDeps());
    const intent = (await record(id)).archiveIntentAt;
    const again = fakeDeps({ fail: new Error("must not run") });

    await expect(runner.runRender({ renderId: id, onProgress: async () => undefined }, again)).resolves.toMatchObject({
      renderId: id,
    });

    expect(again.renderCalls()).toBe(0);
    expect(fs.existsSync(file)).toBe(true);
    expect((await record(id)).archiveIntentAt).toEqual(intent);
  });

  it("fails clearly, without a silent scene, when an audio file of the snapshot has gone missing", async () => {
    const { id, file } = await queueRender("FINAL");
    const { snapshot } = await snapshots.captureRenderSnapshot(videoId, "FINAL");
    fs.rmSync(path.join(env.dataDir, snapshot.audio[2]?.path ?? ""));

    await expect(
      runner.runRender({ renderId: id, onProgress: async () => undefined }, fakeDeps()),
    ).rejects.toMatchObject({
      code: "RENDER_AUDIO_MISSING",
    });

    expect(await record(id)).toMatchObject({ status: "FAILED", archiveIntentAt: null });
    expect(fs.existsSync(file)).toBe(false);
  });
});
