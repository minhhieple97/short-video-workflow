import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { framesForAudio } from "@/features/videos/domain/audio";
import { toCompositionProps } from "@/features/videos/domain/composition-props";
import { estimateNarrationSeconds, secondsToFrames } from "@/features/videos/domain/duration";
import { syllablesPerSecond } from "@/features/videos/domain/pace";
import { timedWordsSchema } from "@/features/videos/domain/word-timing";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as TtsRunner from "@/features/videos/services/tts-runner";
import type * as DbClient from "@/server/db/client";

import { FakeTtsProvider } from "../helpers/fakes/fake-tts-provider";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let videos: typeof VideoService;
let runner: typeof TtsRunner;

let videoId: string;
let sceneId: string;
let provider: FakeTtsProvider;

const NARRATION = "Vì sao bạn luôn bỏ cuộc sau ba ngày dù đã hứa với chính mình rất nhiều lần như vậy hả bạn?";

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  videos = await import("@/features/videos/services/video.service");
  runner = await import("@/features/videos/services/tts-runner");
}, 60_000);

afterAll(() => env.cleanup());

beforeEach(async () => {
  provider = new FakeTtsProvider();
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
  const video = await db.prisma.video.create({ data: { bookId: book.id, title: "Video" } });
  const scene = await db.prisma.videoScene.create({
    data: {
      videoId: video.id,
      order: 1,
      type: "HOOK",
      narration: NARRATION,
      onScreenText: "Vì sao bạn bỏ cuộc?",
      visualVariant: "HOOK_QUESTION",
      contentHash: "scene-hash",
    },
  });
  videoId = video.id;
  sceneId = scene.id;
});

const setPace = (pace: string) => db.prisma.video.update({ where: { id: videoId }, data: { pace } });
const voice = () => runner.runSceneTts({ sceneId, provider });
const sceneNow = () => db.prisma.videoScene.findUniqueOrThrow({ where: { id: sceneId } });
const assetOf = async () =>
  db.prisma.mediaAsset.findUniqueOrThrow({ where: { id: (await sceneNow()).audioAssetId ?? "" } });

describe("changing a video's pace", () => {
  const settings = (pace: "STANDARD" | "FASTER") => ({
    title: "Video",
    description: null,
    platformPreviewMode: null,
    minDurationSec: 30 as const,
    maxDurationSec: 60 as const,
    pace,
  });

  it("works the length of scenes without a voice out again at the new speed, and makes earlier renders outdated", async () => {
    await db.prisma.videoScene.update({
      where: { id: sceneId },
      data: { estimatedSeconds: 99, durationFrames: 99 },
    });
    const before = (await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptVersion;

    const detail = await videos.updateVideo(videoId, settings("FASTER"));

    const scene = await sceneNow();
    expect(detail.pace).toBe("FASTER");
    expect(scene.estimatedSeconds).toBe(estimateNarrationSeconds(NARRATION, syllablesPerSecond("FASTER")));
    expect(scene.estimatedSeconds).toBeLessThan(estimateNarrationSeconds(NARRATION));
    expect(scene.durationFrames).toBe(secondsToFrames(scene.estimatedSeconds ?? 0));
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptVersion).toBe(before + 1);
  });

  it("leaves a scene that already has a voice alone, and keeps the pace when none is given", async () => {
    await voice();
    const voiced = await sceneNow();

    const { pace: _unchanged, ...withoutPace } = settings("STANDARD");
    await setPace("FAST");
    const detail = await videos.updateVideo(videoId, withoutPace);

    expect(detail.pace).toBe("FAST");
    expect(await sceneNow()).toMatchObject({
      audioAssetId: voiced.audioAssetId,
      durationFrames: voiced.durationFrames,
    });
  });
});

describe("voice-over at the video's pace", () => {
  it("speaks at the pace's speed, pauses for its padding and records the speed it used", async () => {
    await setPace("FAST");

    await voice();

    expect(provider.requests.map((request) => request.speedPercent)).toEqual([15]);
    const asset = await assetOf();
    expect(asset.generationSettingsJson).toMatchObject({ speed: 15 });
    expect((await sceneNow()).durationFrames).toBe(framesForAudio(asset.durationMs ?? 0, 200));
  });

  it("makes the same narration shorter at a faster pace", async () => {
    await voice();
    const standard = (await assetOf()).durationMs ?? 0;
    await setPace("FASTER");
    await voice();

    expect((await assetOf()).durationMs ?? 0).toBeLessThan(standard);
  });

  it("shows a voice as stale once the pace changes, and clean again after it is made at the new speed", async () => {
    await voice();
    expect((await videos.getVideo(videoId)).staleVoiceSceneCount).toBe(0);

    await setPace("FASTER");
    expect((await videos.getVideo(videoId)).staleVoiceSceneCount).toBe(1);

    await voice();
    expect((await videos.getVideo(videoId)).staleVoiceSceneCount).toBe(0);
  });

  it("reuses the earlier clip when the pace goes back, and works the scene length out with the pause of the pace", async () => {
    await voice();
    const standardAsset = await assetOf();
    await setPace("FASTER");
    await voice();
    expect(provider.requests).toHaveLength(2);

    await setPace("STANDARD");
    const result = await voice();

    expect(result.cached).toBe(true);
    expect(provider.requests).toHaveLength(2);
    expect((await sceneNow()).audioAssetId).toBe(standardAsset.id);
    expect((await sceneNow()).durationFrames).toBe(framesForAudio(standardAsset.durationMs ?? 0, 300));
  });

  it("changes nothing for a video that never chose a pace", async () => {
    await voice();

    expect(provider.requests.map((request) => request.speedPercent)).toEqual([0]);
    expect((await videos.getVideo(videoId)).pace).toBe("STANDARD");
  });
});

describe("word timings of a generated voice", () => {
  it("keeps when each word is spoken with the clip, and the preview's captions follow the voice", async () => {
    await voice();

    const asset = await assetOf();
    const words = timedWordsSchema.parse(asset.wordBoundariesJson);
    expect(words).toHaveLength(NARRATION.split(/\s+/).length);
    expect(words.every((word) => word.endMs <= (asset.durationMs ?? 0))).toBe(true);

    const detail = await videos.getVideo(videoId);
    expect(detail.scenes[0]?.audio?.wordBoundaries).toEqual(words);
    expect(toCompositionProps(detail).scenes[0]?.karaoke).toBe(true);
  });

  it("stores no timings for a voice that gives none, and the captions are estimated", async () => {
    provider = new FakeTtsProvider({ boundaries: false });
    await voice();

    expect((await assetOf()).wordBoundariesJson).toBeNull();
    expect(toCompositionProps(await videos.getVideo(videoId)).scenes[0]?.karaoke).toBe(false);
  });
});
