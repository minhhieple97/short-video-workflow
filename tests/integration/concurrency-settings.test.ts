import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as SettingsRoute from "@/app/api/settings/concurrency/route";
import type * as DbClient from "@/server/db/client";
import type * as Watcher from "@/worker/lifecycle/concurrency-watcher";
import type { WorkLane } from "@/shared/types/work-lane";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let route: typeof SettingsRoute;
let watcher: typeof Watcher;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  route = await import("@/app/api/settings/concurrency/route");
  watcher = await import("@/worker/lifecycle/concurrency-watcher");
}, 60_000);
beforeEach(async () => {
  await db.prisma.concurrencySetting.deleteMany();
});
afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

const SETTINGS = { claude: 2, notebooklm: 3, voice: 1, render: 1, renderThreads: 4, archive: 3, extraction: 1 };
const put = (body: unknown) =>
  route.PUT(
    new Request("http://127.0.0.1/api/settings/concurrency", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("concurrency settings on the Settings page", () => {
  it("serves the defaults before anything is saved", async () => {
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      settings: { claude: 1, notebooklm: 2, voice: 1, render: 1, renderThreads: 1, archive: 2, extraction: 1 },
    });
  });

  it("saves a whole set and serves it back", async () => {
    const response = await put(SETTINGS);
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({ settings: SETTINGS });
    expect(await (await route.GET()).json()).toMatchObject({ settings: SETTINGS });
    expect(await db.prisma.concurrencySetting.count()).toBe(Object.keys(SETTINGS).length);

    await put({ ...SETTINGS, render: 2 });
    expect(await (await route.GET()).json()).toMatchObject({ settings: { ...SETTINGS, render: 2 } });
  });

  it("refuses a number out of range and changes nothing", async () => {
    await put(SETTINGS);
    const response = await put({ ...SETTINGS, archive: 0 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "Lưu Google Drive: ít nhất 1." },
    });
    expect(await (await route.GET()).json()).toMatchObject({ settings: SETTINGS });
  });

  it("is what the worker applies to its lanes", async () => {
    const lanes: Record<WorkLane, { concurrency: number }> = {
      general: { concurrency: 2 },
      claude: { concurrency: 1 },
      notebooklm: { concurrency: 2 },
      voice: { concurrency: 1 },
      render: { concurrency: 1 },
      archive: { concurrency: 2 },
      extraction: { concurrency: 1 },
    };
    await put(SETTINGS);
    await watcher.applyConcurrencySettings(lanes);
    expect(Object.fromEntries(Object.entries(lanes).map(([lane, worker]) => [lane, worker.concurrency]))).toEqual({
      general: 2,
      claude: 2,
      notebooklm: 3,
      voice: 1,
      render: 1,
      archive: 3,
      extraction: 1,
    });
  });
});
