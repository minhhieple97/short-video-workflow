import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as JobControl from "@/features/jobs/services/job-control.service";
import type * as JobDispatch from "@/features/jobs/services/job-dispatch.service";
import type * as DbClient from "@/server/db/client";
import type { JobType } from "@/shared/types/job";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let dispatch: typeof JobDispatch;
let jobControl: typeof JobControl;

interface EnqueueCall {
  jobType: JobType;
  data: Record<string, unknown>;
  bullmqJobId: string;
}

function recordingEnqueue(): { calls: EnqueueCall[]; enqueue: JobDispatch.EnqueueJob } {
  const calls: EnqueueCall[] = [];
  return {
    calls,
    enqueue: async (jobType, data, bullmqJobId) => {
      calls.push({ jobType, data, bullmqJobId });
    },
  };
}

const refusingEnqueue: JobDispatch.EnqueueJob = async () => {
  throw new Error("redis is down");
};

function request(
  entityId: string,
  overrides: Partial<JobDispatch.TrackedJobRequest> = {},
): JobDispatch.TrackedJobRequest {
  return {
    jobType: "GENERATE_SCENE_TTS",
    entityType: "SCENE",
    entityId,
    payload: { sceneId: entityId },
    ...overrides,
  };
}

beforeAll(async () => {
  env = setupTestEnvironment();
  // Nothing listens here: any test that reaches Redis would fail instead of hanging.
  process.env.REDIS_URL = "redis://127.0.0.1:6399";
  db = await import("@/server/db/client");
  dispatch = await import("@/features/jobs/services/job-dispatch.service");
  jobControl = await import("@/features/jobs/services/job-control.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.jobDispatch.deleteMany();
  await db.prisma.jobRecord.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("job outbox", () => {
  it("stores the job and its outbox row together, still undelivered", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));

    const record = await db.prisma.jobRecord.findUniqueOrThrow({
      where: { id: intent.jobRecordId },
      include: { dispatch: true },
    });
    expect(record.status).toBe("QUEUED");
    expect(record.dispatch).toMatchObject({ dispatchedAt: null, attempts: 0 });
    expect(JSON.parse(record.dispatch?.payloadJson ?? "null")).toEqual({ sceneId: "scene-a" });
  });

  it("delivers the job with its record id and marks the row delivered exactly once", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));
    const { calls, enqueue } = recordingEnqueue();

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(1);
    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(0);

    expect(calls).toEqual([
      {
        jobType: "GENERATE_SCENE_TTS",
        data: { sceneId: "scene-a", jobRecordId: intent.jobRecordId },
        bullmqJobId: intent.jobRecord.bullmqJobId,
      },
    ]);
    const row = await db.prisma.jobDispatch.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.dispatchedAt).not.toBeNull();
  });

  it("keeps the row and delivers it on a later sweep when the queue refuses it", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));

    expect(await dispatch.sweepDueJobIntents(refusingEnqueue)).toBe(0);

    const refused = await db.prisma.jobDispatch.findUniqueOrThrow({
      where: { id: intent.id },
      include: { jobRecord: true },
    });
    expect(refused).toMatchObject({ dispatchedAt: null, attempts: 1 });
    expect(refused.lastError).toContain("redis is down");
    expect(refused.jobRecord.status).toBe("QUEUED");

    const { calls, enqueue } = recordingEnqueue();
    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("holds a delayed job back until it is due", async () => {
    const availableAt = new Date(Date.now() + 60_000);
    await dispatch.recordJobIntent(request("scene-a", { availableAt }));
    const { calls, enqueue } = recordingEnqueue();

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(0);
    expect(calls).toHaveLength(0);

    expect(await dispatch.sweepDueJobIntents(enqueue, new Date(availableAt.getTime() + 1))).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("drops the row of a job that was cancelled while waiting instead of resurrecting it", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));
    await db.prisma.jobRecord.update({ where: { id: intent.jobRecordId }, data: { status: "CANCELLED" } });
    const { calls, enqueue } = recordingEnqueue();

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(0);

    expect(calls).toHaveLength(0);
    expect(await db.prisma.jobDispatch.count()).toBe(0);
  });

  it("fails the job when its outbox payload can never be delivered", async () => {
    const intent = await dispatch.recordJobIntent(
      request("chapter-missing", { jobType: "ANALYZE_CHAPTER", entityType: "CHAPTER" }),
    );
    await db.prisma.jobDispatch.update({ where: { id: intent.id }, data: { payloadJson: "not json" } });
    const { calls, enqueue } = recordingEnqueue();

    expect(await dispatch.sweepDueJobIntents(enqueue)).toBe(0);

    expect(calls).toHaveLength(0);
    const record = await db.prisma.jobRecord.findUniqueOrThrow({ where: { id: intent.jobRecordId } });
    expect(record).toMatchObject({ status: "FAILED", errorCode: "DISPATCH_FAILED" });
    expect(await db.prisma.jobDispatch.count()).toBe(0);
  });

  it("cancels a job that is still in the outbox without touching Redis", async () => {
    const intent = await dispatch.recordJobIntent(request("scene-a"));

    await expect(jobControl.cancelJob(intent.jobRecordId)).resolves.toMatchObject({ status: "CANCELLED" });

    expect(await db.prisma.jobDispatch.count()).toBe(0);
  });
});
