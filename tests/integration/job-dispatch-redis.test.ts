import { randomUUID } from "node:crypto";

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as JobDispatch from "@/features/jobs/services/job-dispatch.service";
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

describe.skipIf(!redisAvailable)("job outbox against real BullMQ", () => {
  let env: TestEnvironment;
  let db: typeof DbClient;
  let dispatch: typeof JobDispatch;
  let producer: typeof Producer;
  let reconcile: typeof Reconcile;
  let connection: Redis;
  let queue: Queue;
  let enqueue: JobDispatch.EnqueueJob;

  beforeAll(async () => {
    env = setupTestEnvironment();
    db = await import("@/server/db/client");
    dispatch = await import("@/features/jobs/services/job-dispatch.service");
    producer = await import("@/server/queue/producer");
    reconcile = await import("@/worker/lifecycle/reconcile");

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
});
