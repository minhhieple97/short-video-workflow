import type { LessonStatus } from "@/features/lessons/domain/lesson-fields";

// Why a lesson cannot be made into a video by the automatic production. The server refuses the first two; the third only
// keeps a second click from starting the same video while the first is still being made, so it is the screens that check it.
export type ProductionBlock = "ARCHIVED" | "NO_SOURCE" | "IN_PRODUCTION";

export const PRODUCTION_BLOCKS: readonly ProductionBlock[] = ["ARCHIVED", "NO_SOURCE", "IN_PRODUCTION"];

export const PRODUCTION_BLOCK_REASONS: Record<ProductionBlock, string> = {
  ARCHIVED: "Bài học đã bị từ chối (lưu trữ).",
  NO_SOURCE: "Chưa có trích đoạn nguồn trong sách.",
  IN_PRODUCTION: "Đang được sản xuất trong một đợt khác.",
};

const PRODUCTION_BLOCK_COUNT_LABELS: Record<ProductionBlock, string> = {
  ARCHIVED: "đã lưu trữ",
  NO_SOURCE: "chưa có trích đoạn nguồn",
  IN_PRODUCTION: "đang được sản xuất",
};

export function productionBlock(lesson: {
  status: LessonStatus;
  hasSourceExcerpt: boolean;
  inProduction: boolean;
}): ProductionBlock | null {
  if (lesson.status === "ARCHIVED") return "ARCHIVED";
  if (!lesson.hasSourceExcerpt) return "NO_SOURCE";
  if (lesson.inProduction) return "IN_PRODUCTION";
  return null;
}

// One line for a selection's lessons that cannot be made: "1 bài đã lưu trữ · 2 bài đang được sản xuất".
export function summarizeProductionBlocks(blocks: readonly ProductionBlock[]): string {
  return PRODUCTION_BLOCKS.flatMap((block) => {
    const count = blocks.filter((value) => value === block).length;
    return count > 0 ? [`${count} bài ${PRODUCTION_BLOCK_COUNT_LABELS[block]}`] : [];
  }).join(" · ");
}
