import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_AI_SETTINGS } from "@/features/settings/domain/ai-settings";
import type * as DbClient from "@/server/db/client";
import type * as AiSettingsRoute from "@/app/api/settings/ai/route";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let environment: TestEnvironment;
let db: typeof DbClient;
let route: typeof AiSettingsRoute;
beforeAll(async () => {
  environment = setupTestEnvironment();
  db = await import("@/server/db/client");
  route = await import("@/app/api/settings/ai/route");
}, 60_000);
beforeEach(async () => {
  await db.prisma.aiGenerationSetting.deleteMany();
});
afterAll(async () => {
  await db.prisma.$disconnect();
  environment.cleanup();
});
const put = (body: unknown) =>
  route.PUT(
    new Request("http://127.0.0.1/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const at = <T>(values: readonly T[], index = 0): T => {
  const value = values[index];
  if (value === undefined) throw new Error("Missing fixture value.");
  return value;
};

describe("AI settings", () => {
  it("serves requested models, xhigh and the six-person configurable library", async () => {
    expect(await (await route.GET()).json()).toEqual({ revision: 0, settings: DEFAULT_AI_SETTINGS });
  });
  it("persists a whole revision and rejects stale writes without losing it", async () => {
    const changed = structuredClone(DEFAULT_AI_SETTINGS);
    changed.characters.maxCharacters = 4;
    at(changed.characters.profiles).name = "Hùng";
    expect((await put({ revision: 0, settings: changed })).status).toBe(200);
    expect((await put({ revision: 0, settings: DEFAULT_AI_SETTINGS })).status).toBe(409);
    expect(await (await route.GET()).json()).toEqual({ revision: 1, settings: changed });
  });
  it("rejects a disabled protagonist, duplicate names and too many story characters", async () => {
    for (const change of [
      (value: typeof DEFAULT_AI_SETTINGS) => {
        at(value.characters.profiles).enabled = false;
      },
      (value: typeof DEFAULT_AI_SETTINGS) => {
        at(value.characters.profiles, 1).name = at(value.characters.profiles).name;
      },
      (value: typeof DEFAULT_AI_SETTINGS) => {
        value.characters.maxCharacters = 7;
      },
      (value: typeof DEFAULT_AI_SETTINGS) => {
        at(value.characters.profiles).pronoun = "chị";
      },
    ]) {
      const invalid = structuredClone(DEFAULT_AI_SETTINGS);
      change(invalid);
      expect((await put({ revision: 0, settings: invalid })).status).toBe(400);
    }
    expect(await db.prisma.aiGenerationSetting.count()).toBe(0);
  });
});
