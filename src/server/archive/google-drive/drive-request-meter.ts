import { IntegrationError } from "@/server/integrations/integration-error";

export type UsageReservation = { ok: true } | { ok: false; limit: "requests" | "bytes"; retryAfterMs: number };

// The app's own Drive use over the last 24 hours. It counts only what this app sent, not the whole Google project.
export interface DriveUsageLedger {
  // Counts one request of `bytes` unless that would pass a daily limit, in which case nothing is counted.
  reserve(input: { at: Date; bytes: number; maxRequests: number; maxBytes: number }): Promise<UsageReservation>;
}

export interface DriveRequestMeterOptions {
  ledger: DriveUsageLedger;
  minIntervalMs: number;
  maxRequestsPerDay: number;
  maxBytesPerDay: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const LIMIT_MESSAGES = {
  requests: "Ứng dụng đã dùng hết số yêu cầu Google Drive cho 24 giờ (giới hạn của ứng dụng); sẽ tiếp tục sau.",
  bytes: "Ứng dụng đã upload hết dung lượng cho phép trong 24 giờ (giới hạn của ứng dụng); sẽ tiếp tục sau.",
};

// Paces Drive requests (at most one per interval) and keeps the app within its own daily request and upload limits. The
// pause between two requests is at most one interval; a daily limit is never waited out here but reported as QUOTA with
// the time until enough of the window has passed, so the job is deferred instead.
export class DriveRequestMeter {
  private readonly options: DriveRequestMeterOptions;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(options: DriveRequestMeterOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async beforeRequest(bytes: number): Promise<void> {
    const reservation = await this.options.ledger.reserve({
      at: new Date(this.now()),
      bytes,
      maxRequests: this.options.maxRequestsPerDay,
      maxBytes: this.options.maxBytesPerDay,
    });
    if (!reservation.ok) {
      throw new IntegrationError("DRIVE_APP_DAILY_LIMIT", LIMIT_MESSAGES[reservation.limit], "QUOTA", {
        retryAfterMs: reservation.retryAfterMs,
        details: { limit: reservation.limit },
      });
    }
    // The slot is taken before sleeping, in one synchronous step: callers that come together get consecutive slots one
    // interval apart instead of all computing the same wait and sending together.
    const now = this.now();
    const slot = Math.max(now, this.lastRequestAt + this.options.minIntervalMs);
    this.lastRequestAt = slot;
    if (slot > now) await this.sleep(slot - now);
  }
}
