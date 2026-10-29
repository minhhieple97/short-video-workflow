import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_LIVENESS_TTL_MS,
  WORKER_LOCK_KEY,
} from "@/server/queue/constants";
import { acquireWorkerLock, readWorkerStatus, type WorkerIdentity, type WorkerLock } from "@/server/queue/worker-lock";
import { startHeartbeat } from "@/worker/lifecycle/heartbeat";

import { OFFLINE_INTEGRATIONS_ENV } from "../helpers/offline-env";

// Real Redis in logical DB 13 (the worker's two keys only); skipped, and reported as skipped, when Redis is not running.
// Everything that touches those keys lives in this one file so vitest never runs two such tests at once.
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/13";
const DATA_DIR = "/data/book-video-studio";

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

function identity(overrides: Partial<WorkerIdentity> = {}): WorkerIdentity {
  return {
    pid: process.pid,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
    dataDir: DATA_DIR,
    ...overrides,
  };
}

// A process id that belonged to a real process a moment ago and now belongs to none.
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.once("exit", resolve));
  if (child.pid === undefined) throw new Error("could not start a helper process");
  return child.pid;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error("Timed out waiting for the expected state");
}

describe.skipIf(!redisAvailable)("worker guard against real Redis", () => {
  let connection: Redis;

  const putLock = (worker: WorkerIdentity) =>
    connection.set(WORKER_LOCK_KEY, JSON.stringify(worker), "PX", WORKER_LIVENESS_TTL_MS);

  async function acquire(dataDir = DATA_DIR, using: Redis = connection): Promise<WorkerLock> {
    const attempt = await acquireWorkerLock(using, dataDir);
    if (!attempt.acquired) throw new Error("expected to get the lock");
    return attempt.lock;
  }

  beforeAll(() => {
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    await connection.del(WORKER_LOCK_KEY, WORKER_HEARTBEAT_KEY);
  });

  afterAll(async () => {
    await connection.del(WORKER_LOCK_KEY, WORKER_HEARTBEAT_KEY);
    connection.disconnect();
  });

  describe("acquiring", () => {
    it("gives the lock to the first worker, with its identity and an expiry", async () => {
      const lock = await acquire();

      expect(lock.identity).toEqual({
        pid: process.pid,
        host: os.hostname(),
        startedAt: expect.any(String),
        dataDir: DATA_DIR,
      });
      expect(JSON.parse((await connection.get(WORKER_LOCK_KEY)) ?? "null")).toEqual(lock.identity);
      const ttl = await connection.pttl(WORKER_LOCK_KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(WORKER_LIVENESS_TTL_MS);
    });

    it("refuses a second worker while the first lives, and says who holds the lock", async () => {
      const first = await acquire();
      await connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()));

      const second = await acquireWorkerLock(connection, "/another/checkout/data");

      expect(second).toMatchObject({ acquired: false, holder: { state: "running", worker: first.identity } });
      expect(await connection.get(WORKER_LOCK_KEY)).toBe(JSON.stringify(first.identity));
    });

    it("takes over the lock of a worker that no longer exists on this machine", async () => {
      await putLock(identity({ pid: await exitedPid() }));

      const lock = await acquire();

      expect(await connection.get(WORKER_LOCK_KEY)).toBe(JSON.stringify(lock.identity));
    });

    it("leaves a lock written on another machine alone: its process cannot be checked from here", async () => {
      await putLock(identity({ host: "some-other-machine", pid: await exitedPid() }));

      const attempt = await acquireWorkerLock(connection, DATA_DIR);

      expect(attempt).toMatchObject({ acquired: false, holder: { worker: { host: "some-other-machine" } } });
    });

    it("lets exactly one of several workers starting together take over a stale lock", async () => {
      await putLock(identity({ pid: await exitedPid() }));
      const racers = Array.from({ length: 8 }, () => new Redis(REDIS_URL, { maxRetriesPerRequest: null }));
      try {
        const attempts = await Promise.all(racers.map((racer, index) => acquireWorkerLock(racer, `/data/${index}`)));

        const winners = attempts.filter((attempt) => attempt.acquired);
        expect(winners).toHaveLength(1);
        const [winner] = winners;
        expect(await connection.get(WORKER_LOCK_KEY)).toBe(JSON.stringify(winner?.lock.identity));
      } finally {
        for (const racer of racers) racer.disconnect();
      }
    });

    it.each(["not json at all", JSON.stringify({ pid: "12", host: 3 })])(
      "treats %s as left over, since no worker writes it",
      async (leftover) => {
        await connection.set(WORKER_LOCK_KEY, leftover);

        expect(await readWorkerStatus(connection)).toEqual({ state: "stopped" });
        const lock = await acquire();

        expect(await connection.get(WORKER_LOCK_KEY)).toBe(JSON.stringify(lock.identity));
      },
    );
  });

  describe("reading the status", () => {
    it("is stopped when nothing holds the lock, even if a heartbeat is left over", async () => {
      await connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()));

      expect(await readWorkerStatus(connection)).toEqual({ state: "stopped" });
    });

    it("is stopped when the holder's process is gone, before the lock expires", async () => {
      await putLock(identity({ pid: await exitedPid() }));
      await connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()));

      expect(await readWorkerStatus(connection)).toEqual({ state: "stopped" });
    });

    it("is running with a fresh heartbeat and unresponsive with an old or missing one", async () => {
      const { identity: worker } = await acquire();
      const now = Date.now();

      expect(await readWorkerStatus(connection, now)).toEqual({
        state: "unresponsive",
        worker,
        heartbeatAgeMs: null,
      });

      await connection.set(WORKER_HEARTBEAT_KEY, String(now - 1_000));
      expect(await readWorkerStatus(connection, now)).toEqual({ state: "running", worker, heartbeatAgeMs: 1_000 });

      await connection.set(WORKER_HEARTBEAT_KEY, String(now - 20_000));
      expect(await readWorkerStatus(connection, now)).toEqual({
        state: "unresponsive",
        worker,
        heartbeatAgeMs: 20_000,
      });
    });
  });

  describe("holding", () => {
    it("renews its own lock, takes it back when it vanished, and reports when another worker holds it", async () => {
      const lock = await acquire();
      await connection.pexpire(WORKER_LOCK_KEY, 1_000);

      expect(await lock.renew()).toBe("held");
      expect(await connection.pttl(WORKER_LOCK_KEY)).toBeGreaterThan(1_000);

      await connection.del(WORKER_LOCK_KEY);
      expect(await lock.renew()).toBe("reacquired");
      expect(await connection.get(WORKER_LOCK_KEY)).toBe(JSON.stringify(lock.identity));

      const rival = JSON.stringify(identity({ dataDir: "/rival" }));
      await connection.set(WORKER_LOCK_KEY, rival);
      expect(await lock.renew()).toBe("lost");
      expect(await connection.get(WORKER_LOCK_KEY)).toBe(rival);
    });

    it("releases only its own lock", async () => {
      const first = await acquire();
      await first.release();
      expect(await connection.get(WORKER_LOCK_KEY)).toBeNull();

      const second = await acquire("/second/checkout/data");
      await first.release();

      expect(await connection.get(WORKER_LOCK_KEY)).toBe(JSON.stringify(second.identity));
    });
  });

  describe("heartbeat", () => {
    it("beats at once, keeps the lock alive, and calls back once when another worker holds the lock", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const onLockLost = vi.fn();
      const lock = await acquire();
      await connection.pexpire(WORKER_LOCK_KEY, 1_000);
      const stop = startHeartbeat(connection, lock, onLockLost);
      try {
        await waitFor(async () => (await connection.pttl(WORKER_LOCK_KEY)) > 1_000);
        expect(Number(await connection.get(WORKER_HEARTBEAT_KEY))).toBeGreaterThan(Date.now() - 5_000);
        expect(onLockLost).not.toHaveBeenCalled();

        await connection.set(WORKER_LOCK_KEY, "another worker");
        await vi.advanceTimersByTimeAsync(WORKER_HEARTBEAT_INTERVAL_MS);
        await waitFor(async () => onLockLost.mock.calls.length > 0);

        await vi.advanceTimersByTimeAsync(WORKER_HEARTBEAT_INTERVAL_MS * 3);
        await sleep(200);
        expect(onLockLost).toHaveBeenCalledTimes(1);
        expect(await connection.get(WORKER_LOCK_KEY)).toBe("another worker");
      } finally {
        stop();
        vi.useRealTimers();
      }
    });
  });

  describe("the worker scripts", () => {
    const execFileAsync = promisify(execFile);
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    const projectRoot = path.resolve(import.meta.dirname, "../..");
    let scratchDir: string;

    interface ScriptRun {
      code: number;
      stdout: string;
      stderr: string;
    }

    function isExecFailure(error: unknown): error is { code: number; stdout: string; stderr: string } {
      return typeof error === "object" && error !== null && "code" in error && "stdout" in error && "stderr" in error;
    }

    async function runScript(
      script: string,
      args: string[],
      overrides: Record<string, string> = {},
    ): Promise<ScriptRun> {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...OFFLINE_INTEGRATIONS_ENV,
        NODE_ENV: "test",
        DATABASE_URL: `file:${path.join(scratchDir, "unused.db")}`,
        DATA_DIR: scratchDir,
        REDIS_URL,
        ...overrides,
      };
      try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, `scripts/${script}`, ...args], {
          cwd: projectRoot,
          env,
        });
        return { code: 0, stdout, stderr };
      } catch (error) {
        if (!isExecFailure(error)) throw error;
        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
      }
    }

    const runStatusScript = (args: string[], redisUrl: string = REDIS_URL): Promise<ScriptRun> =>
      runScript("worker-status.ts", args, { REDIS_URL: redisUrl });

    async function startFakeWorker(overrides: Partial<WorkerIdentity> = {}): Promise<WorkerIdentity> {
      const worker = identity({ dataDir: "/elsewhere/data", ...overrides });
      await putLock(worker);
      await connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()));
      return worker;
    }

    beforeAll(() => {
      scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-worker-status-"));
    });

    afterAll(() => {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    });

    it("lets a worker start without a word when none is running", async () => {
      const result = await runStatusScript(["--require-stopped"]);

      expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    }, 30_000);

    it("refuses to start another worker and shows the running one's status", async () => {
      const worker = await startFakeWorker();

      const result = await runStatusScript(["--require-stopped"]);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Worker đã chạy rồi, không khởi động thêm.");
      expect(result.stderr).toContain("Worker đang chạy.");
      expect(result.stderr).toMatch(new RegExp(`PID\\s+${worker.pid}`));
      expect(result.stderr).toContain(worker.host);
      expect(result.stderr).toMatch(/Heartbeat\s+\d+ giây trước/);
      expect(result.stderr).toMatch(/Hàng đợi\s+\d+ đang chạy/);
      expect(result.stderr).toContain(`kill ${worker.pid}`);
    }, 30_000);

    it("explains a worker that belongs to another checkout's data folder", async () => {
      await startFakeWorker({ dataDir: "/another/checkout/data" });

      const result = await runStatusScript(["--require-stopped"]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("/another/checkout/data");
      expect(result.stderr).toContain("Redis DB riêng");
    }, 30_000);

    it("reports the status on request: exit 0 while a worker runs, 1 when none does", async () => {
      await startFakeWorker();
      const running = await runStatusScript([]);
      expect(running.code).toBe(0);
      expect(running.stdout).toContain("Worker đang chạy.");
      expect(running.stdout).not.toContain("Muốn chạy lại");

      await connection.del(WORKER_LOCK_KEY, WORKER_HEARTBEAT_KEY);
      const stopped = await runStatusScript([]);
      expect(stopped.code).toBe(1);
      expect(stopped.stdout).toContain("Worker chưa chạy.");
    }, 30_000);

    it("says so when the heartbeat has gone quiet", async () => {
      await putLock(identity());
      await connection.set(WORKER_HEARTBEAT_KEY, String(Date.now() - 60_000));

      const result = await runStatusScript([]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("không phản hồi");
      expect(result.stdout).toMatch(/Heartbeat\s+\d+ phút trước/);
    }, 30_000);

    it("tells you to start Redis when it cannot be reached, and does not let a worker start blind", async () => {
      const guard = await runStatusScript(["--require-stopped"], "redis://127.0.0.1:6399");
      expect(guard.code).toBe(1);
      expect(guard.stderr).toContain("docker compose up -d");

      const plain = await runStatusScript([], "redis://127.0.0.1:6399");
      expect(plain.code).toBe(2);
    }, 30_000);

    it("dev:all starts nothing when the web and the worker already run", async () => {
      await startFakeWorker();
      const web = net.createServer();
      await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
      const address = web.address();
      if (address === null || typeof address === "string") throw new Error("expected a TCP address");
      try {
        const result = await runScript("dev-all.ts", [], { PORT: String(address.port) });

        expect(result.code).toBe(0);
        expect(result.stdout).toContain(`Cổng ${address.port} đang được dùng`);
        expect(result.stdout).toContain("Worker đã chạy rồi, không khởi động thêm.");
        expect(result.stdout).toMatch(/Heartbeat\s+\d+ giây trước/);
        expect(result.stdout).toContain("Web và worker đều đã chạy, không có gì để khởi động.");
        expect(result.stdout).not.toContain("Nhấn Ctrl+C");
      } finally {
        await new Promise<void>((resolve) => web.close(() => resolve()));
      }
    }, 30_000);

    it("dev:all starts nothing, and says why, when Redis cannot be reached", async () => {
      const result = await runScript("dev-all.ts", [], { REDIS_URL: "redis://127.0.0.1:6399" });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("docker compose up -d");
      expect(result.stdout).not.toContain("Nhấn Ctrl+C");
    }, 30_000);
  });
});
