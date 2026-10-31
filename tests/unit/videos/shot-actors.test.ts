import { describe, expect, it } from "vitest";

import { captureCast, DEFAULT_CHARACTERS } from "@/features/videos/domain/characters";
import { toCompositionProps, type CompositionSource } from "@/features/videos/domain/composition-props";
import {
  aiShotSchema,
  MAX_VISIBLE_CHARACTERS,
  parseShotPlan,
  plannedShotSchema,
  planShots,
  serializeShotPlan,
  shotActorsSchema,
  type ShotPlan,
} from "@/features/videos/domain/shot-plan";

const NARRATION =
  "Minh hứa sẽ đọc sách mỗi tối. Nhưng mười một giờ đêm, anh vẫn lướt điện thoại, rồi lại hứa mai sẽ đọc thật.";
const six = DEFAULT_CHARACTERS.profiles.map((profile) => profile.id);
const cast = captureCast(
  DEFAULT_CHARACTERS,
  six.map((characterId) => ({ characterId, role: "Một vai" })),
);
const sceneOf = (shots: ShotPlan | undefined): CompositionSource["scenes"][number] => ({
  id: "scene",
  type: "SITUATION",
  visualVariant: "SCENARIO_CARD",
  narration: NARRATION,
  onScreenText: "Chữ",
  durationFrames: 420,
  hidden: false,
  audioAssetId: null,
  ...(shots ? { shots } : {}),
});
const source = (shots: ShotPlan | undefined, withCast = true): CompositionSource => ({
  title: "Video",
  book: { title: "Sách" },
  scenes: [sceneOf(shots)],
  ...(withCast ? { cast } : {}),
});
const shotsOf = (props: ReturnType<typeof toCompositionProps>) => props.scenes[0]?.shots ?? [];

describe("people in a shot", () => {
  it("shows at most two, never the same person twice, and only drawn actions", () => {
    expect(MAX_VISIBLE_CHARACTERS).toBe(2);
    const actor = (characterId: string, action = "TALKING") => ({ characterId, action });
    expect(shotActorsSchema.safeParse([]).success).toBe(true);
    expect(shotActorsSchema.safeParse([actor("hoang")]).success).toBe(true);
    expect(shotActorsSchema.safeParse([actor("hoang"), actor("linh", "WORRIED")]).success).toBe(true);
    expect(shotActorsSchema.safeParse([actor("hoang"), actor("linh"), actor("mai")]).success).toBe(false);
    expect(shotActorsSchema.safeParse([actor("hoang"), actor("hoang", "THINKING")]).success).toBe(false);
    expect(shotActorsSchema.safeParse([actor("hoang", "FLYING")]).success).toBe(false);
  });

  it("rejects a model's shot with three people instead of dropping one", () => {
    const actors = ["hoang", "linh", "mai"].map((characterId) => ({ characterId, action: "TALKING" }));
    expect(aiShotSchema.safeParse({ actors }).success).toBe(false);
    expect(aiShotSchema.safeParse({ actors: actors.slice(0, 2) }).success).toBe(true);
  });

  it("is optional on a shot, so a plan stored before characters had IDs reads the same and serialises the same", () => {
    const legacy =
      '[{"fromWord":0,"setting":"HOME","action":"PHONE"},{"fromWord":7,"mood":"TIRED","partner":"TALKING"}]';
    const plan = parseShotPlan(legacy);
    expect(plan?.every((shot) => !("actors" in shot))).toBe(true);
    expect(plan && serializeShotPlan(plan)).toBe(legacy);
    expect(plannedShotSchema.safeParse({ fromWord: 0 }).success).toBe(true);
  });

  it("keeps each shot's people through planning, storing and reading", () => {
    const plan = planShots(NARRATION, [
      { setting: "HOME", actors: [{ characterId: "hoang", action: "PHONE" }] },
      {
        from: "Nhưng mười một giờ",
        actors: [
          { characterId: "linh", action: "TALKING" },
          { characterId: "hoang", action: "WORKING" },
        ],
      },
      { from: "rồi lại hứa", actors: [{ characterId: "thao", action: "THINKING" }] },
    ]);
    expect(plan?.map((shot) => shot.actors?.map((actor) => actor.characterId))).toEqual([
      ["hoang"],
      ["linh", "hoang"],
      ["thao"],
    ]);
    const stored = plan && serializeShotPlan(plan);
    expect(parseShotPlan(stored ?? null)).toEqual(plan);
  });
});

describe("drawing a video's cast", () => {
  const plan: ShotPlan = [
    { fromWord: 0, actors: [{ characterId: "hoang", action: "PHONE" }] },
    {
      fromWord: 7,
      actors: [
        { characterId: "mai", action: "TALKING" },
        { characterId: "nam", action: "WORRIED" },
      ],
    },
    { fromWord: 14, actors: [{ characterId: "thao", action: "THINKING" }] },
  ];

  it("hands every shot the people its plan names, so the third to sixth person appear in later shots", () => {
    const shots = shotsOf(toCompositionProps(source(plan)));
    const seen = new Set(shots.flatMap((shot) => (shot.actors ?? []).map((actor) => actor.characterId)));
    expect([...seen].sort()).toEqual(["hoang", "mai", "nam", "thao"]);
    expect(shots.every((shot) => (shot.actors?.length ?? 0) <= MAX_VISIBLE_CHARACTERS)).toBe(true);
  });

  it("keeps the same people in the pieces a long shot is cut into", () => {
    const shots = shotsOf(
      toCompositionProps(source([{ fromWord: 0, actors: [{ characterId: "minh", action: "TALKING" }] }])),
    );
    expect(shots.length).toBeGreaterThan(1);
    expect(shots.every((shot) => shot.actors?.[0]?.characterId === "minh")).toBe(true);
  });

  it("puts the protagonist in a shot that names nobody, and leaves a card shot's picture alone", () => {
    const shots = shotsOf(
      toCompositionProps(
        source([
          { fromWord: 0, action: "PHONE" },
          { fromWord: 7, card: { style: "PUNCH", lines: ["Vì sao?"] } },
        ]),
      ),
    );
    expect(shots[0]?.actors).toEqual([{ characterId: cast.primaryCharacterId, action: "PHONE" }]);
    expect(shots.find((shot) => shot.card)?.card).toMatchObject({ style: "PUNCH" });
  });

  it("refuses a shot that names someone outside the video's cast", () => {
    const stranger: ShotPlan = [{ fromWord: 0, actors: [{ characterId: "người-lạ", action: "TALKING" }] }];
    expect(() => toCompositionProps(source(stranger))).toThrow("unknown character");
  });

  it("does not change how a video without a cast is drawn", () => {
    const shots = shotsOf(toCompositionProps(source([{ fromWord: 0, action: "PHONE", partner: "TALKING" }], false)));
    expect(shots.every((shot) => shot.actors === undefined)).toBe(true);
    expect(shots[0]).toMatchObject({ action: "PHONE", partner: "TALKING" });
    expect(toCompositionProps(source(undefined, false)).cast).toBeUndefined();
    expect(toCompositionProps(source(undefined)).cast).toEqual(cast);
  });
});
