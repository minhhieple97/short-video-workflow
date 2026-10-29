import fs from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SCENE_PLAN_PROMPT_VERSION } from "@/server/ai/prompts/scene-plan-prompt";
import { IntegrationError } from "@/server/integrations/integration-error";
import { createScenePlanCompiler } from "@/server/scene-plan";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";
import type { ClaudeScenePlanCompiler as ClaudeCompilerType } from "@/server/scene-plan/claude-scene-plan-compiler";
import type { ScenePlan, ScenePlanRequest } from "@/server/scene-plan/scene-plan-compiler";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import { describeScenePlanCompilerContract } from "../helpers/contracts/scene-plan-compiler-contract";
import { SAMPLE_LESSON } from "../helpers/contracts/script-studio-provider-contract";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const FAKE_CLAUDE = path.join(import.meta.dirname, "../helpers/fake-claude.mjs");

const beat = (name: ScriptDraft["beats"][number]["beat"], narration: string) => ({
  beat: name,
  narration,
  sourceExcerpts: [],
  illustrative: name === "SITUATION",
});
// This draft is the one the shared contract uses, so the plan Claude "returns" below matches what the contract expects.
const DRAFT: ScriptDraft = {
  lessonId: SAMPLE_LESSON.lessonId,
  targetDurationSec: 60,
  durationReason: "Đủ kể trọn bài học.",
  beats: [
    beat("HOOK", "Vì sao bạn cứ hẹn ngày mai?"),
    beat("SITUATION", "Tối nào bạn cũng định tập nhưng lại thôi."),
    beat("MISTAKE", "Bạn đặt mục tiêu quá lớn."),
    beat("LESSON", "Sách gợi ý bắt đầu bằng hai phút."),
    beat("RESOLUTION", "Quay lại tối nay: chỉ mang giày vào."),
    beat("ACTION", "Làm ngay hai phút đầu tiên."),
  ],
};
const REQUEST: ScenePlanRequest = {
  draft: DRAFT,
  lesson: SAMPLE_LESSON,
  targetDurationSec: 60,
  range: { minDurationSec: 30, maxDurationSec: 60 },
  revisionNote: null,
};

let env: TestEnvironment;
let ClaudeScenePlanCompiler: typeof ClaudeCompilerType;
let goodPlan: ScenePlan;
let compiler: ClaudeCompilerType;

const log = () => path.join(env.dataDir, "claude-call.json");
const called = () => fs.existsSync(log());
const callArgs = () => (JSON.parse(fs.readFileSync(log(), "utf8")) as { args: string[] }).args;
const claudeReturns = (plan: unknown) => {
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify(plan);
};

async function failureOf(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  process.env.CLAUDE_CLI_COMMAND = FAKE_CLAUDE;
  process.env.AI_MODE = "cli-auto";
  ({ ClaudeScenePlanCompiler } = await import("@/server/scene-plan/claude-scene-plan-compiler"));
  goodPlan = await new MockScenePlanCompiler().compile(REQUEST);
}, 60_000);

beforeEach(() => {
  compiler = new ClaudeScenePlanCompiler();
  process.env.FAKE_CLAUDE_LOG = log();
  claudeReturns(goodPlan);
});

afterEach(() => {
  fs.rmSync(log(), { force: true });
  fs.rmSync(path.join(env.dataDir, "ai-tasks"), { recursive: true, force: true });
  for (const key of ["FAKE_CLAUDE_MODE", "FAKE_CLAUDE_OUTPUT", "FAKE_CLAUDE_LOG", "ANTHROPIC_API_KEY", "CLAUDECODE"]) {
    delete process.env[key];
  }
});

afterAll(() => env.cleanup());

describeScenePlanCompilerContract(
  "ClaudeScenePlanCompiler through a fake Claude CLI",
  () => new ClaudeScenePlanCompiler(),
);

