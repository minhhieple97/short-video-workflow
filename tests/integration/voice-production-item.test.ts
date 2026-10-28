import fs from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Apply from "@/features/productions/services/scene-plan-apply.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as Voice from "@/features/productions/services/voice-production-item.service";
import type * as VoiceScenes from "@/features/productions/services/voice-video-scenes.service";
import type * as DbClient from "@/server/db/client";
import { createScenePlanArtifact } from "@/server/scene-plan/handoff";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";

import { SAMPLE_LESSON } from "../helpers/contracts/script-studio-provider-contract";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const FAKE_EDGE_TTS = path.join(import.meta.dirname, "../helpers/fake-edge-tts-audio.mjs");
const TOKEN = "worker-a";

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let apply: typeof Apply;
let productions: typeof ProductionRequest;
let voice: typeof Voice;
let voiceScenes: typeof VoiceScenes;

let itemId: string;
let videoId: string;

const counterFile = () => path.join(env.dataDir, "tts-counter.txt");
const synthesisCalls = () => (fs.existsSync(counterFile()) ? Number(fs.readFileSync(counterFile(), "utf8")) : 0);
const scenes = () => db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });
const checkpoint = async () => (await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).checkpoint;

beforeAll(async () => {
  env = setupTestEnvironment();
  Object.assign(process.env, { TTS_MODE: "edge-tts", EDGE_TTS_COMMAND: FAKE_EDGE_TTS });
  db = await import("@/server/db/client");
  claim = await import("@/features/productions/repositories/production-claim.repository");
  apply = await import("@/features/productions/services/scene-plan-apply.service");
  productions = await import("@/features/productions/services/production-request.service");
  voice = await import("@/features/productions/services/voice-production-item.service");
  voiceScenes = await import("@/features/productions/services/voice-video-scenes.service");
}, 60_000);

beforeEach(async () => {
  fs.rmSync(counterFile(), { force: true });
  process.env.FAKE_EDGE_TTS_COUNTER = counterFile();
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
    targetDurationSec: 60,
    extended: false,
  });
  itemId = production.items[0]?.id ?? "";
  videoId = production.items[0]?.videoId ?? "";
  await claim.claimProductionItem(itemId, TOKEN, 60_000);
  await db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint: "COMPILED" } });

  const draft = await new MockScriptStudioProvider().writeDraft({
    sources: [],
    lesson: SAMPLE_LESSON,
    targetDurationSec: 60,
    revisionNote: null,
  });
  const plan = await new MockScenePlanCompiler().compile({
    draft,
    lesson: SAMPLE_LESSON,
    targetDurationSec: 60,
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
});

