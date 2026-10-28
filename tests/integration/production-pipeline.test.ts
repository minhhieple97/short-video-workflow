import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Pipeline from "@/features/productions/services/production-pipeline.service";
import type * as ProductionRender from "@/features/productions/services/production-render.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as DbClient from "@/server/db/client";
import type * as RunProductionItem from "@/worker/processors/run-production-item";
import { IntegrationError } from "@/server/integrations/integration-error";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";
import type { ScenePlan, ScenePlanCompiler, ScenePlanRequest } from "@/server/scene-plan/scene-plan-compiler";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";
import type { ScriptStudioProvider, WriteDraftRequest } from "@/server/script-studio/script-studio-provider";
import { JobCancelledError } from "@/shared/errors";
import type { ProcessorContext } from "@/worker/processors/types";

import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const TOKEN = "worker-a";
const SHORT = "Ngắn.";

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let pipeline: typeof Pipeline;
let productionRender: typeof ProductionRender;
let productions: typeof ProductionRequest;
let processor: typeof RunProductionItem;

let itemId: string;
let videoId: string;

interface Calls {
  drafts: WriteDraftRequest[];
  compiles: ScenePlanRequest[];
}

// Providers that count what they are asked and can be told to misbehave.
function makeDeps(
  options: {
    compileFails?: (attempt: number) => Error | null;
    draftFails?: (attempt: number) => Error | null;
    shortenWhenRevised?: boolean;
    afterCompile?: () => Promise<void>;
    bodyFrames?: number;
  } = {},
) {
  const calls: Calls = { drafts: [], compiles: [] };
  const studio = new MockScriptStudioProvider();
  const mock = new MockScenePlanCompiler();
  const scriptStudio: ScriptStudioProvider = {
    id: "counting-studio",
    ensureSource: (request, callOptions) => studio.ensureSource(request, callOptions),
    detectChapters: (request, callOptions) => studio.detectChapters(request, callOptions),
    extractLessons: (request, callOptions) => studio.extractLessons(request, callOptions),
    writeDraft: async (request, callOptions) => {
      calls.drafts.push(request);
      const failure = options.draftFails?.(calls.drafts.length);
      if (failure) throw failure;
      return studio.writeDraft(request, callOptions);
    },
  };
  const compiler: ScenePlanCompiler = {
    id: "counting-compiler",
    compile: async (request, callOptions): Promise<ScenePlan> => {
      calls.compiles.push(request);
      const failure = options.compileFails?.(calls.compiles.length);
      if (failure) throw failure;
      const plan = await mock.compile(request, callOptions);
      await options.afterCompile?.();
      if (!options.shortenWhenRevised || !request.revisionNote) return plan;
      return {
        hook: { ...plan.hook, narration: SHORT },
        scenes: plan.scenes.map((scene) => ({ ...scene, narration: SHORT })),
      };
    },
  };
  const deps: Pipeline.PipelineDeps = {
    scriptStudio,
    compiler,
    resolveSources: async () => [],
    synthesize: async ({ sceneId }) => {
      const scene = await db.prisma.videoScene.findUniqueOrThrow({ where: { id: sceneId } });
      const asset = await db.prisma.mediaAsset.create({
        data: {
          videoId,
          sceneId,
          kind: "VOICEOVER",
          path: `a-${sceneId}.mp3`,
          mimeType: "audio/mpeg",
          fileSizeBytes: 1,
          durationMs: 1000,
        },
      });
      const frames = scene.type === "HOOK" ? 90 : scene.narration === SHORT ? 60 : (options.bodyFrames ?? 150);
      await db.prisma.videoScene.update({
        where: { id: sceneId },
        data: { audioAssetId: asset.id, durationFrames: frames },
      });
      return { sceneId, cached: false };
    },
  };
  return { deps, calls };
}

const item = () => db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } });
const run = (deps: Pipeline.PipelineDeps, token = TOKEN, signal?: AbortSignal) =>
  pipeline.runProductionPipeline({ itemId, claimToken: token, signal, deps });
const finishRender = (status: string, errorMessage: string | null = null) =>
  db.prisma.renderRecord.updateMany({ where: { videoId }, data: { status, errorMessage } });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  claim = await import("@/features/productions/repositories/production-claim.repository");
  pipeline = await import("@/features/productions/services/production-pipeline.service");
  productionRender = await import("@/features/productions/services/production-render.service");
  productions = await import("@/features/productions/services/production-request.service");
  processor = await import("@/worker/processors/run-production-item");
}, 60_000);

