import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VoicePanel } from "@/features/videos/components/voice/voice-panel";
import type { SceneVoiceJobs } from "@/features/videos/domain/voice-queue";
import type { SceneDto } from "@/features/videos/schemas/video.dto";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const clip = {
  assetId: "asset-1",
  provider: "edge-tts",
  durationMs: 2000,
  leadingSilenceMs: 0,
  speedPercent: 0,
  url: "/api/media/asset-1",
  wordBoundaries: null,
};

const scene = (id: string, order: number, withAudio = false): SceneDto => ({
  id,
  order,
  type: order === 0 ? "HOOK" : "SITUATION",
  title: null,
  narration: `Lời ${id}`,
  onScreenText: `Chữ ${id}`,
  visualVariant: "SCENARIO_CARD",
  hookVariant: null,
  estimatedSeconds: 5,
  durationFrames: 150,
  hidden: false,
  version: 1,
  audioAssetId: withAudio ? "asset-1" : null,
  audio: withAudio ? clip : null,
  illustration: null,
});

function panel(scenes: SceneDto[], jobs: SceneVoiceJobs = {}, mode: "edge-tts" | "upload" = "edge-tts") {
  return renderToStaticMarkup(
    <VoicePanel
      videoId="video-1"
      scenes={scenes}
      tts={{ mode, voice: "vi-VN-NamMinhNeural" }}
      pace="STANDARD"
      staleCount={0}
      jobs={jobs}
    />,
  );
}

const button = (html: string, label: string): { disabled: boolean } | undefined => {
  for (const match of html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)) {
    if ((match[2] ?? "").replace(/<[^>]*>/g, "").trim() === label) {
      return { disabled: /\sdisabled(=|\s|>)/.test(match[1] ?? "") };
    }
  }
  return undefined;
};

// The markup of the row that carries this narration.
const row = (html: string, id: string): string =>
  html
    .split("<li ")
    .slice(1)
    .find((part) => part.includes(`Lời ${id}`)) ?? "";

const job = (status: "QUEUED" | "RUNNING" | "FAILED", errorMessage: string | null = null) => ({
  jobId: `job-${status}`,
  status,
  errorMessage,
});

describe("VoicePanel", () => {
  const scenes = [scene("a", 0), scene("b", 1), scene("c", 2), scene("d", 3, true)];

  it("offers to voice every scene that lacks a voice when nothing is queued", () => {
    const html = panel(scenes);

    expect(button(html, "Tạo giọng cho 3 cảnh còn thiếu")).toEqual({ disabled: false });
    expect(html).not.toContain("đang trong hàng đợi tạo giọng");
    expect(row(html, "a")).toContain("Chưa có giọng đọc");
    expect(button(row(html, "a"), "Tạo giọng đọc")).toEqual({ disabled: false });
  });

  it("shows a scene already in the queue as waiting and does not let its voice be asked for again", () => {
    const html = panel(scenes, { a: job("QUEUED") });

    expect(row(html, "a")).toContain("Đang chờ trong hàng đợi");
    expect(row(html, "a")).not.toContain("Chưa có giọng đọc");
    expect(button(row(html, "a"), "Đang trong hàng đợi")).toEqual({ disabled: true });
    expect(button(row(html, "a"), "Tải lên MP3/WAV")).toEqual({ disabled: true });
    // The others are still free, and the panel's button counts only what is not queued yet.
    expect(button(row(html, "b"), "Tạo giọng đọc")).toEqual({ disabled: false });
    expect(button(html, "Tạo giọng cho 2 cảnh còn thiếu")).toEqual({ disabled: false });
    expect(html).toContain("1 cảnh đang trong hàng đợi tạo giọng");
  });

  it("tells a scene being voiced now from one waiting its turn", () => {
    const html = panel(scenes, { a: job("RUNNING"), b: job("QUEUED") });

    expect(row(html, "a")).toContain("Đang tạo giọng…");
    expect(row(html, "b")).toContain("Đang chờ trong hàng đợi");
  });

  it("keeps the clip of a scene that is being voiced again, and locks its buttons", () => {
    const html = panel(scenes, { d: job("RUNNING") });

    expect(row(html, "d")).toContain("Đang tạo giọng…");
    expect(row(html, "d")).toContain("<audio");
    expect(button(row(html, "d"), "Gỡ")).toEqual({ disabled: true });
    expect(button(row(html, "d"), "Thay bằng tệp")).toEqual({ disabled: true });
  });

  it("switches the panel's own button off once every missing scene is in the queue", () => {
    const html = panel(scenes, { a: job("QUEUED"), b: job("QUEUED"), c: job("RUNNING") });

    expect(button(html, "Đang tạo giọng · còn 3 cảnh")).toEqual({ disabled: true });
    expect(html).toContain("3 cảnh đang trong hàng đợi tạo giọng");
  });

  it("says why the last attempt failed and offers to try again", () => {
    const html = panel(scenes, { b: job("FAILED", "edge-tts không trả về âm thanh.") });

    expect(row(html, "b")).toContain("Lần tạo giọng gần nhất lỗi: edge-tts không trả về âm thanh.");
    expect(button(row(html, "b"), "Thử lại")).toEqual({ disabled: false });
    expect(html).not.toContain("đang trong hàng đợi tạo giọng");
    expect(button(html, "Tạo giọng cho 3 cảnh còn thiếu")).toEqual({ disabled: false });
  });

  it("does not repeat an old failure on a scene that has a voice now", () => {
    const html = panel(scenes, { d: job("FAILED", "lỗi cũ") });

    expect(row(html, "d")).not.toContain("lỗi cũ");
  });

  it("says there is nothing to do when every scene has a voice", () => {
    const html = panel([scene("a", 0, true), scene("b", 1, true)]);

    expect(button(html, "Mọi cảnh đã có giọng đọc")).toEqual({ disabled: true });
  });

  it("keeps voices off in upload mode", () => {
    const html = panel(scenes, {}, "upload");

    expect(button(html, "Tạo giọng cho 3 cảnh còn thiếu")).toEqual({ disabled: true });
    expect(button(row(html, "a"), "Tạo giọng đọc")).toEqual({ disabled: true });
  });
});
