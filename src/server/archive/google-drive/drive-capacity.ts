import { IntegrationError } from "@/server/integrations/integration-error";

import type { GoogleDriveClient } from "./google-drive-client";

export interface DriveCapacity {
  // Null when the account has unlimited storage.
  limitBytes: number | null;
  usageBytes: number;
  fetchedAt: Date;
}

export interface DriveCapacityCache {
  read(): Promise<DriveCapacity | null>;
  write(capacity: DriveCapacity): Promise<void>;
  // Adds to the stored usage in one step, so uploads that finish together are all counted. Nothing happens without a reading.
  addUsage(bytes: number): Promise<void>;
}

export const CAPACITY_MAX_AGE_MS = 60 * 60_000;

// Refuses a new upload that cannot fit in the account's storage, from a cached reading that is refreshed at most hourly,
// and counts each finished upload into the cache so a series of uploads is judged on what it already used.
export class DriveCapacityGuard {
  constructor(
    private readonly drive: GoogleDriveClient,
    private readonly cache: DriveCapacityCache,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureRoomFor(bytes: number, signal?: AbortSignal): Promise<void> {
    const capacity = await this.current(signal);
    if (capacity.limitBytes !== null && capacity.usageBytes + bytes > capacity.limitBytes) {
      throw new IntegrationError(
        "DRIVE_STORAGE_FULL",
        "Google Drive không còn đủ dung lượng cho tệp này. Hãy giải phóng dung lượng hoặc nâng gói rồi thử lại.",
        "REJECTED",
        { details: { neededBytes: bytes, freeBytes: Math.max(0, capacity.limitBytes - capacity.usageBytes) } },
      );
    }
  }

  async recordUpload(bytes: number): Promise<void> {
    await this.cache.addUsage(bytes);
  }

  private async current(signal: AbortSignal | undefined): Promise<DriveCapacity> {
    const cached = await this.cache.read();
    if (cached && this.now().getTime() - cached.fetchedAt.getTime() < CAPACITY_MAX_AGE_MS) return cached;
    const quota = await this.drive.getStorageQuota(signal);
    const fresh = { ...quota, fetchedAt: this.now() };
    await this.cache.write(fresh);
    return fresh;
  }
}
