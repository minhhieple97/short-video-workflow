import type { CheckResult } from "../types";
import { readVersionLine } from "./run-command";

export async function checkPoppler(command = "pdfinfo"): Promise<CheckResult> {
  try {
    const version = await readVersionLine(command, ["-v"]);
    return { id: "poppler", label: "Poppler (PDF)", status: "ok", summary: version || "Đã cài đặt." };
  } catch {
    return {
      id: "poppler",
      label: "Poppler (PDF)",
      status: "warn",
      summary:
        "Chưa cài poppler-utils, nên chưa nhập được sách PDF. Cài bằng `sudo apt-get install -y poppler-utils`; sách .md/.txt vẫn dùng được.",
    };
  }
}
