// Story order of a production video: the lesson is introduced only after the situation and the mistake, and the
// resolution then returns to the opening situation before the concrete action.
export const NARRATIVE_BEATS = ["HOOK", "SITUATION", "MISTAKE", "LESSON", "RESOLUTION", "ACTION"] as const;
export type NarrativeBeat = (typeof NARRATIVE_BEATS)[number];

// The same story as scene types, after the HOOK. KEY_TAKEAWAY carries the lesson and BETTER_APPROACH the resolution,
// so (unlike the manual flow, which puts the better approach first) the lesson comes before the resolution.
export const STORY_SCENE_ORDER = [
  "SITUATION",
  "COMMON_MISTAKE",
  "KEY_TAKEAWAY",
  "BETTER_APPROACH",
  "ACTION_STEP",
] as const;

export type StoryOrderProblem =
  | { code: "FIRST_BEAT_NOT_HOOK" }
  | { code: "MULTIPLE_HOOKS" }
  | { code: "OUT_OF_ORDER"; item: string; after: string }
  | { code: "UNKNOWN_ITEM"; item: string }
  | { code: "MISSING"; missing: string[] };

function findOrderProblem(
  items: readonly string[],
  order: readonly string[],
): Exclude<StoryOrderProblem, { code: "FIRST_BEAT_NOT_HOOK" } | { code: "MULTIPLE_HOOKS" }> | null {
  let highest = -1;
  let previous = "";
  for (const item of items) {
    const position = order.indexOf(item);
    if (position === -1) return { code: "UNKNOWN_ITEM", item };
    if (position < highest) return { code: "OUT_OF_ORDER", item, after: previous };
    highest = position;
    previous = item;
  }
  const missing = order.filter((expected) => !items.includes(expected));
  return missing.length > 0 ? { code: "MISSING", missing } : null;
}

// Beats must start with exactly one HOOK, never go back to an earlier part of the story, and cover all six parts.
// A beat may repeat consecutively (two situation beats), but nothing is optional.
export function findNarrativeOrderProblem(beats: readonly string[]): StoryOrderProblem | null {
  if (beats[0] !== "HOOK") return { code: "FIRST_BEAT_NOT_HOOK" };
  if (beats.slice(1).includes("HOOK")) return { code: "MULTIPLE_HOOKS" };
  return findOrderProblem(beats, NARRATIVE_BEATS);
}

// The scenes after the HOOK of a production plan must tell the same story, in order, using only story scene types.
export function findStorySceneOrderProblem(sceneTypes: readonly string[]): StoryOrderProblem | null {
  return findOrderProblem(sceneTypes, STORY_SCENE_ORDER);
}

export function describeStoryOrderProblem(problem: StoryOrderProblem): string {
  switch (problem.code) {
    case "FIRST_BEAT_NOT_HOOK":
      return "Mạch kể phải mở bằng HOOK.";
    case "MULTIPLE_HOOKS":
      return "Chỉ được có một HOOK, ở đầu.";
    case "OUT_OF_ORDER":
      return `${problem.item} không được đứng sau ${problem.after}: bài học phải đến sau tình huống và sai lầm, và giải pháp đến sau bài học.`;
    case "UNKNOWN_ITEM":
      return `${problem.item} không thuộc mạch kể bắt buộc.`;
    case "MISSING":
      return `Mạch kể còn thiếu: ${problem.missing.join(", ")}.`;
  }
}
