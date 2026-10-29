import "dotenv/config";

import { withProbeConnection } from "@/server/queue/redis-connection";
import { readWorkerStatus, type WorkerStatus } from "@/server/queue/worker-lock";
import { toSafeErrorMessage } from "@/shared/logger";

import { WEB_SERVICE, WORKER_SERVICE } from "./lib/dev-services";
import { isPortInUse } from "./lib/port-in-use";
import { startServices, type Service } from "./lib/service-stack";
import { reportRunningWorker } from "./lib/worker-report";

// What `next dev` listens on when PORT is not set. It moves to the next free port when this one is taken, which would
// leave two dev servers on one project folder, so a taken port means "already running" here.
const DEFAULT_WEB_PORT = 3000;
// `tsx watch` gives the worker 5 s to exit before it kills it; this is the margin on top.
const STOP_TIMEOUT_MS = 8_000;
// After a terminal's SIGINT, `tsx` sends this process a SIGTERM of its own a few ms later; that is not a second Ctrl+C.
const DUPLICATE_SIGNAL_WINDOW_MS = 1_500;

async function main(): Promise<number> {
  let status: WorkerStatus;
  try {
    status = await withProbeConnection((connection) => readWorkerStatus(connection));
  } catch (error) {
    console.error(`Không kết nối được Redis (${toSafeErrorMessage(error)}).`);
    console.error("Chạy `docker compose up -d` rồi thử lại.");
    return 1;
  }

  const services: Service[] = [];
  const webPort = Number(process.env.PORT ?? DEFAULT_WEB_PORT);
  if (await isPortInUse(webPort)) {
    console.log(`Cổng ${webPort} đang được dùng (web đã chạy rồi?), không khởi động thêm web.`);
  } else {
    services.push(WEB_SERVICE);
  }
  if (status.state === "stopped") {
    services.push(WORKER_SERVICE);
  } else {
    console.log("Worker đã chạy rồi, không khởi động thêm.");
    for (const line of await reportRunningWorker(status)) console.log(line);
  }

  const [first] = services;
  if (first === undefined) {
    console.log("Web và worker đều đã chạy, không có gì để khởi động.");
    return 0;
  }
  const names = services.map((service) => service.name).join(" và ");
  console.log(`Khởi động ${names}. Nhấn Ctrl+C để dừng${services.length > 1 ? " cả hai" : ""}.`);

  const stack = startServices(services, {
    primary: first.name,
    stdout: process.stdout,
    stderr: process.stderr,
    color: process.stdout.isTTY && process.env.NO_COLOR === undefined,
    stopTimeoutMs: STOP_TIMEOUT_MS,
  });

  let lastSignalAt = Number.NEGATIVE_INFINITY;
  let signalsHandled = 0;
  const onSignal = (): void => {
    const now = Date.now();
    if (now - lastSignalAt < DUPLICATE_SIGNAL_WINDOW_MS) return;
    lastSignalAt = now;
    signalsHandled += 1;
    if (signalsHandled === 1) {
      console.log("Đang dừng… (nhấn Ctrl+C lần nữa để buộc dừng)");
      stack.stop();
    } else {
      stack.kill();
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, onSignal);
  process.on("exit", () => stack.kill());

  return stack.finished;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
