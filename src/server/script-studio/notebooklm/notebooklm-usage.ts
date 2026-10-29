import { z } from "zod";

import { IntegrationError } from "@/server/integrations/integration-error";

export const notebookLmUsageSchema = z.looseObject({
  tier: z.string().nullish(),
  windows: z
    .array(
      z.looseObject({
        window: z.string(),
        percent_used: z.number().nullish(),
        percent_remaining: z.number().nullish(),
        resets_at: z.string().nullish(),
      }),
    )
    .default([]),
});

export function notebookLmQuotaError(payload: unknown, now = Date.now()): IntegrationError | null {
  const usage = notebookLmUsageSchema.safeParse(payload);
  if (!usage.success) return null;
  const exhausted = usage.data.windows.filter(
    (window) => (window.percent_remaining ?? 100) <= 0 || (window.percent_used ?? 0) >= 100,
  );
  if (exhausted.length === 0) return null;
  const resets = exhausted
    .map((window) => Date.parse(window.resets_at ?? ""))
    .filter((reset) => Number.isFinite(reset) && reset > now);
  return new IntegrationError("NOTEBOOKLM_QUOTA", "NotebookLM báo đã chạm giới hạn sử dụng; sẽ thử lại sau.", "QUOTA", {
    retryAfterMs: resets.length > 0 ? Math.max(...resets) - now : undefined,
  });
}
