import { z } from "zod";

// Redis job payloads carry IDs and small metadata only — never book text, audio or secrets.
export const baseJobPayloadSchema = z.object({
  jobRecordId: z.string().min(1),
});

export const diagnosticPingPayloadSchema = baseJobPayloadSchema.extend({
  message: z.string().max(200).default("ping"),
});

export const analyzeChapterPayloadSchema = baseJobPayloadSchema.extend({
  chapterId: z.string().min(1),
  force: z.boolean().default(false),
});

export type BaseJobPayload = z.infer<typeof baseJobPayloadSchema>;
export type DiagnosticPingPayload = z.infer<typeof diagnosticPingPayloadSchema>;
export type AnalyzeChapterPayload = z.infer<typeof analyzeChapterPayloadSchema>;
