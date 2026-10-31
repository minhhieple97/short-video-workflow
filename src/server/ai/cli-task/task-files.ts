import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { JOB_TYPES } from "@/shared/types/job";
import { aiExecutionSchema } from "@/features/settings/domain/ai-settings";
import { storyDraftSchema } from "@/server/script-draft/contracts";
import { storyScenePlanSchema } from "@/server/scene-plan/story-scene-plan";

import { chapterAnalysisOutputSchema } from "../contracts/chapter-analysis";
import { publishMetadataOutputSchema } from "../contracts/publish-metadata";
import { scenePlanSchema } from "@/server/scene-plan/scene-plan-compiler";

import { sceneRegenerationOutputSchema, videoScriptOutputSchema } from "../contracts/video-script";

export const TASK_OUTPUT_SCHEMAS = {
  "script-draft": storyDraftSchema,
  "chapter-analysis": chapterAnalysisOutputSchema,
  "video-script": videoScriptOutputSchema,
  "scene-regeneration": sceneRegenerationOutputSchema,
  "scene-plan": scenePlanSchema,
  "story-scene-plan": storyScenePlanSchema,
  "publish-metadata": publishMetadataOutputSchema,
} as const;
export type TaskKind = keyof typeof TASK_OUTPUT_SCHEMAS;
export const TASK_KINDS = Object.keys(TASK_OUTPUT_SCHEMAS) as [TaskKind, ...TaskKind[]];

const taskMetaSchema = z.object({
  taskId: z.string(),
  kind: z.enum(TASK_KINDS),
  promptVersion: z.string(),
  createdAt: z.string(),
  stage: z.string().optional(),
  execution: aiExecutionSchema.optional(),
  resume: z.object({ jobType: z.enum(JOB_TYPES), payload: z.record(z.string(), z.unknown()) }).nullable(),
});
export type TaskMeta = z.infer<typeof taskMetaSchema>;

export const taskDirectory = (taskId: string) => dataPath("ai-tasks", taskId);

// Layout of data/ai-tasks/{taskId}/: input.json, prompt.md, schema.json, task.json, then output.json from the CLI run.
export async function writeTaskFiles(meta: TaskMeta, input: unknown, prompt: string): Promise<string> {
  const directory = taskDirectory(meta.taskId);
  // Draft-07 without "$schema": the Claude CLI validator does not know the 2020-12 meta-schema.
  const { $schema: _metaSchema, ...schema } = z.toJSONSchema(TASK_OUTPUT_SCHEMAS[meta.kind], { target: "draft-7" });
  await writeFileAtomic(path.join(directory, "input.json"), `${JSON.stringify(input, null, 2)}\n`);
  await writeFileAtomic(path.join(directory, "prompt.md"), prompt);
  await writeFileAtomic(path.join(directory, "schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
  await writeFileAtomic(path.join(directory, "task.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return directory;
}

export async function readTaskMeta(taskId: string): Promise<TaskMeta> {
  return taskMetaSchema.parse(JSON.parse(await fs.readFile(path.join(taskDirectory(taskId), "task.json"), "utf8")));
}

export async function readTaskText(taskId: string, file: "prompt.md" | "schema.json"): Promise<string> {
  return fs.readFile(path.join(taskDirectory(taskId), file), "utf8");
}

export async function readTaskOutput(taskId: string): Promise<unknown> {
  const raw = await fs.readFile(path.join(taskDirectory(taskId), "output.json"), "utf8").catch(() => null);
  return raw === null ? undefined : (JSON.parse(raw) as unknown);
}

export async function writeTaskOutput(taskId: string, output: unknown): Promise<void> {
  await writeFileAtomic(path.join(taskDirectory(taskId), "output.json"), `${JSON.stringify(output, null, 2)}\n`);
}

export async function writeRawOutput(taskId: string, raw: string): Promise<void> {
  await writeFileAtomic(path.join(taskDirectory(taskId), "output.raw.txt"), raw);
}

// What one Claude Code call was asked to use and, when the CLI reported it, what it used.
const taskExecutionReportSchema = z.object({
  requestedModel: z.string().nullable(),
  requestedEffort: z.string().nullable(),
  // The model that did the work, when the CLI reported usage; `observedModels` also holds its housekeeping models.
  primaryModel: z.string().nullable().default(null),
  observedModels: z.array(z.string()),
});
export type TaskExecutionReport = z.infer<typeof taskExecutionReportSchema>;

export async function writeTaskExecution(taskId: string, report: TaskExecutionReport): Promise<void> {
  await writeFileAtomic(path.join(taskDirectory(taskId), "execution.json"), `${JSON.stringify(report, null, 2)}\n`);
}

export async function readTaskExecution(taskId: string): Promise<TaskExecutionReport | null> {
  const raw = await fs.readFile(path.join(taskDirectory(taskId), "execution.json"), "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const parsed = taskExecutionReportSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
