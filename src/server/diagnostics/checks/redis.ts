import { withProbeConnection } from "@/server/queue/redis-connection";
import { toSafeErrorMessage } from "@/shared/logger";

import type { CheckResult } from "../types";

export async function checkRedis(): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    await withProbeConnection((connection) => connection.ping());
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      id: "redis",
      label: "Redis",
      status: "ok",
      summary: `Kết nối được (${latencyMs} ms)`,
      details: { "Độ trễ (ms)": latencyMs },
    };
  } catch (error) {
    return {
      id: "redis",
      label: "Redis",
      status: "error",
      summary: "Không kết nối được Redis. Chạy `docker compose up -d` (hoặc redis-server) rồi tải lại.",
      details: { Lỗi: toSafeErrorMessage(error) },
    };
  }
}
