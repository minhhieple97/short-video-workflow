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
      details: {
        Lệnh: claudeCliCommand,
        "Cách chạy":
          mode === "cli-auto"
            ? "Worker tự chạy (cli-auto)"
            : mode === "cli-task"
              ? "Bạn chạy pnpm ai:run"
              : "Không dùng (mock)",
      },
    };
  } catch {
    if (mode === "mock") {
      return { id: "claude-cli", label: "Claude Code CLI", status: "info", summary: "Không dùng ở chế độ AI mock." };
    }
    return {
      id: "claude-cli",
      label: "Claude Code CLI",
      // In cli-auto every AI job runs the CLI from the worker, so a missing binary fails all of them.
      status: mode === "cli-auto" ? "error" : "warn",
      summary: `Không tìm thấy lệnh \`${claudeCliCommand}\`. Cần cài Claude Code để chạy AI thật (có thể dùng AI_MODE=mock).`,
      details: { Lệnh: claudeCliCommand },
    };
  }
}
