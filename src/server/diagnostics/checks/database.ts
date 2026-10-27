import { prisma, resolveDatabaseFile } from "@/server/db/client";
import { toSafeErrorMessage } from "@/shared/logger";

import type { CheckResult } from "../types";

export async function checkDatabase(): Promise<CheckResult> {
  const file = resolveDatabaseFile();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { id: "database", label: "SQLite", status: "ok", summary: "Kết nối được", details: { Tệp: file } };
  } catch (error) {
    return {
      id: "database",
      label: "SQLite",
      status: "error",
      summary: "Không mở được cơ sở dữ liệu. Chạy `pnpm db:migrate`.",
      details: { Tệp: file, Lỗi: toSafeErrorMessage(error) },
    };
  }
}
