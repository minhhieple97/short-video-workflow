import { describe, expect, it } from "vitest";

import { buildCaptionCues, splitCaptionPhrases } from "@/features/videos/domain/captions";
import { shortVideoPropsSchema, toCompositionProps, totalFrames } from "@/features/videos/domain/composition-props";
import { HOOK_MAX_FRAMES, HOOK_MAX_SECONDS, MIN_SCENE_FRAMES } from "@/features/videos/domain/duration";
import { runPreflight, type PreflightInput } from "@/features/videos/domain/preflight";
import { CONTENT_SAFE_AREA, SAFE_ZONE_DEFAULTS } from "@/features/videos/domain/safe-zones";

const scene = (overrides: Partial<PreflightInput["scenes"][number]> = {}) => ({
  type: "SITUATION" as const,
  onScreenText: "Tình huống",
  narration: "Một người muốn tập thể dục sau giờ làm.",
  durationFrames: 150,
  hidden: false,
  audioAssetId: "audio",
  ...overrides,
});

const hook = scene({ type: "HOOK", onScreenText: "VÌ SAO?", durationFrames: 75 });
const input = (overrides: Partial<PreflightInput> = {}): PreflightInput => ({
  status: "APPROVED",
  targetDurationSec: 60,
  scenes: [hook, scene(), scene({ type: "ACTION_STEP" })],
  ...overrides,
});

describe("captions", () => {
  it("splits narration at punctuation and caps phrase length", () => {
    expect(splitCaptionPhrases("Tối nay, mang giày chạy và bước ra cửa.")).toEqual([
      "Tối nay,",
      "mang giày chạy và bước ra cửa.",
    ]);
    expect(splitCaptionPhrases("một hai ba bốn năm sáu bảy tám chín mười mười một")).toHaveLength(2);
  });

  it("times cues proportionally and covers the whole scene", () => {
    const cues = buildCaptionCues("Tối nay, mang giày chạy và bước ra cửa.", 90);
    expect(cues[0]).toMatchObject({ startFrame: 0 });
    expect(cues.at(-1)?.endFrame).toBe(90);
    expect(cues[1]?.startFrame).toBe(cues[0]?.endFrame);
    expect((cues[1]?.endFrame ?? 0) - (cues[1]?.startFrame ?? 0)).toBeGreaterThan(
      (cues[0]?.endFrame ?? 0) - (cues[0]?.startFrame ?? 0),
    );
  });
});

describe("composition props", () => {
  const source = {
    title: "Video",
    book: { title: "Sách" },
    scenes: [
      {
        id: "h",
        type: "HOOK" as const,
        visualVariant: "HOOK_QUESTION" as const,
        narration: "Vì sao?",
        onScreenText: "VÌ SAO?",
        durationFrames: 30,
        hidden: false,
        audioAssetId: null,
      },
      {
        id: "x",
        type: "SITUATION" as const,
        visualVariant: "SCENARIO_CARD" as const,
        narration: "Ẩn.",
        onScreenText: "Ẩn",
        durationFrames: 90,
        hidden: true,
        audioAssetId: null,
      },
      {
        id: "a",
        type: "ACTION_STEP" as const,
        visualVariant: "ACTION_CHECKLIST" as const,
        narration: "Làm ngay.",
        onScreenText: "Làm ngay",
        durationFrames: 120,
        hidden: false,
        audioAssetId: "asset-1",
      },
    ],
  };

  it("drops hidden scenes, enforces a readable minimum and resolves audio URLs", () => {
    const props = shortVideoPropsSchema.parse(toCompositionProps(source, (id) => `/api/media/assets/${id}`));
    expect(props.scenes.map((s) => s.id)).toEqual(["h", "a"]);
    expect(props.scenes[0]?.durationInFrames).toBe(MIN_SCENE_FRAMES);
    expect(props.scenes[1]).toMatchObject({ audioSrc: "/api/media/assets/asset-1", label: "Hành động" });
    expect(totalFrames(props)).toBe(MIN_SCENE_FRAMES + 120);
  });
});

describe("preflight", () => {
  it("passes an approved script that fits its preset, warning only about missing audio", () => {
    const report = runPreflight(input({ scenes: [hook, scene({ audioAssetId: null })] }), "FINAL");
    expect(report.blocking).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual(["MISSING_AUDIO"]);
  });

  it("blocks a final render that is over the preset, unapproved or has a long hook, but lets drafts through", () => {
    const risky = input({
      status: "NEEDS_REVIEW",
      targetDurationSec: 30,
      scenes: [scene({ type: "HOOK", durationFrames: HOOK_MAX_FRAMES + 1 }), scene({ durationFrames: 900 })],
    });
    expect(
      runPreflight(risky, "FINAL")
        .blocking.map((issue) => issue.code)
        .sort(),
    ).toEqual(["HOOK_TOO_LONG", "OVER_TARGET", "SCRIPT_NOT_APPROVED"].sort());
    expect(runPreflight(risky, "DRAFT").blocking).toEqual([]);
  });

  it("allows a hook of exactly the limit (4 seconds, 120 frames) and blocks one frame more", () => {
    expect(HOOK_MAX_SECONDS).toBe(4);
    expect(HOOK_MAX_FRAMES).toBe(120);
    const codes = (frames: number) =>
      runPreflight(
        input({ scenes: [scene({ type: "HOOK", durationFrames: frames }), scene({ durationFrames: 600 })] }),
        "FINAL",
      ).blocking.map((issue) => issue.code);

    expect(codes(HOOK_MAX_FRAMES)).not.toContain("HOOK_TOO_LONG");
    expect(codes(HOOK_MAX_FRAMES + 1)).toContain("HOOK_TOO_LONG");
  });

  it("states the limit from the shared constant in its messages", () => {
    const report = runPreflight(
      input({ scenes: [scene({ type: "HOOK", durationFrames: HOOK_MAX_FRAMES + 1 }), scene({ durationFrames: 600 })] }),
      "FINAL",
    );

    expect(report.blocking.find((issue) => issue.code === "HOOK_TOO_LONG")?.message).toContain("tối đa 4s (120 frame)");
  });

  it("always blocks a missing hook, empty text or anything longer than 90 seconds", () => {
    expect(runPreflight(input({ scenes: [scene()] }), "DRAFT").blocking.map((i) => i.code)).toContain("HOOK_MISSING");
    expect(
      runPreflight(input({ scenes: [hook, scene({ onScreenText: " " })] }), "DRAFT").blocking.map((i) => i.code),
    ).toContain("EMPTY_TEXT");
    expect(
      runPreflight(input({ scenes: [hook, scene({ durationFrames: 2800 })] }), "DRAFT").blocking.map((i) => i.code),
    ).toContain("OVER_MAX");
  });
});

describe("safe zones", () => {
  it("lays content inside the strictest platform insets", () => {
    for (const zone of Object.values(SAFE_ZONE_DEFAULTS)) {
      expect(CONTENT_SAFE_AREA.top).toBeGreaterThanOrEqual(zone.top);
      expect(CONTENT_SAFE_AREA.bottom).toBeGreaterThanOrEqual(zone.bottom);
      expect(CONTENT_SAFE_AREA.right).toBeGreaterThanOrEqual(zone.right);
    }
  });
});
