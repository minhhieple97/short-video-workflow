import type { Job } from "bullmq";

import type { WorkLane } from "@/shared/types/work-lane";

export interface ProcessorContext {
  job: Job;
  jobRecordId: string;
  // The lane whose worker runs the job, so a processor can tell when its next step belongs to another one.
  lane: WorkLane;
  signal: AbortSignal;
  reportProgress: (progress: number) => Promise<void>;
}

// Returned by AI processors when the task now waits for the user to run `pnpm ai:run --job <id>`.
export interface WaitingForCli {
  waitingForCli: true;
  taskDir: string;
}

export function isWaitingForCli(value: unknown): value is WaitingForCli {
  return typeof value === "object" && value !== null && "waitingForCli" in value && value.waitingForCli === true;
}

// Returned when a remote operation is still pending: the job ends here so the worker is free, and the outbox
// delivers the same JobRecord again after retryAfterMs.
export interface Deferred {
  deferred: true;
  retryAfterMs: number;
}

export function deferred(retryAfterMs: number): Deferred {
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    throw new RangeError("retryAfterMs must be a positive number of milliseconds");
  }
  return { deferred: true, retryAfterMs: Math.ceil(retryAfterMs) };
}

export function isDeferred(value: unknown): value is Deferred {
  return typeof value === "object" && value !== null && "deferred" in value && value.deferred === true;
}

// Returned when the job's next step belongs to another lane: the same JobRecord goes to that lane's queue right away.
export interface Handoff {
  handoff: true;
  lane: WorkLane;
}

export function handoff(lane: WorkLane): Handoff {
  return { handoff: true, lane };
}

export function isHandoff(value: unknown): value is Handoff {
  return typeof value === "object" && value !== null && "handoff" in value && value.handoff === true;
}

export type JobProcessor = (context: ProcessorContext) => Promise<unknown>;
