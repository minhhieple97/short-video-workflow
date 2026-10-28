import { z } from "zod";

import { NARRATIVE_BEATS } from "@/features/videos/domain/narrative-beats";
import { lessonDraftSchema } from "@/server/ai/contracts/chapter-analysis";

const page = z.number().int().min(1);

export const sourceExcerptSchema = z.object({ page, text: z.string().trim().min(1) });

export const detectedChapterSchema = z
  .object({
    title: z.string().trim().min(1),
    startPage: page,
    endPage: page,
    // Verbatim text where the chapter begins, so the range can be checked against the extracted pages.
    startAnchor: z.string().trim().min(1),
  })
  .refine((chapter) => chapter.endPage >= chapter.startPage, { message: "endPage must not precede startPage" });

export const lessonCandidateSchema = lessonDraftSchema.omit({ sourceExcerpts: true }).extend({
  sourceExcerpts: z.array(sourceExcerptSchema).min(1),
});

export const lessonExtractionSchema = z.object({
  lessons: z.array(lessonCandidateSchema),
  // false when the provider stopped early; a partial result must never be stored as the chapter's final catalogue.
  complete: z.boolean(),
});

export const scriptDraftBeatSchema = z.object({
  beat: z.enum(NARRATIVE_BEATS),
  narration: z.string().trim().min(1).max(600),
  // Kept apart from the narration so claims stay traceable to the book.
  sourceExcerpts: z.array(sourceExcerptSchema),
  // True when the beat contains a scenario invented by the AI rather than taken from the book.
  illustrative: z.boolean(),
});

export const scriptDraftSchema = z.object({
  lessonId: z.string().min(1),
  beats: z.array(scriptDraftBeatSchema).min(1).max(12),
});

export type SourceExcerpt = z.infer<typeof sourceExcerptSchema>;
export type DetectedChapter = z.infer<typeof detectedChapterSchema>;
export type LessonCandidate = z.infer<typeof lessonCandidateSchema>;
export type LessonExtraction = z.infer<typeof lessonExtractionSchema>;
export type ScriptDraftBeat = z.infer<typeof scriptDraftBeatSchema>;
export type ScriptDraft = z.infer<typeof scriptDraftSchema>;
