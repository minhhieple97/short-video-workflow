import "dotenv/config";

import { retryNotification } from "../src/features/notifications/repositories/notification.repository";
import { createNotificationProvider } from "../src/features/notifications/services/notification-dispatch.service";
import { prisma } from "../src/server/db/client";
import { getAppConfig } from "../src/shared/config/env";
import { AppError } from "../src/shared/errors";
import { resolveNotificationTopic } from "../src/features/notifications/services/notification-topic.service";
import { bindNotificationTopic } from "../src/features/notifications/repositories/notification-topic.repository";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--test") {
    const { chatId, mode } = getAppConfig().telegram;
    const provider = createNotificationProvider();
    if (!chatId) throw new AppError("TELEGRAM_DISABLED", "Chưa cấu hình channel Telegram.");
    const messageThreadId =
      mode === "forum"
        ? await resolveNotificationTopic(provider, { chatId, bookId: null, bookTitle: null })
        : undefined;
    const result = await provider.send({
      chatId,
      text: "✅ Book Video Studio: tin kiểm tra kết nối Telegram.",
      messageThreadId,
    });
    console.log(`Đã gửi tin kiểm tra. Message ID: ${result.messageId}`);
  } else if (args.length === 2 && args[0] === "--retry" && args[1]) {
    if (!getAppConfig().telegram.enabled) throw new AppError("TELEGRAM_DISABLED", "Chưa bật Telegram trong .env.");
    await retryNotification(args[1]);
    console.log("Đã xếp lại tin lỗi. Worker sẽ gửi tiếp; video không được chạy lại.");
  } else if (args.length === 4 && args[0] === "--bind-topic" && args[1] && args[2] === "--thread" && args[3]) {
    await bindNotificationTopic(args[1], Number(args[3]));
    console.log("Đã gắn topic. Các tin bị chặn do lỗi topic sẽ được worker gửi tiếp.");
  } else {
    throw new AppError(
      "INVALID_ARGUMENTS",
      "Dùng: pnpm telegram --test | --retry <notificationId> | --bind-topic <bookId|system> --thread <id>",
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof AppError
        ? error.message
        : "Không thực hiện được thao tác Telegram; kiểm tra cấu hình và migration.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
