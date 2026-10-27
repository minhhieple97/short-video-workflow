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

export type JobProcessor = (context: ProcessorContext) => Promise<unknown>;
