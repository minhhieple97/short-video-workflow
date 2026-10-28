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

export const MISTRAL_BATCH_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "TIMEOUT_EXCEEDED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
] as const;

// Mistral's own examples show the request counters as strings, so they are coerced.
const counter = z.coerce.number().int().nonnegative();

export const mistralBatchJobSchema = z.object({
  id: z.string().min(1),
  status: z.enum(MISTRAL_BATCH_STATUSES),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  input_files: z.array(z.string()).nullish(),
  output_file: z.string().nullish(),
  error_file: z.string().nullish(),
  total_requests: counter.nullish(),
  succeeded_requests: counter.nullish(),
  failed_requests: counter.nullish(),
});

export const mistralBatchJobListSchema = z.object({ data: z.array(mistralBatchJobSchema) });

// One line of the batch output or error file. The request is matched back by custom_id (the chunk id).
export const mistralOutputLineSchema = z.object({
  custom_id: z.string().min(1),
  response: z.object({ status_code: z.number().int(), body: z.unknown() }).nullish(),
  error: z.unknown().nullish(),
});

export const mistralOcrBodySchema = z.object({
  pages: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      markdown: z.string(),
      confidence_scores: z.object({ average_page_confidence_score: z.number().min(0).max(1).nullish() }).nullish(),
    }),
  ),
});

export type MistralOcrPage = z.infer<typeof mistralOcrBodySchema>["pages"][number];
export type MistralFile = z.infer<typeof mistralFileSchema>;
export type MistralDeletedFile = z.infer<typeof mistralDeletedFileSchema>;
export type MistralBatchStatus = (typeof MISTRAL_BATCH_STATUSES)[number];
export type MistralBatchJob = z.infer<typeof mistralBatchJobSchema>;
