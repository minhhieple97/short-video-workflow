import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as JobControl from "@/features/jobs/services/job-control.service";
import type * as JobDashboard from "@/features/jobs/services/job-dashboard.service";
import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Control from "@/features/productions/services/production-control.service";
import type { PipelineDeps } from "@/features/productions/services/production-pipeline.service";
import type * as Pipeline from "@/features/productions/services/production-pipeline.service";
import type * as Reconcile from "@/features/productions/services/production-reconcile.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as DbClient from "@/server/db/client";
import { JobCancelledError } from "@/shared/errors";
import type * as RunProductionItem from "@/worker/processors/run-production-item";
import type { ProcessorContext } from "@/worker/processors/types";

import { createCountingDeps } from "../helpers/counting-pipeline-deps";
import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const pipelineDeps = vi.hoisted(() => ({ create: (): PipelineDeps => ({}) as PipelineDeps }));
vi.mock("@/features/productions/services/pipeline-deps", () => ({
  createPipelineDeps: () => pipelineDeps.create(),
}));

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let control: typeof Control;
let jobControl: typeof JobControl;
let dashboard: typeof JobDashboard;
let pipeline: typeof Pipeline;
let processor: typeof RunProductionItem;
let productions: typeof ProductionRequest;
let reconcile: typeof Reconcile;

let itemId: string;
let videoId: string;
let lessonId: string;
let batchId: string;

const item = () => db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } });
const batch = () => db.prisma.productionBatch.findUniqueOrThrow({ where: { id: batchId } });
const itemJobs = () =>
  db.prisma.jobRecord.findMany({
    where: { jobType: "RUN_PRODUCTION_ITEM", entityId: itemId },
    include: { dispatch: true },
    orderBy: { createdAt: "asc" },
  });
