import { describe, expect, it } from "vitest";

import { captureCast, DEFAULT_CHARACTERS } from "@/features/videos/domain/characters";
import { runPreflight } from "@/features/videos/domain/preflight";
import {
  currentSnapshotIdentity,
  fingerprintRenderSnapshot,
  readStoredRenderSnapshot,
  renderSnapshotSchema,
  toCompositionSource,
  toPreflightInput,
  type RenderSnapshot,
} from "@/features/videos/domain/render-snapshot";
import { RENDER_TEMPLATE_VERSION, toCompositionProps } from "@/features/videos/domain/composition-props";

const scene = (overrides: Partial<RenderSnapshot["scenes"][number]> = {}): RenderSnapshot["scenes"][number] => ({
  id: "scene-1",
  order: 0,
  type: "HOOK",
  title: "Hook",
  narration: "Vì sao bạn hoãn việc?",
  onScreenText: "Vì sao?",
  visualVariant: "HOOK_QUESTION",
  hookVariant: "QUESTION",
  durationFrames: 90,
  hidden: false,
  audioAssetId: "asset-1",
  ...overrides,
});

const snapshot = (overrides: Partial<RenderSnapshot> = {}): RenderSnapshot => ({
  ...currentSnapshotIdentity(),
  capturedAt: "2026-10-28T00:00:00.000Z",
  video: {
    id: "v",
    title: "Tiêu đề",
    bookTitle: "Sách",
    targetDurationSec: 60,
    scriptVersion: 3,
    status: "NEEDS_REVIEW",
    autoReady: true,
  },
  render: { quality: "FINAL", width: 1080, height: 1920, fps: 30 },
  scenes: [
    scene(),
    scene({
      id: "scene-2",
      order: 1,
      type: "SITUATION",
      visualVariant: "SCENARIO_CARD",
      hookVariant: null,
      durationFrames: 150,
      audioAssetId: "asset-2",
    }),
  ],
  audio: [
    {
      assetId: "asset-1",
      path: "videos/v/audio/a.mp3",
      mimeType: "audio/mpeg",
      contentHash: "h1",
      durationMs: 2000,
      leadingSilenceMs: 0,
      provider: "edge-tts",
    },
    {
      assetId: "asset-2",
      path: "videos/v/audio/b.mp3",
      mimeType: "audio/mpeg",
      contentHash: "h2",
      durationMs: 4000,
      leadingSilenceMs: 700,
      provider: "edge-tts",
    },
  ],
  lessons: [
    { lessonId: "l", title: "Bài", sources: [{ chapterId: "c", chapterTitle: "Chương", excerpt: "Trích đoạn." }] },
  ],
  ...overrides,
});

