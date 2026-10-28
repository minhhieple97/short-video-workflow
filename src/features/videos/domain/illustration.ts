import { z } from "zod";

import type { SceneType } from "./scene-types";

// The animated cartoon behind a scene: where it happens and what the character is doing. Fixed lists, so an AI can only
// pick what the renderer knows how to draw.
export const ILLUSTRATION_SETTINGS = ["HOME", "OFFICE", "STREET", "PARK", "CAFE", "CLASSROOM", "NIGHT_ROOM"] as const;
export type IllustrationSetting = (typeof ILLUSTRATION_SETTINGS)[number];

export const CHARACTER_ACTIONS = [
  "THINKING",
  "WORRIED",
  "WORKING",
  "TALKING",
  "WALKING",
  "PHONE",
  "IDEA",
  "CELEBRATING",
] as const;
export type CharacterAction = (typeof CHARACTER_ACTIONS)[number];

export const illustrationSchema = z.object({
  setting: z.enum(ILLUSTRATION_SETTINGS),
  action: z.enum(CHARACTER_ACTIONS),
});
export type Illustration = z.infer<typeof illustrationSchema>;

export const ILLUSTRATION_SETTING_LABELS: Record<IllustrationSetting, string> = {
  HOME: "Ở nhà",
  OFFICE: "Văn phòng",
  STREET: "Đường phố",
  PARK: "Công viên",
  CAFE: "Quán cà phê",
  CLASSROOM: "Lớp học",
  NIGHT_ROOM: "Phòng ban đêm",
};

export const CHARACTER_ACTION_LABELS: Record<CharacterAction, string> = {
  THINKING: "Suy nghĩ",
  WORRIED: "Lo lắng",
  WORKING: "Làm việc",
  TALKING: "Trò chuyện",
  WALKING: "Đi bộ",
  PHONE: "Lướt điện thoại",
  IDEA: "Nảy ra ý tưởng",
  CELEBRATING: "Vui mừng",
};

// Used when a scene has no illustration of its own (scenes made before illustrations existed, or a plan that left one
// out): each part of the story gets a fitting picture.
export const DEFAULT_ILLUSTRATION: Record<SceneType, Illustration> = {
  HOOK: { setting: "STREET", action: "THINKING" },
  SITUATION: { setting: "HOME", action: "PHONE" },
  COMMON_MISTAKE: { setting: "OFFICE", action: "WORRIED" },
  KEY_TAKEAWAY: { setting: "CLASSROOM", action: "IDEA" },
  BETTER_APPROACH: { setting: "PARK", action: "WALKING" },
  ACTION_STEP: { setting: "HOME", action: "CELEBRATING" },
  SUMMARY: { setting: "CAFE", action: "TALKING" },
};

export function sameIllustration(a: Illustration | null, b: Illustration | null): boolean {
  return a?.setting === b?.setting && a?.action === b?.action;
}
