import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

import { Redis } from "ioredis";

import { E2E_DATA_DIR, E2E_ENV, E2E_PORT } from "./stack";

const env = { ...process.env, ...E2E_ENV };

fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "inherit" });

const redis = new Redis(E2E_ENV.REDIS_URL ?? "", { maxRetriesPerRequest: 1 });
await redis.flushdb();
redis.disconnect();

const children: ChildProcess[] = [
  spawn("pnpm", ["worker:start"], { env, stdio: "inherit" }),
  spawn("pnpm", ["exec", "next", "start", "-H", "127.0.0.1", "-p", String(E2E_PORT)], { env, stdio: "inherit" }),
];

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3_000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const child of children) child.on("exit", (code) => code && code !== 0 && stop());
