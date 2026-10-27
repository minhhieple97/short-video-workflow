import { z } from "zod";

// Redis job payloads carry IDs and small metadata only — never book text, audio or secrets.
export const baseJobPayloadSchema = z.object({
  jobRecordId: z.string().min(1),
});

export const diagnosticPingPayloadSchema = baseJobPayloadSchema.extend({
  message: z.string().max(200).default("ping"),
});

export type BaseJobPayload = z.infer<typeof baseJobPayloadSchema>;
export type DiagnosticPingPayload = z.infer<typeof diagnosticPingPayloadSchema>;
