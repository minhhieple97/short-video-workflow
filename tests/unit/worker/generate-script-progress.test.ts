import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processGenerateScript } from "@/worker/processors/generate-script";

const generation = vi.hoisted(() => ({
  runScriptGeneration: vi.fn(),
  runSceneRegeneration: vi.fn(),
}));

vi.mock("@/features/videos/services/script-generation.service", () => generation);

const WAITING = { waitingForCli: true, taskDir: "ai-tasks/job-1" };

function contextFor(data: Record<string, unknown>) {
  const reportProgress = vi.fn().mockResolvedValue(undefined);
  const context = {
    job: { data: { jobRecordId: "job-1", ...data } } as unknown as Job,
    jobRecordId: "job-1",
    signal: new AbortController().signal,
    reportProgress,
  };
  return { context, reportProgress };
}

describe("generate-script processor progress", () => {
  beforeEach(() => {
    generation.runScriptGeneration.mockReset();
    generation.runSceneRegeneration.mockReset();
  });

  it("does not report 100% while the script waits for Claude Code", async () => {
    generation.runScriptGeneration.mockResolvedValue(WAITING);
    const { context, reportProgress } = contextFor({ videoId: "video-1" });

    await expect(processGenerateScript(context)).resolves.toEqual(WAITING);

    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([10]);
  });

  it("does not report 100% while a scene rewrite waits for Claude Code", async () => {
    generation.runSceneRegeneration.mockResolvedValue(WAITING);
    const { context, reportProgress } = contextFor({ videoId: "video-1", sceneId: "scene-1" });

    await processGenerateScript(context);

    expect(generation.runSceneRegeneration).toHaveBeenCalledOnce();
    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([10]);
  });

  it("reports 100% once the script is really generated", async () => {
    generation.runScriptGeneration.mockResolvedValue({ scenes: 6 });
    const { context, reportProgress } = contextFor({ videoId: "video-1" });

    await processGenerateScript(context);

    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([10, 100]);
  });
});
