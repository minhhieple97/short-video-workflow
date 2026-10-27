import { z } from "zod";

export const lessonSnapshotSchema = z.object({
  lessonId: z.string(),
  title: z.string(),
  summary: z.string(),
  principle: z.string(),
  realLifeScenario: z.string(),
  commonMistake: z.string(),
  betterApproach: z.string(),
  actionableStep: z.string(),
  contentHash: z.string().nullable(),
  sources: z.array(z.object({ chapterId: z.string(), chapterTitle: z.string(), excerpt: z.string().nullable() })),
  capturedAt: z.string(),
});

export type LessonSnapshot = z.infer<typeof lessonSnapshotSchema>;