beforeEach(async () => {
  ({ itemId, videoId } = await seedProduction({ db, productions }));
  await claim.claimProductionItem(itemId, TOKEN, 600_000);
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("runProductionPipeline", () => {
  it("goes from nothing to a queued FINAL render in one run, then finishes once the render is done", async () => {
    const { deps, calls } = makeDeps();

    const first = await run(deps);

    expect(first).toEqual({ kind: "DEFER", retryAfterMs: pipeline.RENDER_POLL_MS });
    expect(await item()).toMatchObject({ checkpoint: "READY" });
    const record = await db.prisma.renderRecord.findFirstOrThrow({ where: { videoId } });
    expect(record).toMatchObject({ qualityPreset: "FINAL", status: "QUEUED" });
    expect(record.snapshotJson).not.toBeNull();
    expect((await item()).renderId).toBe(record.id);
    const intent = await db.prisma.jobDispatch.findFirstOrThrow({
      where: { jobRecord: { entityId: record.id } },
      include: { jobRecord: true },
    });
    expect(intent.jobRecord.jobType).toBe("RENDER_VIDEO");
    expect(calls.drafts).toHaveLength(1);
    expect(calls.compiles).toHaveLength(1);

    await finishRender("COMPLETED");
    expect(await run(deps)).toEqual({ kind: "COMPLETED" });
    expect((await item()).checkpoint).toBe("RENDERED");
    expect(calls.drafts).toHaveLength(1);
    expect(calls.compiles).toHaveLength(1);
  });

  it("keeps waiting while the render is queued or rendering, without queueing another", async () => {
    const { deps } = makeDeps();
    await run(deps);

    await finishRender("RENDERING");
    expect(await run(deps)).toEqual({ kind: "DEFER", retryAfterMs: pipeline.RENDER_POLL_MS });

    expect(await db.prisma.renderRecord.count({ where: { videoId } })).toBe(1);
  });

  it("fails the item with the render's reason when the render fails or is cancelled", async () => {
    const { deps } = makeDeps();
    await run(deps);

    await finishRender("FAILED", "chromium crashed");

    expect(await run(deps)).toEqual({ kind: "FAILED", code: "RENDER_FAILED", message: "chromium crashed" });
  });

  it("resumes after the last finished step instead of starting again", async () => {
    const first = makeDeps({ compileFails: () => new IntegrationError("X", "outage", "TRANSIENT") });
    expect(await run(first.deps)).toMatchObject({ kind: "DEFER" });
    expect((await item()).checkpoint).toBe("DRAFTED");

    const second = makeDeps();
    await run(second.deps);

    expect(first.calls.drafts).toHaveLength(1);
    expect(second.calls.drafts).toHaveLength(0);
    expect(second.calls.compiles).toHaveLength(1);
    expect((await item()).checkpoint).toBe("READY");
  });

  it("defers a temporary failure with a growing pause, and fails after a bounded number of tries", async () => {
    const { deps } = makeDeps({ compileFails: () => new IntegrationError("OUTAGE", "dịch vụ tạm lỗi", "TRANSIENT") });

    const pauses: number[] = [];
    for (let attempt = 1; attempt <= pipeline.MAX_TRANSIENT_RETRIES; attempt += 1) {
      const outcome = await run(deps);
      expect(outcome.kind).toBe("DEFER");
      if (outcome.kind === "DEFER") pauses.push(outcome.retryAfterMs);
    }
    const last = await run(deps);

    expect(pauses).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(last).toMatchObject({ kind: "FAILED", code: "OUTAGE" });
    expect(last.kind === "FAILED" && last.message).toContain("đã thử lại 5 lần");
  });

  it("uses the pause a quota error asks for, and does not count steps that succeed", async () => {
    const { deps } = makeDeps({
      compileFails: (attempt) =>
        attempt === 1 ? new IntegrationError("QUOTA", "hết hạn mức", "QUOTA", { retryAfterMs: 3_600_000 }) : null,
    });

    expect(await run(deps)).toEqual({ kind: "DEFER", retryAfterMs: 3_600_000 });
    expect((await item()).transientRetries).toBe(1);

    await run(deps);

    expect((await item()).transientRetries).toBe(0);
  });

  it("fails at once for a rejected request or a login problem, which waiting cannot cure", async () => {
    const rejected = makeDeps({ draftFails: () => new IntegrationError("BAD", "bị từ chối", "REJECTED") });
    expect(await run(rejected.deps)).toMatchObject({ kind: "FAILED", code: "BAD" });
    expect((await item()).transientRetries).toBe(0);

    const auth = makeDeps({ draftFails: () => new IntegrationError("LOGIN", "chưa đăng nhập", "AUTH") });
    expect(await run(auth.deps)).toMatchObject({ kind: "FAILED", code: "LOGIN" });
  });

  it("spends the one correction when the compiler's output is rejected, and asks again with the note", async () => {
    const { deps, calls } = makeDeps({
      compileFails: (attempt) =>
        attempt === 1 ? new IntegrationError("INVALID_AI_OUTPUT", "sai cấu trúc", "REJECTED") : null,
    });

    const outcome = await run(deps);

    expect(outcome.kind).toBe("DEFER");
    expect(calls.compiles).toHaveLength(2);
    expect(calls.compiles[0]?.revisionNote).toBeNull();
    expect(calls.compiles[1]?.revisionNote).toContain("đúng cấu trúc");
    expect(await item()).toMatchObject({ aiCorrectionTarget: "SCENE_COMPILER", checkpoint: "READY" });
  });

  it("sends a draft the script studio got wrong back to it once, with the note", async () => {
    const { deps, calls } = makeDeps({
      draftFails: (attempt) =>
        attempt === 1 ? new IntegrationError("DRAFT_INVALID", "sai mạch kể", "REJECTED") : null,
    });

    const outcome = await run(deps);

    expect(outcome.kind).toBe("DEFER");
    expect(calls.drafts).toHaveLength(2);
    expect(calls.drafts[0]?.revisionNote).toBeNull();
    expect(calls.drafts[1]?.revisionNote).toContain("mạch kể");
    expect(calls.compiles[0]?.revisionNote).toBeNull();
    expect(await item()).toMatchObject({ aiCorrectionTarget: "SCRIPT_STUDIO", checkpoint: "READY" });
  });

  it("fails with the reason when the corrected attempt is rejected too", async () => {
    const { deps, calls } = makeDeps({
      compileFails: () => new IntegrationError("INVALID_AI_OUTPUT", "vẫn sai", "REJECTED"),
    });

    const outcome = await run(deps);

    expect(calls.compiles).toHaveLength(2);
    expect(outcome).toMatchObject({ kind: "FAILED", code: "PRODUCTION_CORRECTION_EXHAUSTED" });
  });

  it("corrects a video that does not fit its preset by shortening it, never by raising the preset", async () => {
    const { deps, calls } = makeDeps({ bodyFrames: 400, shortenWhenRevised: true });

    const outcome = await run(deps);

    expect(outcome.kind).toBe("DEFER");
    expect(calls.compiles).toHaveLength(2);
    expect(calls.compiles[1]?.revisionNote).toContain("không tăng preset");
    expect(calls.compiles[1]?.revisionNote).toContain("không đọc nhanh hơn");
    expect(await item()).toMatchObject({ aiCorrectionTarget: "SCENE_COMPILER", checkpoint: "READY" });
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).targetDurationSec).toBe(60);
    const scenes = await db.prisma.videoScene.findMany({ where: { videoId } });
    expect(scenes.every((scene) => scene.narration === SHORT)).toBe(true);
  });

  it("fails when the video still does not fit after its one correction", async () => {
    const { deps } = makeDeps({ bodyFrames: 400 });

    const outcome = await run(deps);

    expect(outcome).toMatchObject({ kind: "FAILED", code: "PRODUCTION_CORRECTION_EXHAUSTED" });
    expect(await db.prisma.renderRecord.count({ where: { videoId } })).toBe(0);
  });

  it("stops before the next step once the item is cancelled", async () => {
    const { deps, calls } = makeDeps({
      afterCompile: async () => {
        await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "CANCELLED" } });
      },
    });

    const outcome = await run(deps);

    expect(outcome).toEqual({ kind: "CANCELLED" });
    expect((await item()).checkpoint).toBe("COMPILED");
    expect(calls.compiles).toHaveLength(1);
    expect(await db.prisma.videoScene.count({ where: { videoId } })).toBe(0);
    expect(await db.prisma.renderRecord.count({ where: { videoId } })).toBe(0);
  });

  it("refuses a caller that does not hold the item", async () => {
    await expect(run(makeDeps().deps, "intruder")).rejects.toMatchObject({ code: "PRODUCTION_CLAIM_LOST" });
    await expect(
      pipeline.runProductionStep({ itemId, claimToken: "intruder", deps: makeDeps().deps }),
    ).rejects.toMatchObject({ code: "PRODUCTION_CLAIM_LOST" });
    expect((await item()).checkpoint).toBe("NONE");
  });

  it("rethrows a cancelled job instead of recording a failure", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(run(makeDeps().deps, TOKEN, controller.signal)).rejects.toBeInstanceOf(JobCancelledError);
    expect((await item()).checkpoint).toBe("NONE");
  });
});

