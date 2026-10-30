import { notificationSummary } from "@/features/notifications/repositories/notification.repository";
import { getAppConfig } from "@/shared/config/env";
import { topicSummary } from "@/features/notifications/repositories/notification-topic.repository";

import type { CheckResult } from "../types";

export async function checkTelegram(): Promise<CheckResult> {
  if (!getAppConfig().telegram.enabled)
    return { id: "telegram", label: "Telegram", status: "info", summary: "Chưa bật thông báo Telegram." };
  const summary = await notificationSummary();
  const topics = await topicSummary();
  return {
    id: "telegram",
    label: "Telegram",
    status: summary.failed || topics.blocked ? "warn" : "ok",
    summary: "Đã bật; kiểm tra hàng đợi local, không gửi tin.",
    details: {
      "Chế độ": getAppConfig().telegram.mode === "forum" ? "Mỗi sách một topic" : "Gửi vào chat/channel",
      "Topic sẵn sàng": topics.ready,
      "Topic cần xử lý": topics.blocked,
      "Tin đang chờ": summary.pending,
      "Tin thất bại": summary.failed,
      "Lỗi gửi cuối": summary.lastError,
    },
  };
}
