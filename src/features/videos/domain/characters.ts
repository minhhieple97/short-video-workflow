import { z } from "zod";

import type { PeepLook } from "@/remotion/peeps/peep";

export const CHARACTER_PRESET_IDS = [
  "man-short",
  "man-glasses",
  "man-pomp",
  "woman-long",
  "woman-bun",
  "woman-bangs",
] as const;
export const CHARACTER_PRESETS: Record<
  (typeof CHARACTER_PRESET_IDS)[number],
  { label: string; gender: "MALE" | "FEMALE"; look: PeepLook }
> = {
  "man-short": { label: "Nam · tóc ngắn", gender: "MALE", look: { hair: "Short", line: "#202124", fill: "#faf8f2" } },
  "man-glasses": {
    label: "Nam · đeo kính",
    gender: "MALE",
    look: { hair: "ShortMessy", accessory: "GlassRound", line: "#202124", fill: "#faf8f2" },
  },
  "man-pomp": {
    label: "Nam · tóc vuốt",
    gender: "MALE",
    look: { hair: "Pomp", facialHair: "MoustacheThin", line: "#202124", fill: "#faf8f2" },
  },
  "woman-long": { label: "Nữ · tóc dài", gender: "FEMALE", look: { hair: "Long", line: "#202124", fill: "#faf8f2" } },
  "woman-bun": {
    label: "Nữ · tóc búi",
    gender: "FEMALE",
    look: { hair: "Bun", accessory: "GlassRoundThick", line: "#202124", fill: "#faf8f2" },
  },
  "woman-bangs": {
    label: "Nữ · tóc mái",
    gender: "FEMALE",
    look: { hair: "LongBangs", line: "#202124", fill: "#faf8f2" },
  },
};

export const characterProfileSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(60),
  name: z.string().trim().min(1).max(40),
  pronoun: z.string().trim().min(1).max(20),
  presetId: z.enum(CHARACTER_PRESET_IDS),
  enabled: z.boolean(),
});
export type CharacterProfile = z.infer<typeof characterProfileSchema>;

export const characterSettingsSchema = z
  .strictObject({
    primaryCharacterId: z.string().min(1),
    maxCharacters: z.number().int().min(1),
    profiles: z.array(characterProfileSchema).min(1).max(CHARACTER_PRESET_IDS.length),
  })
  .superRefine((settings, context) => {
    settings.profiles.forEach((profile, index) => {
      const gender = CHARACTER_PRESETS[profile.presetId].gender;
      const pronoun = profile.pronoun.toLocaleLowerCase("vi-VN").split(/\s+/)[0];
      const opposite = gender === "MALE" ? ["chị", "cô", "bà", "dì"] : ["anh", "chú", "ông", "cậu"];
      if (pronoun && opposite.includes(pronoun))
        context.addIssue({
          code: "custom",
          path: ["profiles", index, "pronoun"],
          message: `Cách xưng hô của ${profile.name} không khớp giới tính tạo hình.`,
        });
    });
    const enabled = settings.profiles.filter((profile) => profile.enabled);
    if (!enabled.some((profile) => profile.id === settings.primaryCharacterId))
      context.addIssue({ code: "custom", path: ["primaryCharacterId"], message: "Nhân vật chính phải đang bật." });
    if (settings.maxCharacters > enabled.length)
      context.addIssue({
        code: "custom",
        path: ["maxCharacters"],
        message: "Giới hạn không được vượt số nhân vật đang bật.",
      });
    for (const key of ["id", "name"] as const) {
      const values = settings.profiles.map((profile) => profile[key].normalize("NFC").toLocaleLowerCase("vi-VN"));
      if (new Set(values).size !== values.length)
        context.addIssue({ code: "custom", path: ["profiles"], message: "ID và tên nhân vật không được trùng." });
    }
  });
export type CharacterSettings = z.infer<typeof characterSettingsSchema>;

export const DEFAULT_CHARACTERS: CharacterSettings = {
  primaryCharacterId: "hoang",
  maxCharacters: CHARACTER_PRESET_IDS.length,
  profiles: [
    { id: "hoang", name: "Hoàng", pronoun: "anh", presetId: "man-short", enabled: true },
    { id: "minh", name: "Minh", pronoun: "anh", presetId: "man-glasses", enabled: true },
    { id: "nam", name: "Nam", pronoun: "anh", presetId: "man-pomp", enabled: true },
    { id: "linh", name: "Linh", pronoun: "chị", presetId: "woman-long", enabled: true },
    { id: "mai", name: "Mai", pronoun: "chị", presetId: "woman-bun", enabled: true },
    { id: "thao", name: "Thảo", pronoun: "chị", presetId: "woman-bangs", enabled: true },
  ],
};

export const castSnapshotSchema = z
  .object({
    primaryCharacterId: z.string(),
    profiles: z
      .array(
        characterProfileSchema.extend({
          role: z.string().min(1).max(160),
          gender: z.enum(["MALE", "FEMALE"]),
          look: z.object({
            hair: z.enum(["Short", "ShortMessy", "Pomp", "Long", "Bun", "LongBangs"]),
            accessory: z.enum(["GlassRound", "GlassRoundThick"]).optional(),
            facialHair: z.literal("MoustacheThin").optional(),
            line: z.string(),
            fill: z.string(),
          }),
        }),
      )
      .min(1),
  })
  .superRefine((cast, context) => {
    const ids = cast.profiles.map((profile) => profile.id);
    if (!ids.includes(cast.primaryCharacterId) || new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "Dàn nhân vật thiếu người chính hoặc trùng ID.",
      });
  });
export type CastSnapshot = z.infer<typeof castSnapshotSchema>;

export function captureCast(
  settings: CharacterSettings,
  choices: readonly { characterId: string; role: string }[],
): CastSnapshot {
  const ids = choices.map((choice) => choice.characterId);
  if (
    !ids.includes(settings.primaryCharacterId) ||
    new Set(ids).size !== ids.length ||
    ids.length > settings.maxCharacters
  )
    throw new Error("Dàn nhân vật không hợp lệ.");
  const profiles = choices.map((choice) => {
    const profile = settings.profiles.find((candidate) => candidate.id === choice.characterId && candidate.enabled);
    if (!profile) throw new Error("Nhân vật không thuộc thư viện đang bật.");
    const preset = CHARACTER_PRESETS[profile.presetId];
    return { ...profile, role: choice.role, gender: preset.gender, look: { ...preset.look } };
  });
  return castSnapshotSchema.parse({ primaryCharacterId: settings.primaryCharacterId, profiles });
}
