import { z } from "zod";

import { IntegrationError } from "@/server/integrations/integration-error";
import { NotebookLmSession } from "@/server/script-studio/notebooklm/notebooklm-session";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { writeNotebookLmStatus } from "../repositories/notebooklm-status.store";
import type { NotebookLmStatusDto } from "../schemas/notebooklm-status.dto";
import type { NotebookLmCaller } from "./notebook-sync.service";
import type { NotebookStudioSettings } from "./notebook-studio.service";

const logger = createLogger("notebooklm.status");

// notebooklm-mcp-cli 0.15.8 `usage_get`: windows of measured allowance; a missing percentage means unknown, not zero.
const usageSchema = z.looseObject({
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

// Asks NotebookLM how much of the plan's allowance is left and keeps that as the account's latest status.
export async function recordNotebookLmUsage(
  caller: NotebookLmCaller,
  profile: string,
  signal?: AbortSignal,
): Promise<NotebookLmStatusDto> {
  const usage = usageSchema.parse(await caller.call("usage_get", {}, signal));
  const status: NotebookLmStatusDto = {
    checkedAt: new Date().toISOString(),
    profile,
    state: "OK",
    message: null,
    tier: usage.tier ?? null,
    windows: usage.windows.map((window) => ({
      window: window.window,
      percentUsed: window.percent_used ?? null,
      percentRemaining: window.percent_remaining ?? null,
      resetsAt: window.resets_at ?? null,
    })),
  };
  await writeNotebookLmStatus(status);
  return status;
}

// A failure to reach the account is kept with our own wording only (IntegrationError messages are written by this app).
export async function recordNotebookLmFailure(profile: string, error: unknown): Promise<NotebookLmStatusDto> {
  const status: NotebookLmStatusDto = {
    checkedAt: new Date().toISOString(),
    profile,
    state: error instanceof IntegrationError && error.kind === "AUTH" ? "NEEDS_LOGIN" : "ERROR",
    message: error instanceof IntegrationError ? error.message : "Không mở được NotebookLM.",
    tier: null,
    windows: [],
  };
  await writeNotebookLmStatus(status);
  logger.warn("NotebookLM is not usable", { profile, state: status.state, error: toSafeErrorMessage(error) });
  return status;
}

// The check behind "Kiểm tra NotebookLM" in Settings: sign in as the profile, read the allowance, close. Never throws for
// an account problem; the result says what is wrong.
export async function checkNotebookLm(
  settings: NotebookStudioSettings,
  signal?: AbortSignal,
): Promise<NotebookLmStatusDto> {
  let session: NotebookLmSession | null = null;
  try {
    session = await NotebookLmSession.open({ ...settings, signal });
    return await recordNotebookLmUsage(session, settings.profile, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return recordNotebookLmFailure(settings.profile, error);
  } finally {
    await session?.close();
  }
}
