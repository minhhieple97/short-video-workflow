import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getAppConfig } from "@/shared/config/env";

import { recordNotificationWithin } from "./notification.repository";

export async function notifyPartialChapterWithin(tx: Prisma.TransactionClient, chapterId: string): Promise<void> {
  if (!getAppConfig().telegram.enabled) return;
  const chapter = await tx.chapter.findUniqueOrThrow({ where: { id: chapterId }, include: { book: true } });
  const job = await tx.jobRecord.findFirst({
    where: { entityType: "CHAPTER", entityId: chapterId },
    orderBy: { createdAt: "desc" },
  });
  await recordNotificationWithin(tx, {
    eventKey: `chapter-partial:${chapterId}:${randomUUID()}`,
    book: chapter.book,
    kind: "PIPELINE_FAILED",
    title: "⚠️ Phân tích chương chưa hoàn tất",
    fields: [
      ["Sách", chapter.book.title],
      ["Chương", chapter.title],
      ["Bước", "Phân tích bài học"],
      ["Mã lỗi", "CHAPTER_ANALYSIS_PARTIAL"],
      ["Chi tiết", "NotebookLM chưa phân tích hết nội dung; kiểm tra chương trước khi thử lại."],
      ["Chapter ID", chapterId],
      ["Job ID", job?.id],
    ],
  });
}
