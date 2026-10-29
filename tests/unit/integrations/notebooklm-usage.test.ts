import { describe, expect, it } from "vitest";

import { notebookLmQuotaError } from "@/server/script-studio/notebooklm/notebooklm-usage";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const window = (name: string, remaining: number | null, resetsAt: string | null) => ({
  window: name,
  percent_remaining: remaining,
  resets_at: resetsAt,
});

describe("NotebookLM quota windows", () => {
  it("waits only for exhausted windows, even if another allowance resets later", () => {
    const quota = notebookLmQuotaError(
      {
        windows: [window("rolling", 0, "2026-10-29T12:30:00Z"), window("weekly", 80, "2026-11-03T12:00:00Z")],
      },
      NOW,
    );
    expect(quota).toMatchObject({ code: "NOTEBOOKLM_QUOTA", kind: "QUOTA", retryAfterMs: 30 * 60_000 });
  });

  it("waits for the last exhausted window, regardless of response order", () => {
    const windows = [window("weekly", 0, "2026-11-03T12:00:00Z"), window("rolling", 0, "2026-10-29T12:30:00Z")];
    expect(notebookLmQuotaError({ windows }, NOW)?.retryAfterMs).toBe(5 * 24 * 3_600_000);
    expect(notebookLmQuotaError({ windows: windows.toReversed() }, NOW)?.retryAfterMs).toBe(5 * 24 * 3_600_000);
  });

  it("also recognises a fully used allowance when remaining percentage is omitted", () => {
    expect(
      notebookLmQuotaError(
        { windows: [{ window: "rolling", percent_used: 100, resets_at: "2026-10-29T12:00:15Z" }] },
        NOW,
      ),
    ).toMatchObject({ retryAfterMs: 15_000 });
  });

  it.each([null, "invalid", "2026-10-28T12:00:00Z"])(
    "leaves the fallback delay to the caller when reset time is %j",
    (reset) => {
      expect(notebookLmQuotaError({ windows: [window("weekly", 0, reset)] }, NOW)).toMatchObject({
        kind: "QUOTA",
        retryAfterMs: undefined,
      });
    },
  );

  it.each([
    {},
    { windows: [] },
    { windows: [window("rolling", null, "2026-10-29T12:30:00Z")] },
    { windows: [window("rolling", 0.01, "2026-10-29T12:30:00Z")] },
    { windows: [{ window: "weekly", percent_used: 0, percent_remaining: null }] },
    { windows: [{ window: "weekly", percent_remaining: "unknown" }] },
  ])("does not interpret an available or unknown allowance as exhausted: %j", (payload) => {
    expect(notebookLmQuotaError(payload, NOW)).toBeNull();
  });
});
