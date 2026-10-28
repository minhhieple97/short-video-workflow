import { HOOK_MAX_SECONDS } from "./duration";

export const SCENE_TYPES = [
  "HOOK",
  "SITUATION",
  "COMMON_MISTAKE",
  "BETTER_APPROACH",
  "KEY_TAKEAWAY",
  "ACTION_STEP",
  "SUMMARY",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const BODY_SCENE_TYPES = SCENE_TYPES.filter((type) => type !== "HOOK") as Exclude<SceneType, "HOOK">[];
export type BodySceneType = Exclude<SceneType, "HOOK">;

export const SCENE_TYPE_LABELS: Record<SceneType, string> = {
  HOOK: `Hook (0–${HOOK_MAX_SECONDS} giây)`,
  SITUATION: "Tình huống",
  COMMON_MISTAKE: "Sai lầm thường gặp",
  BETTER_APPROACH: "Cách xử lý",
  KEY_TAKEAWAY: "Điều cần nhớ",
  ACTION_STEP: "Hành động",
  SUMMARY: "Tổng kết",
};

export const VISUAL_VARIANTS = [
  "HOOK_QUESTION",
  "SPLIT_MISTAKE_SOLUTION",
  "SCENARIO_CARD",
  "BIG_TAKEAWAY",
  "ACTION_CHECKLIST",
] as const;
export type VisualVariant = (typeof VISUAL_VARIANTS)[number];

export const VISUAL_VARIANT_LABELS: Record<VisualVariant, string> = {
  HOOK_QUESTION: "Câu hỏi lớn",
  SPLIT_MISTAKE_SOLUTION: "Chia đôi sai lầm / giải pháp",
  SCENARIO_CARD: "Thẻ tình huống",
  BIG_TAKEAWAY: "Chữ lớn ghi nhớ",
  ACTION_CHECKLIST: "Danh sách hành động",
};

export const DEFAULT_VISUAL_VARIANT: Record<SceneType, VisualVariant> = {
  HOOK: "HOOK_QUESTION",
  SITUATION: "SCENARIO_CARD",
  COMMON_MISTAKE: "SPLIT_MISTAKE_SOLUTION",
  BETTER_APPROACH: "SPLIT_MISTAKE_SOLUTION",
  KEY_TAKEAWAY: "BIG_TAKEAWAY",
  ACTION_STEP: "ACTION_CHECKLIST",
  SUMMARY: "BIG_TAKEAWAY",
};

export const HOOK_VARIANTS = ["QUESTION", "MISTAKE", "CONTRAST"] as const;
export type HookVariant = (typeof HOOK_VARIANTS)[number];

export const HOOK_VARIANT_LABELS: Record<HookVariant, string> = {
  QUESTION: "Câu hỏi đánh trúng vấn đề",
  MISTAKE: "Sai lầm thường gặp",
  CONTRAST: "Tương phản trước / sau",
};

export function toSceneType(value: string): SceneType {
  return SCENE_TYPES.find((type) => type === value) ?? "SUMMARY";
}

export function toVisualVariant(value: string): VisualVariant {
  return VISUAL_VARIANTS.find((variant) => variant === value) ?? "BIG_TAKEAWAY";
}
