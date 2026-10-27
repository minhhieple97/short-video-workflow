import { z } from "zod";

export const renameChapterSchema = z.object({
  title: z.string().trim().min(1, "Tiêu đề không được để trống.").max(200, "Tiêu đề tối đa 200 ký tự."),
});

export type RenameChapterInput = z.infer<typeof renameChapterSchema>;
