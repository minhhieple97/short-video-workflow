import { describe, expect, it } from "vitest";

import { detectAudioFormat, framesForAudio, sceneIdsToRevoice } from "@/features/videos/domain/audio";
import { HOOK_MAX_FRAMES } from "@/features/videos/domain/duration";
import { runPreflight } from "@/features/videos/domain/preflight";
import type { SceneDto } from "@/features/videos/schemas/video.dto";
import { hookIssues } from "@/features/videos/services/video-mapper";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("audio helpers", () => {
  it("recognises MP3 and WAV by their bytes, not their names", () => {
    expect(detectAudioFormat(ascii("ID3\u0004\u0000"))).toBe("mp3");
    expect(detectAudioFormat(bytes(0xff, 0xfb, 0x90, 0x64))).toBe("mp3");
    expect(detectAudioFormat(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]))).toBe("wav");
    expect(detectAudioFormat(ascii("not audio at all"))).toBeNull();
  });

  it("derives scene frames from the real audio plus padding", () => {
    expect(framesForAudio(1968, 300)).toBe(69);
    expect(framesForAudio(3024, 300)).toBe(100);
  });
});

const scene = (overrides: Partial<SceneDto> = {}): SceneDto => ({
  id: "hook",
  order: 0,
  type: "HOOK",
  title: null,
  narration: "Vì sao bạn luôn bỏ cuộc?",
  onScreenText: "VÌ SAO?",
  visualVariant: "HOOK_QUESTION",
  hookVariant: "QUESTION",
  illustration: null,
  estimatedSeconds: 2,
  durationFrames: 60,
  hidden: false,
  version: 1,
  audioAssetId: null,
  audio: null,
  ...overrides,
});

describe("hook checks with narration", () => {
  const audio = {
    assetId: "a",
    provider: "upload",
    durationMs: 3024,
    leadingSilenceMs: 0,
    speedPercent: null,
    url: "/x",
  };

  it("uses the real clip length once audio is attached", () => {
    expect(hookIssues([scene()])).toEqual([]);
    expect(hookIssues([scene({ audioAssetId: "a", audio, durationFrames: HOOK_MAX_FRAMES })])).toEqual([]);
    expect(hookIssues([scene({ audioAssetId: "a", audio, durationFrames: HOOK_MAX_FRAMES + 1 })])[0]).toMatch(
      /theo âm thanh/,
    );
  });

  it("warns when the hook narration starts with a long silence", () => {
    const report = runPreflight(
      {
        status: "APPROVED",
        maxDurationSec: 60,
        minDurationSec: null,
        scenes: [scene({ audioAssetId: "a", audio: { ...audio, leadingSilenceMs: 900 }, durationFrames: 80 })],
      },
      "DRAFT",
    );
    expect(report.warnings.map((warning) => warning.code)).toContain("HOOK_SILENCE");
  });
});

describe("sceneIdsToRevoice", () => {
  it("covers scenes with narration, whatever voice they have, but never a clip the user uploaded", () => {
    expect(
      sceneIdsToRevoice([
        { id: "none", narration: "Lời dẫn", audioProvider: null },
        { id: "tts", narration: "Lời dẫn", audioProvider: "edge-tts" },
        { id: "upload", narration: "Lời dẫn", audioProvider: "upload" },
        { id: "empty", narration: "   ", audioProvider: null },
      ]),
    ).toEqual(["none", "tts"]);
  });
});

describe("preflight and the video's pace", () => {
  const base = {
    status: "APPROVED",
    maxDurationSec: 60,
    minDurationSec: null,
    scenes: [scene({ audioAssetId: "a", durationFrames: 80 })],
  };

  it("warns, without blocking, when voices were made at another pace", () => {
    const report = runPreflight({ ...base, staleVoiceSceneCount: 2 }, "FINAL");

    expect(report.warnings.map((warning) => warning.code)).toContain("VOICE_PACE_MISMATCH");
    expect(report.blocking.map((issue) => issue.code)).not.toContain("VOICE_PACE_MISMATCH");
  });

  it("says nothing when every voice matches, or when the pace of a stored render is unknown", () => {
    expect(runPreflight({ ...base, staleVoiceSceneCount: 0 }, "FINAL").warnings.map((w) => w.code)).not.toContain(
      "VOICE_PACE_MISMATCH",
    );
    expect(runPreflight(base, "FINAL").warnings.map((w) => w.code)).not.toContain("VOICE_PACE_MISMATCH");
  });
});
