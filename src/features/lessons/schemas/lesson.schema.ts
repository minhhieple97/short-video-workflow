import { z } from "zod";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label} không được để trống.`).max(max, `${label} tối đa ${max} ký tự.`);

export const lessonTextSchema = z.object({
  title: text("Tiêu đề", 200),
  summary: text("Tóm tắt", 2000),
  principle: text("Bài học cốt lõi", 2000),
  realLifeScenario: text("Tình huống minh họa", 2000),
  commonMistake: text("Sai lầm thường gặp", 2000),
  betterApproach: text("Cách làm tốt hơn", 2000),
  actionableStep: text("Hành động cụ thể", 2000),
});

export const createManualLessonSchema = lessonTextSchema.extend({
  chapterIds: z.array(z.string().min(1)).min(1, "Chọn ít nhất một chương nguồn.").max(20),
  sourceExcerpt: z
    .string()
    .trim()
    .max(1000, "Trích đoạn tối đa 1000 ký tự.")
    .optional()
    .transform((value) => (value ? value : null)),
});

export const mergeLessonSchema = z.object({
  targetLessonId: z.string().min(1, "Chọn bài học đích."),
});

export const lessonFilterSchema = z.object({
  chapterId: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "APPROVED", "ARCHIVED"]).optional(),
  usage: z.enum(["used", "unused"]).optional(),
});

export const analyzeChapterRequestSchema = z.object({
  force: z.boolean().default(false),
});

export type LessonTextInput = z.infer<typeof lessonTextSchema>;
export type CreateManualLessonInput = z.infer<typeof createManualLessonSchema>;
export type LessonFilterInput = z.infer<typeof lessonFilterSchema>;
