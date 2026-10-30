import { describe, expect, it } from "vitest";

import {
  activeVoiceJob,
  summarizeVoice,
  voiceJobLabel,
  type SceneVoiceJobs,
} from "@/features/videos/domain/voice-queue";
import type { SceneVoiceJobDto } from "@/features/videos/schemas/video.dto";

const job = (status: SceneVoiceJobDto["status"], errorMessage: string | null = null): SceneVoiceJobDto => ({
  jobId: `job-${status}`,
  status,
  errorMessage,
});

describe("activeVoiceJob", () => {
  it("returns a voice job that has not finished, whichever step it is at", () => {
    for (const status of ["QUEUED", "RUNNING", "WAITING_FOR_CLI", "CANCEL_REQUESTED"] as const) {
      expect(activeVoiceJob(job(status))?.status).toBe(status);
    }
  });

  it("returns nothing for a failed job, a finished one or no job", () => {
    expect(activeVoiceJob(job("FAILED", "edge-tts lỗi"))).toBeNull();
    expect(activeVoiceJob(job("COMPLETED"))).toBeNull();
    expect(activeVoiceJob(undefined)).toBeNull();
  });
});

describe("voiceJobLabel", () => {
  it("tells a scene waiting its turn from one being voiced now", () => {
    expect(voiceJobLabel("QUEUED")).toBe("Đang chờ trong hàng đợi");
    expect(voiceJobLabel("RUNNING")).toBe("Đang tạo giọng…");
  });

  it("still says something for a status it has no wording for", () => {
    expect(voiceJobLabel("COMPLETED")).toBe("Đang xử lý");
  });
});

describe("summarizeVoice", () => {
  const clip = { assetId: "a" };
  const scenes = [
    { id: "queued-new", audio: null },
    { id: "idle-new", audio: null },
    { id: "failed-new", audio: null },
    { id: "queued-again", audio: clip },
    { id: "done", audio: clip },
  ];
  const jobs: SceneVoiceJobs = {
    "queued-new": job("QUEUED"),
    "failed-new": job("FAILED", "lỗi"),
    "queued-again": job("RUNNING"),
  };

  it("counts what is missing, what is already in the queue and what a request would still send", () => {
    expect(summarizeVoice(scenes, jobs)).toEqual({ missing: 3, queued: 2, toRequest: 2 });
  });

  it("sends every missing scene when nothing is queued, and none when everything is voiced", () => {
    expect(summarizeVoice(scenes, {})).toEqual({ missing: 3, queued: 0, toRequest: 3 });
    expect(summarizeVoice([{ id: "done", audio: clip }], {})).toEqual({ missing: 0, queued: 0, toRequest: 0 });
  });

  it("sends nothing while every missing scene is already queued", () => {
    const allQueued: SceneVoiceJobs = {
      "queued-new": job("QUEUED"),
      "idle-new": job("QUEUED"),
      "failed-new": job("QUEUED"),
    };

    expect(summarizeVoice(scenes, allQueued)).toMatchObject({ missing: 3, toRequest: 0 });
  });
});