describe("settleProductionRun", () => {
  const settle = (outcome: Pipeline.RunOutcome) => pipeline.settleProductionRun({ itemId, claimToken: TOKEN, outcome });

  it("completes the item and frees the claim", async () => {
    await settle({ kind: "COMPLETED" });

    expect(await item()).toMatchObject({ status: "COMPLETED", claimToken: null, errorCode: null });
    expect((await item()).completedAt).not.toBeNull();
  });

  it("records why an item failed", async () => {
    await settle({ kind: "FAILED", code: "RENDER_FAILED", message: "chromium crashed" });

    expect(await item()).toMatchObject({
      status: "FAILED",
      errorCode: "RENDER_FAILED",
      errorMessage: "chromium crashed",
      claimToken: null,
    });
  });

  it("parks a deferred item as WAITING so it can be claimed again later", async () => {
    await settle({ kind: "DEFER", retryAfterMs: 1000 });

    expect(await item()).toMatchObject({ status: "WAITING", claimToken: null, completedAt: null });
    expect(await claim.claimProductionItem(itemId, "next", 60_000)).toBe(true);
  });

  it("keeps an item cancelled while it was held cancelled, whatever the holder reports", async () => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "CANCELLED" } });

    expect(await claim.releaseProductionClaim(itemId, TOKEN, "WAITING")).toBe(true);

    expect(await item()).toMatchObject({ status: "CANCELLED", claimToken: null });
    expect((await item()).completedAt).not.toBeNull();
    expect(await claim.claimProductionItem(itemId, "next", 60_000)).toBe(false);
  });

  it("leaves a cancelled item cancelled", async () => {
    await settle({ kind: "CANCELLED" });

    expect(await item()).toMatchObject({ status: "CANCELLED", claimToken: null });
  });
});

