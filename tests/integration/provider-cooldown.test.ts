import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Db from "@/server/db/client";
import type * as Cooldown from "@/features/jobs/services/provider-cooldown.service";
import { IntegrationError } from "@/server/integrations/integration-error";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof Db;
let cooldown: typeof Cooldown;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  cooldown = await import("@/features/jobs/services/provider-cooldown.service");
}, 60_000);
beforeEach(async () => {
  await db.prisma.providerCooldown.deleteMany();
});
afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("durable provider cooldown", () => {
  it("shares one quota wait across tasks, honours a weekly reset and survives another caller", async () => {
    let calls = 0;
    const retryAfterMs = 7 * 24 * 3_600_000;
    const call = async () => {
      calls += 1;
      throw new IntegrationError("AI_QUOTA_EXCEEDED", "quota", "QUOTA", { retryAfterMs });
    };
    await expect(cooldown.withProviderCooldown("claude", call)).rejects.toMatchObject({
      kind: "QUOTA",
      retryAfterMs,
    });
    const stored = await db.prisma.providerCooldown.findUniqueOrThrow({ where: { provider: "claude" } });
    expect(stored.blockedUntil.getTime() - Date.now()).toBeGreaterThan(retryAfterMs - 5_000);
    for (let task = 0; task < 20; task += 1)
      await expect(cooldown.withProviderCooldown("claude", call)).rejects.toMatchObject({ kind: "QUOTA" });
    expect(calls).toBe(1);
    await db.prisma.providerCooldown.update({ where: { provider: "claude" }, data: { blockedUntil: new Date(0) } });
    expect(
      await cooldown.withProviderCooldown("claude", async () => {
        calls += 1;
        return "resumed";
      }),
    ).toBe("resumed");
    expect(calls).toBe(2);
    expect(await db.prisma.providerCooldown.count()).toBe(0);
  });

  it.each(["claude", "notebooklm"] as const)("honours full reset intervals for %s", async (provider) => {
    for (const retryAfterMs of [30 * 60_000, 60 * 60_000, 15_000]) {
      await db.prisma.providerCooldown.deleteMany();
      let calls = 0;
      const call = async () => {
        calls += 1;
        throw new IntegrationError("AI_QUOTA_EXCEEDED", "quota", "QUOTA", { retryAfterMs });
      };
      await expect(cooldown.withProviderCooldown(provider, call)).rejects.toMatchObject({ retryAfterMs });
      const error: unknown = await cooldown.withProviderCooldown(provider, call).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(IntegrationError);
      if (!(error instanceof IntegrationError)) throw new Error("Expected quota failure");
      expect(error.retryAfterMs).toBeGreaterThan(retryAfterMs - 5_000);
      expect(error.retryAfterMs).toBeLessThanOrEqual(retryAfterMs);
      expect(calls).toBe(1);
    }
  });

  it("uses at most one real pending Claude task per minute when reset time is unknown", async () => {
    let calls = 0;
    const call = async () => {
      calls += 1;
      throw new IntegrationError("AI_QUOTA_EXCEEDED", "quota", "QUOTA");
    };
    await expect(cooldown.withProviderCooldown("claude", call)).rejects.toMatchObject({ retryAfterMs: 60_000 });
    await expect(cooldown.withProviderCooldown("claude", call)).rejects.toMatchObject({ kind: "QUOTA" });
    expect(calls).toBe(1);
    await db.prisma.providerCooldown.update({ where: { provider: "claude" }, data: { blockedUntil: new Date(0) } });
    await expect(cooldown.withProviderCooldown("claude", call)).rejects.toMatchObject({ kind: "QUOTA" });
    expect(calls).toBe(2);
  });

  it("separates providers, backs off NotebookLM and stops calls during an outage", async () => {
    await expect(
      cooldown.withProviderCooldown("notebooklm", async () => {
        throw new IntegrationError("NOTEBOOKLM_QUOTA", "quota", "QUOTA");
      }),
    ).rejects.toMatchObject({ kind: "QUOTA" });
    const blocked = await db.prisma.providerCooldown.findUniqueOrThrow({ where: { provider: "notebooklm" } });
    expect(blocked.blockedUntil.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(await cooldown.withProviderCooldown("claude", async () => 42)).toBe(42);
    await expect(
      cooldown.withProviderCooldown("edge-tts", async () => {
        throw new IntegrationError("TTS_FAILED", "outage", "TRANSIENT");
      }),
    ).rejects.toMatchObject({ kind: "TRANSIENT" });
    let called = false;
    await expect(
      cooldown.withProviderCooldown("edge-tts", async () => {
        called = true;
      }),
    ).rejects.toMatchObject({ kind: "QUOTA" });
    expect(called).toBe(false);
  });

  it("does not tell a task held back by another task's temporary failure that it failed too, but keeps a quota's words", async () => {
    await expect(
      cooldown.withProviderCooldown("notebooklm", async () => {
        throw new IntegrationError("MCP_TIMEOUT", 'Máy chủ MCP không trả lời "notebook_query" sau 360 s.', "TRANSIENT");
      }),
    ).rejects.toMatchObject({ code: "MCP_TIMEOUT", kind: "TRANSIENT" });

    const held: unknown = await cooldown
      .withProviderCooldown("notebooklm", async () => 1)
      .catch((error: unknown) => error);
    expect(held).toMatchObject({
      code: "MCP_TIMEOUT",
      kind: "QUOTA",
      message: "NotebookLM vừa lỗi ở một tác vụ khác; tạm nghỉ rồi tự thử lại.",
    });
    expect((held as IntegrationError).retryAfterMs).toBeGreaterThan(50_000);

    await expect(
      cooldown.withProviderCooldown("claude", async () => {
        throw new IntegrationError("AI_QUOTA_EXCEEDED", "Hết hạn mức Claude.", "QUOTA", { retryAfterMs: 3_600_000 });
      }),
    ).rejects.toMatchObject({ kind: "QUOTA" });
    await expect(cooldown.withProviderCooldown("claude", async () => 1)).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
      message: "Hết hạn mức Claude.",
    });
  });

  it.each(["AUTH", "REJECTED", "UNKNOWN_OUTCOME"] as const)(
    "does not turn %s into an automatic quota retry",
    async (kind) => {
      await expect(
        cooldown.withProviderCooldown("mistral", async () => {
          throw new IntegrationError("FAIL", "failure", kind);
        }),
      ).rejects.toMatchObject({ kind });
      expect(await db.prisma.providerCooldown.count()).toBe(0);
    },
  );
});