describe("ClaudeScenePlanCompiler", () => {
  it("returns Claude's plan and saves it as the task's output", async () => {
    const plan = await compiler.compile(REQUEST);

    expect(plan).toEqual(goodPlan);
    const [taskId] = fs.readdirSync(path.join(env.dataDir, "ai-tasks"));
    expect(taskId).toMatch(/^scene-plan-[0-9a-f]{24}$/);
    expect(
      JSON.parse(fs.readFileSync(path.join(env.dataDir, "ai-tasks", taskId ?? "", "output.json"), "utf8")),
    ).toEqual(goodPlan);
  });

  it("asks with no built-in tools, no MCP servers and a sanitized environment", async () => {
    Object.assign(process.env, { ANTHROPIC_API_KEY: "must-not-leak", CLAUDECODE: "1" });

    await compiler.compile(REQUEST);

    const args = callArgs();
    expect(args).toEqual(expect.arrayContaining(["-p", "--strict-mcp-config", "--no-session-persistence"]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(JSON.parse(fs.readFileSync(log(), "utf8"))).toMatchObject({
      anthropicApiKey: null,
      claudeCodeSession: null,
    });
  });

  it("gives Claude the draft and the lesson in the task input, fenced as untrusted data in the prompt", async () => {
    await compiler.compile(REQUEST);

    const [taskId] = fs.readdirSync(path.join(env.dataDir, "ai-tasks"));
    const directory = path.join(env.dataDir, "ai-tasks", taskId ?? "");
    const input = JSON.parse(fs.readFileSync(path.join(directory, "input.json"), "utf8")) as Record<string, unknown>;
    expect(input).toMatchObject({
      targetDurationSec: 60,
      revisionNote: null,
      promptVersion: SCENE_PLAN_PROMPT_VERSION,
    });
    expect(fs.readFileSync(path.join(directory, "prompt.md"), "utf8")).toContain("<<<BEGIN_UNTRUSTED_SOURCE_TEXT>>>");
  });

  it("reuses the saved plan for the same input without calling Claude again", async () => {
    await compiler.compile(REQUEST);
    fs.rmSync(log());

    const again = await new ClaudeScenePlanCompiler().compile(REQUEST);

    expect(again).toEqual(goodPlan);
    expect(called()).toBe(false);
  });

  it("treats a different correction note, length or draft as a new task", async () => {
    await compiler.compile(REQUEST);
    fs.rmSync(log());

    await compiler.compile({ ...REQUEST, revisionNote: "Rút gọn." });
    expect(called()).toBe(true);
    fs.rmSync(log());

    await compiler.compile({ ...REQUEST, targetDurationSec: 45 });
    expect(called()).toBe(true);
    expect(fs.readdirSync(path.join(env.dataDir, "ai-tasks"))).toHaveLength(3);
  });

  it("maps CLI failures to integration failure kinds", async () => {
    process.env.FAKE_CLAUDE_MODE = "quota";
    expect(await failureOf(compiler.compile(REQUEST))).toMatchObject({ code: "AI_QUOTA_EXCEEDED", kind: "QUOTA" });

    process.env.FAKE_CLAUDE_MODE = "logged-out";
    expect(await failureOf(compiler.compile(REQUEST))).toMatchObject({ code: "AI_CLI_AUTH", kind: "AUTH" });

    process.env.FAKE_CLAUDE_MODE = "bad-output";
    expect(await failureOf(compiler.compile(REQUEST))).toMatchObject({ code: "INVALID_AI_OUTPUT", kind: "REJECTED" });
  });

  it("rejects a plan that breaks the story order instead of saving it", async () => {
    const swapped = { ...goodPlan, scenes: [...goodPlan.scenes].reverse() };
    claudeReturns(swapped);

    expect(await failureOf(compiler.compile(REQUEST))).toMatchObject({ code: "INVALID_AI_OUTPUT", kind: "REJECTED" });
    expect(
      fs
        .readdirSync(path.join(env.dataDir, "ai-tasks"))
        .flatMap((id) => fs.readdirSync(path.join(env.dataDir, "ai-tasks", id))),
    ).not.toContain("output.json");
  });

  it("rejects a plan that adds a number or a quotation, names them, and lets the same input be asked again", async () => {
    const invented = {
      ...goodPlan,
      scenes: goodPlan.scenes.map((scene, index) =>
        index === 2
          ? { ...scene, narration: 'Nghiên cứu cho thấy 73% người thành công. Tác giả: "không có đường tắt nào cả".' }
          : scene,
      ),
    };
    claudeReturns(invented);

    const failure = await failureOf(compiler.compile(REQUEST));

    expect(failure).toMatchObject({ code: "SCENE_PLAN_UNSUPPORTED_CLAIM", kind: "REJECTED" });
    expect(failure.details).toEqual({ numbers: ["73"], quotes: ["không có đường tắt nào cả"] });

    claudeReturns(goodPlan);
    fs.rmSync(log(), { force: true });
    await expect(compiler.compile(REQUEST)).resolves.toEqual(goodPlan);
    expect(called()).toBe(true);
  });

  it("does not call Claude when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(compiler.compile(REQUEST, { signal: controller.signal })).rejects.toThrow();

    expect(called()).toBe(false);
  });
});

describe("createScenePlanCompiler", () => {
  it("picks the mock offline and Claude for cli-auto", () => {
    expect(createScenePlanCompiler("mock")).toBeInstanceOf(MockScenePlanCompiler);
    expect(createScenePlanCompiler("cli-auto")).toBeInstanceOf(ClaudeScenePlanCompiler);
  });

  it("refuses cli-task, which would wait for a human on every video", () => {
    expect(() => createScenePlanCompiler("cli-task")).toThrowError(
      expect.objectContaining({ code: "AI_MODE_UNSUPPORTED" }),
    );
  });
});

describeScenePlanCompilerContract("MockScenePlanCompiler", () => new MockScenePlanCompiler());
