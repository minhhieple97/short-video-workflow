import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_STALE_AFTER_MS } from "@/server/queue/constants";
import { withProbeConnection } from "@/server/queue/redis-connection";

import type { CheckResult } from "../types";

const NOT_RUNNING_SUMMARY = "Worker chưa chạy. Mở terminal mới và chạy `pnpm worker:dev`.";

export async function checkWorkerHeartbeat(): Promise<CheckResult> {
  try {
    const value = await withProbeConnection((connection) => connection.get(WORKER_HEARTBEAT_KEY));
    if (!value) {
      return { id: "worker", label: "Worker", status: "warn", summary: NOT_RUNNING_SUMMARY };
    }
    const ageMs = Date.now() - Number(value);
    if (!Number.isFinite(ageMs) || ageMs > WORKER_HEARTBEAT_STALE_AFTER_MS) {
      return {
        id: "worker",
        label: "Worker",
        status: "warn",
        summary: "Heartbeat của worker đã cũ. Worker có thể đã dừng.",
      };
    }
    return {
      id: "worker",
      label: "Worker",
      status: "ok",
      summary: "Đang chạy",
      details: { "Heartbeat cách đây (ms)": ageMs },
    };
  } catch {
    return { id: "worker", label: "Worker", status: "warn", summary: "Không đọc được heartbeat (Redis chưa kết nối)." };
  }
}
