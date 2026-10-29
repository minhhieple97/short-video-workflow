import { describe, expect, it } from "vitest";

import type { RunningWorkerStatus, WorkerIdentity } from "@/server/queue/worker-lock";

import { describeForeignWorker, describeWorkerStatus, formatElapsed } from "../../../scripts/lib/worker-status-text";

const NOW = new Date("2026-10-29T10:00:00.000Z");
const WORKER: WorkerIdentity = {
  pid: 4242,
  host: "studio-pc",
  startedAt: new Date(NOW.getTime() - 3_725_000).toISOString(),
  dataDir: "/home/me/studio/data",
};
const QUEUE = { active: 1, waiting: 3, delayed: 0 };

function running(heartbeatAgeMs: number): RunningWorkerStatus {
  return { state: "running", worker: WORKER, heartbeatAgeMs };
}

describe("formatElapsed", () => {
  it.each([
    [-500, "0 giây"],
    [0, "0 giây"],
    [59_400, "59 giây"],
    [60_000, "1 phút"],
    [3_660_000, "1 giờ 1 phút"],
    [7_200_000, "2 giờ"],
    [25 * 3_600_000, "1 ngày 1 giờ"],
    [48 * 3_600_000, "2 ngày"],
  ])("writes %i ms as %s", (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });
});

describe("describeWorkerStatus", () => {
  it("only says the worker is not running when it is stopped", () => {
    expect(describeWorkerStatus({ state: "stopped" }, QUEUE, NOW)).toEqual(["Worker chưa chạy."]);
  });

  it("lists who runs the worker, since when, how recently it beat, and what it is working on", () => {
    const lines = describeWorkerStatus(running(3_000), QUEUE, NOW);

    expect(lines[0]).toBe("Worker đang chạy.");
    const text = lines.join("\n");
    expect(text).toContain("4242");
    expect(text).toContain("studio-pc");
    expect(text).toContain("/home/me/studio/data");
    expect(text).toContain("(đã chạy 1 giờ 2 phút)");
    expect(text).toContain("3 giây trước");
    expect(text).toContain("1 đang chạy · 3 đang chờ · 0 hẹn lại");
  });

  it("lines the values up in one column", () => {
    const rows = describeWorkerStatus(running(3_000), QUEUE, NOW).slice(1);

    const valueColumns = rows.map((row) => {
      const match = /^ {2}(.+?)( {2,})\S/.exec(row);
      return match ? 2 + (match[1]?.length ?? 0) + (match[2]?.length ?? 0) : -1;
    });
    expect(rows).toHaveLength(6);
    expect(new Set(valueColumns).size).toBe(1);
    expect(valueColumns[0]).toBeGreaterThan(0);
  });

  it("leaves out the queue line when the counts could not be read", () => {
    const text = describeWorkerStatus(running(3_000), null, NOW).join("\n");

    expect(text).not.toContain("Hàng đợi");
  });

  it("calls a worker with a stale or missing heartbeat unresponsive", () => {
    const stale = describeWorkerStatus({ state: "unresponsive", worker: WORKER, heartbeatAgeMs: 120_000 }, null, NOW);
    const missing = describeWorkerStatus({ state: "unresponsive", worker: WORKER, heartbeatAgeMs: null }, null, NOW);

    expect(stale[0]).toContain("không phản hồi");
    expect(stale.join("\n")).toContain("2 phút trước");
    expect(missing.join("\n")).toContain("chưa ghi nhận");
  });
});

describe("describeForeignWorker", () => {
  it("stays quiet for a worker of this checkout and for no worker at all", () => {
    expect(describeForeignWorker(running(1_000), WORKER.dataDir)).toBeNull();
    expect(describeForeignWorker({ state: "stopped" }, WORKER.dataDir)).toBeNull();
  });

  it("points at the Redis database when the worker belongs to another data folder", () => {
    expect(describeForeignWorker(running(1_000), "/somewhere/else/data")).toContain("Redis DB riêng");
  });
});
