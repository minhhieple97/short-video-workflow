import { z } from "zod";

export const ocrCeilingInputSchema = z.object({
  ceilingUsd: z
    .number({ error: "Trần chi phí phải là một số (USD)." })
    .finite()
    .min(0, "Trần chi phí không được âm.")
    .max(100, "Trần chi phí tối đa $100 cho một cuốn sách."),
});

export type OcrCeilingInput = z.infer<typeof ocrCeilingInputSchema>;
