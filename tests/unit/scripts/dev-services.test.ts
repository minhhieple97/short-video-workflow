import fs from "node:fs";

import { describe, expect, it } from "vitest";

import pkg from "../../../package.json";
import { WEB_ARGS, WEB_SERVICE, WORKER_ARGS, WORKER_SERVICE } from "../../../scripts/lib/dev-services";

describe("the services started by `pnpm dev:all`", () => {
  it("run the same commands as `pnpm dev` and `pnpm worker:dev`", () => {
    expect(pkg.scripts.dev).toBe(`next ${WEB_ARGS.join(" ")}`);
    expect(pkg.scripts["worker:dev"]).toMatch(new RegExp(`&& tsx ${WORKER_ARGS.join(" ")}$`));
  });

  it("point at programs that are installed", () => {
    for (const service of [WEB_SERVICE, WORKER_SERVICE]) {
      const [program] = service.args;
      expect(program && fs.existsSync(program)).toBe(true);
    }
  });

  it("start the worker only behind the guard that refuses a second one", () => {
    expect(pkg.scripts["worker:dev"]).toMatch(/^tsx scripts\/worker-status\.ts --require-stopped && /);
    expect(pkg.scripts["worker:start"]).toMatch(/^tsx scripts\/worker-status\.ts --require-stopped && /);
  });
});
