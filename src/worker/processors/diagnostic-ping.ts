import { diagnosticPingPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";

import type { JobProcessor } from "./types";

export const processDiagnosticPing: JobProcessor = async ({ job, reportProgress }) => {
  const payload = diagnosticPingPayloadSchema.parse(job.data);
  await reportProgress(50);

  const result = {
    message: payload.message,
    jobId: job.id,
    workerPid: process.pid,
    processedAt: new Date().toISOString(),
  };
  await writeFileAtomic(dataPath("diagnostics", "last-ping.json"), `${JSON.stringify(result, null, 2)}\n`);

  await reportProgress(100);
  return result;
};
