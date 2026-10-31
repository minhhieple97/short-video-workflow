import type { ConcurrencySettings } from "../domain/concurrency-settings";

export type WorkerAvailability = "running" | "stopped" | "unknown";

export interface ConcurrencySettingsDto {
  settings: ConcurrencySettings;
  // Whether a saved change is picked up within seconds or when the worker next starts.
  worker: WorkerAvailability;
}
