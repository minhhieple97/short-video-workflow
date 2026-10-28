import fs from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type * as AutomatedCli from "@/server/ai/automated-cli-provider";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const FAKE_CLAUDE = path.join(import.meta.dirname, "../helpers/fake-claude.mjs");
const OUTPUT = { chapterId: "chapter-1", lessons: [] };
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

afterEach(() => {
  for (const key of ["FAKE_CLAUDE_MODE", "FAKE_CLAUDE_OUTPUT", "FAKE_CLAUDE_LOG", "ANTHROPIC_API_KEY", "CLAUDECODE"]) {
    delete process.env[key];
  }
});

describe("AutomatedCliProvider (AI_MODE=cli-auto)", () => {
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
  ])("fails with a clear code when Claude reports %s", async (mode, code) => {
    const taskId = nextTask();
    process.env.FAKE_CLAUDE_MODE = mode;
    await expect(provider.analyzeChapter(INPUT, { taskId })).rejects.toMatchObject({ code });
    expect(fs.existsSync(taskFile(taskId, "output.json"))).toBe(false);
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
