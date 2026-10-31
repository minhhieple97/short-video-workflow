import { z } from "zod";

import { aiSettingsSchema } from "../domain/ai-settings";

export const updateAiSettingsSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  settings: aiSettingsSchema,
});
