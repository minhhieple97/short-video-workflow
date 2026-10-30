import { z } from "zod";

export const renameChapterSchema = z.object({
  title: z.string().trim().min(1, "Tiêu đề không được để trống.").max(200, "Tiêu đề tối đa 200 ký tự."),
});

export type RenameChapterInput = z.infer<typeof renameChapterSchema>;

// No chapterIds = every chapter that needs it.
export const bookAnalysisRequestSchema = z.object({
  chapterIds: z.array(z.string().min(1)).min(1, "Chọn ít nhất một chương để phân tích.").max(1000).optional(),
});
