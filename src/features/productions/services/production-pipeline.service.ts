import { lessonSnapshotSchema, type LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import type { TargetDurationSec } from "@/features/videos/domain/duration";
import { findRenderRecord } from "@/features/videos/repositories/render.repository";
import { SCENE_PLAN_PROMPT_VERSION } from "@/server/ai/prompts/scene-plan-prompt";
import { IntegrationError } from "@/server/integrations/integration-error";
import { createDraftArtifact, createScenePlanArtifact, scriptDraftArtifactSchema } from "@/server/scene-plan/handoff";
import type { ScenePlanCompiler } from "@/server/scene-plan/scene-plan-compiler";
import type { ScriptStudioProvider, SourceRef } from "@/server/script-studio/script-studio-provider";
import { AppError, JobCancelledError, NotFoundError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { releaseProductionClaim, renewProductionClaim } from "../repositories/production-claim.repository";
import {
  clearTransientRetries,
  findProductionItemForRun,
  recordTransientFailure,
  saveDraftArtifact,
  saveScenePlanArtifact,
  setItemRender,
  type ProductionItemForRun,
} from "../repositories/production-pipeline.repository";
import { isCorrectableIssue } from "../domain/ai-correction";
import { advanceProductionCheckpoint } from "../repositories/production-step.repository";
import { requestAiCorrection } from "./ai-correction.service";
import { markProductionItemReady } from "./production-readiness.service";
import { queueFinalRender } from "./production-render.service";
import { applyScenePlan } from "./scene-plan-apply.service";
import { voiceProductionItem } from "./voice-production-item.service";
import type { SynthesizeScene } from "./voice-video-scenes.service";

const logger = createLogger("productions.pipeline");

export const PRODUCTION_LEASE_MS = 10 * 60_000;
export const RENDER_POLL_MS = 15_000;
// A temporary failure (quota, outage) is retried a few times with a growing pause, then the item fails with its reason.
export const MAX_TRANSIENT_RETRIES = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;
// One run goes through at most one step per checkpoint plus a correction's second pass, so this only guards against a loop.
const MAX_STEPS_PER_RUN = 16;

export interface PipelineDeps {
  scriptStudio: ScriptStudioProvider;
  compiler: ScenePlanCompiler;
  // The sources the script studio reads for a lesson (NotebookLM sources); none for the offline mock.
  resolveSources: (input: { bookId: string; lesson: LessonSnapshot }) => Promise<SourceRef[]>;
  synthesize?: SynthesizeScene;
}

export type StepOutcome =
  | { kind: "CONTINUE" }
  | { kind: "DEFER"; retryAfterMs: number }
  | { kind: "COMPLETED" }
  | { kind: "FAILED"; code: string; message: string }
  | { kind: "CANCELLED" };

export type RunOutcome = Exclude<StepOutcome, { kind: "CONTINUE" }>;

const failed = (code: string, message: string): Extract<StepOutcome, { kind: "FAILED" }> => ({
  kind: "FAILED",
  code,
  message,
});

function backoffMs(retries: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, retries - 1));
}

function lessonOf(item: ProductionItemForRun): LessonSnapshot {
  const parsed = lessonSnapshotSchema.safeParse(item.video?.videoLessons[0]?.lessonSnapshotJson);
  if (!parsed.success)
    throw new AppError("PRODUCTION_LESSON_SNAPSHOT_INVALID", "Snapshot bài học của video bị hỏng.", 500);
  return parsed.data;
}

function targetOf(item: ProductionItemForRun): TargetDurationSec {
  const target = item.batch.targetDurationSec;
  if (target !== 30 && target !== 45 && target !== 60 && target !== 90) {
    throw new AppError("PRODUCTION_PRESET_INVALID", "Preset thời lượng của đợt sản xuất không hợp lệ.", 500);
  }
  return target;
}

const requireVideoId = (item: ProductionItemForRun): string => {
  if (!item.videoId) throw new AppError("PRODUCTION_ITEM_HAS_NO_VIDEO", "Mục sản xuất chưa có video.", 409);
  return item.videoId;
};

function lostClaim(): AppError {
  return new AppError("PRODUCTION_CLAIM_LOST", "Mục sản xuất đã bị thay đổi trong lúc xử lý; dừng bước này.", 409);
}

async function draftStep(
  item: ProductionItemForRun,
  claimToken: string,
  signal: AbortSignal | undefined,
  deps: PipelineDeps,
): Promise<StepOutcome> {
  const lesson = lessonOf(item);
  const targetDurationSec = targetOf(item);
  const sources = await deps.resolveSources({ bookId: item.batch.bookId, lesson });
  try {
    const draft = await deps.scriptStudio.writeDraft(
      {
        sources,
        lesson,
        targetDurationSec,
        revisionNote: item.aiCorrectionTarget === "SCRIPT_STUDIO" ? item.aiCorrectionNote : null,
      },
      { signal },
    );
    const artifact = createDraftArtifact({ draft, lessonContentHash: lesson.contentHash, targetDurationSec });
    if (!(await saveDraftArtifact(item.id, claimToken, artifact))) throw lostClaim();
    return { kind: "CONTINUE" };
  } catch (error) {
    return correctRejected(item.id, claimToken, error);
  }
}

