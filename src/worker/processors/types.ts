import type { Job } from "bullmq";

export interface ProcessorContext {
  job: Job;
  jobRecordId: string;
  reportProgress: (progress: number) => Promise<void>;
}

export type JobProcessor = (context: ProcessorContext) => Promise<unknown>;