describe("queueFinalRender", () => {
  it("reuses the render that already exists for the same script version instead of making another", async () => {
    const { deps } = makeDeps();
    await run(deps);
    const first = (await item()).renderId ?? "";

    const again = await productionRender.queueFinalRender(videoId);

    expect(again).toEqual({ renderId: first, reused: true });
    expect(await db.prisma.renderRecord.count({ where: { videoId } })).toBe(1);

    await finishRender("COMPLETED");
    expect(await productionRender.queueFinalRender(videoId)).toEqual({ renderId: first, reused: true });
  });
});

describe("processRunProductionItem", () => {
  const runJob = (signal = new AbortController().signal) =>
    processor.processRunProductionItem({
      job: { data: { jobRecordId: "job-1", itemId } },
      jobRecordId: "job-1",
      signal,
      reportProgress: async () => {},
    } as unknown as ProcessorContext);

  // Brings the item to READY with a queued render, then lets go of it the way a deferred run does.
  async function parkAtRender() {
    await run(makeDeps().deps);
    await pipeline.settleProductionRun({ itemId, claimToken: TOKEN, outcome: { kind: "DEFER", retryAfterMs: 1 } });
  }

  it("skips an item another run holds", async () => {
    expect(await runJob()).toEqual({ itemId, skipped: true });
    expect((await item()).claimToken).toBe(TOKEN);
  });

  it("ends the job as deferred while the render is pending, leaving the item WAITING", async () => {
    await parkAtRender();

    expect(await runJob()).toEqual({ deferred: true, retryAfterMs: pipeline.RENDER_POLL_MS });
    expect(await item()).toMatchObject({ status: "WAITING", claimToken: null });
  });

  it("completes the item once its render is done", async () => {
    await parkAtRender();
    await finishRender("COMPLETED");

    expect(await runJob()).toEqual({ itemId, outcome: "COMPLETED" });
    expect(await item()).toMatchObject({ status: "COMPLETED", checkpoint: "RENDERED", claimToken: null });
  });

  it("fails the job and the item with the same reason", async () => {
    await parkAtRender();
    await finishRender("FAILED", "chromium crashed");

    await expect(runJob()).rejects.toMatchObject({ code: "RENDER_FAILED", message: "chromium crashed" });
    expect(await item()).toMatchObject({ status: "FAILED", errorCode: "RENDER_FAILED", claimToken: null });
  });

  it("hands a cancelled job's item back as PENDING so it can resume", async () => {
    await parkAtRender();
    const controller = new AbortController();
    controller.abort();

    await expect(runJob(controller.signal)).rejects.toBeInstanceOf(JobCancelledError);
    expect(await item()).toMatchObject({ status: "PENDING", claimToken: null, checkpoint: "READY" });
  });
});
