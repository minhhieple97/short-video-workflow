export interface NotebookLmUsageWindowDto {
  // "rolling" (a short window) or "weekly", as NotebookLM reports them.
  window: string;
  // Null when NotebookLM did not say; never read as zero.
  percentUsed: number | null;
  percentRemaining: number | null;
  resetsAt: string | null;
}

// What the worker last learnt about the NotebookLM account; no cookie, token or raw server message is ever kept.
export interface NotebookLmStatusDto {
  checkedAt: string;
  profile: string;
  state: "OK" | "NEEDS_LOGIN" | "ERROR";
  message: string | null;
  tier: string | null;
  windows: NotebookLmUsageWindowDto[];
}

export interface NotebookLmOverviewDto {
  // Whether the worker would use NotebookLM at all (cli-auto and a profile set).
  enabled: boolean;
  aiMode: string;
  profile: string | null;
  last: NotebookLmStatusDto | null;
}
