import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

import { sanitizeNotificationValue } from "../domain/notification-text";

const TOPIC_LEASE_MS = 60_000;
export const topicScopeKey = (bookId: string | null) => (bookId ? `book:${bookId}` : "system");

function topicName(bookId: string | null, bookTitle: string | null): string {
  if (!bookId) return "Hệ thống";
  const name = Array.from(sanitizeNotificationValue(bookTitle ?? "Sách"))
    .slice(0, 50)
    .join("");
  return `📘 ${name || "Sách"} · ${bookId.slice(-8)}`;
}

export function claimNotificationTopic(
  input: { chatId: string; bookId: string | null; bookTitle: string | null },
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const topic = await tx.notificationTopic.upsert({
      where: { chatId_scopeKey: { chatId: input.chatId, scopeKey: topicScopeKey(input.bookId) } },
      update: {},
      create: {
        chatId: input.chatId,
        scopeKey: topicScopeKey(input.bookId),
        name: topicName(input.bookId, input.bookTitle),
      },
    });
    if (topic.status !== "PENDING") {
      if (topic.status === "CREATING" && (topic.leaseExpiresAt?.getTime() ?? 0) <= now.getTime()) {
        await tx.notificationTopic.updateMany({
          where: { id: topic.id, status: "CREATING", leaseToken: topic.leaseToken, leaseExpiresAt: { lte: now } },
          data: {
            status: "UNKNOWN",
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: "Worker dừng trong lúc tạo topic; kiểm tra group rồi gắn ID topic, không tự tạo lại.",
          },
        });
        const unknown = await tx.notificationTopic.findUniqueOrThrow({ where: { id: topic.id } });
        return { topic: unknown, claimed: false };
      }
      return { topic, claimed: false };
    }
    const claimed = await tx.notificationTopic.updateMany({
      where: { id: topic.id, status: "PENDING" },
      data: {
        status: "CREATING",
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + TOPIC_LEASE_MS),
        lastError: null,
      },
    });
    const current = await tx.notificationTopic.findUniqueOrThrow({ where: { id: topic.id } });
    return { topic: current, claimed: claimed.count > 0 };
  });
}

async function resumeTopicNotificationsWithin(tx: Prisma.TransactionClient, chatId: string, scopeKey: string) {
  const bookId = scopeKey === "system" ? null : scopeKey.slice("book:".length);
  await tx.notificationDelivery.updateMany({
    where: { chatId, bookId, useTopics: true, status: "FAILED", lastError: { startsWith: "TELEGRAM_TOPIC_" } },
    data: {
      status: "PENDING",
      attempts: 0,
      availableAt: new Date(),
      lastError: null,
      messageThreadId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

export async function completeNotificationTopic(
  id: string,
  leaseToken: string,
  messageThreadId: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.notificationTopic.updateMany({
      where: { id, status: "CREATING", leaseToken },
      data: { status: "READY", messageThreadId, leaseToken: null, leaseExpiresAt: null, lastError: null },
    });
    if (count) {
      const topic = await tx.notificationTopic.findUniqueOrThrow({ where: { id } });
      await resumeTopicNotificationsWithin(tx, topic.chatId, topic.scopeKey);
    }
    return count > 0;
  });
}

export async function failNotificationTopic(
  id: string,
  leaseToken: string,
  status: "PENDING" | "FAILED" | "UNKNOWN",
  message: string,
): Promise<void> {
  await prisma.notificationTopic.updateMany({
    where: { id, leaseToken, status: "CREATING" },
    data: { status, lastError: message, leaseToken: null, leaseExpiresAt: null },
  });
}

export async function attachNotificationThread(id: string, leaseToken: string, messageThreadId: number): Promise<void> {
  const { count } = await prisma.notificationDelivery.updateMany({
    where: { id, leaseToken, status: "SENDING" },
    data: { messageThreadId },
  });
  if (!count) throw new AppError("TELEGRAM_TOPIC_LEASE_LOST", "Không còn giữ quyền gửi thông báo này.", 409);
}

export async function resetFailedTopicWithin(
  tx: Prisma.TransactionClient,
  input: { chatId: string; bookId: string | null },
) {
  const target = { chatId: input.chatId, scopeKey: topicScopeKey(input.bookId) };
  const topic = await tx.notificationTopic.findUnique({ where: { chatId_scopeKey: target } });
  if (topic?.status === "UNKNOWN")
    throw new AppError(
      "TELEGRAM_TOPIC_BIND_REQUIRED",
      "Kết quả tạo topic chưa rõ; dùng pnpm telegram --bind-topic <bookId|system> --thread <id> trước khi gửi lại.",
      409,
    );
  await tx.notificationTopic.updateMany({
    where: { ...target, status: "FAILED" },
    data: { status: "PENDING", lastError: null },
  });
}

export async function bindNotificationTopic(scope: string, messageThreadId: number, now = new Date()): Promise<void> {
  const { chatId, mode } = getAppConfig().telegram;
  if (!chatId || mode !== "forum")
    throw new AppError("TELEGRAM_FORUM_REQUIRED", "Cần TELEGRAM_MODE=forum và TELEGRAM_CHAT_ID của group.", 409);
  if (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0)
    throw new AppError("INVALID_THREAD_ID", "ID topic phải là số nguyên dương an toàn.", 400);
  await prisma.$transaction(async (tx) => {
    const book =
      scope === "system" ? null : await tx.book.findUnique({ where: { id: scope }, select: { id: true, title: true } });
    if (scope !== "system" && !book) throw new AppError("BOOK_NOT_FOUND", "Không tìm thấy bookId để gắn topic.", 404);
    const scopeKey = topicScopeKey(book?.id ?? null);
    const existing = await tx.notificationTopic.findUnique({ where: { chatId_scopeKey: { chatId, scopeKey } } });
    if (existing?.status === "CREATING" && (existing.leaseExpiresAt?.getTime() ?? 0) > now.getTime())
      throw new AppError("TELEGRAM_TOPIC_BUSY", "Topic đang được tạo; chờ hết lease trước khi gắn ID.", 409);
    await tx.notificationTopic.upsert({
      where: { chatId_scopeKey: { chatId, scopeKey } },
      create: {
        chatId,
        scopeKey,
        name: topicName(book?.id ?? null, book?.title ?? null),
        status: "READY",
        messageThreadId,
      },
      update: { status: "READY", messageThreadId, leaseToken: null, leaseExpiresAt: null, lastError: null },
    });
    await resumeTopicNotificationsWithin(tx, chatId, scopeKey);
  });
}

export function topicSummary() {
  return Promise.all([
    prisma.notificationTopic.count({ where: { chatId: getAppConfig().telegram.chatId ?? "", status: "READY" } }),
    prisma.notificationTopic.count({
      where: { chatId: getAppConfig().telegram.chatId ?? "", status: { in: ["UNKNOWN", "FAILED"] } },
    }),
  ]).then(([ready, blocked]) => ({ ready, blocked }));
}
