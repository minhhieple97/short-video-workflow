import path from "node:path";

import type { Job } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as StatusStore from "@/features/notebooklm/repositories/notebooklm-status.store";
import type * as Overview from "@/features/notebooklm/services/notebooklm-overview.service";
import type * as Studio from "@/features/notebooklm/services/notebooklm-script-studio";
import type * as Status from "@/features/notebooklm/services/notebooklm-status.service";
import type * as DbClient from "@/server/db/client";
import type { AppConfig } from "@/shared/config/env";
import type * as DiagnosticPing from "@/worker/processors/diagnostic-ping";

import { fakeNotebookLm, type FakeNotebookLm } from "../helpers/fake-notebooklm";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let status: typeof Status;
let store: typeof StatusStore;
let overview: typeof Overview;
let studios: typeof Studio;
let ping: typeof DiagnosticPing;
let nlm: FakeNotebookLm;

const USAGE = {
  status: "success",
  tier: "Pro",
  windows: [
    { window: "rolling", percent_used: 40, percent_remaining: 60, resets_at: "2026-10-29T00:00:00+00:00" },
    { window: "weekly", percent_used: null, percent_remaining: null, resets_at: null },
  ],
};

const config = (mode: string, profile: string | undefined) =>
  ({ ai: { mode }, notebookLm: { profile } }) as unknown as AppConfig;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  status = await import("@/features/notebooklm/services/notebooklm-status.service");
  store = await import("@/features/notebooklm/repositories/notebooklm-status.store");
  overview = await import("@/features/notebooklm/services/notebooklm-overview.service");
  studios = await import("@/features/notebooklm/services/notebooklm-script-studio");
  ping = await import("@/worker/processors/diagnostic-ping");
}, 60_000);

beforeEach(() => {
  nlm = fakeNotebookLm(path.join(env.dataDir, `nlm-${Math.random().toString(36).slice(2)}`));
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("NotebookLM status", () => {
  it("keeps the allowance the account reports, unknown percentages as unknown", async () => {
    nlm.script({ usage_get: [USAGE] });

    const checked = await status.checkNotebookLm(nlm.settings);

    expect(checked).toMatchObject({ profile: "default", state: "OK", tier: "Pro", message: null });
    expect(checked.windows).toEqual([
      { window: "rolling", percentUsed: 40, percentRemaining: 60, resetsAt: "2026-10-29T00:00:00+00:00" },
      { window: "weekly", percentUsed: null, percentRemaining: null, resetsAt: null },
    ]);
    expect(await store.readNotebookLmStatus()).toEqual(checked);
  });

  it("records that the profile needs signing in, with our own words", async () => {
    const checked = await status.checkNotebookLm({ ...nlm.settings, profile: "work" });

    expect(checked).toMatchObject({ profile: "work", state: "NEEDS_LOGIN", windows: [] });
    expect(checked.message).toContain("nlm login --profile work");
  });

  it("reads the allowance when a studio run ends, and records a failed sign-in when it cannot start", async () => {
    nlm.script({ usage_get: [USAGE, USAGE] });
    const studio = new studios.NotebookLmScriptStudio(nlm.settings);
    await studio
      .ensureSource({
        book: { id: "b", title: "Sách" },
        document: { key: "k", title: "t", markdown: "m" },
        known: null,
      })
      .catch(() => undefined);
    await studio.close();
    expect(await store.readNotebookLmStatus()).toMatchObject({ state: "OK", tier: "Pro" });

    const signedOut = new studios.NotebookLmScriptStudio({ ...nlm.settings, profile: "work" });
    await expect(
      signedOut.writeDraft({
        sources: [{ key: "k", remoteId: "nb#s" }],
        lesson: {
          lessonId: "l",
          title: "t",
          summary: "s",
          principle: "p",
          realLifeScenario: "r",
          commonMistake: "m",
          betterApproach: "b",
          actionableStep: "a",
          contentHash: null,
          sources: [],
          capturedAt: "2026-10-28T00:00:00.000Z",
        },
        range: { minDurationSec: 30, maxDurationSec: 60 },
        pace: "STANDARD" as const,
        storyAngle: "PEAK_FIRST" as const,
        revisionNote: null,
      }),
    ).rejects.toMatchObject({ kind: "AUTH" });
    expect(await store.readNotebookLmStatus()).toMatchObject({ profile: "work", state: "NEEDS_LOGIN" });
  });

  it("still displays allowance when the account is exhausted", async () => {
    nlm.script({
      usage_get: [
        {
          ...USAGE,
          windows: [{ window: "weekly", percent_used: 100, percent_remaining: 0, resets_at: "2027-01-01T00:00:00Z" }],
        },
      ],
    });
    const checked = await status.checkNotebookLm(nlm.settings);
    expect(checked).toMatchObject({
      state: "OK",
      windows: [{ window: "weekly", percentRemaining: 0, resetsAt: "2027-01-01T00:00:00Z" }],
    });
    expect(nlm.calls("usage_get")).toHaveLength(1);
    expect(nlm.calls("notebook_query")).toHaveLength(0);
  });

  it("shows Settings the last observation of the configured profile only", async () => {
    nlm.script({ usage_get: [USAGE] });
    await status.checkNotebookLm(nlm.settings);

    await expect(overview.getNotebookLmOverview(config("cli-auto", "default"))).resolves.toMatchObject({
      enabled: true,
      profile: "default",
      last: { state: "OK" },
    });
    await expect(overview.getNotebookLmOverview(config("cli-auto", "work"))).resolves.toMatchObject({
      enabled: true,
      last: null,
    });
    await expect(overview.getNotebookLmOverview(config("mock", "default"))).resolves.toMatchObject({ enabled: false });
    await expect(overview.getNotebookLmOverview(config("cli-auto", undefined))).resolves.toMatchObject({
      enabled: false,
      profile: null,
    });
  });

  it("fails the worker's NotebookLM check with the reason when NotebookLM is not set up", async () => {
    await expect(
      ping.processDiagnosticPing({
        job: { id: "j", data: { jobRecordId: "r", kind: "notebooklm" } } as unknown as Job,
        jobRecordId: "r",
        lane: "general",
        signal: new AbortController().signal,
        reportProgress: async () => {},
      }),
    ).rejects.toMatchObject({ code: "NOTEBOOKLM_NOT_CONFIGURED" });
  });
});
