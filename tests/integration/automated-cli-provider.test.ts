import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type * as AutomatedCli from "@/server/ai/automated-cli-provider";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const FAKE_CLAUDE = path.join(import.meta.dirname, "../helpers/fake-claude.mjs");
const OUTPUT = { chapterId: "chapter-1", lessons: [] };
const execFileAsync = promisify(execFile);
const INPUT = {
  bookTitle: "Sách",
  chapterId: "chapter-1",
  chapterTitle: "Chương 1",
  chapterContent: "Nội dung chương.",
  promptVersion: "chapter-analysis-v1",
};

let env: TestEnvironment;
let provider: InstanceType<typeof AutomatedCli.AutomatedCliProvider>;
let taskCounter = 0;
const nextTask = () => `auto-${(taskCounter += 1)}`;
const taskFile = (taskId: string, name: string) => path.join(env.dataDir, "ai-tasks", taskId, name);

beforeAll(async () => {
  env = setupTestEnvironment();
  process.env.CLAUDE_CLI_COMMAND = FAKE_CLAUDE;
  process.env.AI_MODE = "cli-auto";
  const { AutomatedCliProvider } = await import("@/server/ai/automated-cli-provider");
  provider = new AutomatedCliProvider();
}, 60_000);

afterAll(() => env.cleanup());

afterEach(async () => {
  const { prisma } = await import("@/server/db/client");
  await prisma.providerCooldown.deleteMany();
  for (const key of ["FAKE_CLAUDE_MODE", "FAKE_CLAUDE_OUTPUT", "FAKE_CLAUDE_LOG", "ANTHROPIC_API_KEY", "CLAUDECODE"]) {
    delete process.env[key];
  }
});

