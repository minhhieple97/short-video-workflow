import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as TaskFiles from "@/server/ai/cli-task/task-files";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let taskFiles: typeof TaskFiles;

beforeAll(async () => {
  env = setupTestEnvironment();
  taskFiles = await import("@/server/ai/cli-task/task-files");
}, 60_000);

afterAll(() => env.cleanup());

describe("the scene-plan task kind", () => {
  it("is a known task kind next to the existing ones", () => {
    expect(taskFiles.TASK_KINDS).toEqual(
      expect.arrayContaining(["chapter-analysis", "video-script", "scene-regeneration", "scene-plan"]),
    );
  });

  it("writes a JSON schema for Claude that asks for a hook, the story scenes and an optional publish set", async () => {
    await taskFiles.writeTaskFiles(
      {
        taskId: "scene-plan-1",
        kind: "scene-plan",
        promptVersion: "scene-plan-v1",
        createdAt: "2026-10-28T00:00:00.000Z",
        resume: null,
      },
      { any: "input" },
      "prompt",
    );

    const schema = JSON.parse(
      fs.readFileSync(path.join(env.dataDir, "ai-tasks", "scene-plan-1", "schema.json"), "utf8"),
    ) as {
      properties: Record<string, unknown>;
      required: string[];
      $schema?: string;
    };
    expect(schema.required).toEqual(expect.arrayContaining(["hook", "scenes"]));
    expect(Object.keys(schema.properties).sort()).toEqual(["hook", "publish", "scenes"]);
    expect(schema.required).not.toContain("publish");
    expect(schema.$schema).toBeUndefined();
  });

  it("reads its task metadata back", async () => {
    await taskFiles.writeTaskFiles(
      {
        taskId: "scene-plan-2",
        kind: "scene-plan",
        promptVersion: "scene-plan-v1",
        createdAt: "2026-10-28T00:00:00.000Z",
        resume: null,
      },
      {},
      "prompt",
    );

    await expect(taskFiles.readTaskMeta("scene-plan-2")).resolves.toMatchObject({ kind: "scene-plan" });
  });

  it("validates Claude's output against the story-order contract", () => {
    const schema = taskFiles.TASK_OUTPUT_SCHEMAS["scene-plan"];
    const scene = (type: string) => ({ type, narration: "Lời.", onScreenText: "Chữ", visualVariant: "SCENARIO_CARD" });
    const hook = { variant: "QUESTION", narration: "Hook?", onScreenText: "Hook?", visualVariant: "HOOK_QUESTION" };

    expect(
      schema.safeParse({
        hook,
        scenes: ["SITUATION", "COMMON_MISTAKE", "BETTER_APPROACH", "KEY_TAKEAWAY", "ACTION_STEP"].map(scene),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        hook,
        scenes: ["SITUATION", "COMMON_MISTAKE", "KEY_TAKEAWAY", "BETTER_APPROACH", "ACTION_STEP"].map(scene),
      }).success,
    ).toBe(true);
  });
});
