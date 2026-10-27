import { apiRequest } from "@/lib/api-client";
import { isTerminalJobStatus, type JobDto } from "@/shared/types/job";

interface WaitOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  maxAttempts?: number;
  onUpdate?: (job: JobDto) => void;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Polls GET /api/jobs/:id until the job settles (finished or waiting for a terminal step); null on timeout or abort.
export async function waitForJob(jobId: string, options: WaitOptions = {}): Promise<JobDto | null> {
  const { signal, intervalMs = 2_000, maxAttempts = 90, onUpdate } = options;
  for (let attempt = 0; attempt < maxAttempts && !signal?.aborted; attempt += 1) {
    await delay(intervalMs, signal);
    if (signal?.aborted) return null;
    const job = await apiRequest<JobDto>(`/api/jobs/${jobId}`, { signal });
    onUpdate?.(job);
    if (isTerminalJobStatus(job.status) || job.status === "WAITING_FOR_CLI") return job;
  }
  return null;
}
