import "server-only";

import { notebookStudioSettings } from "@/features/notebooklm/services/notebook-studio.service";
import { defaultDurationRange } from "@/features/videos/services/video.service";
import { createScriptStudioProvider } from "@/server/script-studio";
import { getAppConfig, type AppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

import type { ProductionSettingsDto } from "../schemas/production-settings.dto";

// Why an automatic production cannot run on this machine, in the owner's words, or null when it can. It asks the same
// factory the worker uses, so the screen and the worker never disagree; the scene compiler needs no check of its own
// because it is available in exactly the modes that have a script studio.
export function productionUnavailableReason(config: AppConfig = getAppConfig()): string | null {
  if (notebookStudioSettings(config)) return null;
  try {
    createScriptStudioProvider(config.ai.mode);
    return null;
  } catch (error) {
    return error instanceof AppError ? error.message : toSafeErrorMessage(error);
  }
}

export function getProductionSettings(config: AppConfig = getAppConfig()): ProductionSettingsDto {
  return {
    defaultRange: defaultDurationRange(),
    defaultPace: config.video.defaultPace,
    ceilingSec: config.video.maxDurationSec,
    unavailable: productionUnavailableReason(config),
  };
}
