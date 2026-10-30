import type { CallOptions } from "@/server/integrations/call-options";

export interface NotificationProvider {
  send(
    input: { chatId: string; text: string; messageThreadId?: number },
    options?: CallOptions,
  ): Promise<{ messageId: string }>;
  createTopic?(input: { chatId: string; name: string }, options?: CallOptions): Promise<{ messageThreadId: number }>;
}
