import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import type { ScenePlan } from "./scene-plan-compiler";

// Claude may reword the narration, but it may not add a number or a quotation that the draft and the lesson do not
// contain. This is a mechanical backstop for the prompt rule, not a proof of faithfulness: it cannot see a made-up claim
// that uses no number and no quotation marks.
export interface UnsupportedClaims {
  numbers: string[];
  quotes: string[];
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
const QUOTED = /[“"«]([^”"»]{3,})[”"»]/g;

const normalize = (text: string): string => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const canonicalNumber = (token: string): string => token.replace(",", ".").replace(/\.0+$/, "");

function textsOf(plan: ScenePlan): string[] {
  const { hook, scenes } = plan;
  return [
    hook.narration,
    hook.onScreenText,
    ...scenes.flatMap((scene) => [scene.title ?? "", scene.narration, scene.onScreenText]),
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

export function findUnsupportedClaims(plan: ScenePlan, draft: ScriptDraft, lesson: LessonSnapshot): UnsupportedClaims {
  const sources = sourceTexts(draft, lesson);
  const sourceNumbers = new Set(sources.flatMap((text) => (text.match(NUMBER) ?? []).map(canonicalNumber)));
  const normalizedSources = sources.map(normalize);

  const numbers = new Set<string>();
  const quotes = new Set<string>();
  for (const text of textsOf(plan)) {
    for (const token of text.match(NUMBER) ?? []) {
      if (!sourceNumbers.has(canonicalNumber(token))) numbers.add(token);
    }
    for (const match of text.matchAll(QUOTED)) {
      const quote = match[1] ?? "";
      if (!normalizedSources.some((source) => source.includes(normalize(quote)))) quotes.add(quote);
    }
  }
  return { numbers: [...numbers], quotes: [...quotes] };
}

export function hasUnsupportedClaims(claims: UnsupportedClaims): boolean {
  return claims.numbers.length > 0 || claims.quotes.length > 0;
}
