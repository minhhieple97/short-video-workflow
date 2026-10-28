import { getAppConfig, type AppConfig } from "@/shared/config/env";

import type { CheckResult } from "../types";
import { readVersionLine } from "./run-command";

// The web process never starts the NotebookLM server; whether the profile is still signed in is learnt when the worker
// opens a session. This check looks at what can be known from here: the launcher and the configured profile.
export async function checkNotebookLm(
  config: Pick<AppConfig["notebookLm"], "command" | "packageSpec" | "profile"> = getAppConfig().notebookLm,
): Promise<CheckResult> {
  const { command, packageSpec, profile } = config;
  const details = { Lệnh: command, Gói: packageSpec, Profile: profile ?? "(chưa đặt)" };
  try {
    await readVersionLine(command, ["--version"]);
  } catch {
    return {
      id: "notebooklm",
      label: "NotebookLM",
      status: "warn",
      summary: `Không chạy được \`${command}\`. Cài uv (https://docs.astral.sh/uv/) để worker khởi động notebooklm-mcp-cli.`,
      details,
    };
  }
  if (!profile) {
    return {
      id: "notebooklm",
      label: "NotebookLM",
      status: "warn",
      summary:
        "Chưa đặt NOTEBOOKLM_PROFILE. Đăng nhập bằng `uvx --from notebooklm-mcp-cli nlm login --profile <tên>` rồi đặt tên đó vào .env.",
      details,
    };
  }
  return {
    id: "notebooklm",
    label: "NotebookLM",
    status: "ok",
    summary: "Đã cấu hình. Đăng nhập được kiểm khi worker mở phiên NotebookLM.",
    details,
  };
}