const activeItemJobs = async () =>
  (await itemJobs()).filter((job) => ["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(job.status));
const finishRender = (status: string, errorMessage: string | null = null) =>
  db.prisma.renderRecord.updateMany({ where: { videoId }, data: { status, errorMessage } });
// The dispatcher would settle the job a processor ran; tests that call the processor directly settle it themselves.
const settleItemJobs = (status: "FAILED" | "CANCELLED") =>
  db.prisma.jobRecord.updateMany({ where: { jobType: "RUN_PRODUCTION_ITEM", entityId: itemId }, data: { status } });

const runJob = (signal = new AbortController().signal) =>
  processor.processRunProductionItem({
    job: { data: { jobRecordId: "job-1", itemId } },
    jobRecordId: "job-1",
    signal,
    reportProgress: async () => {},
  } as unknown as ProcessorContext);

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  claim = await import("@/features/productions/repositories/production-claim.repository");
  control = await import("@/features/productions/services/production-control.service");
  jobControl = await import("@/features/jobs/services/job-control.service");
  dashboard = await import("@/features/jobs/services/job-dashboard.service");
  pipeline = await import("@/features/productions/services/production-pipeline.service");
  processor = await import("@/worker/processors/run-production-item");
  productions = await import("@/features/productions/services/production-request.service");
  reconcile = await import("@/features/productions/services/production-reconcile.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.jobRecord.deleteMany();
  ({ itemId, videoId, lessonId } = await seedProduction({ db, productions }));
  batchId = (await item()).batchId;
  pipelineDeps.create = () => createCountingDeps(db, () => videoId).deps;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("requesting a production", () => {
  it("records one job per item together with the production, left for the outbox to deliver", async () => {
    const jobs = await itemJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "QUEUED", entityType: "PRODUCTION_ITEM" });
    expect(jobs[0]?.dispatch?.dispatchedAt).toBeNull();
    expect(JSON.parse(jobs[0]?.dispatch?.payloadJson ?? "null")).toEqual({ itemId });
  });

  it("starts no further job when the same request is replayed", async () => {
    const input = {
      bookId: (await batch()).bookId,
      lessonIds: [lessonId],
      idempotencyKey: "replayed-key",
      targetDurationSec: 60 as const,
      extended: false,
    };
    const first = await productions.requestProduction(input);
    await productions.requestProduction(input);

    const replayedItem = first.production.items[0]?.id ?? "";
    expect(await db.prisma.jobRecord.count({ where: { entityId: replayedItem } })).toBe(1);
  });
});

describe("processRunProductionItem", () => {
  it("does nothing for an item that has finished", async () => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "COMPLETED" } });

    expect(await runJob()).toEqual({ itemId, skipped: true });
  });

  it("comes back when the lease of an earlier run has run out instead of dropping the item", async () => {
    await claim.claimProductionItem(itemId, "dead-worker", 60_000);

    const result = await runJob();

    expect(result).toMatchObject({ deferred: true });
    const wait = (result as { retryAfterMs: number }).retryAfterMs;
    expect(wait).toBeGreaterThan(59_000);
    expect(wait).toBeLessThanOrEqual(62_000);
    expect((await item()).claimToken).toBe("dead-worker");
  });

  it("marks the batch running as soon as one of its items starts", async () => {
    let seen = "";
    pipelineDeps.create = () =>
      createCountingDeps(db, () => videoId, {
        afterCompile: async () => {
          seen = (await batch()).status;
        },
      }).deps;

    await runJob();

    expect(seen).toBe("RUNNING");
  });

  it("defers while the render is pending and keeps the batch running", async () => {
    expect(await runJob()).toEqual({ deferred: true, retryAfterMs: pipeline.RENDER_POLL_MS });

    expect(await item()).toMatchObject({ status: "WAITING", checkpoint: "READY", claimToken: null });
    expect((await batch()).status).toBe("RUNNING");
  });

  it("completes the item and the batch once the render is done", async () => {
    await runJob();
    await finishRender("COMPLETED");

    expect(await runJob()).toEqual({ itemId, outcome: "COMPLETED" });
    expect(await item()).toMatchObject({ status: "COMPLETED", checkpoint: "RENDERED" });
    expect(await batch()).toMatchObject({ status: "COMPLETED" });
    expect((await batch()).completedAt).not.toBeNull();
  });

  it("fails the job, the item and the batch with the same reason", async () => {
    await runJob();
    await finishRender("FAILED", "chromium crashed");

    await expect(runJob()).rejects.toMatchObject({ code: "RENDER_FAILED", message: "chromium crashed" });
    expect(await item()).toMatchObject({ status: "FAILED", errorCode: "RENDER_FAILED", claimToken: null });
    expect((await batch()).status).toBe("FAILED");
  });

  it("cancels the item when its job is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runJob(controller.signal)).rejects.toBeInstanceOf(JobCancelledError);
    expect(await item()).toMatchObject({ status: "CANCELLED", claimToken: null, checkpoint: "NONE" });
    expect((await batch()).status).toBe("CANCELLED");
  });

  it("closes what the run held open (the NotebookLM process) after every run, deferred or failed", async () => {
    let closed = 0;
    pipelineDeps.create = () => ({
      ...createCountingDeps(db, () => videoId).deps,
      close: async () => void (closed += 1),
    });

    await runJob();
    expect(closed).toBe(1);
    await finishRender("FAILED", "chromium crashed");
    await expect(runJob()).rejects.toMatchObject({ code: "RENDER_FAILED" });
    expect(closed).toBe(2);
  });

  it("records an unexpected error as the item's failure instead of leaving it in progress", async () => {
    pipelineDeps.create = () => {
      throw new Error("provider exploded");
    };

    await expect(runJob()).rejects.toThrow("provider exploded");
    expect(await item()).toMatchObject({
      status: "FAILED",
      errorCode: "PRODUCTION_STEP_ERROR",
      errorMessage: "provider exploded",
      claimToken: null,
    });
  });
});

