import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processRenderVideo } from "@/worker/processors/render-video";

const mocks = vi.hoisted(() => ({ runRender: vi.fn(), requestRenderArchive: vi.fn() }));

vi.mock("@/features/videos/services/render-runner", () => ({ runRender: mocks.runRender }));
vi.mock("@/features/archive/services/archive-request.service", () => ({
  requestRenderArchive: mocks.requestRenderArchive,
}));

const context = () =>
  ({
    job: { data: { jobRecordId: "job-1", renderId: "render-1" } } as unknown as Job,
    jobRecordId: "job-1",
    lane: "render",
    signal: new AbortController().signal,
    reportProgress: vi.fn().mockResolvedValue(undefined),
  }) as const;

describe("render-video processor and the archive", () => {
  beforeEach(() => {
    mocks.runRender.mockReset().mockResolvedValue({ renderId: "render-1", durationMs: 8000 });
    mocks.requestRenderArchive.mockReset().mockResolvedValue({ status: "REQUESTED", archiveId: "a", created: true });
  });

  it("asks for the render's archive once the render is done", async () => {
    await expect(processRenderVideo(context())).resolves.toEqual({ renderId: "render-1", durationMs: 8000 });

    expect(mocks.requestRenderArchive).toHaveBeenCalledWith("render-1");
    expect(mocks.runRender.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requestRenderArchive.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps the finished render when the archive cannot be started now", async () => {
    mocks.requestRenderArchive.mockRejectedValue(new Error("database is locked"));

    await expect(processRenderVideo(context())).resolves.toEqual({ renderId: "render-1", durationMs: 8000 });
  });

  it("asks for no archive when the render fails", async () => {
    mocks.runRender.mockRejectedValue(new Error("chromium crashed"));

    await expect(processRenderVideo(context())).rejects.toThrow("chromium crashed");
    expect(mocks.requestRenderArchive).not.toHaveBeenCalled();
  });
});
