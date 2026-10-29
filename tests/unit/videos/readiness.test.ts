import { describe, expect, it } from "vitest";

import { HOOK_MAX_FRAMES } from "@/features/videos/domain/duration";
import { runPreflight, type PreflightInput } from "@/features/videos/domain/preflight";
import { assessReadiness, type ReadinessInput } from "@/features/videos/domain/readiness";

type Scene = PreflightInput["scenes"][number];

const scene = (overrides: Partial<Scene> = {}): Scene => ({
  type: "SITUATION",
  onScreenText: "Chữ",
  narration: "Lời",
  durationFrames: 300,
  hidden: false,
  audioAssetId: "audio",
  audio: { leadingSilenceMs: 0 },
  ...overrides,
});

const input = (overrides: Partial<ReadinessInput> = {}): ReadinessInput => ({
  status: "NEEDS_REVIEW",
  maxDurationSec: 60,
  minDurationSec: null,
  scenes: [scene({ type: "HOOK", durationFrames: 90 }), scene(), scene({ type: "ACTION_STEP" })],
  lessons: [{ hasSourceExcerpt: true }],
  ...overrides,
});

describe("the FINAL preflight's approval gate", () => {
  const base = { status: "NEEDS_REVIEW", maxDurationSec: 60, minDurationSec: null, scenes: input().scenes };
  const codes = (value: PreflightInput) => runPreflight(value, "FINAL").blocking.map((issue) => issue.code);

  it("blocks an unapproved script that no automated check vouches for", () => {
    expect(codes(base)).toContain("SCRIPT_NOT_APPROVED");
    expect(codes({ ...base, autoReady: false })).toContain("SCRIPT_NOT_APPROVED");
  });

  it("lets a script through when it is approved by a person or the automated checks passed for it", () => {
    expect(codes({ ...base, status: "APPROVED" })).not.toContain("SCRIPT_NOT_APPROVED");
    expect(codes({ ...base, autoReady: true })).not.toContain("SCRIPT_NOT_APPROVED");
  });

  it("does not gate a draft render either way", () => {
    expect(runPreflight(base, "DRAFT").blocking.map((issue) => issue.code)).not.toContain("SCRIPT_NOT_APPROVED");
  });
});

describe("assessReadiness", () => {
  it("is ready when voicing is done and every FINAL rule holds, without a human approval", () => {
    expect(assessReadiness(input())).toEqual({ ready: true, issues: [] });
  });

  it("is not ready while a visible scene has no audio, but ignores a hidden one", () => {
    const missing = assessReadiness(
      input({ scenes: [scene({ type: "HOOK", durationFrames: 90 }), scene({ audioAssetId: null })] }),
    );
    const hidden = assessReadiness(
      input({ scenes: [scene({ type: "HOOK", durationFrames: 90 }), scene({ audioAssetId: null, hidden: true })] }),
    );

    expect(missing.issues.map((issue) => issue.code)).toEqual(["AUDIO_NOT_READY"]);
    expect(hidden.ready).toBe(true);
  });

  it("blocks a hook longer than 4 seconds (120 frames) and allows exactly 4", () => {
    const longHook = (frames: number) =>
      assessReadiness(input({ scenes: [scene({ type: "HOOK", durationFrames: frames }), scene()] })).issues.map(
        (issue) => issue.code,
      );

    expect(longHook(HOOK_MAX_FRAMES)).toEqual([]);
    expect(longHook(HOOK_MAX_FRAMES + 1)).toContain("HOOK_TOO_LONG");
  });

  it("blocks a video that runs past the range's maximum instead of trimming or speeding up the narration", () => {
    const report = assessReadiness(
      input({
        maxDurationSec: 30,
        scenes: [scene({ type: "HOOK", durationFrames: 90 }), scene({ durationFrames: 900 })],
      }),
    );

    expect(report.ready).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("OVER_TARGET");
  });

  it("blocks a video shorter than the range's minimum, which a person would only be warned about", () => {
    const short = input({ minDurationSec: 30 });

    expect(assessReadiness(short).issues.map((issue) => issue.code)).toEqual(["UNDER_MIN"]);
    expect(runPreflight({ ...short, status: "APPROVED" }, "FINAL")).toMatchObject({
      blocking: [],
      warnings: [expect.objectContaining({ code: "UNDER_MIN" })],
    });
    expect(assessReadiness(input({ minDurationSec: 20 })).ready).toBe(true);
  });

  it("blocks a missing hook and a scene without on-screen text", () => {
    expect(assessReadiness(input({ scenes: [scene(), scene()] })).issues.map((issue) => issue.code)).toContain(
      "HOOK_MISSING",
    );
    expect(
      assessReadiness(
        input({ scenes: [scene({ type: "HOOK", durationFrames: 90 }), scene({ onScreenText: " " })] }),
      ).issues.map((issue) => issue.code),
    ).toContain("EMPTY_TEXT");
  });

  it("blocks a lesson that no longer has a source excerpt, and a video with no lesson at all", () => {
    expect(
      assessReadiness(input({ lessons: [{ hasSourceExcerpt: true }, { hasSourceExcerpt: false }] })).issues.map(
        (i) => i.code,
      ),
    ).toEqual(["SOURCE_MISSING"]);
    expect(assessReadiness(input({ lessons: [] })).issues.map((issue) => issue.code)).toEqual(["SOURCE_MISSING"]);
  });

  it("reports every problem at once so one correction can address them together", () => {
    const report = assessReadiness(
      input({
        maxDurationSec: 30,
        scenes: [scene({ type: "HOOK", durationFrames: 200, audioAssetId: null }), scene({ durationFrames: 900 })],
        lessons: [],
      }),
    );

    expect(report.issues.map((issue) => issue.code).sort()).toEqual(
      ["AUDIO_NOT_READY", "HOOK_TOO_LONG", "OVER_TARGET", "SOURCE_MISSING"].sort(),
    );
  });
});
