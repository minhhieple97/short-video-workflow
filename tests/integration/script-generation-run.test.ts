import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_AI_SETTINGS } from "@/features/settings/domain/ai-settings";
import type { AiProvider } from "@/server/ai/ai-provider";
import type { SceneRegenerationInput } from "@/server/ai/contracts/video-script";
import { MockAiProvider } from "@/server/ai/mock-ai-provider";
import { castFromSnapshot } from "@/remotion/stage/cast";
import { validateStoryDraft } from "@/server/script-draft/contracts";
import { validateStoryScenePlan } from "@/server/scene-plan/story-scene-plan";
import { MockScriptDraftWriter } from "@/server/script-draft/mock-script-draft-writer";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";
import type * as DbClient from "@/server/db/client";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as ScriptPipeline from "@/features/videos/services/script-pipeline.service";
import type * as GenerationRuns from "@/features/videos/services/script-generation-run.service";
import type * as AiSettings from "@/features/settings/services/ai-settings.service";

import { REAL_MODEL_USAGE } from "../helpers/fixtures/real-model-usage";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";
import { seedProduction } from "../helpers/production-fixture";

let environment: TestEnvironment;
let db: typeof DbClient;
let productions: typeof ProductionRequest;
let pipeline: typeof ScriptPipeline;
let runs: typeof GenerationRuns;
let settings: typeof AiSettings;
let runId: string;
let videoId: string;
let bookId: string;
const SOURCE = "Quyền chủ động xuất bản không thay thế việc tìm đúng người đọc.";
const at = <T>(values: readonly T[], index = 0): T => {
  const value = values[index];
  if (value === undefined) throw new Error("Missing fixture value.");
  return value;
};

beforeAll(async () => {
  environment = setupTestEnvironment();
  db = await import("@/server/db/client");
  productions = await import("@/features/productions/services/production-request.service");
  pipeline = await import("@/features/videos/services/script-pipeline.service");
  runs = await import("@/features/videos/services/script-generation-run.service");
  settings = await import("@/features/settings/services/ai-settings.service");
}, 60_000);
beforeEach(async () => {
  await db.prisma.aiGenerationSetting.deleteMany();
  const seeded = await seedProduction({ db, productions, pipeline: "opus" });
  videoId = seeded.videoId;
  bookId = seeded.bookId;
  await db.prisma.chapter.updateMany({
    where: { bookId },
    data: { content: `Một đoạn dẫn nhập. ${SOURCE} Điều kiện là phải chủ động kết nối người học.` },
  });
  await db.prisma.lessonSource.updateMany({ where: { lessonId: seeded.lessonId }, data: { sourceExcerpt: SOURCE } });
  const item = await db.prisma.productionItem.findUniqueOrThrow({ where: { id: seeded.itemId } });
  if (!item.scriptGenerationRunId) throw new Error("Missing generation run.");
  runId = item.scriptGenerationRunId;
  const row = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
  const { generationInputSchema } = await import("@/server/script-draft/contracts");
  const input = generationInputSchema.parse(row.inputJson);
  input.lessons.forEach((lesson) => {
    lesson.sources.forEach((source) => {
      source.excerpt = SOURCE;
    });
  });
  await db.prisma.scriptGenerationRun.update({ where: { id: runId }, data: { inputJson: input } });
});
afterAll(async () => {
  await db.prisma.$disconnect();
  environment.cleanup();
});

const stage = () => ({ generationRunId: runId, jobRecordId: null, mode: "mock" as const });

