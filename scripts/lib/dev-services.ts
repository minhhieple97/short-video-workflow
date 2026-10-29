import { createRequire } from "node:module";

import type { Service } from "./service-stack";

// The same commands as the `dev` and `worker:dev` scripts (a test keeps them equal). They run through node directly:
// each extra `pnpm` or `sh` in between would swallow the stop signal before it reached the real process.
export const WEB_ARGS = ["dev", "-H", "127.0.0.1"] as const;
export const WORKER_ARGS = ["watch", "src/worker/main.ts"] as const;

const require = createRequire(import.meta.url);

export const WEB_SERVICE: Service = {
  name: "web",
  command: process.execPath,
  args: [require.resolve("next/dist/bin/next"), ...WEB_ARGS],
};

export const WORKER_SERVICE: Service = {
  name: "worker",
  command: process.execPath,
  args: [require.resolve("tsx/cli"), ...WORKER_ARGS],
};
