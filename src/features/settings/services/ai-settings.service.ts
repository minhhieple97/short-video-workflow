import { readAiSettings, saveAiSettings } from "../repositories/ai-settings.repository";
import { updateAiSettingsSchema } from "../schemas/ai-settings.schema";

export const getAiSettings = readAiSettings;

export async function updateAiSettings(input: unknown) {
  const { revision, settings } = updateAiSettingsSchema.parse(input);
  return saveAiSettings(revision, settings);
}
