import "dotenv/config";

import { withProbeConnection } from "@/server/queue/redis-connection";
import { readWorkerStatus, type WorkerStatus } from "@/server/queue/worker-lock";
import { toSafeErrorMessage } from "@/shared/logger";

import { reportRunningWorker } from "./lib/worker-report";

// Exit code: 0 a worker is running, 1 none is, 2 Redis could not be reached.
// `--require-stopped` is the guard in front of `worker:dev` and `worker:start`: silent and successful when no worker
// runs, otherwise it prints the status and fails, so a second `tsx watch` never idles beside the first.
const REQUIRE_STOPPED = process.argv.includes("--require-stopped");

async function main(): Promise<number> {
  let status: WorkerStatus;
  try {
    status = await withProbeConnection((connection) => readWorkerStatus(connection));
  } catch (error) {
    console.error(`Không đọc được trạng thái worker vì không kết nối được Redis (${toSafeErrorMessage(error)}).`);
    console.error("Chạy `docker compose up -d` rồi thử lại.");
    return REQUIRE_STOPPED ? 1 : 2;
  }

  if (status.state === "stopped") {
    if (REQUIRE_STOPPED) return 0;
    console.log("Worker chưa chạy.");
    console.log("Chạy `pnpm worker:dev` (hoặc `pnpm dev:all` để chạy cùng web).");
    return 1;
  }

  const write = REQUIRE_STOPPED ? console.error : console.log;
  if (REQUIRE_STOPPED) write("Worker đã chạy rồi, không khởi động thêm.");
  for (const line of await reportRunningWorker(status)) write(line);
  if (!REQUIRE_STOPPED) return 0;
  write(`Muốn chạy lại, hãy dừng worker đó trước (Ctrl+C ở terminal của nó, hoặc \`kill ${status.worker.pid}\`).`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
