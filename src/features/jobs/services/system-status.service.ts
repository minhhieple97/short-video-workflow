import { checkWorkerHeartbeat } from "@/server/diagnostics/checks/worker-heartbeat";
import { getAppConfig } from "@/shared/config/env";
import type { SystemStatusDto } from "@/shared/types/system-status";

import { countActiveJobRecords } from "../repositories/job-record.repository";

// Cheap enough for the sidebar to poll: one Redis GET, one indexed COUNT, no process spawning.
export async function getSystemStatus(): Promise<SystemStatusDto> {
  const [worker, activeJobs] = await Promise.all([checkWorkerHeartbeat(), countActiveJobRecords()]);
  return {
    worker: worker.status === "ok" ? "running" : "stopped",
    activeJobs,
    aiMode: getAppConfig().ai.mode,
  };
}
