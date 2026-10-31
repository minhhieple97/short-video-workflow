import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import { aiShotTexts } from "@/features/videos/domain/shot-plan";
import { findUnsupportedClaimsIn, type UnsupportedClaims } from "@/features/videos/domain/source-claims";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import type { ScenePlan } from "./scene-plan-compiler";

export { hasUnsupportedClaims, type UnsupportedClaims } from "@/features/videos/domain/source-claims";

function textsOf(plan: ScenePlan): string[] {
  const { hook, scenes } = plan;
  return [
    hook.narration,
    hook.onScreenText,
    ...scenes.flatMap((scene) => [scene.title ?? "", scene.narration, scene.onScreenText, ...aiShotTexts(scene.shots)]),
  ];
}

function sourceTexts(draft: ScriptDraft, lesson: LessonSnapshot): string[] {
  return [
    ...draft.beats.flatMap((beat) => [beat.narration, ...beat.sourceExcerpts.map((excerpt) => excerpt.text)]),
    lesson.title,
    lesson.summary,
    lesson.principle,
    lesson.realLifeScenario,
    lesson.commonMistake,
    lesson.betterApproach,
    lesson.actionableStep,
    ...lesson.sources.map((source) => source.excerpt ?? ""),
  ];
}

// Claude may reword the draft's narration, but the scenes may not claim anything the draft and the lesson do not.
export function findUnsupportedClaims(plan: ScenePlan, draft: ScriptDraft, lesson: LessonSnapshot): UnsupportedClaims {
  return findUnsupportedClaimsIn(textsOf(plan), sourceTexts(draft, lesson));
}
