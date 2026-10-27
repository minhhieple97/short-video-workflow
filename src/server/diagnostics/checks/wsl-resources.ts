import fs from "node:fs";
import os from "node:os";

import { DataDirError, resolveDataDir } from "@/server/storage/paths";

import type { CheckDetails, CheckResult } from "../types";

const BYTES_PER_GB = 1024 ** 3;

function toGb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_GB) * 10) / 10;
}

function readAvailableMemoryBytes(): number {
  try {
    const match = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    if (match?.[1]) return Number(match[1]) * 1024;
  } catch {
    // /proc/meminfo is Linux-only; fall back to Node's estimate.
  }
  return os.freemem();
}

export function checkWslResources(): CheckResult {
  const details: CheckDetails = {
    "Chạy trong WSL": os.release().toLowerCase().includes("microsoft") ? "Có" : "Không",
    "Số CPU": os.cpus().length,
    "RAM tổng (GB)": toGb(os.totalmem()),
    "RAM khả dụng (GB)": toGb(readAvailableMemoryBytes()),
    "Thư viện Chromium": "Chưa kiểm tra (cần ở M4, khi render bằng Remotion)",
  };

  try {
    const dataDir = resolveDataDir();
    details["Thư mục dữ liệu"] = dataDir;
    const stats = fs.statfsSync(fs.existsSync(dataDir) ? dataDir : process.cwd());
    details["Ổ đĩa trống (GB)"] = toGb(stats.bavail * stats.bsize);
  } catch (error) {
    if (error instanceof DataDirError) {
      return { id: "resources", label: "Tài nguyên máy", status: "error", summary: error.message, details };
    }
    throw error;
  }

  return {
    id: "resources",
    label: "Tài nguyên máy",
    status: "info",
    summary: "Chỉ để tham khảo. Không tự chỉnh .wslconfig; hãy đo trên máy thật trước khi tăng concurrency.",
    details,
  };
}