describe("source-grounded script generations", () => {
  it("rejects a CLI response that reports a different model", async () => {
    const { getAppConfig } = await import("@/shared/config/env");
    const ai = getAppConfig().ai;
    const command = ai.claudeCliCommand;
    try {
      ai.claudeCliCommand = path.join(import.meta.dirname, "../helpers/fake-claude.mjs");
      process.env.FAKE_CLAUDE_MODEL = "claude-sonnet-5-5";
      process.env.FAKE_CLAUDE_OUTPUT = "{}";
      await expect(pipeline.writeGenerationDraft({ ...stage(), mode: "cli-auto" })).rejects.toMatchObject({
        code: "AI_CLI_MODEL_MISMATCH",
      });
      expect(
        (await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } })).draftArtifactJson,
      ).toBeNull();
    } finally {
      ai.claudeCliCommand = command;
      delete process.env.FAKE_CLAUDE_MODEL;
      delete process.env.FAKE_CLAUDE_OUTPUT;
    }
  });

  it("accepts the answer of the requested model although the CLI also lists its helper model, and rejects another primary one", async () => {
    const { getAppConfig } = await import("@/shared/config/env");
    const files = await import("@/server/ai/cli-task/task-files");
    const ai = getAppConfig().ai;
    const command = ai.claudeCliCommand;
    try {
      ai.claudeCliCommand = path.join(import.meta.dirname, "../helpers/fake-claude.mjs");
      const generation = await runs.prepareGenerationRun(runId);
      const response = await new MockScriptDraftWriter().writeDraft(
        {
          input: generation.input,
          settings: generation.settings,
          sourcePack: generation.sourcePack,
          revisionNote: null,
        },
        { taskId: "fixture" },
      );
      if (response.status !== "completed") throw new Error("Unexpected wait.");
      process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify(response.output);

      process.env.FAKE_CLAUDE_MODEL_USAGE = JSON.stringify({
        "claude-sonnet-5-5": { outputTokens: 900, costUSD: 0.05 },
        "claude-haiku-5-5": REAL_MODEL_USAGE["claude-haiku-5-5"],
      });
      await expect(pipeline.writeGenerationDraft({ ...stage(), mode: "cli-auto" })).rejects.toMatchObject({
        code: "AI_CLI_MODEL_MISMATCH",
      });

      process.env.FAKE_CLAUDE_MODEL_USAGE = JSON.stringify(REAL_MODEL_USAGE);
      const draft = await pipeline.writeGenerationDraft({ ...stage(), mode: "cli-auto" });
      expect("draft" in draft).toBe(true);
      const row = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
      const { storyDraftArtifactSchema } = await import("@/server/script-draft/artifacts");
      const report = await files.readTaskExecution(
        `script-draft-${storyDraftArtifactSchema.parse(row.draftArtifactJson).inputHash}`,
      );
      expect(report).toMatchObject({
        requestedModel: "claude-opus-5-5",
        primaryModel: "claude-opus-5-5",
        observedModels: ["claude-haiku-5-5", "claude-opus-5-5"],
      });
    } finally {
      ai.claudeCliCommand = command;
      for (const key of ["FAKE_CLAUDE_OUTPUT", "FAKE_CLAUDE_MODEL_USAGE"]) delete process.env[key];
    }
  });

  it("resumes a legacy waiting AiRun after a prompt-version update", async () => {
    const audit = await import("@/features/jobs/repositories/ai-run.repository");
    const old = await audit.startAiRun({
      jobRecordId: "legacy-wait",
      mode: "cli-task",
      promptVersion: "video-script-v11",
      inputHash: "old-version",
    });
    await audit.markAiRunWaiting(old.id);
    const resumed = await audit.startAiRun({
      jobRecordId: "legacy-wait",
      mode: "cli-task",
      promptVersion: "video-script-v12",
      inputHash: "new-version",
    });
    expect(resumed.id).toBe(old.id);
    expect(resumed.promptVersion).toBe("video-script-v11");
  });

  it("runs the manual full-script entrypoint through the shared two-stage pipeline", async () => {
    const { runScriptGeneration } = await import("@/features/videos/services/script-generation.service");
    expect(await runScriptGeneration({ videoId, generationRunId: runId, jobRecordId: null })).toEqual({
      scenes: 6,
      hookOptions: 2,
    });
    const video = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(video.scriptGenerationRunId).toBe(runId);
  });
  it("keeps the first accepted draft when another writer finishes after the video was applied", async () => {
    const firstGate = Promise.withResolvers<void>();
    const secondGate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    let calls = 0;
    const writer = {
      id: "concurrent-writer",
      writeDraft: async (...args: Parameters<MockScriptDraftWriter["writeDraft"]>) => {
        const index = calls++;
        if (calls === 2) entered.resolve();
        await (index === 0 ? firstGate.promise : secondGate.promise);
        const result = await new MockScriptDraftWriter().writeDraft(...args);
        if (result.status === "completed" && index === 1) {
          const resolution = result.output.beats.find((beat) => beat.beat === "RESOLUTION");
          if (resolution) resolution.narration += " Một cách diễn đạt khác.";
        }
        return result;
      },
    };
    const a = pipeline.writeGenerationDraft(stage(), writer);
    const b = pipeline.writeGenerationDraft(stage(), writer);
    try {
      await entered.promise;
      firstGate.resolve();
      const accepted = await a;
      await pipeline.compileGenerationPlan(stage());
      const { replaceScript } = await import("@/features/videos/repositories/video.repository");
      await replaceScript(videoId, await pipeline.generationReplacement(runId));
      const before = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
      secondGate.resolve();
      expect(await b).toEqual(accepted);
      const after = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
      expect(after.draftArtifactJson).toEqual(before.draftArtifactJson);
      expect(after.castJson).toEqual(before.castJson);
      expect(after.scenePlanArtifactJson).toEqual(before.scenePlanArtifactJson);
    } finally {
      firstGate.resolve();
      secondGate.resolve();
      await Promise.allSettled([a, b]);
    }
  });

  it("uses one correction without changing the already applied generation until the replacement is ready", async () => {
    const { createPipelineDeps } = await import("@/features/productions/services/pipeline-deps");
    const { runProductionStep } = await import("@/features/productions/services/production-pipeline.service");
    const { claimProductionItem } = await import("@/features/productions/repositories/production-claim.repository");
    const { requestAiCorrection } = await import("@/features/productions/services/ai-correction.service");
    const item = await db.prisma.productionItem.findFirstOrThrow({ where: { videoId } });
    const claimToken = "generation-correction";
    await claimProductionItem(item.id, claimToken, 600_000);
    const deps = createPipelineDeps("mock", null, true);
    const step = (lane: "claude" | "general") => runProductionStep({ itemId: item.id, claimToken, deps, lane });
    expect(await step("claude")).toEqual({ kind: "CONTINUE" });
    expect(await step("claude")).toEqual({ kind: "CONTINUE" });
    expect(await step("general")).toEqual({ kind: "CONTINUE" });
    const previous = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
    expect(await requestAiCorrection({ itemId: item.id, claimToken, issues: [{ code: "OVER_TARGET" }] })).toMatchObject(
      { status: "CORRECTION_STARTED", target: "SCRIPT_STUDIO", rewoundTo: "NONE" },
    );
    const corrected = await db.prisma.productionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(corrected.scriptGenerationRunId).not.toBe(runId);
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptGenerationRunId).toBe(runId);
    expect(await step("claude")).toEqual({ kind: "CONTINUE" });
    expect(await step("claude")).toEqual({ kind: "CONTINUE" });
    expect(await step("general")).toEqual({ kind: "CONTINUE" });
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptGenerationRunId).toBe(
      corrected.scriptGenerationRunId,
    );
    expect((await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } })).castJson).toEqual(
      previous.castJson,
    );
    expect(await requestAiCorrection({ itemId: item.id, claimToken, issues: [{ code: "OVER_TARGET" }] })).toEqual({
      status: "BUDGET_SPENT",
    });
  });

  it("queues a new draft in the Claude lane", async () => {
    const item = await db.prisma.productionItem.findFirstOrThrow({ where: { videoId } });
    const intent = await db.prisma.jobDispatch.findFirstOrThrow({
      where: { jobRecord: { entityId: item.id, jobType: "RUN_PRODUCTION_ITEM" } },
    });
    expect(JSON.parse(intent.payloadJson)).toEqual({ itemId: item.id, lane: "claude" });
  });

  it("resumes two CLI tasks with separate outputs and frozen execution settings", async () => {
    const { findWaitingTaskId } = await import("@/features/jobs/repositories/ai-run.repository");
    const files = await import("@/server/ai/cli-task/task-files");
    const jobRecordId = "two-stage-manual";
    const current = {
      ...stage(),
      jobRecordId,
      mode: "cli-task" as const,
      resume: { jobType: "GENERATE_VIDEO_SCRIPT" as const, payload: { videoId, generationRunId: runId } },
    };
    expect(await pipeline.writeGenerationDraft(current)).toMatchObject({ waitingForCli: true });
    const draftTaskId = await findWaitingTaskId(jobRecordId);
    if (!draftTaskId) throw new Error("Missing waiting draft.");
    expect(await files.readTaskMeta(draftTaskId)).toMatchObject({
      kind: "script-draft",
      execution: { model: "claude-opus-5-5", effort: "xhigh" },
    });
    const generation = await runs.prepareGenerationRun(runId);
    const response = await new MockScriptDraftWriter().writeDraft(
      { input: generation.input, settings: generation.settings, sourcePack: generation.sourcePack, revisionNote: null },
      { taskId: "offline-fixture" },
    );
    if (response.status !== "completed") throw new Error("Unexpected wait.");
    await files.writeTaskOutput(draftTaskId, response.output);
    await pipeline.writeGenerationDraft(current);
    expect(await pipeline.compileGenerationPlan(current)).toMatchObject({ waitingForCli: true });
    const sceneTaskId = await findWaitingTaskId(jobRecordId);
    if (!sceneTaskId) throw new Error("Missing waiting scene plan.");
    expect(sceneTaskId).not.toBe(draftTaskId);
    expect(await files.readTaskMeta(sceneTaskId)).toMatchObject({
      kind: "story-scene-plan",
      execution: { model: "claude-sonnet-5-5", effort: "xhigh" },
    });
    const { captureCast } = await import("@/features/videos/domain/characters");
    const story = {
      input: generation.input,
      sourcePack: generation.sourcePack,
      draft: response.output,
      cast: captureCast(generation.settings.characters, response.output.cast),
    };
    const plan = await new MockScenePlanCompiler().compile({
      story,
      draft: story.draft,
      lesson: at(generation.input.lessons),
      book: generation.input.book,
      targetDurationSec: story.draft.targetDurationSec,
      range: generation.input,
      pace: generation.input.pace,
      revisionNote: null,
    });
    await files.writeTaskOutput(sceneTaskId, plan);
    await pipeline.compileGenerationPlan(current);
    const audit = await db.prisma.aiRun.findMany({ where: { jobRecordId }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.stage)).toEqual(["draft", "scene"]);
    expect(audit.every((row) => row.status === "COMPLETED")).toBe(true);
    expect(await files.readTaskOutput(draftTaskId)).toMatchObject({ schemaVersion: "story-draft-v2" });
    expect(await files.readTaskOutput(sceneTaskId)).toMatchObject({ schemaVersion: "story-scene-plan-v2" });
  });

  it("passes Opus and Sonnet xhigh to the CLI even with different global defaults", async () => {
    const { getAppConfig } = await import("@/shared/config/env");
    const ai = getAppConfig().ai;
    const saved = { command: ai.claudeCliCommand, model: ai.claudeModel, effort: ai.claudeEffort };
    const log = path.join(environment.dataDir, "stage-cli.json");
    try {
      ai.claudeCliCommand = path.join(import.meta.dirname, "../helpers/fake-claude.mjs");
      ai.claudeModel = "wrong-global-model";
      ai.claudeEffort = "low";
      process.env.FAKE_CLAUDE_LOG = log;
      const generation = await runs.prepareGenerationRun(runId);
      const response = await new MockScriptDraftWriter().writeDraft(
        {
          input: generation.input,
          settings: generation.settings,
          sourcePack: generation.sourcePack,
          revisionNote: null,
        },
        { taskId: "fixture" },
      );
      if (response.status !== "completed") throw new Error("Unexpected wait.");
      process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify(response.output);
      process.env.FAKE_CLAUDE_MODEL = "claude-opus-5-5";
      await pipeline.writeGenerationDraft({ ...stage(), mode: "cli-auto" });
      expect((JSON.parse(fs.readFileSync(log, "utf8")) as { args: string[] }).args).toEqual(
        expect.arrayContaining(["--model", "claude-opus-5-5", "--effort", "xhigh"]),
      );
      const { captureCast } = await import("@/features/videos/domain/characters");
      const story = {
        input: generation.input,
        sourcePack: generation.sourcePack,
        draft: response.output,
        cast: captureCast(generation.settings.characters, response.output.cast),
      };
      process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify(
        await new MockScenePlanCompiler().compile({
          story,
          draft: story.draft,
          lesson: at(generation.input.lessons),
          book: generation.input.book,
          targetDurationSec: story.draft.targetDurationSec,
          range: generation.input,
          pace: generation.input.pace,
          revisionNote: null,
        }),
      );
      process.env.FAKE_CLAUDE_MODEL = "claude-sonnet-5-5";
      await pipeline.compileGenerationPlan({ ...stage(), mode: "cli-auto" });
      expect((JSON.parse(fs.readFileSync(log, "utf8")) as { args: string[] }).args).toEqual(
        expect.arrayContaining(["--model", "claude-sonnet-5-5", "--effort", "xhigh"]),
      );
    } finally {
      ai.claudeCliCommand = saved.command;
      ai.claudeModel = saved.model;
      ai.claudeEffort = saved.effort;
      for (const key of ["FAKE_CLAUDE_LOG", "FAKE_CLAUDE_OUTPUT", "FAKE_CLAUDE_MODEL"]) delete process.env[key];
    }
  });
  it("freezes settings and local sources and keeps null pages for text imports", async () => {
    const prepared = await runs.prepareGenerationRun(runId);
    expect(prepared.sourcePack.sources[0]).toMatchObject({ page: null, excerpt: SOURCE });
    const changed = structuredClone(DEFAULT_AI_SETTINGS);
    changed.script.model = "claude-other";
    at(changed.characters.profiles).name = "Tên mới";
    await settings.updateAiSettings({ revision: 0, settings: changed });
    await db.prisma.chapter.updateMany({ where: { bookId }, data: { content: "Nội dung chương đã thay đổi." } });
    const again = await runs.prepareGenerationRun(runId);
    expect(again.sourcePack).toEqual(prepared.sourcePack);
    expect(again.settings.script.model).toBe("claude-opus-5-5");
    expect(again.settings.characters.profiles[0]?.name).toBe("Hoàng");
  });

  it("rejects an unmatched excerpt before asking a writer", async () => {
    await db.prisma.chapter.updateMany({ where: { bookId }, data: { content: "Không chứa trích đoạn của bài học." } });
    let calls = 0;
    await expect(
      pipeline.writeGenerationDraft(stage(), {
        id: "must-not-run",
        writeDraft: async (request, context) => {
          calls += 1;
          return new MockScriptDraftWriter().writeDraft(request, context);
        },
      }),
    ).rejects.toMatchObject({ code: "SCRIPT_SOURCE_EXCERPT_MISMATCH" });
    expect(calls).toBe(0);
  });

  it("resumes stages and applies script plus cast only once", async () => {
    const { replaceScript } = await import("@/features/videos/repositories/video.repository");
    await pipeline.writeGenerationDraft(stage());
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptGenerationRunId).toBeNull();
    await pipeline.compileGenerationPlan(stage());
    const replacement = await pipeline.generationReplacement(runId);
    const first = await replaceScript(videoId, replacement);
    const scenes = await db.prisma.videoScene.findMany({ where: { videoId } });
    await replaceScript(videoId, replacement);
    expect(await db.prisma.videoScene.findMany({ where: { videoId } })).toEqual(scenes);
    expect(first.scriptGenerationRunId).toBe(runId);
    const { getVideo } = await import("@/features/videos/services/video.service");
    const video = await getVideo(videoId);
    expect(video.cast?.profiles[0]).toMatchObject({ id: "hoang", name: "Hoàng", gender: "MALE" });
    if (!video.cast) throw new Error("Missing cast.");
    expect(castFromSnapshot(video.cast).main.hair).toBe("Short");
    const { getScriptSourceView } = await import("@/features/videos/services/script-source-view.service");
    await db.prisma.video.update({ where: { id: videoId }, data: { scriptVersion: { increment: 1 } } });
    expect((await getScriptSourceView(videoId))?.edited).toBe(false);
    const firstScene = scenes[0];
    if (!firstScene) throw new Error("Missing fixture scene.");
    await db.prisma.videoScene.update({ where: { id: firstScene.id }, data: { narration: "Lời kể đã được sửa tay." } });
    expect((await getScriptSourceView(videoId))?.edited).toBe(true);
  });

  it("tells which model Claude Code reported doing each stage, and nothing when it reported none", async () => {
    const { replaceScript } = await import("@/features/videos/repositories/video.repository");
    const { getScriptSourceView } = await import("@/features/videos/services/script-source-view.service");
    const { writeTaskExecution } = await import("@/server/ai/cli-task/task-files");
    const { storyDraftArtifactSchema, storySceneArtifactSchema } = await import("@/server/script-draft/artifacts");
    await pipeline.writeGenerationDraft(stage());
    await pipeline.compileGenerationPlan(stage());
    await replaceScript(videoId, await pipeline.generationReplacement(runId));
    expect((await getScriptSourceView(videoId))?.actualModels).toEqual({ script: null, scene: null });

    const row = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
    const draft = storyDraftArtifactSchema.parse(row.draftArtifactJson);
    const scene = storySceneArtifactSchema.parse(row.scenePlanArtifactJson);
    await writeTaskExecution(`script-draft-${draft.inputHash}`, {
      requestedModel: "claude-opus-5-5",
      requestedEffort: "xhigh",
      primaryModel: "claude-opus-5-5",
      observedModels: ["claude-haiku-5-5", "claude-opus-5-5"],
    });
    await writeTaskExecution(`scene-plan-${scene.inputHash}`, {
      requestedModel: "claude-sonnet-5-5",
      requestedEffort: "xhigh",
      primaryModel: "claude-sonnet-5-5",
      observedModels: ["claude-haiku-5-5", "claude-sonnet-5-5"],
    });

    expect((await getScriptSourceView(videoId))?.actualModels).toEqual({
      script: "claude-opus-5-5",
      scene: "claude-sonnet-5-5",
    });
  });

  it("keeps the current video if it was edited during generation", async () => {
    await pipeline.writeGenerationDraft(stage());
    await pipeline.compileGenerationPlan(stage());
    await db.prisma.video.update({ where: { id: videoId }, data: { scriptVersion: { increment: 1 } } });
    const { replaceScript } = await import("@/features/videos/repositories/video.repository");
    await expect(replaceScript(videoId, await pipeline.generationReplacement(runId))).rejects.toMatchObject({
      code: "SCRIPT_GENERATION_STALE",
    });
    expect(await db.prisma.videoScene.count({ where: { videoId } })).toBe(0);
  });

  it.each([1, 2, 3, 6])(
    "accepts a %i-person story and rejects unknown actors and rewritten narration",
    async (count) => {
      const generation = await runs.prepareGenerationRun(runId);
      const request = {
        input: generation.input,
        settings: generation.settings,
        sourcePack: generation.sourcePack,
        revisionNote: null,
      };
      const draftResult = await new MockScriptDraftWriter().writeDraft(request, { taskId: "fixture" });
      if (draftResult.status !== "completed") throw new Error("Unexpected wait.");
      const draft = draftResult.output;
      draft.cast = generation.settings.characters.profiles.slice(0, count).map((profile) => ({
        characterId: profile.id,
        role: "Một vai trong câu chuyện minh họa",
      }));
      draft.beats.forEach((beat, index) => {
        beat.characterIds = [at(draft.cast, index % draft.cast.length).characterId];
      });
      validateStoryDraft(draft, request);
      const { captureCast } = await import("@/features/videos/domain/characters");
      const story = {
        draft,
        input: generation.input,
        sourcePack: generation.sourcePack,
        cast: captureCast(generation.settings.characters, draft.cast),
      };
      const lesson = at(generation.input.lessons);
      const plan = await new MockScenePlanCompiler().compile({
        story,
        draft,
        lesson,
        book: generation.input.book,
        targetDurationSec: draft.targetDurationSec,
        range: generation.input,
        pace: generation.input.pace,
        revisionNote: null,
      });
      const valid = validateStoryScenePlan(plan, story);
      expect(
        new Set(
          [valid.hook, ...valid.scenes].flatMap((scene) =>
            scene.shots.flatMap((shot) => shot.actors.map((actor) => actor.characterId)),
          ),
        ).size,
      ).toBe(count);
      at(at(at(valid.scenes).shots).actors).characterId = "unknown";
      expect(() => validateStoryScenePlan(valid, story)).toThrow("ID");
      const changed = structuredClone(plan);
      changed.hook.narration = "Lời kể bị Sonnet thay đổi.";
      expect(() => validateStoryScenePlan(changed, story)).toThrow("lời kể");
    },
  );
});

