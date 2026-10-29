import { describe, expect, it } from "vitest";

import { buildArchiveManifest, buildArchiveScript, toArchiveJson } from "@/features/archive/domain/archive-record";
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
