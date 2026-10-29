import { describe, expect, it } from "vitest";

import {
  createDraftArtifact,
  createScenePlanArtifact,
  DRAFT_SCHEMA_VERSION,
  fingerprintDraft,
  fingerprintScenePlan,
  scenePlanArtifactSchema,
  scenePlanTaskInputSchema,
  SCENE_PLAN_SCHEMA_VERSION,
  scriptDraftArtifactSchema,
} from "@/server/scene-plan/handoff";
import { stableStringify } from "@/shared/stable-json";
import type { ScenePlan } from "@/server/scene-plan/scene-plan-compiler";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import { SAMPLE_BOOK, SAMPLE_LESSON } from "../../helpers/contracts/script-studio-provider-contract";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";

async function sample(): Promise<{ draft: ScriptDraft; plan: ScenePlan }> {
  const draft = await new MockScriptStudioProvider().writeDraft({
    sources: [],
    lesson: SAMPLE_LESSON,
    range: { minDurationSec: 30, maxDurationSec: 60 },
    pace: "STANDARD" as const,
    storyAngle: "PEAK_FIRST" as const,
    revisionNote: null,
  });
  const plan = await new MockScenePlanCompiler().compile({
    draft,
    lesson: SAMPLE_LESSON,
    book: SAMPLE_BOOK,
    targetDurationSec: 60,
    range: { minDurationSec: 30, maxDurationSec: 60 },
    pace: "STANDARD" as const,
    revisionNote: null,
  });
  return { draft, plan };
}

