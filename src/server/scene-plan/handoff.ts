import { createHash } from "node:crypto";

import { z } from "zod";

import { DURATION_PRESETS_SEC } from "@/features/videos/domain/duration";
import { lessonSnapshotSchema } from "@/features/videos/domain/lesson-snapshot";
import { stableStringify } from "@/shared/stable-json";
import { publishBookSchema } from "@/server/ai/contracts/publish-metadata";
import { scriptDraftSchema, type ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import { scenePlanSchema, type ScenePlan } from "./scene-plan-compiler";

// Two artifacts travel between the steps of one video and are never mixed: the DRAFT written by the script studio
// (NotebookLM) and the FINAL scene plan compiled by Claude. Each has its own schema version and its own fingerprint, so a
// stored result is only reused while the exact input that produced it is unchanged.
export const DRAFT_SCHEMA_VERSION = "script-draft-v1";
export const SCENE_PLAN_SCHEMA_VERSION = "scene-plan-v1";

const sha256 = (value: unknown): string => createHash("sha256").update(stableStringify(value)).digest("hex");

// The draft depends on the lesson as it was captured and on the length it was written for. Only these fields are
// hashed: callers may hand over a wider object (an artifact) and its own bookkeeping must not leak into the hash.
export function fingerprintDraft(input: {
  draft: ScriptDraft;
  lessonContentHash: string | null;
  targetDurationSec: number;
}): string {
  const { draft, lessonContentHash, targetDurationSec } = input;
  return sha256({ kind: DRAFT_SCHEMA_VERSION, draft, lessonContentHash, targetDurationSec });
}

// The plan depends on the exact draft it was compiled from, the prompt that compiled it and the length it must fit.
export function fingerprintScenePlan(input: {
  plan: ScenePlan;
  draftFingerprint: string;
  promptVersion: string;
  targetDurationSec: number;
}): string {
  const { plan, draftFingerprint, promptVersion, targetDurationSec } = input;
  return sha256({ kind: SCENE_PLAN_SCHEMA_VERSION, plan, draftFingerprint, promptVersion, targetDurationSec });
}

const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

export const scriptDraftArtifactSchema = z
  .object({
    schemaVersion: z.literal(DRAFT_SCHEMA_VERSION),
    fingerprint,
    lessonContentHash: z.string().nullable(),
    targetDurationSec: z.number().int().positive(),
    draft: scriptDraftSchema,
  })
  .superRefine((artifact, context) => {
    if (artifact.fingerprint !== fingerprintDraft(artifact)) {
      context.addIssue({
        code: "custom",
        path: ["fingerprint"],
        message: "Fingerprint của bản thảo không khớp nội dung.",
      });
    }
  });

export const scenePlanArtifactSchema = z
  .object({
    schemaVersion: z.literal(SCENE_PLAN_SCHEMA_VERSION),
    fingerprint,
    draftFingerprint: fingerprint,
    promptVersion: z.string().min(1),
    targetDurationSec: z.number().int().positive(),
    plan: scenePlanSchema,
  })
  .superRefine((artifact, context) => {
    if (artifact.fingerprint !== fingerprintScenePlan({ ...artifact, plan: artifact.plan })) {
      context.addIssue({
        code: "custom",
        path: ["fingerprint"],
        message: "Fingerprint của kế hoạch cảnh không khớp nội dung.",
      });
    }
  });

export type ScriptDraftArtifact = z.infer<typeof scriptDraftArtifactSchema>;
export type ScenePlanArtifact = z.infer<typeof scenePlanArtifactSchema>;

export function createDraftArtifact(input: {
  draft: ScriptDraft;
  lessonContentHash: string | null;
  targetDurationSec: number;
}): ScriptDraftArtifact {
  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    fingerprint: fingerprintDraft(input),
    lessonContentHash: input.lessonContentHash,
    targetDurationSec: input.targetDurationSec,
    draft: input.draft,
  };
}

export function createScenePlanArtifact(input: {
  plan: ScenePlan;
  draftFingerprint: string;
  promptVersion: string;
  targetDurationSec: number;
}): ScenePlanArtifact {
  return {
    schemaVersion: SCENE_PLAN_SCHEMA_VERSION,
    fingerprint: fingerprintScenePlan(input),
    draftFingerprint: input.draftFingerprint,
    promptVersion: input.promptVersion,
    targetDurationSec: input.targetDurationSec,
    plan: input.plan,
  };
}

// What Claude is given for the scene-plan task (written to input.json). The draft is the artifact's content only: the
// model sees the story to edit, not the fingerprint bookkeeping.
export const scenePlanTaskInputSchema = z.object({
  draft: scriptDraftSchema,
  lesson: lessonSnapshotSchema,
  book: publishBookSchema,
  targetDurationSec: z.literal(DURATION_PRESETS_SEC),
  minDurationSec: z.literal(DURATION_PRESETS_SEC),
  maxDurationSec: z.literal(DURATION_PRESETS_SEC),
  revisionNote: z.string().nullable(),
  promptVersion: z.string().min(1),
});

export type ScenePlanTaskInput = z.infer<typeof scenePlanTaskInputSchema>;
