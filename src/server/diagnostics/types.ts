export type CheckStatus = "ok" | "warn" | "error" | "info";

export type CheckDetails = Record<string, string | number | boolean>;

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  summary: string;
  details?: CheckDetails;
}

export interface ConfigRow {
  label: string;
  value: string;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  overall: "ok" | "degraded";
  app: { name: string; version: string };
  checks: CheckResult[];
  config: ConfigRow[];
}
