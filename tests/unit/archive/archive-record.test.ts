import { describe, expect, it } from "vitest";

import { buildArchiveManifest, buildArchiveScript, toArchiveJson } from "@/features/archive/domain/archive-record";
import { captureCast, DEFAULT_CHARACTERS } from "@/features/videos/domain/characters";
import { currentSnapshotIdentity, type RenderSnapshot } from "@/features/videos/domain/render-snapshot";

type SnapshotScene = RenderSnapshot["scenes"][number];

const scene = (order: number, type: SnapshotScene["type"], extra: Partial<SnapshotScene> = {}): SnapshotScene => ({
  id: `scene-${order}`,
  order,
  type,
  title: null,
  narration: `Lời ${order}`,
  onScreenText: `Chữ ${order}`,
  visualVariant: "SCENARIO_CARD",
  hookVariant: null,
  durationFrames: 90,
  hidden: false,
  audioAssetId: null,
  ...extra,
});

const snapshot = (scenes: SnapshotScene[]): RenderSnapshot => ({
  ...currentSnapshotIdentity(),
  capturedAt: "2026-10-29T00:00:00.000Z",
  video: {
    id: "v",
    title: "Video",
    bookTitle: "Sách",
    targetDurationSec: 60,
    scriptVersion: 2,
    status: "NEEDS_REVIEW",
    autoReady: true,
  },
  render: { quality: "FINAL", width: 1080, height: 1920, fps: 30 },
  scenes,
  audio: [],
  lessons: [],
});

const facts = {
  renderId: "r",
  bookId: "b",
  snapshotHash: "h",
  durationMs: 9000,
  completedAt: "2026-10-29T00:01:00.000Z",
};
const digest = { name: "f", bytes: 1, sha256: "s" };
const manifestOf = (value: RenderSnapshot) => buildArchiveManifest(value, facts, { video: digest, script: digest });

describe("illustrative scenes in the Drive record", () => {
  it("marks each scenario made up for the video in script.json and lists the visible ones in manifest.json", () => {
    const value = snapshot([
      scene(0, "HOOK", { illustrative: false }),
      scene(1, "SITUATION", { illustrative: true }),
      scene(2, "COMMON_MISTAKE", { illustrative: false }),
      scene(3, "SITUATION", { illustrative: true, hidden: true }),
    ]);

    expect(buildArchiveScript(value, facts).scenes.map((item) => [item.order, item.illustrative])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(manifestOf(value).illustrativeScenes).toEqual([1]);
    expect(manifestOf(snapshot([scene(0, "HOOK", { illustrative: false })])).illustrativeScenes).toEqual([]);
  });

  it("writes a snapshot from before the mark existed exactly as it was written then", () => {
    const value = snapshot([scene(0, "HOOK"), scene(1, "SITUATION")]);

    expect(toArchiveJson(buildArchiveScript(value, facts))).not.toContain("illustrative");
    expect(toArchiveJson(manifestOf(value))).not.toContain("illustrative");
  });
});

describe("who is in the video, in the Drive record", () => {
  const cast = captureCast(DEFAULT_CHARACTERS, [
    { characterId: "hoang", role: "Người thử cách mới" },
    { characterId: "mai", role: "Người bạn góp ý" },
  ]);
  const generation = {
    mode: "cli-auto" as const,
    runId: "run-1",
    script: { model: "claude-opus-5-5", effort: "xhigh" as const },
    scene: { model: "claude-sonnet-5-5", effort: "xhigh" as const },
    draftPromptVersion: "script-draft-v1",
    scenePromptVersion: "scene-plan-v11",
  };

  it("adds the cast and the models only for a video made with them, and rebuilds an older record as it was", () => {
    const old = snapshot([scene(0, "HOOK")]);
    expect(buildArchiveScript(old, facts)).not.toHaveProperty("cast");
    expect(buildArchiveScript(old, facts)).not.toHaveProperty("generation");
    expect(manifestOf(old)).not.toHaveProperty("cast");
    expect(manifestOf(old)).not.toHaveProperty("generation");

    const made: RenderSnapshot = { ...old, cast, generation };
    const script = buildArchiveScript(made, facts);
    expect(script).toMatchObject({ cast, generation });
    expect(manifestOf(made)).toMatchObject({ cast, generation });
    const { cast: _cast, generation: _generation, ...rest } = script;
    expect(rest).toEqual(buildArchiveScript(old, facts));
  });

  it("takes them from the snapshot, so a later change of the library cannot rewrite a finished record", () => {
    const made: RenderSnapshot = { ...snapshot([scene(0, "HOOK")]), cast, generation };
    const before = toArchiveJson(buildArchiveScript(made, facts));
    const library = structuredClone(DEFAULT_CHARACTERS);
    const first = library.profiles[0];
    if (first) first.name = "Tên mới";
    expect(toArchiveJson(buildArchiveScript(made, facts))).toBe(before);
    const stored = JSON.parse(before) as { cast: { profiles: unknown[] } };
    expect(stored.cast.profiles[0]).toMatchObject({ id: "hoang", name: "Hoàng" });
  });
});