async function compileStep(
  item: ProductionItemForRun,
  claimToken: string,
  signal: AbortSignal | undefined,
  deps: PipelineDeps,
): Promise<StepOutcome> {
  const draftArtifact = scriptDraftArtifactSchema.safeParse(item.draftArtifactJson);
  if (!draftArtifact.success) {
    return failed("PRODUCTION_ARTIFACT_INVALID", "Bản thảo đã lưu bị hỏng hoặc không khớp fingerprint.");
  }
  const lesson = lessonOf(item);
  const targetDurationSec = targetOf(item);

  try {
    const plan = await deps.compiler.compile(
      {
        draft: draftArtifact.data.draft,
        lesson,
        targetDurationSec,
        revisionNote: item.aiCorrectionTarget === "SCENE_COMPILER" ? item.aiCorrectionNote : null,
      },
      { signal },
    );
    const artifact = createScenePlanArtifact({
      plan,
      draftFingerprint: draftArtifact.data.fingerprint,
      promptVersion: SCENE_PLAN_PROMPT_VERSION,
      targetDurationSec,
    });
    if (!(await saveScenePlanArtifact(item.id, claimToken, artifact))) throw lostClaim();
    return { kind: "CONTINUE" };
  } catch (error) {
    return correctRejected(item.id, claimToken, error);
  }
}

// Output an AI got wrong (a draft out of order, a plan with bad structure or unsupported claims) is exactly what the one
// correction is for. Any other rejection, such as a refused request, cannot be fixed by asking again.
function correctRejected(itemId: string, claimToken: string, error: unknown): Promise<StepOutcome> {
  if (error instanceof IntegrationError && error.kind === "REJECTED" && isCorrectableIssue(error.code)) {
    return correct(itemId, claimToken, [{ code: error.code, message: error.message }], error.message);
  }
  throw error;
}

// Spends the video's single AI correction, or fails the item with the problems when there is nothing left to try.
async function correct(
  itemId: string,
  claimToken: string,
  issues: { code: string; message?: string }[],
  summary: string,
): Promise<StepOutcome> {
  const result = await requestAiCorrection({ itemId, claimToken, issues });
  if (result.status === "CORRECTION_STARTED") return { kind: "CONTINUE" };
  return failed(
    result.status === "BUDGET_SPENT" ? "PRODUCTION_CORRECTION_EXHAUSTED" : "PRODUCTION_NOT_CORRECTABLE",
    result.status === "BUDGET_SPENT"
      ? `Đã dùng hết lượt sửa AI mà video vẫn chưa đạt: ${summary}`
      : `Video chưa đạt và không thể nhờ AI sửa: ${summary}`,
  );
}

async function renderStep(item: ProductionItemForRun, claimToken: string): Promise<StepOutcome> {
  const videoId = requireVideoId(item);
  if (!item.renderId) {
    const { renderId } = await queueFinalRender(videoId);
    if (!(await setItemRender(item.id, claimToken, renderId))) throw lostClaim();
    return { kind: "DEFER", retryAfterMs: RENDER_POLL_MS };
  }

  const render = await findRenderRecord(item.renderId);
  if (!render) return failed("RENDER_NOT_FOUND", "Không tìm thấy bản render của video.");
  if (render.status === "QUEUED" || render.status === "RENDERING")
    return { kind: "DEFER", retryAfterMs: RENDER_POLL_MS };
  if (render.status !== "COMPLETED") {
    return failed("RENDER_FAILED", render.errorMessage ?? "Bản render không hoàn tất.");
  }
  if (!(await advanceProductionCheckpoint(item.id, claimToken, "READY", "RENDERED"))) throw lostClaim();
  return { kind: "CONTINUE" };
}

