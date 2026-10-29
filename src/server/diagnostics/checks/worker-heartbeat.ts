import { withProbeConnection } from "@/server/queue/redis-connection";
import { readWorkerStatus } from "@/server/queue/worker-lock";

import type { CheckResult } from "../types";

const NOT_RUNNING_SUMMARY = "Worker chưa chạy. Mở terminal mới và chạy `pnpm worker:dev`.";

export async function checkWorkerHeartbeat(): Promise<CheckResult> {
  try {
    const status = await withProbeConnection((connection) => readWorkerStatus(connection));
    if (status.state === "stopped") {
      return { id: "worker", label: "Worker", status: "warn", summary: NOT_RUNNING_SUMMARY };
    }
    const details = {
      PID: status.worker.pid,
      "Khởi động lúc": new Date(status.worker.startedAt).toLocaleString("vi-VN"),
      ...(status.heartbeatAgeMs === null ? {} : { "Heartbeat cách đây (ms)": status.heartbeatAgeMs }),
    };
    if (status.state === "unresponsive") {
      return {
        id: "worker",
        label: "Worker",
        status: "warn",
        summary: "Heartbeat của worker đã cũ. Worker có thể đã dừng.",
        details,
      };
    }
    return { id: "worker", label: "Worker", status: "ok", summary: "Đang chạy", details };
  } catch {
    return { id: "worker", label: "Worker", status: "warn", summary: "Không đọc được heartbeat (Redis chưa kết nối)." };
  }
}
