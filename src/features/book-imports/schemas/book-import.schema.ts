import { z } from "zod";

import { durationRangeFields, enforceRange, paceFields } from "@/features/videos/schemas/video.schema";

export const MAX_BOOKS_PER_IMPORT = 15;

export const createBookImportSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(100),
    fileNames: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine((name) => /\.pdf$/i.test(name), "Chỉ nhận tệp PDF."),
      )
      .min(1, "Chọn ít nhất một sách.")
      .max(MAX_BOOKS_PER_IMPORT, "Tối đa 15 sách mỗi đợt."),
    ...durationRangeFields,
    ...paceFields,
  })
  .superRefine(enforceRange);

export type CreateBookImport = z.infer<typeof createBookImportSchema>;

export const bookImportActionSchema = z.object({ action: z.enum(["start", "cancel", "retry"]) });
