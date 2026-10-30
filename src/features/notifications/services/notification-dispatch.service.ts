import type { NotificationProvider } from "@/server/notifications/notification-provider";
import { TelegramNotificationProvider } from "@/server/notifications/telegram/telegram-notification-provider";
import { IntegrationError } from "@/server/integrations/integration-error";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import {
  claimNextNotification,
  MAX_NOTIFICATION_ATTEMPTS,
  settleNotification,
} from "../repositories/notification.repository";
import { sanitizeNotificationValue } from "../domain/notification-text";
import { resolveNotificationTopic } from "./notification-topic.service";
import { attachNotificationThread } from "../repositories/notification-topic.repository";

const logger = createLogger("notifications.dispatch");

export function createNotificationProvider(): NotificationProvider {
  const { enabled, botToken } = getAppConfig().telegram;
  if (!enabled || !botToken) throw new AppError("TELEGRAM_DISABLED", "Chưa bật Telegram trong .env.", 409);
  return new TelegramNotificationProvider({ token: botToken });
}

export async function dispatchNextNotification(provider?: NotificationProvider, now = new Date()): Promise<void> {
  if (!getAppConfig().telegram.enabled) return;
  const row = await claimNextNotification(now);
  if (!row) return;
  try {
    const selected = provider ?? createNotificationProvider();
    const messageThreadId = row.useTopics ? await resolveNotificationTopic(selected, row, now) : undefined;
    if (messageThreadId) await attachNotificationThread(row.id, row.leaseToken, messageThreadId);
    const result = await selected.send({
      chatId: row.chatId,
      text: row.text,
      ...(messageThreadId ? { messageThreadId } : {}),
    });
    await settleNotification(row.id, row.leaseToken, { status: "SENT", messageId: result.messageId }, now);
  } catch (error) {
    const quota = error instanceof IntegrationError && error.kind === "QUOTA";
    const permanent = error instanceof IntegrationError && ["AUTH", "REJECTED"].includes(error.kind);
    const message = sanitizeNotificationValue(
      error instanceof IntegrationError
        ? `${error.code}: ${error.message}`
        : "TELEGRAM_DELIVERY_UNKNOWN: Không xác định được kết quả gửi.",
      [getAppConfig().telegram.botToken],
    );
    const delay = quota
      ? Math.max(1000, error.retryAfterMs ?? 60_000)
      : Math.min(30 * 60_000, 30_000 * 2 ** (row.attempts - 1));
    const status = permanent || (!quota && row.attempts >= MAX_NOTIFICATION_ATTEMPTS) ? "FAILED" : "PENDING";
    await settleNotification(
      row.id,
      row.leaseToken,
      { status, error: message, availableAt: new Date(now.getTime() + delay), refundAttempt: quota },
      now,
    );
    logger.warn("Notification delivery deferred or failed", { notificationId: row.id, status, attempts: row.attempts });
  }
}