describe("cancelProduction", () => {
  it("cancels unfinished items and stops their queued job", async () => {
    const production = await control.cancelProduction(batchId);

    expect(production.status).toBe("CANCELLED");
    expect(await item()).toMatchObject({ status: "CANCELLED" });
    expect((await item()).completedAt).not.toBeNull();
    const [job] = await itemJobs();
    expect(job?.status).toBe("CANCELLED");
    expect(job?.dispatch).toBeNull();
  });

  it("also stops a render queued for the item", async () => {
    await runJob();

    await control.cancelProduction(batchId, itemId);

    const render = await db.prisma.renderRecord.findFirstOrThrow({ where: { videoId } });
    expect(render.status).toBe("CANCELLED");
    const renderJob = await db.prisma.jobRecord.findFirstOrThrow({ where: { entityId: render.id } });
    expect(renderJob.status).toBe("CANCELLED");
  });

  it("lets a run in progress finish its step, then keeps the item cancelled", async () => {
    await claim.claimProductionItem(itemId, "worker-a", 60_000);

    await control.cancelProduction(batchId);
    expect(await item()).toMatchObject({ status: "CANCELLED", claimToken: "worker-a" });

    await pipeline.settleProductionRun({ itemId, claimToken: "worker-a", outcome: { kind: "DEFER", retryAfterMs: 1 } });
    expect(await item()).toMatchObject({ status: "CANCELLED", claimToken: null });
  });

  it("leaves finished items alone", async () => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "COMPLETED" } });

    const production = await control.cancelProduction(batchId);

    expect(production.items[0]?.status).toBe("COMPLETED");
    expect(production.status).toBe("COMPLETED");
  });

  it("rejects an item that is not part of the production", async () => {
    await expect(control.cancelProduction(batchId, "other-item")).rejects.toMatchObject({
      code: "PRODUCTION_ITEM_NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("retryProduction", () => {
  async function failAtRender() {
    await runJob();
    await finishRender("FAILED", "chromium crashed");
    await expect(runJob()).rejects.toMatchObject({ code: "RENDER_FAILED" });
    await settleItemJobs("FAILED");
  }

  it("resumes a failed item from its checkpoint with a fresh job and a fresh render", async () => {
    await failAtRender();
    const failedRender = (await item()).renderId;
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { transientRetries: 3 } });

    const production = await control.retryProduction(batchId);

    expect(production.status).toBe("QUEUED");
    expect(await item()).toMatchObject({
      status: "PENDING",
      checkpoint: "READY",
      errorCode: null,
      errorMessage: null,
      renderId: null,
      transientRetries: 0,
      completedAt: null,
    });
    expect(await activeItemJobs()).toHaveLength(1);

    expect(await runJob()).toMatchObject({ deferred: true });
    expect((await item()).renderId).not.toBe(failedRender);
    expect(await db.prisma.renderRecord.count({ where: { videoId } })).toBe(2);
  });

  it("resumes a cancelled item too", async () => {
    await control.cancelProduction(batchId);

    const production = await control.retryProduction(batchId);

    expect(production.items[0]?.status).toBe("PENDING");
    expect(await activeItemJobs()).toHaveLength(1);
  });

  it("starts one job when the same item is retried twice at once", async () => {
    await failAtRender();

    await Promise.all([control.retryProduction(batchId, itemId), control.retryProduction(batchId, itemId)]);

    expect(await activeItemJobs()).toHaveLength(1);
  });

  it("refuses when nothing failed or was cancelled", async () => {
    await expect(control.retryProduction(batchId)).rejects.toMatchObject({ code: "PRODUCTION_NOTHING_TO_RETRY" });
  });

  it("refuses to run a finished item again", async () => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "COMPLETED" } });

    await expect(control.retryProduction(batchId, itemId)).rejects.toMatchObject({
      code: "PRODUCTION_ITEM_NOT_RETRYABLE",
      httpStatus: 409,
    });
  });
});

describe("the jobs page", () => {
  it("retries a production item through its failed job", async () => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "FAILED", errorCode: "X" } });
    await settleItemJobs("FAILED");
    const [failed] = await itemJobs();

    const job = await jobControl.retryJob(failed?.id ?? "");

    expect(job).toMatchObject({ jobType: "RUN_PRODUCTION_ITEM", status: "QUEUED" });
    expect(job.id).not.toBe(failed?.id);
    expect(await item()).toMatchObject({ status: "PENDING", errorCode: null });
  });

  it("cancels the item when its queued job is cancelled", async () => {
    const [job] = await itemJobs();

    await jobControl.cancelJob(job?.id ?? "");

    expect(await item()).toMatchObject({ status: "CANCELLED" });
    expect((await batch()).status).toBe("CANCELLED");
  });

  it("names the job after the lesson and links to its video", async () => {
    const [job] = await itemJobs();
    const jobs = await dashboard.listJobsForDashboard();

    expect(jobs.find((listed) => listed.id === job?.id)).toMatchObject({
      entityLabel: "Sản xuất · Bài",
      entityHref: `/videos/${videoId}`,
    });
  });
});

describe("reconcileProductionItems", () => {
  it("gives an in-progress item whose job was lost exactly one new job", async () => {
    await settleItemJobs("FAILED");

    expect(await reconcile.reconcileProductionItems()).toBe(1);
    expect(await reconcile.reconcileProductionItems()).toBe(0);

    const active = await activeItemJobs();
    expect(active).toHaveLength(1);
    expect(active[0]?.dispatch?.dispatchedAt).toBeNull();
  });

  it("leaves items that still have a job, and finished items, alone", async () => {
    expect(await reconcile.reconcileProductionItems()).toBe(0);

    await settleItemJobs("FAILED");
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "FAILED" } });

    expect(await reconcile.reconcileProductionItems()).toBe(0);
    expect(await activeItemJobs()).toHaveLength(0);
  });
});
