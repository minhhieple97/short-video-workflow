import { z } from "zod";

import { characterSettingsSchema, DEFAULT_CHARACTERS } from "@/features/videos/domain/characters";

export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const aiExecutionSchema = z.strictObject({
  model: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^claude-[a-z0-9][a-z0-9.-]*$/, "Nhập ID model đầy đủ, ví dụ claude-opus-5-5."),
  effort: z.enum(AI_EFFORTS),
});
export type AiExecution = z.infer<typeof aiExecutionSchema>;
export const aiSettingsSchema = z.strictObject({
  script: aiExecutionSchema,
  scene: aiExecutionSchema,
  characters: characterSettingsSchema,
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export const DEFAULT_AI_SETTINGS: AiSettings = {
  script: { model: "claude-opus-5-5", effort: "xhigh" },
  scene: { model: "claude-sonnet-5-5", effort: "xhigh" },
  characters: DEFAULT_CHARACTERS,
};
