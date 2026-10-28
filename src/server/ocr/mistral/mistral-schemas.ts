import { z } from "zod";

// Only the fields this adapter relies on are validated; Mistral may add others.
export const mistralFileSchema = z.object({
  id: z.string().min(1),
  bytes: z.number().int().nonnegative().nullish(),
  filename: z.string().nullish(),
  purpose: z.string().nullish(),
});

export const mistralDeletedFileSchema = z.object({
  id: z.string().min(1),
  deleted: z.boolean(),
});

export type MistralFile = z.infer<typeof mistralFileSchema>;
export type MistralDeletedFile = z.infer<typeof mistralDeletedFileSchema>;
