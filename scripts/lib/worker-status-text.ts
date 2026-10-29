import type { WorkerStatus } from "@/server/queue/worker-lock";

export interface QueueCounts {
  active: number;
  waiting: number;
  delayed: number;
}

const DATE_TIME = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" });

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} giờ` : `${hours} giờ ${minutes % 60} phút`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} ngày` : `${days} ngày ${hours % 24} giờ`;
}

export function describeWorkerStatus(
  status: WorkerStatus,
  queue: QueueCounts | null,
  now: Date = new Date(),
): string[] {
  if (status.state === "stopped") return ["Worker chưa chạy."];

  const { worker, heartbeatAgeMs } = status;
  const startedAt = new Date(worker.startedAt);
  const rows: [label: string, value: string][] = [
    ["PID", String(worker.pid)],
    ["Máy", worker.host],
    ["Thư mục dữ liệu", worker.dataDir],
    ["Khởi động", `${DATE_TIME.format(startedAt)} (đã chạy ${formatElapsed(now.getTime() - startedAt.getTime())})`],
    ["Heartbeat", heartbeatAgeMs === null ? "chưa ghi nhận" : `${formatElapsed(heartbeatAgeMs)} trước`],
  ];
  if (queue) {
    rows.push(["Hàng đợi", `${queue.active} đang chạy · ${queue.waiting} đang chờ · ${queue.delayed} hẹn lại`]);
  }

  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const headline =
    status.state === "running" ? "Worker đang chạy." : "Worker đang giữ khoá nhưng không phản hồi (heartbeat đã cũ).";
  return [headline, ...rows.map(([label, value]) => `  ${label.padEnd(labelWidth)}  ${value}`)];
}

// Two checkouts of the project share one Redis by default; the lock then refuses the second one's worker, and the
// reason is not obvious from "already running" alone.
export function describeForeignWorker(status: WorkerStatus, ownDataDir: string): string | null {
  if (status.state === "stopped" || status.worker.dataDir === ownDataDir) return null;
  return "Worker này dùng thư mục dữ liệu khác (bản checkout khác?). Mỗi bản checkout cần một Redis DB riêng, ví dụ REDIS_URL=redis://127.0.0.1:6379/1.";
}
