import { z } from "zod";

import { aiExecutionSchema } from "@/features/settings/domain/ai-settings";

export const generationProvenanceSchema = z.object({
  mode: z.enum(["mock", "cli-task", "cli-auto"]),
  runId: z.string(),
  script: aiExecutionSchema,
  scene: aiExecutionSchema,
  draftPromptVersion: z.string(),
  scenePromptVersion: z.string(),
});
export type GenerationProvenance = z.infer<typeof generationProvenanceSchema>;