describe("stopping and starting again", () => {
  // Counts the drafts and plans that were really produced; a call stopped by a cancelled job produces none.
  const countingWriter = () => {
    const state = { calls: 0 };
    const writer = {
      id: "counting-writer",
      writeDraft: async (...args: Parameters<MockScriptDraftWriter["writeDraft"]>) => {
        const result = await new MockScriptDraftWriter().writeDraft(...args);
        state.calls += 1;
        return result;
      },
    };
    return { state, writer };
  };
  const countingCompiler = () => {
    const state = { calls: 0 };
    const compiler = {
      id: "counting-compiler",
      compile: async (...args: Parameters<MockScenePlanCompiler["compile"]>) => {
        const result = await new MockScenePlanCompiler().compile(...args);
        state.calls += 1;
        return result;
      },
    };
    return { state, compiler };
  };

  it("does not ask the writer or the compiler again once their results are stored", async () => {
    const draft = countingWriter();
    const scene = countingCompiler();

    const first = await pipeline.writeGenerationDraft(stage(), draft.writer);
    const plan = await pipeline.compileGenerationPlan(stage(), scene.compiler);
    // What a restarted worker does with the same job: go through the stages again from the stored run.
    const afterRestart = await pipeline.writeGenerationDraft(stage(), draft.writer);
    const planAfterRestart = await pipeline.compileGenerationPlan(stage(), scene.compiler);

    expect(afterRestart).toEqual(first);
    expect(planAfterRestart).toEqual(plan);
    expect([draft.state.calls, scene.state.calls]).toEqual([1, 1]);
  });

  it("leaves nothing behind when the job is cancelled, and the same run finishes later", async () => {
    await db.prisma.aiRun.deleteMany();
    const controller = new AbortController();
    controller.abort();
    const draft = countingWriter();

    await expect(
      pipeline.writeGenerationDraft({ ...stage(), signal: controller.signal }, draft.writer),
    ).rejects.toThrow();
    expect(draft.state.calls).toBe(0);
    expect(
      (await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } })).draftArtifactJson,
    ).toBeNull();

    await pipeline.writeGenerationDraft(stage(), draft.writer);
    expect(draft.state.calls).toBe(1);
    const audit = await db.prisma.aiRun.findMany({ where: { stage: "draft" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.status)).toEqual(["FAILED", "COMPLETED"]);
  });

  it("stops a writer that is cancelled while it works, without storing a half result", async () => {
    const { JobCancelledError } = await import("@/shared/errors");
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const writer = {
      id: "cancelled-writer",
      writeDraft: async (): Promise<never> => {
        started.resolve();
        await new Promise((resolve) => controller.signal.addEventListener("abort", resolve, { once: true }));
        throw new JobCancelledError();
      },
    };

    const pending = pipeline.writeGenerationDraft({ ...stage(), signal: controller.signal }, writer);
    await started.promise;
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(JobCancelledError);
    const row = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
    expect([row.draftArtifactJson, row.castJson, row.scenePlanArtifactJson]).toEqual([null, null, null]);
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptGenerationRunId).toBeNull();
  });

  it("keeps the script the video has when a later scene plan fails", async () => {
    const { replaceScript } = await import("@/features/videos/repositories/video.repository");
    await pipeline.writeGenerationDraft(stage());
    await pipeline.compileGenerationPlan(stage());
    await replaceScript(videoId, await pipeline.generationReplacement(runId));
    const before = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    const scenes = await db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });

    const first = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
    const next = await db.prisma.scriptGenerationRun.create({
      data: {
        ownerKey: "manual:second-try",
        videoId,
        baseScriptVersion: before.scriptVersion,
        settingsJson: first.settingsJson ?? {},
        inputJson: first.inputJson ?? {},
      },
    });
    const secondStage = { ...stage(), generationRunId: next.id };
    await pipeline.writeGenerationDraft(secondStage);
    const failing = {
      id: "failing-compiler",
      compile: async (): Promise<never> => {
        throw new Error("scene plan failed");
      },
    };

    await expect(pipeline.compileGenerationPlan(secondStage, failing)).rejects.toThrow("scene plan failed");

    const after = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect([after.scriptVersion, after.scriptGenerationRunId]).toEqual([before.scriptVersion, runId]);
    expect(await db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } })).toEqual(scenes);
    const row = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: next.id } });
    expect(row.scenePlanArtifactJson).toBeNull();
    expect(row.appliedScriptVersion).toBeNull();
  });
});

