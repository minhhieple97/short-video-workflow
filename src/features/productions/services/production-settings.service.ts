import "server-only";

import { defaultDurationRange } from "@/features/videos/services/video.service";
import { getAppConfig, type AppConfig } from "@/shared/config/env";

import type { ProductionSettingsDto } from "../schemas/production-settings.dto";

// Why an automatic production cannot run on this machine, in the owner's words, or null when it can. It asks the same
// factory the worker uses, so the screen and the worker never disagree; the scene compiler needs no check of its own
// because it is available in exactly the modes that have a script studio.
export function productionUnavailableReason(config: AppConfig = getAppConfig()): string | null {
  return config.ai.mode === "cli-task"
    ? "Sản xuất hàng loạt cần AI_MODE=cli-auto (hoặc mock); chế độ cli-task phải chờ chạy từng tác vụ."
    : null;
}

export function getProductionSettings(config: AppConfig = getAppConfig()): ProductionSettingsDto {
  return {
    defaultRange: defaultDurationRange(),
    defaultPace: config.video.defaultPace,
    ceilingSec: config.video.maxDurationSec,
    unavailable: productionUnavailableReason(config),
  };
}
