import os from "node:os";

import type { Redis } from "ioredis";
import { z } from "zod";

import { AppError } from "@/shared/errors";

import {
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_STALE_AFTER_MS,
  WORKER_LIVENESS_TTL_MS,
  WORKER_LOCK_KEY,
} from "./constants";

const workerIdentitySchema = z.object({
  pid: z.number().int().positive(),
  host: z.string().min(1),
  startedAt: z.iso.datetime(),
  dataDir: z.string().min(1),
});

export type WorkerIdentity = z.infer<typeof workerIdentitySchema>;

export type RunningWorkerStatus =
  | { state: "running"; worker: WorkerIdentity; heartbeatAgeMs: number }
  | { state: "unresponsive"; worker: WorkerIdentity; heartbeatAgeMs: number | null };

export type WorkerStatus = { state: "stopped" } | RunningWorkerStatus;

export type LockRenewal = "held" | "reacquired" | "lost";

export interface WorkerLock {
  readonly identity: WorkerIdentity;
  renew(): Promise<LockRenewal>;
  release(): Promise<void>;
}

export type WorkerLockAttempt = { acquired: true; lock: WorkerLock } | { acquired: false; holder: RunningWorkerStatus };

// Every script acts only while the key still holds exactly the caller's value, so a worker that lost the lock can never
// extend, release or overwrite the new holder's. Scripts, not SET ... IFEQ: that needs Redis 8.4, the compose file pins 7.
const RENEW_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0`;
const RELEASE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`;
const REPLACE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3]) return 1 end return 0`;

const MAX_ACQUIRE_ATTEMPTS = 3;

async function runScript(connection: Redis, script: string, ...args: (string | number)[]): Promise<boolean> {
  return (await connection.eval(script, 1, WORKER_LOCK_KEY, ...args)) === 1;
}

async function setIfAbsent(connection: Redis, value: string): Promise<boolean> {
  return (await connection.set(WORKER_LOCK_KEY, value, "PX", WORKER_LIVENESS_TTL_MS, "NX")) === "OK";
}

async function readKeys(connection: Redis): Promise<{ lock: string | null; heartbeat: string | null }> {
  const [lock, heartbeat] = await connection.mget(WORKER_LOCK_KEY, WORKER_HEARTBEAT_KEY);
  return { lock: lock ?? null, heartbeat: heartbeat ?? null };
}

function parseIdentity(raw: string): WorkerIdentity | null {
  try {
    const parsed = workerIdentitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

// Only a holder on this machine can be proven dead; a lock written from elsewhere has to be left to expire. Waiting out
// the expiry is not an option here: `tsx watch` kills a slow worker with SIGKILL and starts the next one at once.
function isDeadHolder(worker: WorkerIdentity): boolean {
  return worker.host === os.hostname() && !isProcessAlive(worker.pid);
}

function classify(worker: WorkerIdentity, heartbeat: string | null, now: number): RunningWorkerStatus {
  const beatAt = heartbeat === null ? Number.NaN : Number(heartbeat);
  if (!Number.isFinite(beatAt)) return { state: "unresponsive", worker, heartbeatAgeMs: null };
  const heartbeatAgeMs = Math.max(0, now - beatAt);
  return heartbeatAgeMs > WORKER_HEARTBEAT_STALE_AFTER_MS
    ? { state: "unresponsive", worker, heartbeatAgeMs }
    : { state: "running", worker, heartbeatAgeMs };
}

function createLock(connection: Redis, identity: WorkerIdentity, value: string): WorkerLock {
  return {
    identity,
    async renew() {
      if (await runScript(connection, RENEW_SCRIPT, value, WORKER_LIVENESS_TTL_MS)) return "held";
      // Gone rather than taken (Redis was flushed, or a long stall let it lapse): claim it again unless another worker did.
      return (await setIfAbsent(connection, value)) ? "reacquired" : "lost";
    },
    async release() {
      await runScript(connection, RELEASE_SCRIPT, value);
    },
  };
}

// At most one worker may run per Redis database: two would each take jobs and break the concurrency limits (AI 1, render 1).
export async function acquireWorkerLock(connection: Redis, dataDir: string): Promise<WorkerLockAttempt> {
  const identity: WorkerIdentity = {
    pid: process.pid,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
    dataDir,
  };
  const value = JSON.stringify(identity);
  const lock = createLock(connection, identity, value);

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    if (await setIfAbsent(connection, value)) return { acquired: true, lock };

    const { lock: current, heartbeat } = await readKeys(connection);
    if (current === null) continue;
    const holder = parseIdentity(current);
    if (holder !== null && !isDeadHolder(holder)) {
      return { acquired: false, holder: classify(holder, heartbeat, Date.now()) };
    }
    // Left by a worker that no longer exists, or by something that was never one: take it over, but only while it still
    // holds that exact value, so two workers starting together cannot both win.
    if (await runScript(connection, REPLACE_SCRIPT, current, value, WORKER_LIVENESS_TTL_MS)) {
      return { acquired: true, lock };
    }
  }
  throw new AppError("WORKER_LOCK_CONTENDED", "The worker lock kept changing hands; try again.");
}

export async function readWorkerStatus(connection: Redis, now: number = Date.now()): Promise<WorkerStatus> {
  const { lock, heartbeat } = await readKeys(connection);
  const worker = lock === null ? null : parseIdentity(lock);
  if (worker === null || isDeadHolder(worker)) return { state: "stopped" };
  return classify(worker, heartbeat, now);
}