describe("a manual script request", () => {
  const request = async () => {
    const { createScriptGenerationIntent } =
      await import("@/features/videos/repositories/script-generation-request.repository");
    const row = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
    const video = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    const { generationInputSchema } = await import("@/server/script-draft/contracts");
    return {
      create: async () =>
        createScriptGenerationIntent({
          context: generationInputSchema.parse(row.inputJson),
          settings: (await settings.getAiSettings()).settings,
          baseScriptVersion: video.scriptVersion,
        }),
    };
  };

  it("freezes the settings it was made with, and the job names the run that holds them", async () => {
    const intent = await (await request()).create();
    const payload = JSON.parse(intent.payloadJson) as { videoId: string; generationRunId: string };
    expect(payload.videoId).toBe(videoId);
    expect(intent.jobRecord).toMatchObject({ jobType: "GENERATE_VIDEO_SCRIPT", entityId: videoId, status: "QUEUED" });

    const changed = structuredClone(DEFAULT_AI_SETTINGS);
    changed.scene.effort = "low";
    at(changed.characters.profiles, 1).name = "Tên mới";
    await settings.updateAiSettings({ revision: 0, settings: changed });

    const frozen = await runs.requireGenerationRun(payload.generationRunId);
    expect(frozen.settings).toEqual(DEFAULT_AI_SETTINGS);
    expect(frozen.row.baseScriptVersion).toBe(1);
  });

  it("is refused while another one is queued, and when the video was edited after the page was drawn", async () => {
    const create = (await request()).create;
    await create();
    await expect(create()).rejects.toMatchObject({ code: "SCRIPT_GENERATION_RUNNING" });

    await db.prisma.jobRecord.updateMany({
      where: { jobType: "GENERATE_VIDEO_SCRIPT" },
      data: { status: "COMPLETED" },
    });
    await db.prisma.video.update({ where: { id: videoId }, data: { scriptVersion: { increment: 1 } } });
    await expect(create()).rejects.toMatchObject({ code: "SCRIPT_GENERATION_STALE" });
  });
});

