import { Job } from "bullmq";

import { listUndeliveredJobRecordIds } from "@/features/jobs/repositories/job-dispatch.repository";
import {
  listUnsettledJobRecords,
  markJobCancelled,
  markJobCompleted,
  markJobFailed,
} from "@/features/jobs/repositories/job-record.repository";
import { releaseJobEntity } from "@/features/jobs/services/job-effects";
import type { StudioQueues } from "@/server/queue/producer";
import { createLogger } from "@/shared/logger";

const logger = createLogger("worker.reconcile");
const LOST_MESSAGE = "Tác vụ không còn trong hàng đợi (Redis đã bị xoá hoặc dọn dẹp). Hãy thử lại.";

// JobRecord is only a read model: on start-up it is re-aligned with what BullMQ actually holds.
// A job whose outbox row is still undelivered (or delayed) is not in Redis yet by design, so it is not lost.
// A job record does not say which lane its job went to, so each queue is asked until one holds it.
async function findJob(queues: StudioQueues, bullmqJobId: string): Promise<Job | undefined> {
  for (const queue of Object.values(queues)) {
    const job = await Job.fromId(queue, bullmqJobId);
    if (job) return job;
  }
  return undefined;
}

export async function reconcileJobRecords(queues: StudioQueues): Promise<number> {
  const undelivered = await listUndeliveredJobRecordIds();
  let fixed = 0;
  for (const record of await listUnsettledJobRecords()) {
    if (undelivered.has(record.id)) continue;
    const job = await findJob(queues, record.bullmqJobId);
    const state = job ? await job.getState() : "missing";

    if (state === "missing" || state === "unknown") {
      if (record.status === "CANCEL_REQUESTED") {
        await markJobCancelled(record.id);
        await releaseJobEntity(record, "CANCELLED", "Đã huỷ.");
      } else {
        await markJobFailed(record.id, "JOB_LOST", LOST_MESSAGE);
        await releaseJobEntity(record, "FAILED", LOST_MESSAGE);
      }
      fixed += 1;
    } else if (state === "completed" && record.status !== "COMPLETED") {
      await markJobCompleted(record.id);
      fixed += 1;
    } else if (state === "failed") {
      await markJobFailed(record.id, "PROCESSOR_ERROR", job?.failedReason ?? "Tác vụ thất bại.");
      await releaseJobEntity(record, "FAILED", job?.failedReason ?? "Tác vụ thất bại.");
      fixed += 1;
    }
  }
  if (fixed > 0) logger.info("Reconciled job records", { fixed });
  return fixed;
}
