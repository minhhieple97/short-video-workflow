import fs from "node:fs/promises";
import path from "node:path";

import type { CheckResult } from "../types";
import { readFirstOutputLine } from "./run-command";

const BROWSER_ROOT = path.join(process.cwd(), "node_modules", ".remotion");

async function findExecutable(directory: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === "chrome-headless-shell") return full;
    if (entry.isDirectory()) {
      const found = await findExecutable(full, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export async function checkRemotionBrowser(): Promise<CheckResult> {
  const executable = await findExecutable(BROWSER_ROOT);
  if (!executable) {
    return {
      id: "chromium",
      label: "Chromium (Remotion)",
      status: "warn",
      summary: "Chưa có trình duyệt render. Chạy `pnpm exec remotion browser ensure` (cần Internet một lần).",
    };
  }
  try {
    const version = await readFirstOutputLine(executable, ["--version"]);
    return { id: "chromium", label: "Chromium (Remotion)", status: "ok", summary: version || "Sẵn sàng render" };
  } catch {
    return {
      id: "chromium",
      label: "Chromium (Remotion)",
      status: "error",
      summary: "Không chạy được Chromium — có thể thiếu thư viện Linux; xem hướng dẫn cài phụ thuộc của Remotion.",
    };
  }
}
