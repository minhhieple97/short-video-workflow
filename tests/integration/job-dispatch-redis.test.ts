import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as JobDispatch from "@/features/jobs/services/job-dispatch.service";
import type * as Dispatcher from "@/worker/processors/dispatcher";
import type * as ProcessorTypes from "@/worker/processors/types";
import type * as Reconcile from "@/worker/lifecycle/reconcile";
import type * as DbClient from "@/server/db/client";
import type * as Producer from "@/server/queue/producer";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

// Real BullMQ on a throwaway queue name in logical DB 13; skipped (and reported as skipped) when Redis is not running.
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
  let connection: Redis;
  let queue: Queue;
  let enqueue: JobDispatch.EnqueueJob;

  beforeAll(async () => {
    env = setupTestEnvironment();
    db = await import("@/server/db/client");
    dispatch = await import("@/features/jobs/services/job-dispatch.service");
    producer = await import("@/server/queue/producer");
    reconcile = await import("@/worker/lifecycle/reconcile");
    dispatcher = await import("@/worker/processors/dispatcher");
    processorTypes = await import("@/worker/processors/types");

    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(`studio-jobs-test-${randomUUID()}`, { connection });
    enqueue = (jobType, data, bullmqJobId) => producer.addJobToQueue(queue, jobType, data, bullmqJobId);
  }, 60_000);

  beforeEach(async () => {
    await db.prisma.jobDispatch.deleteMany();
    await db.prisma.jobRecord.deleteMany();
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
    await db.prisma.$disconnect();
    env.cleanup();
  });

  const request = (entityId: string): JobDispatch.TrackedJobRequest => ({
    jobType: "GENERATE_SCENE_TTS",
    entityType: "SCENE",
    entityId,
    payload: { sceneId: entityId },
  });

  it("delivers an outbox row as one BullMQ job under the record's job id", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(1);

    const job = await queue.getJob(intent.jobRecord.bullmqJobId);
    expect(job?.name).toBe("GENERATE_SCENE_TTS");
    expect(job?.data).toEqual({ sceneId: "scene-a", jobRecordId: intent.jobRecordId });
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("does not duplicate the job when a crash between enqueue and mark causes a redelivery", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));
    await enqueue(
      "GENERATE_SCENE_TTS",
      { sceneId: "scene-a", jobRecordId: intent.jobRecordId },
      intent.jobRecord.bullmqJobId,
    );

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(1);

    expect(await queue.getWaitingCount()).toBe(1);
    const row = await db.prisma.jobDispatch.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.dispatchedAt).not.toBeNull();
  });

  it("reconcile leaves an undelivered job alone but still fails a job that vanished from Redis", async () => {
    const undelivered = await dispatch.recordJobIntent(request("scene-undelivered"));
    const vanished = await db.prisma.jobRecord.create({
      data: { bullmqJobId: "ghost", jobType: "GENERATE_SCENE_TTS", entityType: "SCENE", entityId: "scene-ghost" },
    });

    await reconcile.reconcileJobRecords(queue);

    const stillQueued = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: undelivered.jobRecordId } });
    expect(stillQueued.status).toBe("QUEUED");
    const lost = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: vanished.id } });
    expect(lost).toMatchObject({ status: "FAILED", errorCode: "JOB_LOST" });
  });

  it("frees the worker while a job is deferred and runs it again, under a new job id, when it is due", async () => {
    const order: string[] = [];
    const unused: ProcessorTypes.JobProcessor = async () => {
      throw new Error("not used in this test");
    };
    const processors = {
      DIAGNOSTIC_PING: async () => {
        order.push("ping");
        return { pong: true };
      },
      ANALYZE_CHAPTER: unused,
      GENERATE_VIDEO_SCRIPT: unused,
      GENERATE_SCENE_TTS: async () => {
        order.push("tts");
        return order.filter((entry) => entry === "tts").length === 1 ? processorTypes.deferred(1_500) : { done: true };
      },
      RENDER_VIDEO: unused,
    };

    const waiting = await dispatch.recordJobIntent(request("scene-a"));
    const quick = await dispatch.recordJobIntent({
      jobType: "DIAGNOSTIC_PING",
      entityType: "SYSTEM",
      entityId: "ping-1",
      payload: {},
    });
    const workerConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    const worker = new Worker(queue.name, dispatcher.createJobDispatcher(processors), {
      connection: workerConnection,
      concurrency: 1,
    });

    try {
      await dispatch.sweepDueJobIntents(enqueue);
      const statusOf = async (id: string) => (await db.prisma.jobRecord.findUniqueOrThrow({ where: { id } })).status;

      await waitFor(async () => (await statusOf(quick.jobRecordId)) === "COMPLETED", 10_000);
      // The deferred job did not hold the single worker slot: the other job finished while it was still waiting.
      expect(order).toEqual(["tts", "ping"]);
      expect(await statusOf(waiting.jobRecordId)).toBe("QUEUED");
      expect(
        await db.prisma.jobDispatch.count({ where: { jobRecordId: waiting.jobRecordId, dispatchedAt: null } }),
      ).toBe(1);

      await waitFor(async () => {
        await dispatch.sweepDueJobIntents(enqueue);
        return (await statusOf(waiting.jobRecordId)) === "COMPLETED";
      }, 15_000);
      expect(order).toEqual(["tts", "ping", "tts"]);
      const finished = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: waiting.jobRecordId } });
      expect(finished.attempts).toBe(2);
      expect(finished.bullmqJobId).not.toBe(waiting.jobRecord.bullmqJobId);
    } finally {
      await worker.close();
      workerConnection.disconnect();
    }
  }, 40_000);
});
