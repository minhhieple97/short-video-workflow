import { z } from "zod";

import { durationFields, enforceExtended } from "@/features/videos/schemas/video.schema";

export const MAX_LESSONS_PER_PRODUCTION = 100;

export const createProductionSchema = z
  .object({
    bookId: z.string().min(1),
    lessonIds: z
      .array(z.string().min(1))
      .min(1, "Chọn ít nhất một bài học để sản xuất.")
      .max(MAX_LESSONS_PER_PRODUCTION, `Tối đa ${MAX_LESSONS_PER_PRODUCTION} bài học mỗi lần.`)
      .refine((ids) => new Set(ids).size === ids.length, "Mỗi bài học chỉ được chọn một lần."),
    // Chosen by the caller for one submit, so a double click or a replay is recognised and not made twice.
    idempotencyKey: z.string().trim().min(8, "Khoá chống gửi trùng quá ngắn.").max(100),
    ...durationFields,
  })
  .superRefine(enforceExtended);

export type CreateProductionInput = z.infer<typeof createProductionSchema>;

// Cancel and retry act on one video of the batch when itemId is given, otherwise on every video they apply to.
export const productionItemTargetSchema = z.object({ itemId: z.string().min(1).optional() });
