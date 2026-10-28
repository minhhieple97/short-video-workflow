// Story order of a production video: the lesson is introduced only after the situation and the mistake.
export const NARRATIVE_BEATS = ["HOOK", "SITUATION", "MISTAKE", "LESSON", "RESOLUTION", "ACTION"] as const;
export type NarrativeBeat = (typeof NARRATIVE_BEATS)[number];
