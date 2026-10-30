import type { NotificationProvider } from "@/server/notifications/notification-provider";
import { IntegrationError } from "@/server/integrations/integration-error";
import { getAppConfig } from "@/shared/config/env";

import { sanitizeNotificationValue } from "../domain/notification-text";
import {
  claimNotificationTopic,
  completeNotificationTopic,
  failNotificationTopic,
} from "../repositories/notification-topic.repository";

export async function resolveNotificationTopic(
  provider: NotificationProvider,
  input: { chatId: string; bookId: string | null; bookTitle: string | null },
  now = new Date(),
): Promise<number> {
  const { topic, claimed } = await claimNotificationTopic(input, now);
  if (topic.status === "READY" && topic.messageThreadId) return topic.messageThreadId;
  if (topic.status === "UNKNOWN")
    throw new IntegrationError(
      "TELEGRAM_TOPIC_CREATE_UNKNOWN",
      "Chưa rõ kết quả tạo topic; kiểm tra group và gắn ID bằng pnpm telegram --bind-topic <bookId|system> --thread <id>.",
      "REJECTED",
    );
  if (topic.status === "FAILED")
    throw new IntegrationError(
      "TELEGRAM_TOPIC_SETUP_REQUIRED",
      "Topic bị lỗi cấu hình/quyền. Sửa bot/group rồi dùng pnpm telegram --retry <notificationId>, hoặc gắn ID topic có sẵn.",
      "REJECTED",
    );
  if (!topic.leaseToken)
    throw new IntegrationError(
      "TELEGRAM_TOPIC_CREATE_UNKNOWN",
      "Topic chưa có liên kết hợp lệ; kiểm tra và gắn ID topic.",
      "REJECTED",
    );
  if (!claimed)
    throw new IntegrationError("TELEGRAM_TOPIC_BUSY", "Topic đang được tạo; sẽ gửi tiếp khi có liên kết.", "QUOTA", {
      retryAfterMs: Math.max(1000, (topic.leaseExpiresAt?.getTime() ?? now.getTime()) - now.getTime()),
    });
  let created: { messageThreadId: number };
  try {
    if (!provider.createTopic)
      throw new IntegrationError("TELEGRAM_TOPIC_UNSUPPORTED", "Adapter không hỗ trợ tạo topic.", "REJECTED");
    created = await provider.createTopic({ chatId: topic.chatId, name: topic.name });
  } catch (error) {
    const quota = error instanceof IntegrationError && error.kind === "QUOTA";
    const rejected = error instanceof IntegrationError && ["AUTH", "REJECTED"].includes(error.kind);
    const message = sanitizeNotificationValue(
      error instanceof IntegrationError ? error.message : "Mất phản hồi trong lúc tạo topic.",
      [getAppConfig().telegram.botToken],
    );
    await failNotificationTopic(
      topic.id,
      topic.leaseToken,
      quota ? "PENDING" : rejected ? "FAILED" : "UNKNOWN",
      message,
    );
    if (quota || rejected) throw error;
    throw new IntegrationError(
      "TELEGRAM_TOPIC_CREATE_UNKNOWN",
      "Mất phản hồi tạo topic; kiểm tra group rồi gắn ID topic, không tự tạo lại.",
      "REJECTED",
    );
  }
  if (!(await completeNotificationTopic(topic.id, topic.leaseToken, created.messageThreadId)))
    throw new IntegrationError(
      "TELEGRAM_TOPIC_CREATE_UNKNOWN",
      "Không lưu được liên kết topic; kiểm tra group rồi gắn lại ID.",
      "REJECTED",
    );
  return created.messageThreadId;
}
