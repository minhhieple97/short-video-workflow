import { describe, expect, it } from "vitest";

import { aiSettingsSchema, DEFAULT_AI_SETTINGS } from "@/features/settings/domain/ai-settings";
import {
  captureCast,
  castSnapshotSchema,
  CHARACTER_PRESET_IDS,
  CHARACTER_PRESETS,
  characterSettingsSchema,
  DEFAULT_CHARACTERS,
  type CharacterSettings,
} from "@/features/videos/domain/characters";

const settings = (change: (value: CharacterSettings) => void = () => undefined): CharacterSettings => {
  const value = structuredClone(DEFAULT_CHARACTERS);
  change(value);
  return value;
};
const profileAt = (value: CharacterSettings, index: number) => {
  const profile = value.profiles[index];
  if (!profile) throw new Error("Missing fixture profile.");
  return profile;
};

describe("character library", () => {
  it("starts with six Open Peeps presets, three men and three women, each with its own look", () => {
    expect(CHARACTER_PRESET_IDS).toHaveLength(6);
    const genders = CHARACTER_PRESET_IDS.map((id) => CHARACTER_PRESETS[id].gender);
    expect(genders.filter((gender) => gender === "MALE")).toHaveLength(3);
    expect(genders.filter((gender) => gender === "FEMALE")).toHaveLength(3);
    expect(new Set(CHARACTER_PRESET_IDS.map((id) => JSON.stringify(CHARACTER_PRESETS[id].look))).size).toBe(6);
    expect(characterSettingsSchema.safeParse(DEFAULT_CHARACTERS).success).toBe(true);
    expect(DEFAULT_CHARACTERS.profiles.map((profile) => profile.presetId).sort()).toEqual(
      [...CHARACTER_PRESET_IDS].sort(),
    );
  });

  it("keys a person by a stable ID, so renaming never moves the look", () => {
    const renamed = settings((value) => {
      profileAt(value, 0).name = "Hùng";
    });
    expect(characterSettingsSchema.safeParse(renamed).success).toBe(true);
    const before = captureCast(DEFAULT_CHARACTERS, [{ characterId: "hoang", role: "Chính" }]);
    const after = captureCast(renamed, [{ characterId: "hoang", role: "Chính" }]);
    expect(after.profiles[0]).toMatchObject({ id: "hoang", name: "Hùng" });
    expect(after.profiles[0]?.look).toEqual(before.profiles[0]?.look);
  });

  it("refuses settings that contradict themselves", () => {
    const invalid: [string, (value: CharacterSettings) => void][] = [
      [
        "disabled protagonist",
        (value) => {
          profileAt(value, 0).enabled = false;
        },
      ],
      [
        "more people than are enabled",
        (value) => {
          profileAt(value, 5).enabled = false;
        },
      ],
      [
        "duplicate name",
        (value) => {
          profileAt(value, 1).name = profileAt(value, 0).name.toUpperCase();
        },
      ],
      [
        "duplicate id",
        (value) => {
          profileAt(value, 1).id = profileAt(value, 0).id;
        },
      ],
      [
        "a woman's look with a man's address",
        (value) => {
          profileAt(value, 3).pronoun = "anh";
        },
      ],
      [
        "a man's look with a woman's address",
        (value) => {
          profileAt(value, 0).pronoun = "chị";
        },
      ],
      [
        "zero people",
        (value) => {
          value.maxCharacters = 0;
        },
      ],
    ];
    for (const [label, change] of invalid)
      expect(characterSettingsSchema.safeParse(settings(change)).success, label).toBe(false);
  });

  it("lets the user shrink the cast limit down to the people that are enabled", () => {
    const smaller = settings((value) => {
      for (const profile of value.profiles.slice(3)) profile.enabled = false;
      value.maxCharacters = 3;
    });
    expect(characterSettingsSchema.safeParse(smaller).success).toBe(true);
    const tooMany = settings((value) => {
      for (const profile of value.profiles.slice(3)) profile.enabled = false;
    });
    expect(characterSettingsSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("captured cast", () => {
  const choice = (characterId: string) => ({ characterId, role: "Vai trong câu chuyện" });

  it.each([1, 2, 3, 6])("captures %i people with name, pronoun, gender and look from the same profile", (count) => {
    const ids = DEFAULT_CHARACTERS.profiles.slice(0, count).map((profile) => profile.id);
    const cast = captureCast(DEFAULT_CHARACTERS, ids.map(choice));
    expect(castSnapshotSchema.parse(cast)).toEqual(cast);
    expect(cast.profiles.map((profile) => profile.id)).toEqual(ids);
    for (const profile of cast.profiles) {
      const source = DEFAULT_CHARACTERS.profiles.find((candidate) => candidate.id === profile.id);
      expect(profile).toMatchObject({
        name: source?.name,
        pronoun: source?.pronoun,
        gender: CHARACTER_PRESETS[source?.presetId ?? "man-short"].gender,
        look: CHARACTER_PRESETS[source?.presetId ?? "man-short"].look,
      });
    }
  });

  it("is a copy: changing the library afterwards leaves the video's people alone", () => {
    const library = settings();
    const cast = captureCast(library, [choice("hoang"), choice("linh")]);
    profileAt(library, 0).name = "Tên khác";
    profileAt(library, 0).presetId = "woman-bun";
    expect(cast.profiles[0]).toMatchObject({ name: "Hoàng", gender: "MALE" });
    expect(cast.profiles[0]?.look.hair).toBe("Short");
  });

  it("rejects a cast without the protagonist, with repeats, over the limit, or with people outside the library", () => {
    expect(() => captureCast(DEFAULT_CHARACTERS, [choice("linh")])).toThrow();
    expect(() => captureCast(DEFAULT_CHARACTERS, [choice("hoang"), choice("hoang")])).toThrow();
    expect(() => captureCast(DEFAULT_CHARACTERS, [choice("hoang"), choice("không-có")])).toThrow();
    const limited = settings((value) => {
      value.maxCharacters = 2;
    });
    expect(() => captureCast(limited, [choice("hoang"), choice("linh"), choice("mai")])).toThrow();
    const disabled = settings((value) => {
      profileAt(value, 3).enabled = false;
      value.maxCharacters = 5;
    });
    expect(() => captureCast(disabled, [choice("hoang"), choice("linh")])).toThrow();
  });
});

describe("AI settings", () => {
  it("default to Opus for the script and Sonnet for the scene plan, both at xhigh", () => {
    expect(aiSettingsSchema.parse(DEFAULT_AI_SETTINGS)).toMatchObject({
      script: { model: "claude-opus-5-5", effort: "xhigh" },
      scene: { model: "claude-sonnet-5-5", effort: "xhigh" },
    });
  });

  it("wants a full model ID and a known effort, and ignores no unknown field", () => {
    const base = structuredClone(DEFAULT_AI_SETTINGS);
    expect(aiSettingsSchema.safeParse({ ...base, script: { model: "opus", effort: "xhigh" } }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ ...base, script: { model: "claude-opus-5-5", effort: "ultra" } }).success).toBe(
      false,
    );
    expect(aiSettingsSchema.safeParse({ ...base, apiKey: "sk-secret" }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ ...base, scene: { ...base.scene, apiKey: "sk-secret" } }).success).toBe(false);
  });
});
