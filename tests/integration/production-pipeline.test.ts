import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Pipeline from "@/features/productions/services/production-pipeline.service";
import type * as ProductionRender from "@/features/productions/services/production-render.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import { Prisma } from "@/generated/prisma/client";
import { pickStoryAngle } from "@/features/videos/domain/story-angle";
import type * as DbClient from "@/server/db/client";
import { IntegrationError } from "@/server/integrations/integration-error";
import { JobCancelledError } from "@/shared/errors";

import { createCountingDeps, SHORT_NARRATION, type CountingDepsOptions } from "../helpers/counting-pipeline-deps";
import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const TOKEN = "worker-a";

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let pipeline: typeof Pipeline;
let productionRender: typeof ProductionRender;
let productions: typeof ProductionRequest;

let itemId: string;
let videoId: string;

const makeDeps = (options: CountingDepsOptions = {}) => createCountingDeps(db, () => videoId, options);

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
}, 60_000);

beforeEach(async () => {
  await db.prisma.providerCooldown.deleteMany();
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

    expect(await run(deps)).toEqual({
      kind: "FAILED",
      code: "RENDER_FAILED",
      message: "chromium crashed",
      stage: "Render bản cuối",
    });
  });

  it("hands the item to the lane of each step instead of running a step that is not its lane's", async () => {
    const { deps, calls } = makeDeps();
    const inLane = (lane: Pipeline.RunProductionPipelineInput["lane"]) =>
      pipeline.runProductionPipeline({ itemId, claimToken: TOKEN, deps, lane });

    // The draft is NotebookLM's step; asked in the Claude lane, nothing runs.
    expect(await inLane("claude")).toEqual({ kind: "HANDOFF", lane: "notebooklm" });
    expect(await item()).toMatchObject({ checkpoint: "NONE" });
    expect(calls.drafts).toHaveLength(0);

    expect(await inLane("notebooklm")).toEqual({ kind: "HANDOFF", lane: "claude" });
    expect((await item()).checkpoint).toBe("DRAFTED");
    expect(calls.drafts).toHaveLength(1);

    expect(await inLane("claude")).toEqual({ kind: "HANDOFF", lane: "general" });
    expect((await item()).checkpoint).toBe("COMPILED");
    expect(calls.compiles).toHaveLength(1);

    expect(await inLane("general")).toEqual({ kind: "HANDOFF", lane: "voice" });
    expect((await item()).checkpoint).toBe("APPLIED");

    expect(await inLane("voice")).toEqual({ kind: "HANDOFF", lane: "general" });
    expect((await item()).checkpoint).toBe("VOICED");

    expect(await inLane("general")).toEqual({ kind: "DEFER", retryAfterMs: pipeline.RENDER_POLL_MS });
    expect((await item()).checkpoint).toBe("READY");
  });

  it("releases a handed-over item as waiting to be queued, not parked", async () => {
    const { deps } = makeDeps();
    const outcome = await pipeline.runProductionPipeline({ itemId, claimToken: TOKEN, deps, lane: "claude" });

    await pipeline.settleProductionRun({ itemId, claimToken: TOKEN, outcome });

    expect(await item()).toMatchObject({ status: "PENDING", claimToken: null });
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

  it("answers a draft request it has answered before from the cache, without asking the script studio again", async () => {
    const first = makeDeps({ compileFails: () => new IntegrationError("X", "outage", "TRANSIENT") });
    await run(first.deps);
    const saved = (await item()).draftArtifactJson;
    // As if the worker had died after the script studio answered but before the draft was kept with the item.
    await db.prisma.productionItem.update({
      where: { id: itemId },
      data: { checkpoint: "NONE", draftArtifactJson: Prisma.DbNull },
    });

    const second = makeDeps();
    await run(second.deps);

    expect(first.calls.drafts).toHaveLength(1);
    expect(second.calls.drafts).toHaveLength(0);
    expect((await item()).draftArtifactJson).toEqual(saved);
    expect((await item()).checkpoint).toBe("READY");
  });

  it("ignores a cached draft that no longer passes the draft contract and asks again", async () => {
    const first = makeDeps({ compileFails: () => new IntegrationError("X", "outage", "TRANSIENT") });
    await run(first.deps);
    await db.prisma.scriptDraftCache.updateMany({ data: { draftJson: JSON.stringify({ beats: [] }) } });
    await db.prisma.productionItem.update({
      where: { id: itemId },
      data: { checkpoint: "NONE", draftArtifactJson: Prisma.DbNull },
    });

    const second = makeDeps();
    await run(second.deps);

    expect(second.calls.drafts).toHaveLength(1);
    expect((await item()).checkpoint).toBe("READY");
  });

  it("does not reuse a draft once the request differs (a correction note, another preset)", async () => {
    const first = makeDeps({ compileFails: () => new IntegrationError("X", "outage", "TRANSIENT") });
    await run(first.deps);
    await db.prisma.productionItem.update({
      where: { id: itemId },
      data: {
        checkpoint: "NONE",
        draftArtifactJson: Prisma.DbNull,
        aiCorrectionTarget: "SCRIPT_STUDIO",
        aiCorrectionNote: "Giữ đúng trích đoạn.",
      },
    });

    const second = makeDeps();
    await run(second.deps);

    expect(second.calls.drafts).toHaveLength(1);
    expect(second.calls.drafts[0]?.revisionNote).toBe("Giữ đúng trích đoạn.");
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
    expect(await item()).toMatchObject({ transientRetries: 0, errorCode: "QUOTA", errorMessage: "hết hạn mức" });

    await run(deps);

    expect(await item()).toMatchObject({ transientRetries: 0, errorCode: null, errorMessage: null });
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

  it("draws the story angle from the batch and the item's position, and keeps it for the correction", async () => {
    const { deps, calls } = makeDeps({ proposeSec: (attempt) => (attempt === 1 ? 90 : 45) });

    await run(deps);

    const { batchId, position } = await item();
    const expected = pickStoryAngle(batchId, position);
    expect(calls.drafts).toHaveLength(2);
    expect(calls.drafts.map((draft) => draft.storyAngle)).toEqual([expected, expected]);
  });

  it("tells neighbouring items of a batch differently, and uses every angle once in each run of six", async () => {
    const { itemIds } = await seedProduction({ db, productions, lessonCount: 7 });
    const { deps, calls } = makeDeps();

    for (const id of itemIds) {
      await claim.claimProductionItem(id, TOKEN, 600_000);
      expect(await pipeline.runProductionStep({ itemId: id, claimToken: TOKEN, deps })).toEqual({ kind: "CONTINUE" });
    }

    const angles = calls.drafts.map((draft) => draft.storyAngle);
    expect(angles).toHaveLength(7);
    expect(new Set(angles.slice(0, 6)).size).toBe(6);
    for (const [index, angle] of angles.entries()) expect(angle).not.toBe(angles[index - 1]);
  });

  it("reuses a cached draft for the same angle but writes a new one when the lesson is told another way", async () => {
    const draftStep = (deps: Pipeline.PipelineDeps) => pipeline.runProductionStep({ itemId, claimToken: TOKEN, deps });
    const startAgain = (position?: number) =>
      db.prisma.productionItem.update({
        where: { id: itemId },
        data: { checkpoint: "NONE", draftArtifactJson: Prisma.DbNull, ...(position === undefined ? {} : { position }) },
      });

    const first = makeDeps();
    await draftStep(first.deps);
    const { batchId, position } = await item();
    expect(first.calls.drafts).toHaveLength(1);

    await startAgain();
    const sameAngle = makeDeps();
    await draftStep(sameAngle.deps);
    expect(sameAngle.calls.drafts).toHaveLength(0);

    await startAgain(position + 1);
    const otherAngle = makeDeps();
    await draftStep(otherAngle.deps);
    expect(otherAngle.calls.drafts.map((draft) => draft.storyAngle)).toEqual([pickStoryAngle(batchId, position + 1)]);
  });

  it("fails with the reason when the corrected attempt is rejected too", async () => {
    const { deps, calls } = makeDeps({
      compileFails: () => new IntegrationError("INVALID_AI_OUTPUT", "vẫn sai", "REJECTED"),
    });

    const outcome = await run(deps);

    expect(calls.compiles).toHaveLength(2);
    expect(outcome).toMatchObject({ kind: "FAILED", code: "PRODUCTION_CORRECTION_EXHAUSTED" });
  });

  it("puts the length the draft proposes, and why, on the video and compiles to it", async () => {
    const { deps, calls } = makeDeps({ proposeSec: () => 45 });

    await run(deps);

    expect(calls.drafts[0]?.range).toEqual({ minDurationSec: 30, maxDurationSec: 60 });
    expect(calls.compiles[0]).toMatchObject({
      targetDurationSec: 45,
      range: { minDurationSec: 30, maxDurationSec: 60 },
    });
    expect(await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).toMatchObject({
      targetDurationSec: 45,
      durationReason: expect.stringContaining("giây"),
    });
  });

  it("accepts a video longer than the proposed length as long as it stays within the range", async () => {
    // 3 s hook + five 6 s scenes = 33 s against a 30 s proposal and a 60 s maximum.
    const { deps } = makeDeps({ proposeSec: () => 30 });

    await run(deps);

    expect(await item()).toMatchObject({ checkpoint: "READY", aiCorrectionTarget: null });
  });

  it("sends a video shorter than its range back to the script studio to tell more, not to the compiler", async () => {
    const { deps, calls } = makeDeps({ bodyFrames: 60 });

    await run(deps);

    expect(calls.drafts).toHaveLength(2);
    expect(calls.drafts[1]?.revisionNote).toContain("kể sâu hơn từ nguồn");
    expect((await item()).aiCorrectionTarget).toBe("SCRIPT_STUDIO");
  });

  it("spends the one correction on a draft whose proposed length is outside the range", async () => {
    const { deps, calls } = makeDeps({ proposeSec: (attempt) => (attempt === 1 ? 90 : 45) });

    await run(deps);

    expect(calls.drafts).toHaveLength(2);
    expect(calls.drafts[1]?.revisionNote).toContain("90 giây");
    expect(calls.compiles[0]?.targetDurationSec).toBe(45);
    expect(await item()).toMatchObject({ aiCorrectionTarget: "SCRIPT_STUDIO", checkpoint: "READY" });
  });

  it("corrects a video longer than its range by shortening it, never by widening the range", async () => {
    const { deps, calls } = makeDeps({ bodyFrames: 400, shortenWhenRevised: true });

    const outcome = await run(deps);

    expect(outcome.kind).toBe("DEFER");
    expect(calls.compiles).toHaveLength(2);
    expect(calls.compiles[1]?.revisionNote).toContain("không nới khoảng");
    expect(calls.compiles[1]?.revisionNote).toContain("không đọc nhanh hơn");
    expect(await item()).toMatchObject({ aiCorrectionTarget: "SCENE_COMPILER", checkpoint: "READY" });
    expect(await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).toMatchObject({
      minDurationSec: 30,
      maxDurationSec: 60,
    });
    const scenes = await db.prisma.videoScene.findMany({ where: { videoId } });
    expect(scenes.every((scene) => scene.narration === SHORT_NARRATION)).toBe(true);
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
