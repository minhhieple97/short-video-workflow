import { describe, expect, it } from "vitest";

import { toCompositionProps } from "@/features/videos/domain/composition-props";
import {
  buildSceneShots,
  MAX_SHOT_FRAMES,
  MIN_SHOT_FRAMES,
  placePlannedShots,
  type ShotCue,
} from "@/features/videos/domain/scene-shots";
import { resolveSceneShots } from "@/features/videos/domain/shot-timeline";
import type { ShotPlan } from "@/features/videos/domain/shot-plan";
import { estimateWordTimings } from "@/features/videos/domain/word-timing";

const cue = (frame: number, extra: Partial<ShotCue> = {}): ShotCue => ({ frame, card: false, ...extra });
const lengths = (shots: readonly { durationInFrames: number }[]) => shots.map((shot) => shot.durationInFrames);

describe("placing planned shots on a scene's frames", () => {
  it("starts on frame 0 and on each cue, covering the scene exactly", () => {
    const shots = placePlannedShots([cue(0), cue(90), cue(200)], [], 300, "WIDE", "STAGE");
    expect(shots.map((shot) => [shot.startFrame, shot.plan])).toEqual([
      [0, 0],
      [90, 1],
      [200, 2],
    ]);
    expect(lengths(shots).reduce((sum, length) => sum + length, 0)).toBe(300);
  });

  it("moves a cut onto a caption page turn close by, and leaves it where it is otherwise", () => {
    const shots = placePlannedShots([cue(0), cue(90), cue(200)], [0, 98, 170], 300, "WIDE", "STAGE");
    expect(shots.map((shot) => shot.startFrame)).toEqual([0, 98, 200]);
  });

  it("skips a cue that would leave a shot under the minimum, keeping the picture before it", () => {
    const shots = placePlannedShots([cue(0), cue(MIN_SHOT_FRAMES - 10), cue(120), cue(290)], [], 320, "WIDE", "STAGE");
    expect([...new Set(shots.map((shot) => shot.plan))]).toEqual([0, 2]);
  });

  it("cuts a long cartoon shot into pieces that alternate the camera, but never a card", () => {
    const stage = placePlannedShots([cue(0, { size: "CLOSE" })], [], 400, "WIDE", "STAGE");
    expect(stage.length).toBeGreaterThan(1);
    expect(stage.every((shot) => shot.durationInFrames <= MAX_SHOT_FRAMES && shot.plan === 0)).toBe(true);
    expect(stage.map((shot) => shot.size).slice(0, 3)).toEqual(["CLOSE", "WIDE", "MEDIUM"]);
    expect(placePlannedShots([cue(0, { card: true })], [], 400, "WIDE", "STAGE")).toHaveLength(1);
  });

  it("merges plain shots of a text scene, so only a card starts or ends one", () => {
    const cues = [cue(0, { card: true }), cue(100), cue(200), cue(300, { card: true })];
    const shots = placePlannedShots(cues, [], 400, "WIDE", "TEXT");
    expect(shots.map((shot) => [shot.startFrame, shot.plan])).toEqual([
      [0, 0],
      [100, 1],
      [300, 3],
    ]);
  });
});

describe("resolving a scene's shots", () => {
  const narration = "Minh hứa sẽ đọc sách mỗi tối. Nhưng mười một giờ đêm, anh vẫn lướt điện thoại mãi không thôi.";
  const words = estimateWordTimings(narration, { startMs: 0, endMs: 9000 });
  const base = { setting: "HOME", action: "PHONE" } as const;
  const resolve = (plan: ShotPlan | null) =>
    resolveSceneShots({
      plan,
      base,
      words,
      pageStarts: [],
      sceneFrames: 300,
      fps: 30,
      mode: "STAGE",
      startWith: "WIDE",
    });

  it("cuts where the cued word is spoken and carries the place and pose until a shot changes them", () => {
    const shots = resolve([
      { fromWord: 0, mood: "TIRED", props: [{ id: "MOBILE_PHONE" }] },
      { fromWord: 7, setting: "NIGHT_ROOM", tag: "23:00" },
      { fromWord: 14, action: "WORRIED", partner: "TALKING" },
    ]);
    const nhung = words[7];
    expect(shots[1]?.startFrame).toBe(Math.round(((nhung?.startMs ?? 0) / 1000) * 30));
    expect(shots.map((shot) => [shot.setting, shot.action])).toEqual([
      ["HOME", "PHONE"],
      ["NIGHT_ROOM", "PHONE"],
      ["NIGHT_ROOM", "WORRIED"],
    ]);
    expect(shots.map((shot) => [shot.mood, shot.tag, shot.partner, shot.props.length])).toEqual([
      ["TIRED", null, null, 1],
      [null, "23:00", null, 0],
      [null, null, "TALKING", 0],
    ]);
  });

  it("draws a scene without a plan as before: its illustration cut at the caption pages", () => {
    const pageStarts = [0, 80, 170, 240];
    const legacy = resolveSceneShots({
      plan: null,
      base,
      words,
      pageStarts,
      sceneFrames: 300,
      fps: 30,
      mode: "STAGE",
      startWith: "MEDIUM",
    });
    expect(legacy.map(({ startFrame, durationInFrames, size }) => ({ startFrame, durationInFrames, size }))).toEqual(
      buildSceneShots(pageStarts, 300, "STAGE", "MEDIUM"),
    );
    expect(legacy.every((shot) => shot.setting === "HOME" && shot.card === null && shot.props.length === 0)).toBe(true);
  });

  it("reaches the composition props, with the hook's first shot on frame 0", () => {
    const props = toCompositionProps({
      title: "Video",
      book: { title: "Sách" },
      scenes: [
        {
          id: "h",
          type: "HOOK",
          visualVariant: "HOOK_QUESTION",
          narration,
          onScreenText: "Vì sao?",
          durationFrames: 300,
          hidden: false,
          audioAssetId: null,
          shots: [
            { fromWord: 0, card: { style: "PUNCH", lines: ["Vì sao?"] } },
            { fromWord: 7, action: "WORRIED" },
          ],
        },
      ],
    });
    const shots = props.scenes[0]?.shots ?? [];
    expect(shots[0]).toMatchObject({ startFrame: 0, card: { style: "PUNCH" } });
    expect(shots.slice(1).every((shot) => shot.card === null && shot.action === "WORRIED")).toBe(true);
  });
});
