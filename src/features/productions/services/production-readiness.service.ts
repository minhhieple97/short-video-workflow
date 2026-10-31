import type { PreflightIssue } from "@/features/videos/domain/preflight";
import { lessonSnapshotSchema } from "@/features/videos/domain/lesson-snapshot";
import { assessReadiness } from "@/features/videos/domain/readiness";
import { markAutoApproved } from "@/features/videos/repositories/video.repository";
import { toVideoDetail } from "@/features/videos/services/video-mapper";
import { requireVideo } from "@/features/videos/services/video.service";
import { AppError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { hasReachedCheckpoint } from "../domain/production-status";
import { advanceProductionCheckpoint } from "../repositories/production-step.repository";
import { outOfOrder, requireHeldProductionItem } from "./production-step";

const logger = createLogger("productions.readiness");

export type ReadinessOutcome =
  | { status: "READY" }
  | { status: "ALREADY_READY" }
  // The checks failed; nothing was changed, and the issues say what to fix.
  | { status: "NOT_READY"; issues: PreflightIssue[] };

const hasExcerpt = (snapshotJson: unknown): boolean => {
  const snapshot = lessonSnapshotSchema.safeParse(snapshotJson);
  return snapshot.success && snapshot.data.sources.some((source) => (source.excerpt ?? "").trim().length > 0);
};

// The READY step: once every scene has its audio, the automated checks stand in for the person who would approve the
// script. Passing approves the script version that was checked (the video becomes APPROVED, as if "Duyệt kịch bản" had
// been pressed), records that version as ready and moves the item on. Editing the video afterwards follows the manual
// rules: a script edit sends it back to review, and the readiness no longer matches the new version.
export async function markProductionItemReady(input: {
  itemId: string;
  claimToken: string;
}): Promise<ReadinessOutcome> {
  const item = await requireHeldProductionItem(input.itemId, input.claimToken);
  if (hasReachedCheckpoint(item.checkpoint, "READY")) return { status: "ALREADY_READY" };
  if (item.checkpoint !== "VOICED") {
    throw outOfOrder(item.checkpoint, "Phải tạo xong giọng đọc trước khi kiểm tra sẵn sàng.");
  }

  const record = await requireVideo(item.videoId);
  const report = assessReadiness({
    ...toVideoDetail(record),
    lessons: record.videoLessons.map((videoLesson) => ({
      hasSourceExcerpt: hasExcerpt(videoLesson.lessonSnapshotJson),
    })),
  });
  if (!report.ready) return { status: "NOT_READY", issues: report.issues };

  if (!(await markAutoApproved(record.id, record.scriptVersion))) {
    return {
      status: "NOT_READY",
      issues: [{ code: "SCRIPT_CHANGED", message: "Kịch bản đã thay đổi trong lúc kiểm tra; cần kiểm tra lại." }],
    };
  }
  if (!(await advanceProductionCheckpoint(input.itemId, input.claimToken, "VOICED", "READY"))) {
    throw new AppError("PRODUCTION_CLAIM_LOST", "Mục sản xuất đã bị thay đổi trong lúc kiểm tra sẵn sàng.", 409);
  }
  logger.info("Production item ready", {
    itemId: input.itemId,
    videoId: record.id,
    scriptVersion: record.scriptVersion,
  });
  return { status: "READY" };
}
