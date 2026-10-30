import { z } from "zod";

import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError } from "@/server/integrations/integration-error";

import type { NotificationProvider } from "../notification-provider";

const requestSchema = z.object({
  chatId: z.string().min(1),
  text: z.string().min(1).max(4096),
  messageThreadId: z.number().int().positive().optional(),
});
const topicSchema = z.object({ chatId: z.string().min(1), name: z.string().min(1).max(128) });
const responseSchema = z.object({
  ok: z.boolean(),
  error_code: z.number().optional(),
  description: z.string().optional(),
  result: z.unknown().optional(),
  parameters: z.object({ retry_after: z.number().int().positive().optional() }).optional(),
});
const messageSchema = z.object({ message_id: z.number().int().positive() });
const createdTopicSchema = z.object({ message_thread_id: z.number().int().positive() });
type Method = "sendMessage" | "createForumTopic";

function unknownOutcome(method: Method): IntegrationError {
  return method === "createForumTopic"
    ? new IntegrationError(
        "TELEGRAM_TOPIC_CREATE_UNKNOWN",
        "Chưa rõ kết quả tạo topic. Kiểm tra group rồi gắn ID bằng pnpm telegram --bind-topic <bookId|system> --thread <id>; không tự tạo lại.",
        "UNKNOWN_OUTCOME",
      )
    : new IntegrationError(
        "TELEGRAM_DELIVERY_UNKNOWN",
        "Mất phản hồi Telegram; tin có thể đã được gửi.",
        "UNKNOWN_OUTCOME",
      );
}

export class TelegramNotificationProvider implements NotificationProvider {
  constructor(private readonly options: { token: string; fetch?: typeof fetch; timeoutMs?: number }) {}

  async send(
    input: { chatId: string; text: string; messageThreadId?: number },
    options?: CallOptions,
  ): Promise<{ messageId: string }> {
    if (!requestSchema.safeParse(input).success)
      throw new IntegrationError("TELEGRAM_INVALID_MESSAGE", "Tin Telegram không hợp lệ.", "REJECTED");
    const result = messageSchema.safeParse(
      await this.request(
        "sendMessage",
        {
          chat_id: input.chatId,
          text: input.text,
          message_thread_id: input.messageThreadId,
          link_preview_options: { is_disabled: true },
        },
        options,
      ),
    );
    if (!result.success) throw unknownOutcome("sendMessage");
    return { messageId: String(result.data.message_id) };
  }

  async createTopic(
    input: { chatId: string; name: string },
    options?: CallOptions,
  ): Promise<{ messageThreadId: number }> {
    if (!topicSchema.safeParse(input).success)
      throw new IntegrationError("TELEGRAM_TOPIC_INVALID", "Tên hoặc group của topic không hợp lệ.", "REJECTED");
    const result = createdTopicSchema.safeParse(
      await this.request("createForumTopic", { chat_id: input.chatId, name: input.name }, options),
    );
    if (!result.success) throw unknownOutcome("createForumTopic");
    return { messageThreadId: result.data.message_thread_id };
  }

  private async request(method: Method, payload: Record<string, unknown>, options?: CallOptions): Promise<unknown> {
    let response: Response;
    let body: unknown;
    try {
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 10_000);
      response = await (this.options.fetch ?? fetch)(`https://api.telegram.org/bot${this.options.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
        redirect: "error",
      });
      body = await response.json().catch(() => null);
    } catch {
      throw unknownOutcome(method);
    }
    const result = responseSchema.safeParse(body);
    const status = result.success ? (result.data.error_code ?? response.status) : response.status;
    const creating = method === "createForumTopic";
    if (status === 429)
      throw new IntegrationError("TELEGRAM_RATE_LIMITED", "Telegram yêu cầu chờ trước khi gửi tiếp.", "QUOTA", {
        retryAfterMs: (result.success ? (result.data.parameters?.retry_after ?? 60) : 60) * 1000,
      });
    if (status === 401 || status === 403)
      throw new IntegrationError(
        creating ? "TELEGRAM_TOPIC_ACCESS_DENIED" : "TELEGRAM_ACCESS_DENIED",
        creating
          ? "Kiểm tra token, group bật Topics và quyền quản lý topic của bot."
          : "Kiểm tra token, chat và quyền gửi tin của bot Telegram.",
        "AUTH",
      );
    if (status >= 500) {
      if (creating) throw unknownOutcome(method);
      throw new IntegrationError("TELEGRAM_UNAVAILABLE", "Dịch vụ Telegram tạm thời không khả dụng.", "TRANSIENT");
    }
    if (status >= 400 || (result.success && !result.data.ok)) {
      if (
        !creating &&
        result.success &&
        /TOPIC_CLOSED|TOPIC_DELETED|message thread not found|MESSAGE_THREAD_INVALID|TOPIC_ID_INVALID/i.test(
          result.data.description ?? "",
        )
      ) {
        throw new IntegrationError(
          "TELEGRAM_TOPIC_UNAVAILABLE",
          "Topic đã đóng, bị xoá hoặc không còn dùng được. Mở lại topic hoặc gắn ID mới; tin không được gửi ra ngoài topic.",
          "REJECTED",
        );
      }
      throw new IntegrationError(
        creating ? "TELEGRAM_TOPIC_REJECTED" : "TELEGRAM_REJECTED",
        creating
          ? "Không tạo được topic. Group cần bật Topics và bot cần quyền quản lý topic."
          : "Telegram từ chối tin; kiểm tra chat và cấu hình bot.",
        "REJECTED",
      );
    }
    if (!result.success || !result.data.ok) throw unknownOutcome(method);
    return result.data.result;
  }
}
