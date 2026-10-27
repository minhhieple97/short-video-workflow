import { z } from "zod";

export const chapterAnalysisInputSchema = z.object({
  bookTitle: z.string().min(1),
  author: z.string().optional(),
  chapterId: z.string().min(1),
  chapterTitle: z.string().min(1),
  chapterContent: z.string().min(1),
  promptVersion: z.string().min(1),
});

export const lessonDraftSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  principle: z.string().min(1),
  realLifeScenario: z.string().min(1),
  commonMistake: z.string().min(1),
  betterApproach: z.string().min(1),
  actionableStep: z.string().min(1),
  sourceExcerpts: z.array(z.object({ chapterId: z.string().min(1), text: z.string().min(1) })),
  exampleIsIllustrative: z.boolean(),
});

export const chapterAnalysisOutputSchema = z.object({
  chapterId: z.string().min(1),
  lessons: z.array(lessonDraftSchema),
});

export type ChapterAnalysisInput = z.infer<typeof chapterAnalysisInputSchema>;
export type LessonDraft = z.infer<typeof lessonDraftSchema>;
export type ChapterAnalysisOutput = z.infer<typeof chapterAnalysisOutputSchema>;
