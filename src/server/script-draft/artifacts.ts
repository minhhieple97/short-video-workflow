import { createHash } from "node:crypto";

import { z } from "zod";

import { storyScenePlanSchema, type StoryScenePlan } from "@/server/scene-plan/story-scene-plan";
import { stableStringify } from "@/shared/stable-json";

import { storyDraftSchema, type StoryDraft } from "./contracts";

export const generationHash = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const draftBody = z.object({
  schemaVersion: z.literal("script-draft-artifact-v2"),
  inputHash: hashSchema,
  targetDurationSec: z.number().int().positive(),
  draft: storyDraftSchema,
});
export const storyDraftArtifactSchema = draftBody
  .extend({ fingerprint: hashSchema })
  .superRefine(({ fingerprint, ...body }, context) => {
    if (fingerprint !== generationHash(body))
      context.addIssue({ code: "custom", path: ["fingerprint"], message: "Fingerprint bản thảo không khớp." });
  });
const sceneBody = z.object({
  schemaVersion: z.literal("scene-plan-artifact-v2"),
  inputHash: hashSchema,
  draftFingerprint: hashSchema,
  promptVersion: z.string(),
  targetDurationSec: z.number().int().positive(),
  plan: storyScenePlanSchema,
});
export const storySceneArtifactSchema = sceneBody
  .extend({ fingerprint: hashSchema })
  .superRefine(({ fingerprint, ...body }, context) => {
    if (fingerprint !== generationHash(body))
      context.addIssue({ code: "custom", path: ["fingerprint"], message: "Fingerprint kế hoạch cảnh không khớp." });
  });
export type StoryDraftArtifact = z.infer<typeof storyDraftArtifactSchema>;
export type StorySceneArtifact = z.infer<typeof storySceneArtifactSchema>;
export function createStoryDraftArtifact(draft: StoryDraft, inputHash: string): StoryDraftArtifact {
  const body = draftBody.parse({
    schemaVersion: "script-draft-artifact-v2",
    inputHash,
    targetDurationSec: draft.targetDurationSec,
    draft,
  });
  return { ...body, fingerprint: generationHash(body) };
}
export function createStorySceneArtifact(input: {
  plan: StoryScenePlan;
  inputHash: string;
  draftFingerprint: string;
  promptVersion: string;
  targetDurationSec: number;
}): StorySceneArtifact {
  const body = sceneBody.parse({ schemaVersion: "scene-plan-artifact-v2", ...input });
  return { ...body, fingerprint: generationHash(body) };
}
