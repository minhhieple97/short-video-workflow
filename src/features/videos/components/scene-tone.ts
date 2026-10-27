import type { SceneType } from "../domain/scene-types";

type SceneBadge = "orange" | "blue" | "rose" | "mint" | "violet" | "amber";

// Each scene type keeps one color everywhere (editor card, voice row) so the storyboard reads at a glance.
export const SCENE_TONE: Record<SceneType, { badge: SceneBadge; rail: string }> = {
  HOOK: { badge: "orange", rail: "bg-brand" },
  SITUATION: { badge: "blue", rail: "bg-[#5b7bff]" },
  COMMON_MISTAKE: { badge: "rose", rail: "bg-[#e5446d]" },
  BETTER_APPROACH: { badge: "mint", rail: "bg-[#12a37a]" },
  KEY_TAKEAWAY: { badge: "violet", rail: "bg-[#7c5cff]" },
  ACTION_STEP: { badge: "amber", rail: "bg-[#f5a524]" },
  SUMMARY: { badge: "violet", rail: "bg-primary" },
};