describe("render snapshot", () => {
  it("round-trips through its schema and names the template and composition it was made for", () => {
    const value = snapshot();

    expect(renderSnapshotSchema.parse(value)).toEqual(value);
    expect(value).toMatchObject({
      schemaVersion: "render-snapshot-v1",
      templateVersion: RENDER_TEMPLATE_VERSION,
      compositionId: "ShortVideo",
    });
  });

  it("still trusts a snapshot stored before scenes had illustrations, and uses a stored choice when there is one", () => {
    const old = snapshot();
    const stored = JSON.parse(JSON.stringify(old)) as unknown;
    expect(readStoredRenderSnapshot(stored, fingerprintRenderSnapshot(old))).toEqual(old);

    const chosen = snapshot({
      scenes: [scene({ illustration: { setting: "CAFE", action: "TALKING" } }), scene({ id: "s2", order: 1 })],
    });
    const reread = readStoredRenderSnapshot(JSON.parse(JSON.stringify(chosen)), fingerprintRenderSnapshot(chosen));
    expect(reread).toEqual(chosen);
    const props = toCompositionProps(toCompositionSource(chosen));
    expect(props.scenes[0]?.illustration).toEqual({ setting: "CAFE", action: "TALKING" });
  });

  it("keeps the hash of a snapshot stored before renders carried a publish set, and round-trips one that does", () => {
    const old = snapshot();
    expect(readStoredRenderSnapshot(JSON.parse(JSON.stringify(old)), fingerprintRenderSnapshot(old))).toEqual(old);

    const withPublish = snapshot({ publish: { title: "Tiêu đề", caption: "Caption.", hashtags: ["sachhay"] } });
    expect(fingerprintRenderSnapshot(withPublish)).not.toBe(fingerprintRenderSnapshot(old));
    expect(
      readStoredRenderSnapshot(JSON.parse(JSON.stringify(withPublish)), fingerprintRenderSnapshot(withPublish)),
    ).toEqual(withPublish);
  });

  it("keeps the hash of a snapshot stored before shots existed, and draws the shots of one that has them", () => {
    const old = snapshot();
    expect(old.scenes[0]).not.toHaveProperty("shots");
    expect(readStoredRenderSnapshot(JSON.parse(JSON.stringify(old)), fingerprintRenderSnapshot(old))).toEqual(old);

    const planned = snapshot({
      scenes: [
        scene({
          type: "SITUATION",
          visualVariant: "SCENARIO_CARD",
          hookVariant: null,
          audioAssetId: null,
          narration: "Vì sao bạn cứ hoãn việc mãi đến tận đêm khuya?",
          durationFrames: 240,
          shots: [
            { fromWord: 0, card: { style: "PUNCH", lines: ["Vì sao?"] } },
            { fromWord: 5, action: "WORRIED", mood: "TIRED" },
          ],
        }),
      ],
    });
    expect(fingerprintRenderSnapshot(planned)).not.toBe(fingerprintRenderSnapshot(old));
    const reread = readStoredRenderSnapshot(JSON.parse(JSON.stringify(planned)), fingerprintRenderSnapshot(planned));
    expect(reread).toEqual(planned);
    const shots = toCompositionProps(toCompositionSource(planned)).scenes[0]?.shots ?? [];
    expect(shots.map((shot) => [shot.card?.style ?? null, shot.mood])).toEqual([
      ["PUNCH", null],
      [null, "TIRED"],
    ]);
  });

  it("keeps the hash of a snapshot stored before characters were captured, and draws each person by ID from one that has them", () => {
    const old = snapshot();
    expect(old).not.toHaveProperty("cast");
    expect(readStoredRenderSnapshot(JSON.parse(JSON.stringify(old)), fingerprintRenderSnapshot(old))).toEqual(old);
    expect(toCompositionProps(toCompositionSource(old)).cast).toBeUndefined();

    const cast = captureCast(DEFAULT_CHARACTERS, [
      { characterId: "hoang", role: "Người thử cách mới" },
      { characterId: "linh", role: "Người bạn góp ý" },
    ]);
    const withCast = snapshot({
      cast,
      generation: {
        mode: "mock",
        runId: "run-1",
        script: { model: "claude-opus-5-5", effort: "xhigh" },
        scene: { model: "claude-sonnet-5-5", effort: "xhigh" },
        draftPromptVersion: "script-draft-v1",
        scenePromptVersion: "scene-plan-v11",
      },
      scenes: [scene({ shots: [{ fromWord: 0, actors: [{ characterId: "linh", action: "TALKING" }] }] })],
    });
    expect(fingerprintRenderSnapshot(withCast)).not.toBe(fingerprintRenderSnapshot(old));
    const reread = readStoredRenderSnapshot(JSON.parse(JSON.stringify(withCast)), fingerprintRenderSnapshot(withCast));
    expect(reread).toEqual(withCast);
    const props = toCompositionProps(toCompositionSource(withCast));
    expect(props.cast).toEqual(cast);
    expect(props.scenes[0]?.shots.every((shot) => shot.actors?.[0]?.characterId === "linh")).toBe(true);

    const edited = JSON.parse(JSON.stringify(withCast)) as { cast: { profiles: { name: string }[] } };
    if (edited.cast.profiles[0]) edited.cast.profiles[0].name = "Người khác";
    expect(readStoredRenderSnapshot(edited, fingerprintRenderSnapshot(withCast))).toBeNull();
  });

  it("keeps the pace a render was made at, and reads a snapshot stored before paces existed as the default", () => {
    const old = snapshot();
    expect(old.video.pace).toBeUndefined();
    expect(toCompositionProps(toCompositionSource(old)).paceFactor).toBe(1);

    const fast = snapshot({ video: { ...old.video, pace: "FASTER" } });
    const reread = readStoredRenderSnapshot(JSON.parse(JSON.stringify(fast)), fingerprintRenderSnapshot(fast));
    expect(reread?.video.pace).toBe("FASTER");
    expect(toCompositionProps(toCompositionSource(fast)).paceFactor).toBe(1.2);
    expect(fingerprintRenderSnapshot(fast)).not.toBe(fingerprintRenderSnapshot(old));
  });

  it("has a fingerprint that changes with any captured detail", () => {
    const base = fingerprintRenderSnapshot(snapshot());
    const edited = snapshot({
      scenes: [scene({ narration: "Khác" }), snapshot().scenes[1] as RenderSnapshot["scenes"][number]],
    });

    expect(fingerprintRenderSnapshot(snapshot())).toBe(base);
    expect(fingerprintRenderSnapshot(edited)).not.toBe(base);
    expect(fingerprintRenderSnapshot(snapshot({ templateVersion: "short-video-template-other" }))).not.toBe(base);
    expect(fingerprintRenderSnapshot(snapshot({ audio: [] }))).not.toBe(base);
  });

  it("feeds the composition with the snapshot's own scenes, in order, skipping hidden ones", () => {
    const value = snapshot({
      scenes: [
        scene({
          id: "late",
          order: 2,
          type: "ACTION_STEP",
          visualVariant: "ACTION_CHECKLIST",
          hookVariant: null,
          audioAssetId: null,
        }),
        scene({
          id: "hidden",
          order: 1,
          hidden: true,
          type: "SITUATION",
          visualVariant: "SCENARIO_CARD",
          hookVariant: null,
        }),
        scene({ id: "first", order: 0 }),
      ],
    });

    const props = toCompositionProps(toCompositionSource(value), (assetId) => `http://assets/${assetId}`);

    expect(props.scenes.map((item) => item.id)).toEqual(["first", "late"]);
    expect(props.scenes[0]?.audioSrc).toBe("http://assets/asset-1");
    expect(props.scenes[1]?.audioSrc).toBeNull();
    expect(props).toMatchObject({ title: "Tiêu đề", bookTitle: "Sách" });
  });

  it("is judged by the preflight on the facts it captured: the script gate and the audio's leading silence", () => {
    const value = snapshot();

    const report = runPreflight(toPreflightInput(value), "FINAL");

    expect(report.blocking).toEqual([]);
    expect(
      runPreflight(toPreflightInput(snapshot({ video: { ...value.video, autoReady: false } })), "FINAL").blocking.map(
        (i) => i.code,
      ),
    ).toContain("SCRIPT_NOT_APPROVED");
    const silentHook = snapshot({
      audio: [
        {
          assetId: "asset-1",
          path: "p",
          mimeType: "audio/mpeg",
          contentHash: null,
          durationMs: 1,
          leadingSilenceMs: 2000,
          provider: null,
        },
      ],
    });
    expect(runPreflight(toPreflightInput(silentHook), "FINAL").warnings.map((issue) => issue.code)).toContain(
      "HOOK_SILENCE",
    );
  });

  it("rejects a snapshot of another schema version or with a malformed scene", () => {
    expect(renderSnapshotSchema.safeParse({ ...snapshot(), schemaVersion: "render-snapshot-v0" }).success).toBe(false);
    expect(
      renderSnapshotSchema.safeParse({ ...snapshot(), scenes: [{ ...scene(), type: "NOT_A_TYPE" }] }).success,
    ).toBe(false);
  });
});
