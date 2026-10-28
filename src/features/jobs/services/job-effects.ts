import { cancelArchive } from "@/features/archive/repositories/render-archive.repository";
import type { JobRecord } from "@/generated/prisma/client";
import { findChapterWithBook, setChapterAnalysisStatus } from "@/features/chapters/repositories/chapter.repository";
import { cancelItem, refreshBatchStatus } from "@/features/productions/repositories/production-jobs.repository";
import { failRenderRecord, findRenderRecord } from "@/features/videos/repositories/render.repository";

const CHAPTER_IN_FLIGHT = ["QUEUED", "ANALYZING", "WAITING_FOR_CLI"];
const RENDER_IN_FLIGHT = ["QUEUED", "RENDERING"];

// Puts the job's entity back into a consistent state after a job is cancelled or lost.
export async function releaseJobEntity(
  record: JobRecord,
  outcome: "CANCELLED" | "FAILED",
  message: string,
): Promise<void> {
  if (record.jobType === "ANALYZE_CHAPTER") {
    const chapter = await findChapterWithBook(record.entityId);
    if (!chapter || !CHAPTER_IN_FLIGHT.includes(chapter.analysisStatus)) return;
    const restored = outcome === "FAILED" ? "FAILED" : chapter.analyzedAt ? "ANALYZED" : "NOT_ANALYZED";
    await setChapterAnalysisStatus(chapter.id, restored);
  }
  if (record.jobType === "RENDER_VIDEO") {
    const render = await findRenderRecord(record.entityId);
    if (render && RENDER_IN_FLIGHT.includes(render.status)) await failRenderRecord(render.id, outcome, message);
  }
  // A lost archive job is replaced by the archive sweep; only a cancel stops the archive.
  if (record.jobType === "ARCHIVE_RENDER" && outcome === "CANCELLED") await cancelArchive(record.entityId);
  // A lost item job is replaced at worker start-up (the item resumes from its checkpoint), so only a cancel changes it.
  if (record.jobType === "RUN_PRODUCTION_ITEM" && outcome === "CANCELLED") {
    const batchId = await cancelItem(record.entityId);
    if (batchId) await refreshBatchStatus(batchId);
  }
}
