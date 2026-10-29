import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processGeneratePublishMetadata } from "@/worker/processors/generate-publish-metadata";

const generation = vi.hoisted(() => ({ runPublishMetadataGeneration: vi.fn() }));

vi.mock("@/features/videos/services/publish-generation.service", () => generation);

function contextFor() {
  const reportProgress = vi.fn().mockResolvedValue(undefined);
  const context = {
    job: { data: { jobRecordId: "job-1", videoId: "video-1" } } as unknown as Job,
    jobRecordId: "job-1",
    signal: new AbortController().signal,
    reportProgress,
  };
  return { context, reportProgress };
}

describe("generate-publish-metadata processor", () => {
  beforeEach(() => generation.runPublishMetadataGeneration.mockReset());

  it("hands `pnpm ai:run` what it needs to queue the job again, and stays below 100% while waiting", async () => {
    const waiting = { waitingForCli: true, taskDir: "ai-tasks/job-1" };
    generation.runPublishMetadataGeneration.mockResolvedValue(waiting);
    const { context, reportProgress } = contextFor();

    await expect(processGeneratePublishMetadata(context)).resolves.toEqual(waiting);

    expect(generation.runPublishMetadataGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: "video-1",
        jobRecordId: "job-1",
        resume: { jobType: "GENERATE_PUBLISH_METADATA", payload: { videoId: "video-1" } },
      }),
    );
    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([10]);
  });

  it("reports 100% once the set is stored", async () => {
    generation.runPublishMetadataGeneration.mockResolvedValue({ hashtags: 5 });
    const { context, reportProgress } = contextFor();

    await processGeneratePublishMetadata(context);

    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([10, 100]);
  });
});
