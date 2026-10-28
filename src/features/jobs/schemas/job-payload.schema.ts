import { z } from "zod";

// Redis job payloads carry IDs and small metadata only — never book text, audio or secrets.
export const baseJobPayloadSchema = z.object({
  jobRecordId: z.string().min(1),
});

export const diagnosticPingPayloadSchema = baseJobPayloadSchema.extend({
  message: z.string().max(200).default("ping"),
  kind: z.enum(["ping", "mock-ai"]).default("ping"),
});

export const diagnosticRequestSchema = z.object({
  kind: z.enum(["ping", "mock-ai"]).default("ping"),
});

export const analyzeChapterPayloadSchema = baseJobPayloadSchema.extend({
  chapterId: z.string().min(1),
  force: z.boolean().default(false),
});

export const generateScriptPayloadSchema = baseJobPayloadSchema.extend({
  videoId: z.string().min(1),
  sceneId: z.string().min(1).optional(),
});

export const archiveRenderPayloadSchema = baseJobPayloadSchema.extend({ archiveId: z.string().min(1) });

export const extractPdfPayloadSchema = baseJobPayloadSchema.extend({ extractionId: z.string().min(1) });

export const runProductionItemPayloadSchema = baseJobPayloadSchema.extend({
  itemId: z.string().min(1),
});

export const renderVideoPayloadSchema = baseJobPayloadSchema.extend({
  renderId: z.string().min(1),
});

export const generateTtsPayloadSchema = baseJobPayloadSchema.extend({
  sceneId: z.string().min(1),
});

export type BaseJobPayload = z.infer<typeof baseJobPayloadSchema>;
export type DiagnosticPingPayload = z.infer<typeof diagnosticPingPayloadSchema>;
export type AnalyzeChapterPayload = z.infer<typeof analyzeChapterPayloadSchema>;
