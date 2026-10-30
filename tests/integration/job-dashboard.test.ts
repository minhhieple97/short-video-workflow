import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as JobDashboard from "@/features/jobs/services/job-dashboard.service";
import type * as DbClient from "@/server/db/client";
import { JOB_STATUSES } from "@/shared/types/job";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let dashboard: typeof JobDashboard;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  dashboard = await import("@/features/jobs/services/job-dashboard.service");

  const base = Date.UTC(2026, 9, 27, 8, 0, 0);
  for (const [index, status] of JOB_STATUSES.entries()) {
    await db.prisma.jobRecord.create({
      data: {
        bullmqJobId: `job-${status}`,
        jobType: "DIAGNOSTIC_PING",
        entityType: "SYSTEM",
        entityId: "system",
        status,
        createdAt: new Date(base + index * 1_000),
      },
    });
  }
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("active jobs on the dashboard", () => {
  it("lists only jobs that are still waiting or running, oldest first", async () => {
    const active = await dashboard.listActiveJobs();

    expect(active.map((job) => job.status)).toEqual(["QUEUED", "WAITING_FOR_CLI", "RUNNING", "CANCEL_REQUESTED"]);
    expect(active.every((job) => job.entityLabel === "Hệ thống")).toBe(true);
    expect(active.find((job) => job.status === "WAITING_FOR_CLI")?.cliCommand).toMatch(/^pnpm ai:run --job /);
    expect(active.find((job) => job.status === "CANCEL_REQUESTED")?.canCancel).toBe(false);
  });

  it("keeps finished jobs in the full jobs list", async () => {
    const all = await dashboard.listJobsForDashboard();
    expect(all).toHaveLength(JOB_STATUSES.length);
    expect(all.filter((job) => job.canRetry).map((job) => job.status)).toEqual(["CANCELLED", "FAILED"]);
  });

  it("pages the full list newest first and counts every job, not just the page", async () => {
    const first = await dashboard.listJobsPage({ page: 1, pageSize: 3 });
    const last = await dashboard.listJobsPage({ page: 3, pageSize: 3 });

    expect(first).toMatchObject({ total: JOB_STATUSES.length, pageCount: 3, page: 1 });
    expect(first.items.map((job) => job.status)).toEqual([...JOB_STATUSES].reverse().slice(0, 3));
    expect(last.items.map((job) => job.status)).toEqual([JOB_STATUSES[0]]);
  });
});
