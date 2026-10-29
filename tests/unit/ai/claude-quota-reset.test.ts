import { describe, expect, it } from "vitest";

import { claudeQuotaRetryAfterMs, classifyCliFailure } from "@/server/ai/cli-task/claude-output";

const NOW = Date.parse("2026-10-29T10:00:30Z");

describe("Claude quota reset metadata", () => {
  it("accepts Unix seconds, milliseconds, ISO dates and the longest blocking window", () => {
    const reset = NOW + 5 * 3_600_000;
    expect(claudeQuotaRetryAfterMs(JSON.stringify({ resetsAt: reset / 1000 }), NOW)).toBe(5 * 3_600_000);
    expect(claudeQuotaRetryAfterMs(JSON.stringify({ reset_at: new Date(reset).toISOString() }), NOW)).toBe(
      5 * 3_600_000,
    );
    expect(claudeQuotaRetryAfterMs(JSON.stringify({ resets_at: reset }), NOW)).toBe(5 * 3_600_000);
    expect(claudeQuotaRetryAfterMs('{"resetsAt":0}', NOW)).toBeUndefined();
  });
  it("reads CLI clock resets with an explicit timezone and handles midnight", () => {
    expect(claudeQuotaRetryAfterMs("You've hit your limit · resets 8pm (Asia/Saigon)", NOW)).toBe(
      3 * 3_600_000 - 30_000,
    );
    expect(claudeQuotaRetryAfterMs("resets 3am (Asia/Saigon)", NOW)).toBe(10 * 3_600_000 - 30_000);
    expect(claudeQuotaRetryAfterMs("resets in 2 hours", NOW)).toBe(7_200_000);
    expect(claudeQuotaRetryAfterMs("resets in 30 minutes", NOW)).toBe(1_800_000);
    expect(claudeQuotaRetryAfterMs("resets in 1 hour", NOW)).toBe(3_600_000);
    expect(claudeQuotaRetryAfterMs("resets 25pm (Invalid/Zone)", NOW)).toBeUndefined();
    expect(claudeQuotaRetryAfterMs("usage limit reached", NOW)).toBeUndefined();
  });
  it("recognises the CLI limit message", () => {
    expect(classifyCliFailure("You've hit your limit · resets 8pm")).toBe("QUOTA");
  });
});