describe("AutomatedCliProvider (AI_MODE=cli-auto)", () => {
  it("shows requested effort in diagnostics without running an AI task", async () => {
    const { getAppConfig } = await import("@/shared/config/env");
    const { checkClaudeCli } = await import("@/server/diagnostics/checks/claude-cli");
    const ai = getAppConfig().ai;
    const log = path.join(env.dataDir, "diagnostics-claude-call.json");
    process.env.FAKE_CLAUDE_LOG = log;
    try {
      expect((await checkClaudeCli()).details).toMatchObject({ "Effort yêu cầu": "Theo mặc định Claude CLI" });
      ai.claudeEffort = "medium";
      expect((await checkClaudeCli()).details).toMatchObject({ "Effort yêu cầu": "medium" });
      expect(fs.existsSync(log)).toBe(false);
    } finally {
      ai.claudeEffort = undefined;
    }
  });

  it.each([undefined, "high"])(
    "shows effort %s in the manual CLI dry run without calling AI",
    async (effort) => {
      const { createJobRecord, markJobWaitingForCli } =
        await import("@/features/jobs/repositories/job-record.repository");
      const { LocalCliTaskProvider } = await import("@/server/ai/local-cli-task-provider");
      const record = await createJobRecord({
        bullmqJobId: nextTask(),
        jobType: "ANALYZE_CHAPTER",
        entityType: "CHAPTER",
        entityId: INPUT.chapterId,
      });
      await markJobWaitingForCli(record.id);
      await new LocalCliTaskProvider().analyzeChapter(INPUT, { taskId: record.id });
      const log = path.join(env.dataDir, `${record.id}-dry-run.json`);
      const { stdout } = await execFileAsync(
        "pnpm",
        ["exec", "tsx", "scripts/run-claude-task.ts", "--job", record.id, "--dry-run"],
        { env: { ...process.env, CLAUDE_EFFORT: effort ?? "", FAKE_CLAUDE_LOG: log }, timeout: 30_000 },
      );
      expect(stdout).toContain(`Effort yêu cầu: ${effort ?? "Theo mặc định Claude CLI"}`);
      if (effort) expect(stdout).toContain(`--effort ${effort}`);
      else expect(stdout).not.toContain("--effort");
      expect(fs.existsSync(log)).toBe(false);
    },
    40_000,
  );

  it.each(["low", "medium", "high", "xhigh", "max"] as const)(
    "passes configured effort %s to the shared CLI runner",
    async (effort) => {
      const { getAppConfig } = await import("@/shared/config/env");
      const ai = getAppConfig().ai;
      const log = path.join(env.dataDir, "claude-effort-call.json");
      Object.assign(process.env, {
        FAKE_CLAUDE_OUTPUT: JSON.stringify(OUTPUT),
        FAKE_CLAUDE_LOG: log,
        CLAUDE_CODE_EFFORT_LEVEL: "low",
      });
      try {
        ai.claudeEffort = effort;
        await provider.analyzeChapter(INPUT, { taskId: nextTask() });
        const call = JSON.parse(fs.readFileSync(log, "utf8")) as { args: string[]; effortEnv: string | null };
        expect(call.args[call.args.indexOf("--effort") + 1]).toBe(effort);
        expect(call.effortEnv).toBeNull();
      } finally {
        ai.claudeEffort = undefined;
        delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
      }
    },
  );

  it("runs the task through the Claude CLI right away and saves the validated output", async () => {
    const taskId = nextTask();
    const log = path.join(env.dataDir, "claude-call.json");
    Object.assign(process.env, {
      FAKE_CLAUDE_OUTPUT: JSON.stringify(OUTPUT),
      FAKE_CLAUDE_LOG: log,
      ANTHROPIC_API_KEY: "must-not-leak",
      CLAUDECODE: "1",
    });

    await expect(provider.analyzeChapter(INPUT, { taskId })).resolves.toEqual({ status: "completed", output: OUTPUT });

    expect(JSON.parse(fs.readFileSync(taskFile(taskId, "output.json"), "utf8"))).toEqual(OUTPUT);
    expect(fs.existsSync(taskFile(taskId, "prompt.md"))).toBe(true);
    const call = JSON.parse(fs.readFileSync(log, "utf8")) as Record<string, unknown>;
    expect(call.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--json-schema",
      fs.readFileSync(taskFile(taskId, "schema.json"), "utf8"),
    ]);
    expect(call).toMatchObject({ anthropicApiKey: null, claudeCodeSession: null });
    expect(call.promptLength).toBeGreaterThan(0);
  });

  it("reuses a saved output instead of calling Claude again", async () => {
    const taskId = nextTask();
    process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify(OUTPUT);
    await provider.analyzeChapter(INPUT, { taskId });
    process.env.FAKE_CLAUDE_MODE = "quota";
    await expect(provider.analyzeChapter(INPUT, { taskId })).resolves.toMatchObject({ status: "completed" });
  });

  it.each([
    ["quota", "AI_QUOTA_EXCEEDED"],
    ["logged-out", "AI_CLI_AUTH"],
    ["bad-output", "INVALID_AI_OUTPUT"],
    ["invalid-model", "AI_CLI_MODEL_UNAVAILABLE"],
  ])("fails with a clear code when Claude reports %s", async (mode, code) => {
    const taskId = nextTask();
    process.env.FAKE_CLAUDE_MODE = mode;
    await expect(provider.analyzeChapter(INPUT, { taskId })).rejects.toMatchObject({ code });
    expect(fs.existsSync(taskFile(taskId, "output.json"))).toBe(false);
  });

  it.each([
    ["quota-30m", 30 * 60_000],
    ["quota-1h", 60 * 60_000],
  ] as const)("reads the reset interval from the %s CLI response and waits until then", async (mode, retryAfterMs) => {
    const log = path.join(env.dataDir, "claude-quota-call.json");
    Object.assign(process.env, { FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log });
    await expect(provider.analyzeChapter(INPUT, { taskId: nextTask() })).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
      retryAfterMs,
    });
    fs.rmSync(log);
    const error: unknown = await provider
      .analyzeChapter(INPUT, { taskId: nextTask() })
      .catch((failure: unknown) => failure);
    const { IntegrationError } = await import("@/server/integrations/integration-error");
    if (!(error instanceof IntegrationError)) throw new Error("Expected quota failure");
    expect(error.retryAfterMs).toBeGreaterThan(retryAfterMs - 5_000);
    expect(fs.existsSync(log)).toBe(false);
  });

  it("stops the Claude process when the job is cancelled", async () => {
    process.env.FAKE_CLAUDE_MODE = "slow";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const startedAt = Date.now();
    await expect(
      provider.analyzeChapter(INPUT, { taskId: nextTask(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });
});
