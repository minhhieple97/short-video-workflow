import { execFileSync } from "node:child_process";
import path from "node:path";

import type { PopplerConfig } from "@/server/pdf/poppler";

// Poppler is a system package; suites that need it run when it is installed (or when TEST_POPPLER_BIN_DIR points at a
// copy of the tools) and are skipped otherwise, like the suites that need Redis.
export function popplerTestConfig(): PopplerConfig | null {
  const binDir = process.env.TEST_POPPLER_BIN_DIR || undefined;
  try {
    execFileSync(binDir ? path.join(binDir, "pdfinfo") : "pdfinfo", ["-v"], { stdio: "ignore" });
    return { binDir, timeoutMs: 30_000 };
  } catch {
    return null;
  }
}
