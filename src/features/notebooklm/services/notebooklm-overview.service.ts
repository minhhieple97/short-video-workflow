import "server-only";

import { getAppConfig, type AppConfig } from "@/shared/config/env";

import { readNotebookLmStatus } from "../repositories/notebooklm-status.store";
import type { NotebookLmOverviewDto } from "../schemas/notebooklm-status.dto";

// What Settings can show without starting the MCP server: the configuration and what the worker last observed.
export async function getNotebookLmOverview(config: AppConfig = getAppConfig()): Promise<NotebookLmOverviewDto> {
  const profile = config.notebookLm.profile ?? null;
  const last = await readNotebookLmStatus();
  return {
    enabled: config.ai.mode === "cli-auto" && profile !== null,
    aiMode: config.ai.mode,
    profile,
    // An observation about another profile says nothing about the configured one.
    last: last && last.profile === profile ? last : null,
  };
}
