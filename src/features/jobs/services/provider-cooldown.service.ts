import { IntegrationError } from "@/server/integrations/integration-error";

import {
  clearProviderCooldown,
  findProviderCooldown,
  saveProviderCooldown,
} from "../repositories/provider-cooldown.repository";

export type QuotaProvider = "claude" | "notebooklm" | "mistral" | "edge-tts" | "drive";
export const QUOTA_CHECK_INTERVAL_MS = 60_000;
const QUOTA_FALLBACK_MS: Record<QuotaProvider, number> = {
  claude: 60_000,
  notebooklm: 15 * 60_000,
  mistral: 5 * 60_000,
  "edge-tts": 60_000,
  drive: 60_000,
};

export async function withProviderCooldown<T>(provider: QuotaProvider, call: () => Promise<T>): Promise<T> {
  const blocked = await findProviderCooldown(provider);
  const remainingMs = (blocked?.blockedUntil.getTime() ?? 0) - Date.now();
  if (blocked && remainingMs > 0) {
    throw new IntegrationError(blocked.errorCode, blocked.message, "QUOTA", {
      retryAfterMs: remainingMs,
    });
  }
  try {
    const result = await call();
    if (blocked) await clearProviderCooldown(provider);
    return result;
  } catch (error) {
    if (error instanceof IntegrationError && (error.kind === "QUOTA" || error.kind === "TRANSIENT")) {
      const delay = Math.max(
        (provider === "claude" || provider === "notebooklm") &&
          error.kind === "QUOTA" &&
          error.retryAfterMs !== undefined
          ? 1
          : QUOTA_CHECK_INTERVAL_MS,
        error.retryAfterMs ?? (error.kind === "QUOTA" ? QUOTA_FALLBACK_MS[provider] : QUOTA_CHECK_INTERVAL_MS),
      );
      await saveProviderCooldown({
        provider,
        blockedUntil: new Date(Date.now() + delay),
        errorCode: error.code,
        message: error.message,
      });
      throw new IntegrationError(error.code, error.message, error.kind, {
        cause: error,
        retryAfterMs: error.kind === "TRANSIENT" ? error.retryAfterMs : delay,
      });
    }
    throw error;
  }
}