describe("rewriting one scene of a video", () => {
  const applyRun = async () => {
    const { replaceScript } = await import("@/features/videos/repositories/video.repository");
    await pipeline.writeGenerationDraft(stage());
    await pipeline.compileGenerationPlan(stage());
    await replaceScript(videoId, await pipeline.generationReplacement(runId));
  };
  const scenesOf = () => db.prisma.videoScene.findMany({ where: { videoId }, orderBy: { order: "asc" } });
  const NEW_WORDS = "Hoàng hiểu rằng quyền chủ động xuất bản không thay thế việc tìm đúng người đọc.";

  // A provider that records what the rewrite was given and answers with the words it is told to.
  const answering = (
    narration: string,
    seen: { input: SceneRegenerationInput | null },
    during?: () => Promise<void>,
  ) => {
    const mock = new MockAiProvider();
    const provider: AiProvider = {
      mode: "mock",
      analyzeChapter: (input) => mock.analyzeChapter(input),
      generateVideoScript: (input) => mock.generateVideoScript(input),
      generatePublishMetadata: (input) => mock.generatePublishMetadata(input),
      regenerateScene: async (input) => {
        seen.input = input;
        await during?.();
        return {
          status: "completed",
          output: { sceneId: input.sceneId, scene: { ...input.scene, narration } },
        };
      },
    };
    return provider;
  };
  const rewrite = async (index: number, provider: AiProvider, execution = DEFAULT_AI_SETTINGS.script) => {
    const { runSceneRegeneration } = await import("@/features/videos/services/script-generation.service");
    const target = (await scenesOf())[index];
    if (!target) throw new Error("Missing scene.");
    return runSceneRegeneration({ videoId, sceneId: target.id, jobRecordId: null, execution, provider });
  };

  it("uses the script stage's model and hands the writer the video's people, scenes and book passages", async () => {
    await applyRun();
    await db.prisma.aiRun.deleteMany();
    const before = await scenesOf();
    const seen = { input: null as SceneRegenerationInput | null };

    await rewrite(3, answering(NEW_WORDS, seen));

    const after = await scenesOf();
    expect(after[3]).toMatchObject({ narration: NEW_WORDS, version: (before[3]?.version ?? 0) + 1 });
    expect(after.filter((_, index) => index !== 3)).toEqual(before.filter((_, index) => index !== 3));
    expect(after[3]?.shotsJson).not.toBeNull();
    const run = await db.prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id: runId } });
    const castIds = (run.castJson as { profiles: { id: string }[] }).profiles.map((profile) => profile.id);
    expect(seen.input?.storyContext?.cast?.profiles.map((profile) => profile.id)).toEqual(castIds);
    expect(seen.input?.storyContext?.sourcePack.sources[0]?.excerpt).toBe(SOURCE);
    expect(seen.input?.storyContext?.scenes).toHaveLength(before.length);
    const audit = await db.prisma.aiRun.findFirstOrThrow({ where: { stage: "scene-regeneration" } });
    expect(audit.executionJson).toEqual({ model: "claude-opus-5-5", effort: "xhigh" });
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).scriptGenerationRunId).toBe(runId);
  });

  it("asks for another answer when the rewrite brings a number or a quotation the story and its sources lack", async () => {
    await applyRun();
    const before = await scenesOf();

    await expect(
      rewrite(3, answering("Doanh thu của Hoàng tăng 73% chỉ sau một tuần.", { input: null })),
    ).rejects.toMatchObject({ code: "SCENE_REGENERATION_UNSUPPORTED_CLAIM" });
    await expect(
      rewrite(3, answering("Tác giả viết: “Mọi người đều giàu có vào ngày mai.”", { input: null })),
    ).rejects.toMatchObject({ code: "SCENE_REGENERATION_UNSUPPORTED_CLAIM" });

    expect(await scenesOf()).toEqual(before);
  });

  it("leaves a scene alone that someone edited while the AI was writing", async () => {
    await applyRun();
    const target = (await scenesOf())[3];
    if (!target) throw new Error("Missing scene.");

    await expect(
      rewrite(
        3,
        answering(NEW_WORDS, { input: null }, async () => {
          await db.prisma.videoScene.update({
            where: { id: target.id },
            data: { narration: "Một lời sửa tay.", version: { increment: 1 } },
          });
        }),
      ),
    ).rejects.toMatchObject({ code: "SCENE_REGENERATION_STALE" });

    expect(await db.prisma.videoScene.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      narration: "Một lời sửa tay.",
      version: target.version + 1,
    });
  });

  it("still rewrites a scene of a video from before generation runs, with its sources while they match and without them when they do not", async () => {
    const { runScriptGeneration } = await import("@/features/videos/services/script-generation.service");
    await runScriptGeneration({ videoId, jobRecordId: null });
    const legacy = await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(legacy.scriptGenerationRunId).toBeNull();

    const without = { input: null as SceneRegenerationInput | null };
    await rewrite(2, answering("Một lời dẫn mới cho cảnh sai lầm của video cũ.", without));
    expect((await scenesOf())[2]?.narration).toBe("Một lời dẫn mới cho cảnh sai lầm của video cũ.");
    expect(without.input?.storyContext).toBeUndefined();

    const link = await db.prisma.videoLesson.findFirstOrThrow({ where: { videoId } });
    const snapshot = link.lessonSnapshotJson as { sources: { excerpt: string | null }[] };
    for (const source of snapshot.sources) source.excerpt = SOURCE;
    await db.prisma.videoLesson.update({ where: { id: link.id }, data: { lessonSnapshotJson: snapshot } });
    const withSources = { input: null as SceneRegenerationInput | null };
    await rewrite(2, answering("Thêm một lời dẫn khác cho cảnh sai lầm của video cũ.", withSources));
    expect(withSources.input?.storyContext?.sourcePack.sources[0]?.excerpt).toBe(SOURCE);
    expect(withSources.input?.storyContext?.cast).toBeUndefined();
  });
});
