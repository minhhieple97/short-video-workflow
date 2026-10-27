import { getAppConfig } from "@/shared/config/env";

import type { CheckResult } from "../types";
import { readFirstOutputLine } from "./run-command";

// Only checks that the binary exists; never runs anything that touches authentication.
export async function checkClaudeCli(): Promise<CheckResult> {
  const { mode, claudeCliCommand } = getAppConfig().ai;
  try {
    const version = await readFirstOutputLine(claudeCliCommand, ["--version"]);
    return {
      id: "claude-cli",
      label: "Claude Code CLI",
      status: "ok",
      summary: version || "Đã cài đặt",
      details: { Lệnh: claudeCliCommand },
    };
  } catch {
    const required = mode === "cli-task";
    return {
      id: "claude-cli",
      label: "Claude Code CLI",
      status: required ? "warn" : "info",
      summary: required
        ? `Không tìm thấy lệnh \`${claudeCliCommand}\`. Cần cài Claude Code để chạy AI thật (có thể dùng AI_MODE=mock).`
        : "Không dùng ở chế độ AI mock.",
      details: { Lệnh: claudeCliCommand },
    };
  }
}
