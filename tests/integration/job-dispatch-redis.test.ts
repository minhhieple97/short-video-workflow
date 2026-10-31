import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { IntegrationError } from "@/server/integrations/integration-error";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as JobDispatch from "@/features/jobs/services/job-dispatch.service";
import type * as Dispatcher from "@/worker/processors/dispatcher";
import type * as ProcessorTypes from "@/worker/processors/types";
import type * as Reconcile from "@/worker/lifecycle/reconcile";
import type * as DbClient from "@/server/db/client";
import type * as Producer from "@/server/queue/producer";
import type * as ConcurrencyWatcher from "@/worker/lifecycle/concurrency-watcher";
import { LANE_QUEUE_NAMES, mapLanes } from "@/server/queue/lanes";
import type { JobType } from "@/shared/types/job";
import type { WorkLane } from "@/shared/types/work-lane";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

// Real BullMQ on throwaway queue names (one per lane) in logical DB 13; skipped (and reported as skipped) when Redis is not running.
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/13";

async function isRedisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1_000,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  probe.on("error", () => undefined);
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const redisAvailable = await isRedisReachable();

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the expected state");
}

describe.skipIf(!redisAvailable)("job outbox against real BullMQ", () => {
  let env: TestEnvironment;
  let db: typeof DbClient;
  let dispatch: typeof JobDispatch;
  let producer: typeof Producer;
  let reconcile: typeof Reconcile;
  let dispatcher: typeof Dispatcher;
  let processorTypes: typeof ProcessorTypes;
  let watcher: typeof ConcurrencyWatcher;
  let connection: Redis;
  let queues: Producer.StudioQueues;
  let enqueue: JobDispatch.EnqueueJob;

  beforeAll(async () => {
    env = setupTestEnvironment();
    db = await import("@/server/db/client");
    dispatch = await import("@/features/jobs/services/job-dispatch.service");
    producer = await import("@/server/queue/producer");
    reconcile = await import("@/worker/lifecycle/reconcile");
    dispatcher = await import("@/worker/processors/dispatcher");
    processorTypes = await import("@/worker/processors/types");
    watcher = await import("@/worker/lifecycle/concurrency-watcher");

    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    const suffix = randomUUID();
    queues = mapLanes((lane) => new Queue(`${LANE_QUEUE_NAMES[lane]}-test-${suffix}`, { connection }));
    enqueue = (jobType, data, bullmqJobId) => producer.addJobToQueue(queues, jobType, data, bullmqJobId);
  }, 60_000);

  beforeEach(async () => {
    await db.prisma.jobDispatch.deleteMany();
    await db.prisma.jobRecord.deleteMany();
    await db.prisma.concurrencySetting.deleteMany();
    for (const queue of Object.values(queues)) await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    for (const queue of Object.values(queues)) await queue.obliterate({ force: true });
    await producer.closeStudioQueues(queues);
    connection.disconnect();
    await db.prisma.$disconnect();
    env.cleanup();
  });

  const unused: ProcessorTypes.JobProcessor = async () => {
    throw new Error("not used in this test");
  };
  const processorsWith = (
    overrides: Partial<Record<JobType, ProcessorTypes.JobProcessor>>,
  ): Record<JobType, ProcessorTypes.JobProcessor> => ({
    DIAGNOSTIC_PING: unused,
    ANALYZE_CHAPTER: unused,
    GENERATE_VIDEO_SCRIPT: unused,
    GENERATE_PUBLISH_METADATA: unused,
    GENERATE_SCENE_TTS: unused,
    RENDER_VIDEO: unused,
    RUN_PRODUCTION_ITEM: unused,
    ARCHIVE_RENDER: unused,
    EXTRACT_PDF: unused,
    ...overrides,
  });

  // The worker's set-up, for the lanes a test needs: one BullMQ worker per lane on its own queue.
  function startWorkers(
    processors: Record<JobType, ProcessorTypes.JobProcessor>,
    lanes: readonly WorkLane[],
    concurrency = 1,
  ) {
    const workerConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    const workers = lanes.map(
      (lane) =>
        [
          lane,
          new Worker(queues[lane].name, dispatcher.createJobDispatcher(processors, { lane, enqueue }), {
            connection: workerConnection,
            concurrency,
          }),
        ] as const,
    );
    return {
      byLane: Object.fromEntries(workers) as Partial<Record<WorkLane, Worker>>,
      close: async () => {
        await Promise.all(workers.map(([, worker]) => worker.close()));
        workerConnection.disconnect();
      },
    };
  }

  const statusOf = async (id: string) => (await db.prisma.jobRecord.findUniqueOrThrow({ where: { id } })).status;

  const request = (entityId: string): JobDispatch.TrackedJobRequest => ({
    jobType: "GENERATE_SCENE_TTS",
    entityType: "SCENE",
    entityId,
    payload: { sceneId: entityId },
  });

  it("delivers an outbox row as one BullMQ job under the record's job id", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(1);

    const job = await queues.voice.getJob(intent.jobRecord.bullmqJobId);
    expect(job?.name).toBe("GENERATE_SCENE_TTS");
    expect(job?.data).toEqual({ sceneId: "scene-a", jobRecordId: intent.jobRecordId });
    expect(await queues.voice.getWaitingCount()).toBe(1);
    expect(await queues.general.getWaitingCount()).toBe(0);
  });

  it("does not duplicate the job when a crash between enqueue and mark causes a redelivery", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));
    await enqueue(
      "GENERATE_SCENE_TTS",
      { sceneId: "scene-a", jobRecordId: intent.jobRecordId },
      intent.jobRecord.bullmqJobId,
    );

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(1);

    expect(await queues.voice.getWaitingCount()).toBe(1);
    const row = await db.prisma.jobDispatch.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.dispatchedAt).not.toBeNull();
  });

  it("reconcile leaves an undelivered job alone but still fails a job that vanished from Redis", async () => {
    const undelivered = await dispatch.recordJobIntent(request("scene-undelivered"));
    const vanished = await db.prisma.jobRecord.create({
      data: { bullmqJobId: "ghost", jobType: "GENERATE_SCENE_TTS", entityType: "SCENE", entityId: "scene-ghost" },
    });

    await reconcile.reconcileJobRecords(queues);

    const stillQueued = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: undelivered.jobRecordId } });
    expect(stillQueued.status).toBe("QUEUED");
    const lost = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: vanished.id } });
    expect(lost).toMatchObject({ status: "FAILED", errorCode: "JOB_LOST" });
  });

  it("frees the lane while a job is deferred and runs it again, under a new job id, when it is due", async () => {
    const order: string[] = [];
    const processors = processorsWith({
      GENERATE_SCENE_TTS: async ({ job }) => {
        const sceneId = String((job.data as { sceneId: string }).sceneId);
        order.push(sceneId);
        return sceneId === "scene-a" && order.filter((entry) => entry === "scene-a").length === 1
          ? processorTypes.deferred(1_500)
          : { done: true };
      },
    });

    const waiting = await dispatch.recordJobIntent(request("scene-a"));
    const quick = await dispatch.recordJobIntent(request("scene-b"));
    const workers = startWorkers(processors, ["voice"]);

    try {
      await dispatch.sweepDueJobIntents(enqueue);

      await waitFor(async () => (await statusOf(quick.jobRecordId)) === "COMPLETED", 10_000);
      // The deferred job did not hold the lane's single slot: the other job finished while it was still waiting.
      expect(order).toEqual(["scene-a", "scene-b"]);
      expect(await statusOf(waiting.jobRecordId)).toBe("QUEUED");
      expect(
        await db.prisma.jobDispatch.count({ where: { jobRecordId: waiting.jobRecordId, dispatchedAt: null } }),
      ).toBe(1);

      await waitFor(async () => {
        await dispatch.sweepDueJobIntents(enqueue);
        return (await statusOf(waiting.jobRecordId)) === "COMPLETED";
      }, 15_000);
      expect(order).toEqual(["scene-a", "scene-b", "scene-a"]);
      const finished = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: waiting.jobRecordId } });
      expect(finished.attempts).toBe(2);
      expect(finished.bullmqJobId).not.toBe(waiting.jobRecord.bullmqJobId);
    } finally {
      await workers.close();
    }
  }, 40_000);

  it("uploads to Drive while the render lane is busy", async () => {
    let releaseRender: () => void = () => undefined;
    const renderMayFinish = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const processors = processorsWith({
      RENDER_VIDEO: async () => {
        await renderMayFinish;
        return { rendered: true };
      },
      ARCHIVE_RENDER: async () => ({ archived: true }),
    });
    const render = await dispatch.recordJobIntent({
      jobType: "RENDER_VIDEO",
      entityType: "RENDER",
      entityId: "render-1",
      payload: { renderId: "render-1" },
    });
    const archive = await dispatch.recordJobIntent({
      jobType: "ARCHIVE_RENDER",
      entityType: "RENDER_ARCHIVE",
      entityId: "archive-0",
      payload: { archiveId: "archive-0" },
    });
    const workers = startWorkers(processors, ["render", "archive"]);
    try {
      await dispatch.sweepDueJobIntents(enqueue);
      await waitFor(async () => (await statusOf(archive.jobRecordId)) === "COMPLETED", 10_000);
      expect(await statusOf(render.jobRecordId)).toBe("RUNNING");
      releaseRender();
      await waitFor(async () => (await statusOf(render.jobRecordId)) === "COMPLETED", 10_000);
    } finally {
      releaseRender();
      await workers.close();
    }
  }, 30_000);

  it("hands a job to the lane of its next step, keeping one job record", async () => {
    const seen: WorkLane[] = [];
    const processors = processorsWith({
      RUN_PRODUCTION_ITEM: async ({ lane }) => {
        seen.push(lane);
        return lane === "general" ? processorTypes.handoff("notebooklm") : { done: true };
      },
    });
    const item = await dispatch.recordJobIntent({
      jobType: "RUN_PRODUCTION_ITEM",
      entityType: "PRODUCTION_ITEM",
      entityId: "item-1",
      payload: { itemId: "item-1" },
    });
    const workers = startWorkers(processors, ["general", "notebooklm"]);
    try {
      await dispatch.sweepDueJobIntents(enqueue);
      // Delivered at once: no outbox sweep runs between the two lanes.
      await waitFor(async () => (await statusOf(item.jobRecordId)) === "COMPLETED", 10_000);
      expect(seen).toEqual(["general", "notebooklm"]);
      const row = await db.prisma.jobDispatch.findUniqueOrThrow({ where: { jobRecordId: item.jobRecordId } });
      expect(JSON.parse(row.payloadJson)).toEqual({ itemId: "item-1", lane: "notebooklm" });
      expect(await db.prisma.jobRecord.count()).toBe(1);
      // Two runs, but the first one only moved the job on: it is not counted as a try.
      expect((await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: item.jobRecordId } })).attempts).toBe(1);
    } finally {
      await workers.close();
    }
  }, 30_000);

  it("moves a job queued before lanes existed to its own lane before running it", async () => {
    const ran: WorkLane[] = [];
    const processors = processorsWith({
      ARCHIVE_RENDER: async ({ lane }) => {
        ran.push(lane);
        return { archived: true };
      },
    });
    const intent = await dispatch.recordJobIntent({
      jobType: "ARCHIVE_RENDER",
      entityType: "RENDER_ARCHIVE",
      entityId: "archive-legacy",
      payload: { archiveId: "archive-legacy" },
    });
    // As an older worker would have queued it: in the one shared queue, which is now the general lane's.
    await queues.general.add(
      "ARCHIVE_RENDER",
      { archiveId: "archive-legacy", jobRecordId: intent.jobRecordId },
      { jobId: intent.jobRecord.bullmqJobId },
    );
    await db.prisma.jobDispatch.update({ where: { id: intent.id }, data: { dispatchedAt: new Date() } });
    const workers = startWorkers(processors, ["general", "archive"]);
    try {
      await waitFor(async () => (await statusOf(intent.jobRecordId)) === "COMPLETED", 10_000);
      expect(ran).toEqual(["archive"]);
      const record = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: intent.jobRecordId } });
      expect(record.attempts).toBe(1);
    } finally {
      await workers.close();
    }
  }, 30_000);

  it("takes more tasks at once once the setting is raised, without a restart", async () => {
    let running = 0;
    let mostAtOnce = 0;
    const gates = new Map<string, () => void>();
    const processors = processorsWith({
      ARCHIVE_RENDER: async ({ job }) => {
        const archiveId = String((job.data as { archiveId: string }).archiveId);
        running += 1;
        mostAtOnce = Math.max(mostAtOnce, running);
        await new Promise<void>((resolve) => gates.set(archiveId, resolve));
        running -= 1;
        return { archived: true };
      },
    });
    const intents = await Promise.all(
      ["a", "b", "c", "d"].map((id) =>
        dispatch.recordJobIntent({
          jobType: "ARCHIVE_RENDER",
          entityType: "RENDER_ARCHIVE",
          entityId: `archive-${id}`,
          payload: { archiveId: `archive-${id}` },
        }),
      ),
    );
    const workers = startWorkers(processors, ["archive"]);
    const releaseAll = () => {
      for (const release of gates.values()) release();
    };
    try {
      await dispatch.sweepDueJobIntents(enqueue);
      await waitFor(async () => running === 1, 10_000);

      await db.prisma.concurrencySetting.create({ data: { key: "archive", value: 3 } });
      await watcher.applyConcurrencySettings(mapLanes((lane) => workers.byLane[lane] ?? { concurrency: 1 }));
      expect(workers.byLane.archive?.concurrency).toBe(3);
      // BullMQ reads the number before it takes a job: a lane at its limit takes more once a running task ends.
      gates.get("archive-a")?.();
      await waitFor(async () => running === 3, 10_000);
      releaseAll();
      for (const intent of intents)
        await waitFor(async () => (await statusOf(intent.jobRecordId)) === "COMPLETED", 10_000);
      expect(mostAtOnce).toBe(3);
    } finally {
      releaseAll();
      await workers.close();
    }
  }, 40_000);

  it.each([
    { provider: "claude" as const, minutes: 30 },
    { provider: "claude" as const, minutes: 60 },
    { provider: "notebooklm" as const, minutes: 30 },
    { provider: "notebooklm" as const, minutes: 7 * 24 * 60 },
  ])(
    "waits $minutes minutes for $provider reset through a worker restart without polling",
    async ({ provider, minutes }) => {
      const { withProviderCooldown } = await import("@/features/jobs/services/provider-cooldown.service");
      await db.prisma.providerCooldown.deleteMany();
      let calls = 0;
      const processors = processorsWith({
        DIAGNOSTIC_PING: async () => ({ pong: true }),
        ANALYZE_CHAPTER: async () =>
          withProviderCooldown(provider, async () => {
            calls += 1;
            if (calls === 1)
              throw new IntegrationError("AI_QUOTA_EXCEEDED", "quota", "QUOTA", { retryAfterMs: minutes * 60_000 });
            return { done: true };
          }),
      });
      const waiting = await dispatch.recordJobIntent({
        jobType: "ANALYZE_CHAPTER",
        entityType: "CHAPTER",
        entityId: "quota-chapter",
        payload: { chapterId: "quota-chapter" },
      });
      const quick = await dispatch.recordJobIntent({
        jobType: "DIAGNOSTIC_PING",
        entityType: "SYSTEM",
        entityId: "quota-ping",
        payload: {},
      });
      let workers = startWorkers(processors, ["claude", "general"]);
      const record = () => db.prisma.jobRecord.findUniqueOrThrow({ where: { id: waiting.jobRecordId } });
      const makeDue = () =>
        db.prisma.jobDispatch.update({
          where: { jobRecordId: waiting.jobRecordId },
          data: { availableAt: new Date(0) },
        });
      try {
        await dispatch.sweepDueJobIntents(enqueue);
        await waitFor(
          async () =>
            (await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: quick.jobRecordId } })).status === "COMPLETED",
          10_000,
        );
        expect(await record()).toMatchObject({ status: "QUEUED", transientFailures: 0 });
        expect(calls).toBe(1);
        const reset = await db.prisma.providerCooldown.findUniqueOrThrow({ where: { provider } });
        const schedule = await db.prisma.jobDispatch.findUniqueOrThrow({ where: { jobRecordId: waiting.jobRecordId } });
        expect(schedule.availableAt.getTime()).toBeGreaterThanOrEqual(reset.blockedUntil.getTime());
        expect(schedule.availableAt.getTime() - reset.blockedUntil.getTime()).toBeLessThan(10_000);
        const beforeReset = new Date(reset.blockedUntil.getTime() - 1);
        expect(await dispatch.sweepDueJobIntents(enqueue, beforeReset)).toBe(0);
        await workers.close();
        workers = startWorkers(processors, ["claude", "general"]);
        expect(await dispatch.sweepDueJobIntents(enqueue, beforeReset)).toBe(0);
        expect(await record()).toMatchObject({ status: "QUEUED", attempts: 1, transientFailures: 0 });
        expect(calls).toBe(1);
        await db.prisma.providerCooldown.update({ where: { provider }, data: { blockedUntil: new Date(0) } });
        await makeDue();
        await dispatch.sweepDueJobIntents(enqueue);
        await waitFor(async () => (await record()).status === "COMPLETED", 10_000);
        expect(calls).toBe(2);
        expect((await record()).transientFailures).toBe(0);
        expect(await db.prisma.jobRecord.count({ where: { entityId: "quota-chapter" } })).toBe(1);
      } finally {
        await workers.close();
      }
    },
    40_000,
  );
});
