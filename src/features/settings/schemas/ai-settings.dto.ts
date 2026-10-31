import type { AiSettings } from "../domain/ai-settings";

export interface AiSettingsDto {
  revision: number;
  settings: AiSettings;
}