afterEach(() => {
  for (const key of ["FAKE_EDGE_TTS_FAIL_ON", "FAKE_EDGE_TTS_LOG"]) delete process.env[key];
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("voiceProductionItem with the real voice-over path", () => {
  it("gives every scene its audio, one call per scene, then moves the item to VOICED", async () => {
    const outcome = await voice.voiceProductionItem({ itemId, claimToken: TOKEN });

    expect(outcome).toEqual({ status: "VOICED", pending: 6, synthesized: 6, reused: 0 });
    expect(synthesisCalls()).toBe(6);
    const all = await scenes();
    expect(all.every((scene) => scene.audioAssetId !== null && (scene.durationFrames ?? 0) > 0)).toBe(true);
    expect(await checkpoint()).toBe("VOICED");
  });

  it("speaks the scenes in story order", async () => {
    process.env.FAKE_EDGE_TTS_LOG = path.join(env.dataDir, "tts-log.txt");

    await voice.voiceProductionItem({ itemId, claimToken: TOKEN });

    const spoken = fs.readFileSync(process.env.FAKE_EDGE_TTS_LOG, "utf8").trim().split("\n");
    expect(spoken).toEqual((await scenes()).map((scene) => scene.narration));
  });

  it("resumes at the first scene without audio after a failure, without speaking the earlier ones again", async () => {
    const all = await scenes();
    process.env.FAKE_EDGE_TTS_FAIL_ON = all[3]?.narration ?? "";

    await expect(voice.voiceProductionItem({ itemId, claimToken: TOKEN })).rejects.toThrow();

    expect(synthesisCalls()).toBe(4);
    expect((await scenes()).map((scene) => scene.audioAssetId !== null)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(await checkpoint()).toBe("APPLIED");

    delete process.env.FAKE_EDGE_TTS_FAIL_ON;
    fs.rmSync(counterFile());
    const outcome = await voice.voiceProductionItem({ itemId, claimToken: TOKEN });

    expect(outcome).toEqual({ status: "VOICED", pending: 3, synthesized: 3, reused: 0 });
    expect(synthesisCalls()).toBe(3);
    expect(await checkpoint()).toBe("VOICED");
  });

  it("reuses stored speech when the input has not changed, so no new call is made", async () => {
    await voice.voiceProductionItem({ itemId, claimToken: TOKEN });
    const all = await scenes();
    await db.prisma.videoScene.updateMany({
      where: { id: { in: [all[1]?.id ?? "", all[4]?.id ?? ""] } },
      data: { audioAssetId: null },
    });
    fs.rmSync(counterFile());

    const summary = await voiceScenes.voiceVideoScenes({ videoId });

    expect(summary).toEqual({ pending: 2, synthesized: 0, reused: 2 });
    expect(synthesisCalls()).toBe(0);
    expect((await scenes()).every((scene) => scene.audioAssetId !== null)).toBe(true);
  });

  it("does nothing when the item is already voiced", async () => {
    await voice.voiceProductionItem({ itemId, claimToken: TOKEN });
    fs.rmSync(counterFile());

    await expect(voice.voiceProductionItem({ itemId, claimToken: TOKEN })).resolves.toEqual({
      status: "ALREADY_VOICED",
    });
    expect(synthesisCalls()).toBe(0);
  });

  it("refuses a caller that does not hold the item, and one that is too early", async () => {
    await expect(voice.voiceProductionItem({ itemId, claimToken: "intruder" })).rejects.toMatchObject({
      code: "PRODUCTION_CLAIM_LOST",
    });
    expect(synthesisCalls()).toBe(0);

    await db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint: "COMPILED" } });
    await expect(voice.voiceProductionItem({ itemId, claimToken: TOKEN })).rejects.toMatchObject({
      code: "PRODUCTION_STEP_OUT_OF_ORDER",
      details: { checkpoint: "COMPILED" },
    });
  });

  it("reports an unknown item as not found", async () => {
    await expect(voice.voiceProductionItem({ itemId: "missing", claimToken: TOKEN })).rejects.toMatchObject({
      httpStatus: 404,
    });
  });
});

describe("voiceVideoScenes", () => {
  const spy = () => {
    const order: string[] = [];
    let running = 0;
    let peak = 0;
    const synthesize: VoiceScenes.SynthesizeScene = async ({ sceneId }) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(sceneId);
      await db.prisma.videoScene.update({ where: { id: sceneId }, data: { audioAssetId: `asset-${sceneId}` } });
      running -= 1;
      return { sceneId, cached: false };
    };
    return { synthesize, order, peak: () => peak };
  };

  it("never runs two syntheses at once and goes through the scenes in order", async () => {
    const { synthesize, order, peak } = spy();

    await voiceScenes.voiceVideoScenes({ videoId, synthesize });

    expect(peak()).toBe(1);
    expect(order).toEqual((await scenes()).map((scene) => scene.id));
  });

  it("skips hidden scenes and scenes that already have audio", async () => {
    const all = await scenes();
    await db.prisma.videoScene.update({ where: { id: all[0]?.id ?? "" }, data: { audioAssetId: "existing" } });
    await db.prisma.videoScene.update({ where: { id: all[2]?.id ?? "" }, data: { hidden: true } });
    const { synthesize, order } = spy();

    const summary = await voiceScenes.voiceVideoScenes({ videoId, synthesize });

    expect(summary.pending).toBe(4);
    expect(order).toEqual([all[1], all[3], all[4], all[5]].map((scene) => scene?.id));
  });

  it("stops before the next scene once cancelled, keeping the audio already made", async () => {
    const controller = new AbortController();
    const { synthesize, order } = spy();

    await expect(
      voiceScenes.voiceVideoScenes({
        videoId,
        synthesize,
        signal: controller.signal,
        onProgress: (done) => {
          if (done === 2) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "JOB_CANCELLED" });

    expect(order).toHaveLength(2);
    expect((await scenes()).filter((scene) => scene.audioAssetId !== null)).toHaveLength(2);
  });

  it("reports progress after each scene", async () => {
    const { synthesize } = spy();
    const progress: [number, number][] = [];

    await voiceScenes.voiceVideoScenes({
      videoId,
      synthesize,
      onProgress: (done, pending) => void progress.push([done, pending]),
    });

    expect(progress).toEqual([1, 2, 3, 4, 5, 6].map((done) => [done, 6]));
  });
});
