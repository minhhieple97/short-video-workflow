import { withProbeConnection } from "@/server/queue/redis-connection";
import { readWorkerStatus } from "@/server/queue/worker-lock";

import { resolveConcurrency, type ConcurrencySettings } from "../domain/concurrency-settings";
import { listConcurrencySettingRows, saveConcurrencySettings } from "../repositories/concurrency-setting.repository";
import type { ConcurrencySettingsDto, WorkerAvailability } from "../schemas/concurrency-settings.dto";

// Read by the worker (to size its lanes, again every few seconds) and by the render runner, so no "server-only" here.
export async function getConcurrencySettings(): Promise<ConcurrencySettings> {
  return resolveConcurrency(await listConcurrencySettingRows());
}

async function workerAvailability(): Promise<WorkerAvailability> {
  try {
    const status = await withProbeConnection((connection) => readWorkerStatus(connection));
    return status.state === "running" ? "running" : "stopped";
  } catch {
    return "unknown";
  }
}

export async function getConcurrencySettingsOverview(): Promise<ConcurrencySettingsDto> {
  const [settings, worker] = await Promise.all([getConcurrencySettings(), workerAvailability()]);
  return { settings, worker };
}

export async function updateConcurrencySettings(settings: ConcurrencySettings): Promise<ConcurrencySettingsDto> {
  await saveConcurrencySettings(settings);
  return getConcurrencySettingsOverview();
}
