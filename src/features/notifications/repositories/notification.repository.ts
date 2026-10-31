import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

import { formatNotificationTime, sanitizeNotificationValue } from "../domain/notification-text";
import { resetFailedTopicWithin } from "./notification-topic.repository";

export const MAX_NOTIFICATION_ATTEMPTS = 8;
export const NOTIFICATION_LEASE_MS = 60_000;

export async function recordNotificationWithin(
  tx: Prisma.TransactionClient,
  event: {
    eventKey: string;
    kind: string;
    title: string;
    fields: readonly (readonly [string, string | number | null | undefined])[];
    videoUrl?: string;
    // Names the link, so a message can say which version it opens ("Link Drive (bản nháp)").
    videoUrlLabel?: string;
    book?: { id: string; title: string };
  },
) {
  const config = getAppConfig();
  if (!config.telegram.enabled || !config.telegram.chatId) return null;
  const id = randomUUID();
  const now = new Date();
  const safe = (value: string) =>
    sanitizeNotificationValue(value, [config.telegram.botToken, config.mistral.apiKey, config.drive.clientSecret]);
  const fields = event.fields
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `${label}: ${safe(String(value))}`);
  if (event.videoUrl && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(event.videoUrl))
    fields.push(`${safe(event.videoUrlLabel ?? "Xem video")}: ${event.videoUrl}`);
  const footer = `\nThời gian: ${formatNotificationTime(now)}\nMã sự kiện: ${id}`;
  const text = [safe(event.title), ...fields].join("\n").slice(0, 4000 - footer.length) + footer;
  return tx.notificationDelivery.upsert({
    where: { eventKey: event.eventKey },
    update: {},
    create: {
      id,
      eventKey: event.eventKey,
      kind: event.kind,
      chatId: config.telegram.chatId,
      text,
      useTopics: config.telegram.mode === "forum",
      bookId: event.book?.id,
      bookTitle: event.book ? safe(event.book.title) : undefined,
    },
  });
}

export function claimNextNotification(now = new Date()) {
  const { enabled, chatId } = getAppConfig().telegram;
  if (!enabled || !chatId) return Promise.resolve(null);
  return prisma.$transaction(async (tx) => {
    await tx.notificationDelivery.updateMany({
      where: { chatId, status: "SENDING", leaseExpiresAt: { lte: now } },
      data: { status: "PENDING", leaseToken: null, leaseExpiresAt: null },
    });
    await tx.notificationDelivery.updateMany({
      where: { chatId, status: "PENDING", attempts: { gte: MAX_NOTIFICATION_ATTEMPTS } },
      data: { status: "FAILED", lastError: "Đã hết lượt gửi; kết quả lần gửi cuối có thể chưa xác định." },
    });
    if (
      await tx.notificationDelivery.count({
        where: {
          chatId,
          status: "PENDING",
          lastError: { startsWith: "TELEGRAM_RATE_LIMITED:" },
          availableAt: { gt: now },
        },
      })
    )
      return null;
    const row = await tx.notificationDelivery.findFirst({
      where: { chatId, status: "PENDING", availableAt: { lte: now } },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!row) return null;
    const leaseToken = randomUUID();
    const claimed = await tx.notificationDelivery.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: {
        status: "SENDING",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + NOTIFICATION_LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    return claimed.count ? { ...row, attempts: row.attempts + 1, leaseToken } : null;
  });
}

export async function settleNotification(
  id: string,
  leaseToken: string,
  result:
    | { status: "SENT"; messageId: string }
    | { status: "PENDING" | "FAILED"; error: string; availableAt?: Date; refundAttempt?: boolean },
  now = new Date(),
): Promise<void> {
  await prisma.notificationDelivery.updateMany({
    where: { id, leaseToken, status: "SENDING" },
    data:
      result.status === "SENT"
        ? {
            status: "SENT",
            messageId: result.messageId,
            sentAt: now,
            lastError: null,
            leaseToken: null,
            leaseExpiresAt: null,
          }
        : {
            status: result.status,
            lastError: result.error,
            availableAt: result.availableAt,
            attempts: result.refundAttempt ? { decrement: 1 } : undefined,
            leaseToken: null,
            leaseExpiresAt: null,
          },
  });
}

export async function retryNotification(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.notificationDelivery.findFirst({
      where: { id, status: "FAILED", chatId: getAppConfig().telegram.chatId ?? "" },
    });
    if (row?.useTopics) await resetFailedTopicWithin(tx, row);
    const { count } = await tx.notificationDelivery.updateMany({
      where: { id, status: "FAILED", chatId: getAppConfig().telegram.chatId ?? "" },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    if (!count)
      throw new AppError("NOTIFICATION_NOT_RETRYABLE", "Không tìm thấy tin lỗi của channel hiện tại để gửi lại.", 409);
  });
}

export async function notificationSummary() {
  const [pending, failed, last] = await Promise.all([
    prisma.notificationDelivery.count({ where: { status: { in: ["PENDING", "SENDING"] } } }),
    prisma.notificationDelivery.count({ where: { status: "FAILED" } }),
    prisma.notificationDelivery.findFirst({
      where: { lastError: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { lastError: true },
    }),
  ]);
  return { pending, failed, lastError: last?.lastError ?? "Không có" };
}

export function recordNotification(event: Parameters<typeof recordNotificationWithin>[1]) {
  return prisma.$transaction((tx) => recordNotificationWithin(tx, event));
}
