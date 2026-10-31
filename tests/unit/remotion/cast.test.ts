import { describe, expect, it } from "vitest";

import { captureCast, CHARACTER_PRESETS, DEFAULT_CHARACTERS } from "@/features/videos/domain/characters";
import { castFor, castFromSnapshot, resolveCast } from "@/remotion/stage/cast";

const everyone = captureCast(
  DEFAULT_CHARACTERS,
  DEFAULT_CHARACTERS.profiles.map((profile) => ({ characterId: profile.id, role: "Một vai" })),
);

describe("a video's cast in the renderer", () => {
  it("gives each person the look captured for their ID, whoever they stand beside", () => {
    const cast = castFromSnapshot(everyone);
    expect(Object.keys(cast.characters ?? {}).sort()).toEqual(DEFAULT_CHARACTERS.profiles.map((p) => p.id).sort());
    for (const profile of DEFAULT_CHARACTERS.profiles)
      expect(cast.characters?.[profile.id]).toEqual(CHARACTER_PRESETS[profile.presetId].look);
    expect(cast.main).toEqual(cast.characters?.[everyone.primaryCharacterId]);
  });

  it("does not let the title decide who appears when the video carries its cast", () => {
    expect(resolveCast("Tiêu đề thứ nhất", everyone)).toEqual(resolveCast("Một tiêu đề hoàn toàn khác", everyone));
    expect(resolveCast("Tiêu đề thứ nhất", everyone).characters).toBeDefined();
  });

  it("still draws a video made before characters had IDs from its title, exactly as before", () => {
    const legacy = resolveCast("Tiêu đề thứ nhất", undefined);
    expect(legacy).toEqual(castFor("Tiêu đề thứ nhất"));
    expect(legacy.characters).toBeUndefined();
    const titles = ["A", "B", "C", "D", "E", "F", "G", "H"];
    expect(new Set(titles.map((title) => resolveCast(title, undefined).main.hair)).size).toBeGreaterThan(2);
  });

  it("refuses a cast whose protagonist has no look instead of drawing someone else", () => {
    const broken = { ...everyone, primaryCharacterId: "không-có" };
    expect(() => castFromSnapshot(broken)).toThrow("primary character");
  });
});
