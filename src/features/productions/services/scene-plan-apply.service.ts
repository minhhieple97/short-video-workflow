import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import { publishWriteFor } from "@/features/videos/services/publish-proposal";
import { buildSceneRecord } from "@/features/videos/services/scene-records";
import type { PublishBook } from "@/server/ai/contracts/publish-metadata";
import { scenePlanArtifactSchema } from "@/server/scene-plan/handoff";
import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { applyScenePlanOnce } from "../repositories/scene-plan-apply.repository";

const logger = createLogger("productions.apply-plan");

export type ApplyScenePlanOutcome = "APPLIED" | "ALREADY_APPLIED";

// Writes a compiled scene plan onto the item's video, with the title, caption and hashtags Claude wrote for it when they
// pass the publish rules. The artifact is re-validated first (its fingerprint must still match its content), and the same
// plan applied again is a no-op, so replaying the step keeps the scenes and their audio.
export async function applyScenePlan(input: {
  itemId: string;
  claimToken: string;
  artifact: unknown;
  lesson: LessonSnapshot;
  book: PublishBook;
}): Promise<ApplyScenePlanOutcome> {
  const parsed = scenePlanArtifactSchema.safeParse(input.artifact);
  if (!parsed.success) {
    throw new AppError("INVALID_SCENE_PLAN_ARTIFACT", "Kế hoạch cảnh đã lưu bị hỏng hoặc không khớp fingerprint.", 422);
  }
  const { plan, fingerprint, promptVersion } = parsed.data;
  const scenes = [
    buildSceneRecord({
      type: "HOOK",
      title: "Hook",
      narration: plan.hook.narration,
      onScreenText: plan.hook.onScreenText,
      visualVariant: plan.hook.visualVariant,
      hookVariant: plan.hook.variant,
      illustration: plan.hook.illustration ?? null,
    }),
    ...plan.scenes.map((scene) =>
      buildSceneRecord({
        type: scene.type,
        title: scene.title ?? null,
        narration: scene.narration,
        onScreenText: scene.onScreenText,
        visualVariant: scene.visualVariant,
        hookVariant: null,
        illustration: scene.illustration ?? null,
      }),
    ),
  ];

  const result = await applyScenePlanOnce({
    itemId: input.itemId,
    claimToken: input.claimToken,
    planFingerprint: fingerprint,
    script: {
      hookOptions: [plan.hook],
      scenes,
      publish: publishWriteFor(plan.publish, {
        logIds: { itemId: input.itemId },
        promptVersion,
        book: input.book,
        lessons: [input.lesson],
        scenes,
      }),
    },
  });

  switch (result.status) {
    case "APPLIED":
    case "ALREADY_APPLIED":
      logger.info("Scene plan applied", { itemId: input.itemId, outcome: result.status });
      return result.status;
    case "MISSING_ITEM":
      throw new NotFoundError("PRODUCTION_ITEM_NOT_FOUND", "Không tìm thấy mục sản xuất.");
    case "LOST_CLAIM":
      throw new AppError("PRODUCTION_CLAIM_LOST", "Mục sản xuất này không còn được bạn giữ; dừng bước này.", 409);
    case "NO_VIDEO":
      throw new AppError("PRODUCTION_ITEM_HAS_NO_VIDEO", "Mục sản xuất chưa có video để áp dụng cảnh.", 409);
    case "NOT_READY":
      throw new AppError(
        "PRODUCTION_STEP_OUT_OF_ORDER",
        "Chỉ áp dụng được kế hoạch cảnh khi mục sản xuất vừa biên dịch xong; muốn áp dụng kế hoạch khác hãy lùi checkpoint trước.",
        409,
        { details: { checkpoint: result.checkpoint } },
      );
  }
}
