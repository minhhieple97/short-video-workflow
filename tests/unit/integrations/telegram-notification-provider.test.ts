import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TelegramNotificationProvider } from "@/server/notifications/telegram/telegram-notification-provider";

let endpoint = "";
let status = 200;
let body: unknown = { ok: true, result: { message_id: 42 } };
let loseResponse = false;
const received: unknown[] = [];
const methods: string[] = [];
async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  received.push(JSON.parse(text));
  methods.push(request.url ?? "");
  if (loseResponse) {
    request.socket.destroy();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => response.destroy());
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fake Telegram address");
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

const provider = () =>
  new TelegramNotificationProvider({
    token: "123456:fake-token",
    fetch: (url, init) => fetch(`${endpoint}/${new URL(String(url)).pathname.split("/").at(-1)}`, init),
  });
const message = { chatId: "-100123456", text: "✅ Video: https://drive.google.com/file/d/video-id/view" };

describe("Telegram adapter against a local HTTP fake", () => {
  it("creates a forum topic and sends subsequent messages with its thread ID", async () => {
    body = { ok: true, result: { message_thread_id: 71 } };
    try {
      expect(await provider().createTopic({ chatId: message.chatId, name: "📘 Sách" })).toEqual({
        messageThreadId: 71,
      });
      expect(methods.at(-1)).toBe("/createForumTopic");
      expect(received.at(-1)).toEqual({ chat_id: message.chatId, name: "📘 Sách" });
    } finally {
      body = { ok: true, result: { message_id: 42 } };
    }
    await provider().send({ ...message, messageThreadId: 71 });
    expect(received.at(-1)).toMatchObject({ message_thread_id: 71 });
  });

  it("distinguishes a closed or deleted topic without leaking Telegram's description", async () => {
    status = 400;
    body = { ok: false, description: "Bad Request: TOPIC_CLOSED secret-token" };
    try {
      await expect(provider().send({ ...message, messageThreadId: 71 })).rejects.toMatchObject({
        code: "TELEGRAM_TOPIC_UNAVAILABLE",
        kind: "REJECTED",
      });
    } finally {
      status = 200;
      body = { ok: true, result: { message_id: 42 } };
    }
  });

  it("treats an ambiguous create response as unknown, including server errors", async () => {
    for (const nextStatus of [200, 503]) {
      status = nextStatus;
      body = { ok: true, result: {} };
      try {
        await expect(provider().createTopic({ chatId: message.chatId, name: "Sách" })).rejects.toMatchObject({
          code: "TELEGRAM_TOPIC_CREATE_UNKNOWN",
          kind: "UNKNOWN_OUTCOME",
        });
      } finally {
        status = 200;
        body = { ok: true, result: { message_id: 42 } };
      }
    }
  });
  it("sends plain text and returns Telegram's message ID", async () => {
    expect(await provider().send(message)).toEqual({ messageId: "42" });
    expect(received.at(-1)).toEqual({
      chat_id: message.chatId,
      text: message.text,
      link_preview_options: { is_disabled: true },
    });
  });

  it.each([
    [401, "AUTH"],
    [403, "AUTH"],
    [400, "REJECTED"],
    [503, "TRANSIENT"],
  ])("classifies HTTP %s without exposing the remote body", async (code, kind) => {
    status = Number(code);
    body = { ok: false, description: "secret-token https://api.telegram.org/bot123456:fake-token" };
    try {
      await expect(provider().send(message)).rejects.toMatchObject({ kind });
    } finally {
      status = 200;
      body = { ok: true, result: { message_id: 42 } };
    }
  });

  it("honours retry_after even when the HTTP response is 200", async () => {
    body = { ok: false, error_code: 429, parameters: { retry_after: 120 } };
    try {
      await expect(provider().send(message)).rejects.toMatchObject({ kind: "QUOTA", retryAfterMs: 120_000 });
    } finally {
      body = { ok: true, result: { message_id: 42 } };
    }
  });

  it("reports an unknown outcome after the fake accepted a message but lost the response", async () => {
    loseResponse = true;
    const before = received.length;
    try {
      await expect(provider().send(message)).rejects.toMatchObject({ kind: "UNKNOWN_OUTCOME" });
    } finally {
      loseResponse = false;
    }
    expect(received.length).toBe(before + 1);
  });

  it("classifies a timeout without leaking the URL or token", async () => {
    const stalled = new TelegramNotificationProvider({
      token: "secret-token",
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("https://api.telegram.org/botsecret-token")), {
            once: true,
          });
        }),
    });
    const result = await stalled.send(message).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "TELEGRAM_DELIVERY_UNKNOWN" });
    expect(String(result)).not.toContain("secret-token");
  });

  it("rejects invalid lengths before making any request", async () => {
    const before = received.length;
    await expect(provider().send({ ...message, text: "x".repeat(4097) })).rejects.toMatchObject({ kind: "REJECTED" });
    expect(received.length).toBe(before);
  });
});
