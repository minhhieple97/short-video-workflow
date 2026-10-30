import "dotenv/config";

import { redactRedisUrl, withProbeConnection } from "@/server/queue/redis-connection";
import { readWorkerStatus, type WorkerStatus } from "@/server/queue/worker-lock";
import { resolveDataDir } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { toSafeErrorMessage } from "@/shared/logger";

import { describeStartup, type WebProbe } from "./lib/dev-banner";
import { formatDevLog } from "./lib/dev-log-format";
import { WEB_SERVICE, WORKER_SERVICE } from "./lib/dev-services";
import { isPortInUse } from "./lib/port-in-use";
import { findPortHolder, isProjectWeb } from "./lib/port-holder";
import { startServices, type Service } from "./lib/service-stack";
import { reportRunningWorker } from "./lib/worker-report";

// What `next dev` listens on when PORT is not set. It moves to the next free port when this one is taken, which would
// leave two dev servers on one project folder, so a taken port means "already running" here.
const DEFAULT_WEB_PORT = 3000;
// `tsx watch` gives the worker 5 s to exit before it kills it; this is the margin on top.
const STOP_TIMEOUT_MS = 8_000;
// After a terminal's SIGINT, `tsx` sends this process a SIGTERM of its own a few ms later; that is not a second Ctrl+C.
const DUPLICATE_SIGNAL_WINDOW_MS = 1_500;

async function probeWeb(port: number): Promise<WebProbe> {
  if (!(await isPortInUse(port))) return { state: "free" };
  return (await isProjectWeb(port)) ? { state: "project" } : { state: "foreign", holder: await findPortHolder(port) };
}

function redisTarget(redisUrl: string): string {
  const { pathname } = new URL(redisUrl);
  const database = pathname.replace("/", "");
  return `${redactRedisUrl(redisUrl).replace(/^rediss?:\/\//, "")} · DB ${database || "0"}`;
}

async function main(): Promise<number> {
  let config: ReturnType<typeof getAppConfig>;
  try {
    config = getAppConfig();
  } catch (error) {
    console.error(`Cấu hình trong .env chưa đúng: ${toSafeErrorMessage(error)}`);
    return 1;
  }
  let status: WorkerStatus;
  try {
    status = await withProbeConnection((connection) => readWorkerStatus(connection));
  } catch (error) {
    console.error(`Không kết nối được Redis (${toSafeErrorMessage(error)}).`);
    console.error("Chạy `docker compose up -d` rồi thử lại.");
    return 1;
  }

  const webPort = Number(process.env.PORT ?? DEFAULT_WEB_PORT);
  const startup = describeStartup({
    webPort,
    web: await probeWeb(webPort),
    runningWorker: status.state === "stopped" ? null : await reportRunningWorker(status),
    redis: redisTarget(config.redisUrl),
    aiMode: config.ai.mode,
    telegram: { enabled: config.telegram.enabled, mode: config.telegram.mode, chatId: config.telegram.chatId },
    dataDir: resolveDataDir(),
  });
  console.log(startup.lines.join("\n"));

  const services: Service[] = [];
  if (startup.startsWeb) services.push(WEB_SERVICE);
  if (startup.startsWorker) services.push(WORKER_SERVICE);
  const [first] = services;
  if (first === undefined) return startup.blocked ? 1 : 0;

  const stack = startServices(services, {
    primary: first.name,
    stdout: process.stdout,
    stderr: process.stderr,
    color: process.stdout.isTTY && process.env.NO_COLOR === undefined,
    formatLine: formatDevLog,
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