async function executeStep(
  item: ProductionItemForRun,
  claimToken: string,
  signal: AbortSignal | undefined,
  deps: PipelineDeps,
  renew: () => Promise<void>,
): Promise<StepOutcome> {
  switch (item.checkpoint) {
    case "NONE":
      return draftStep(item, claimToken, signal, deps);
    case "DRAFTED":
      return compileStep(item, claimToken, signal, deps);
    case "COMPILED":
      await applyScenePlan({ itemId: item.id, claimToken, artifact: item.scenePlanArtifactJson });
      return { kind: "CONTINUE" };
    case "APPLIED":
      await voiceProductionItem({
        itemId: item.id,
        claimToken,
        signal,
        synthesize: deps.synthesize,
        onProgress: renew,
      });
      return { kind: "CONTINUE" };
    case "VOICED": {
      const readiness = await markProductionItemReady({ itemId: item.id, claimToken });
      if (readiness.status !== "NOT_READY") return { kind: "CONTINUE" };
      return correct(item.id, claimToken, readiness.issues, readiness.issues.map((issue) => issue.message).join(" "));
    }
    case "READY":
      return renderStep(item, claimToken);
    case "RENDERED":
      return { kind: "COMPLETED" };
    default:
      return failed("PRODUCTION_CHECKPOINT_UNKNOWN", `Checkpoint không hợp lệ: ${String(item.checkpoint)}`);
  }
}

// A failure that waiting may cure is retried with a growing pause, a few times; anything else ends the item with its reason.
async function classifyFailure(itemId: string, claimToken: string, error: unknown): Promise<StepOutcome> {
  if (error instanceof JobCancelledError) throw error;
  if (error instanceof IntegrationError && error.kind !== "REJECTED" && error.kind !== "AUTH") {
    const retries = await recordTransientFailure(itemId, claimToken, { code: error.code, message: error.message });
    if (retries > MAX_TRANSIENT_RETRIES) {
      return failed(error.code, `${error.message} (đã thử lại ${MAX_TRANSIENT_RETRIES} lần)`);
    }
    logger.warn("Temporary failure; deferring the item", { itemId, retries, code: error.code, kind: error.kind });
    return { kind: "DEFER", retryAfterMs: error.retryAfterMs ?? backoffMs(retries) };
  }
  if (error instanceof AppError) return failed(error.code, error.message);
  return failed("PRODUCTION_STEP_ERROR", toSafeErrorMessage(error));
}

// Runs the item's next step, whichever checkpoint it stands at: a restart therefore skips everything already done.
export async function runProductionStep(input: {
  itemId: string;
  claimToken: string;
  signal?: AbortSignal;
  deps: PipelineDeps;
  renew?: () => Promise<void>;
}): Promise<StepOutcome> {
  const item = await findProductionItemForRun(input.itemId);
  if (!item) throw new NotFoundError("PRODUCTION_ITEM_NOT_FOUND", "Không tìm thấy mục sản xuất.");
  if (item.claimToken !== input.claimToken) throw lostClaim();
  // Cancelling is checked before every step, so once an item is cancelled no later step starts.
  if (item.status === "CANCELLED") return { kind: "CANCELLED" };
  if (input.signal?.aborted) throw new JobCancelledError();

  try {
    const outcome = await executeStep(
      item,
      input.claimToken,
      input.signal,
      input.deps,
      input.renew ?? (async () => undefined),
    );
    if (outcome.kind === "CONTINUE") await clearTransientRetries(input.itemId, input.claimToken);
    return outcome;
  } catch (error) {
    return classifyFailure(input.itemId, input.claimToken, error);
  }
}

// Steps in a row until the item finishes, fails, is cancelled or has to wait. It never waits itself: a render in progress
// or a pause between retries ends the run with DEFER, and the item's job is scheduled again.
export async function runProductionPipeline(input: {
  itemId: string;
  claimToken: string;
  signal?: AbortSignal;
  deps: PipelineDeps;
  leaseMs?: number;
}): Promise<RunOutcome> {
  const leaseMs = input.leaseMs ?? PRODUCTION_LEASE_MS;
  const renew = async (): Promise<void> => {
    if (!(await renewProductionClaim(input.itemId, input.claimToken, leaseMs))) throw lostClaim();
  };

  for (let step = 0; step < MAX_STEPS_PER_RUN; step += 1) {
    await renew();
    const outcome = await runProductionStep({ ...input, renew });
    if (outcome.kind !== "CONTINUE") return outcome;
  }
  return failed("PRODUCTION_STEP_LIMIT", "Đường ống chạy quá nhiều bước liên tiếp; dừng để tránh vòng lặp.");
}

export async function settleProductionRun(input: {
  itemId: string;
  claimToken: string;
  outcome: RunOutcome;
}): Promise<void> {
  const { itemId, claimToken, outcome } = input;
  switch (outcome.kind) {
    case "COMPLETED":
      await releaseProductionClaim(itemId, claimToken, "COMPLETED");
      return;
    case "FAILED":
      await releaseProductionClaim(itemId, claimToken, "FAILED", { code: outcome.code, message: outcome.message });
      return;
    case "CANCELLED":
      await releaseProductionClaim(itemId, claimToken, "CANCELLED");
      return;
    case "DEFER":
      await releaseProductionClaim(itemId, claimToken, "WAITING");
      return;
  }
}
