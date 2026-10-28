import type { Job } from "bullmq";

export interface ProcessorContext {
  job: Job;
  jobRecordId: string;
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

export type JobProcessor = (context: ProcessorContext) => Promise<unknown>;
