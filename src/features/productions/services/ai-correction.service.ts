import { AppError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { planCorrection, type CorrectionIssue, type CorrectionTarget } from "../domain/ai-correction";
import type { ItemCheckpoint } from "../domain/production-status";
import { spendAiCorrection } from "../repositories/production-step.repository";
import { requireHeldProductionItem } from "./production-step";
import { findItemRunState } from "../repositories/production-jobs.repository";

const logger = createLogger("productions.ai-correction");

export type CorrectionOutcome =
  | { status: "CORRECTION_STARTED"; target: CorrectionTarget; note: string; rewoundTo: ItemCheckpoint }
  // The video already used its one correction: the problems stand and the item should fail with them.
  | { status: "BUDGET_SPENT" }
  // None of the problems is something asking an AI again could fix; the budget is left untouched.
  | { status: "NOT_CORRECTABLE" };

// Decides what to do about the problems found after a step: spend the video's single AI correction on the step that can
// fix them, or give up. The correction only rewrites wording and structure: the preset and the narration speed are never
// touched, so a video that does not fit fails instead of being squeezed in.
export async function requestAiCorrection(input: {
  itemId: string;
  claimToken: string;
  issues: readonly CorrectionIssue[];
}): Promise<CorrectionOutcome> {
  await requireHeldProductionItem(input.itemId, input.claimToken);
  const state = await findItemRunState(input.itemId);
  const plan = planCorrection(input.issues, Boolean(state?.scriptGenerationRunId));
  if (!plan) return { status: "NOT_CORRECTABLE" };

  const result = await spendAiCorrection({
    itemId: input.itemId,
    claimToken: input.claimToken,
    target: plan.target,
    note: plan.note,
    rewindTo: plan.rewindTo,
  });
  switch (result.status) {
    case "SPENT":
      logger.info("AI correction started", { itemId: input.itemId, target: plan.target, rewoundTo: plan.rewindTo });
      return { status: "CORRECTION_STARTED", target: plan.target, note: plan.note, rewoundTo: plan.rewindTo };
    case "ALREADY_SPENT":
      return { status: "BUDGET_SPENT" };
    case "LOST_CLAIM":
      throw new AppError("PRODUCTION_CLAIM_LOST", "Mục sản xuất này không còn được bạn giữ; dừng bước này.", 409);
    case "WOULD_MOVE_FORWARD":
      throw new AppError(
        "PRODUCTION_STEP_OUT_OF_ORDER",
        "Lượt sửa chỉ được đưa mục sản xuất lùi về bước trước, không tiến lên.",
        409,
      );
  }
}