describe("stableStringify", () => {
  it("gives the same text whatever the key order, and keeps array order", () => {
    expect(stableStringify({ b: 1, a: { d: [3, 1, 2], c: null } })).toBe(
      stableStringify({ a: { c: null, d: [3, 1, 2] }, b: 1 }),
    );
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("ignores undefined properties", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe("draft artifact", () => {
  it("round-trips through its schema with a stable fingerprint", async () => {
    const { draft } = await sample();
    const input = { draft, lessonContentHash: "lesson-hash", targetDurationSec: 60 };

    const artifact = createDraftArtifact(input);

    expect(scriptDraftArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({ schemaVersion: DRAFT_SCHEMA_VERSION, fingerprint: fingerprintDraft(input) });
    expect(createDraftArtifact(input).fingerprint).toBe(artifact.fingerprint);
  });

  it("changes its fingerprint when the narration, the lesson or the target length changes", async () => {
    const { draft } = await sample();
    const base = { draft, lessonContentHash: "h", targetDurationSec: 60 };
    const edited: ScriptDraft = {
      ...draft,
      beats: draft.beats.map((beat, index) => (index === 1 ? { ...beat, narration: "Khác" } : beat)),
    };

    const fingerprints = [
      fingerprintDraft(base),
      fingerprintDraft({ ...base, draft: edited }),
      fingerprintDraft({ ...base, lessonContentHash: "other" }),
      fingerprintDraft({ ...base, targetDurationSec: 45 }),
    ];

    expect(new Set(fingerprints).size).toBe(4);
  });

  it("hashes only its own inputs, so bookkeeping on a wider object does not change it", async () => {
    const { draft } = await sample();
    const input = { draft, lessonContentHash: "h", targetDurationSec: 60 };
    const wider = { ...input, fingerprint: "x".repeat(64), schemaVersion: DRAFT_SCHEMA_VERSION };

    expect(fingerprintDraft(wider)).toBe(fingerprintDraft(input));
  });

  it("is rejected when its content was changed without updating the fingerprint", async () => {
    const { draft } = await sample();
    const artifact = createDraftArtifact({ draft, lessonContentHash: null, targetDurationSec: 60 });
    const tampered = {
      ...artifact,
      draft: {
        ...draft,
        beats: draft.beats.map((beat, index) => (index === 0 ? { ...beat, narration: "Bị sửa" } : beat)),
      },
    };

    const result = scriptDraftArtifactSchema.safeParse(tampered);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("không khớp");
  });

  it("is rejected for an unknown schema version", async () => {
    const { draft } = await sample();
    const artifact = createDraftArtifact({ draft, lessonContentHash: null, targetDurationSec: 60 });

    expect(scriptDraftArtifactSchema.safeParse({ ...artifact, schemaVersion: "script-draft-v0" }).success).toBe(false);
  });
});

describe("scene plan artifact", () => {
  it("round-trips through its schema and records which draft it came from", async () => {
    const { draft, plan } = await sample();
    const draftArtifact = createDraftArtifact({ draft, lessonContentHash: null, targetDurationSec: 60 });

    const artifact = createScenePlanArtifact({
      plan,
      draftFingerprint: draftArtifact.fingerprint,
      promptVersion: "scene-plan-v1",
      targetDurationSec: 60,
    });

    expect(scenePlanArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({
      schemaVersion: SCENE_PLAN_SCHEMA_VERSION,
      draftFingerprint: draftArtifact.fingerprint,
    });
  });

  it("changes its fingerprint when the draft, the prompt or the length changes, so a stale plan is not reused", async () => {
    const { plan } = await sample();
    const base = { plan, draftFingerprint: "a".repeat(64), promptVersion: "scene-plan-v1", targetDurationSec: 60 };

    const fingerprints = [
      fingerprintScenePlan(base),
      fingerprintScenePlan({ ...base, draftFingerprint: "b".repeat(64) }),
      fingerprintScenePlan({ ...base, promptVersion: "scene-plan-v2" }),
      fingerprintScenePlan({ ...base, targetDurationSec: 30 }),
    ];

    expect(new Set(fingerprints).size).toBe(4);
  });

  it("is rejected when its plan was changed without updating the fingerprint", async () => {
    const { plan } = await sample();
    const artifact = createScenePlanArtifact({
      plan,
      draftFingerprint: "a".repeat(64),
      promptVersion: "p",
      targetDurationSec: 60,
    });
    const tampered = { ...artifact, plan: { ...plan, hook: { ...plan.hook, narration: "Hook bị sửa" } } };

    expect(scenePlanArtifactSchema.safeParse(tampered).success).toBe(false);
  });

  it("keeps the draft and the final plan apart: neither parses as the other", async () => {
    const { draft, plan } = await sample();
    const draftArtifact = createDraftArtifact({ draft, lessonContentHash: null, targetDurationSec: 60 });
    const planArtifact = createScenePlanArtifact({
      plan,
      draftFingerprint: draftArtifact.fingerprint,
      promptVersion: "p",
      targetDurationSec: 60,
    });

    expect(scenePlanArtifactSchema.safeParse(draftArtifact).success).toBe(false);
    expect(scriptDraftArtifactSchema.safeParse(planArtifact).success).toBe(false);
    expect(draftArtifact.schemaVersion).not.toBe(planArtifact.schemaVersion);
  });
});

describe("scene plan task input", () => {
  it("carries the draft's story, the lesson snapshot and the book's name, without fingerprint bookkeeping", async () => {
    const { draft } = await sample();

    const input = scenePlanTaskInputSchema.parse({
      draft,
      lesson: SAMPLE_LESSON,
      book: SAMPLE_BOOK,
      targetDurationSec: 60,
      minDurationSec: 30,
      maxDurationSec: 90,
      revisionNote: null,
      promptVersion: "scene-plan-v1",
    });

    expect(Object.keys(input).sort()).toEqual([
      "book",
      "draft",
      "lesson",
      "maxDurationSec",
      "minDurationSec",
      "pace",
      "promptVersion",
      "revisionNote",
      "targetDurationSec",
    ]);
    expect(input.pace).toBe("STANDARD");
  });

  it("rejects a length that is not one of the allowed ones", async () => {
    const { draft } = await sample();
    const input = (lengths: { targetDurationSec: number; minDurationSec: number; maxDurationSec: number }) =>
      scenePlanTaskInputSchema.safeParse({
        draft,
        lesson: SAMPLE_LESSON,
        book: SAMPLE_BOOK,
        ...lengths,
        revisionNote: null,
        promptVersion: "p",
      }).success;

    expect(input({ targetDurationSec: 60, minDurationSec: 30, maxDurationSec: 90 })).toBe(true);
    expect(input({ targetDurationSec: 50, minDurationSec: 30, maxDurationSec: 90 })).toBe(false);
    expect(input({ targetDurationSec: 60, minDurationSec: 30, maxDurationSec: 100 })).toBe(false);
  });
});
