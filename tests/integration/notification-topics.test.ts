import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Db from "@/server/db/client";
import type * as Repo from "@/features/notifications/repositories/notification.repository";
import type * as TopicRepo from "@/features/notifications/repositories/notification-topic.repository";
import type * as Dispatch from "@/features/notifications/services/notification-dispatch.service";
import type { NotificationProvider } from "@/server/notifications/notification-provider";
import { IntegrationError } from "@/server/integrations/integration-error";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof Db;
let repo: typeof Repo;
let topics: typeof TopicRepo;
let dispatch: typeof Dispatch;
let book: { id: string; title: string };
let otherBook: { id: string; title: string };
const now = () => new Date(Date.now() + 1000);
const notices = () => db.prisma.notificationDelivery.findMany({ orderBy: { createdAt: "asc" } });
const mappings = () => db.prisma.notificationTopic.findMany({ orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  env = setupTestEnvironment();
  Object.assign(process.env, {
    TELEGRAM_ENABLED: "true",
    TELEGRAM_MODE: "forum",
    TELEGRAM_BOT_TOKEN: "123456:fake-topic-token",
    TELEGRAM_CHAT_ID: "-100123456789",
  });
  db = await import("@/server/db/client");
  repo = await import("@/features/notifications/repositories/notification.repository");
  topics = await import("@/features/notifications/repositories/notification-topic.repository");
  dispatch = await import("@/features/notifications/services/notification-dispatch.service");
}, 60_000);
beforeEach(async () => {
  const { getAppConfig } = await import("@/shared/config/env");
  getAppConfig().telegram.mode = "forum";
  await db.prisma.notificationDelivery.deleteMany();
  await db.prisma.notificationTopic.deleteMany();
  await db.prisma.book.deleteMany();
  const createBook = () =>
    db.prisma.book.create({
      data: {
        title: "Hai sách trùng tên",
        sourceFilePath: "books/id/original.pdf",
        sourceFileName: "book.pdf",
        sourceHash: randomUUID(),
        sourceFormat: "pdf",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
      select: { id: true, title: true },
    });
  book = await createBook();
  otherBook = await createBook();
});
afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

async function record(target: typeof book | undefined = book, kind = "PIPELINE_FAILED") {
  return repo.recordNotification({ eventKey: randomUUID(), kind, title: "Thông báo", fields: [], book: target });
}

function provider() {
  let counter = 100;
  return {
    createTopic: vi.fn(async (_input: { chatId: string; name: string }) => ({ messageThreadId: ++counter })),
    send: vi.fn(async (_input: Parameters<NotificationProvider["send"]>[0]) => ({ messageId: randomUUID() })),
  };
}

describe("one durable Telegram forum topic per book", () => {
  it("routes 20 notifications to one topic and reuses it after restart and title changes", async () => {
    const fake = provider();
    for (let index = 0; index < 20; index += 1) await record();
    for (let index = 0; index < 20; index += 1) await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).toHaveBeenCalledTimes(1);
    expect(fake.send).toHaveBeenCalledTimes(20);
    expect(new Set(fake.send.mock.calls.map(([input]) => input.messageThreadId))).toEqual(new Set([101]));
    expect(
      (await notices()).every((row) => row.status === "SENT" && row.messageThreadId === 101 && row.bookId === book.id),
    ).toBe(true);
    await db.prisma.$disconnect();
    await db.prisma.book.update({ where: { id: book.id }, data: { title: "Đã đổi tên sách" } });
    await record({ ...book, title: "Đã đổi tên sách" });
    await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).toHaveBeenCalledTimes(1);
    expect(fake.send.mock.calls.at(-1)?.[0].messageThreadId).toBe(101);
  });

  it("separates books with identical titles and shares a system topic for provider events", async () => {
    const fake = provider();
    await record(book);
    await record(otherBook);
    await repo.recordNotification({ eventKey: randomUUID(), kind: "PROVIDER_WAITING", title: "Chờ quota", fields: [] });
    await repo.recordNotification({
      eventKey: randomUUID(),
      kind: "PROVIDER_RESUMED",
      title: "Đã tiếp tục",
      fields: [],
    });
    for (let index = 0; index < 4; index += 1) await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).toHaveBeenCalledTimes(3);
    const names = fake.createTopic.mock.calls.map(([input]) => input.name);
    expect(names[0]).not.toBe(names[1]);
    expect(names[2]).toBe("Hệ thống");
    expect(fake.send.mock.calls.map(([input]) => input.messageThreadId)).toEqual([101, 102, 103, 103]);
  });

  it("never guesses topic identity from the rendered message text", async () => {
    const fake = provider();
    await repo.recordNotification({
      eventKey: "no-book-id",
      kind: "PIPELINE_FAILED",
      title: `Sách: ${book.title}`,
      fields: [["Book ID", book.id]],
    });
    await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic.mock.calls[0]?.[0].name).toBe("Hệ thống");
  });

  it("keeps previously queued chat messages unthreaded after enabling forum mode", async () => {
    const { getAppConfig } = await import("@/shared/config/env");
    getAppConfig().telegram.mode = "chat";
    await record();
    getAppConfig().telegram.mode = "forum";
    const fake = provider();
    await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).not.toHaveBeenCalled();
    expect(fake.send.mock.calls[0]?.[0]).not.toHaveProperty("messageThreadId");
  });

  it("does not issue a second create request while another caller holds the creation lease", async () => {
    const fake = provider();
    const input = { chatId: "-100123456789", bookId: book.id, bookTitle: book.title };
    const first = await topics.claimNotificationTopic(input, now());
    expect(first.claimed).toBe(true);
    const { resolveNotificationTopic } = await import("@/features/notifications/services/notification-topic.service");
    await expect(resolveNotificationTopic(fake, input, now())).rejects.toMatchObject({ code: "TELEGRAM_TOPIC_BUSY" });
    expect(fake.createTopic).not.toHaveBeenCalled();
    expect((await mappings())[0]?.leaseToken).toBe(first.topic.leaseToken);
  });

  it("does not create duplicate topics after a lost response; binding recovers all affected messages", async () => {
    await record();
    await record();
    await record(otherBook);
    const fake = provider();
    fake.createTopic.mockImplementation(async (input) => {
      if (input.name.includes(book.id.slice(-8)))
        throw new IntegrationError("TELEGRAM_TOPIC_CREATE_UNKNOWN", "Lost response after create", "UNKNOWN_OUTCOME");
      return { messageThreadId: 202 };
    });
    for (let index = 0; index < 3; index += 1) await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).toHaveBeenCalledTimes(2);
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(fake.send.mock.calls[0]?.[0].messageThreadId).toBe(202);
    const broken = (await notices()).filter((row) => row.bookId === book.id);
    expect(broken.every((row) => row.status === "FAILED")).toBe(true);
    await expect(repo.retryNotification(broken[0]?.id ?? "")).rejects.toMatchObject({
      code: "TELEGRAM_TOPIC_BIND_REQUIRED",
    });
    await topics.bindNotificationTopic(book.id, 777);
    for (let index = 0; index < 2; index += 1) await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).toHaveBeenCalledTimes(2);
    expect(fake.send.mock.calls.slice(1).every(([input]) => input.messageThreadId === 777)).toBe(true);
    expect((await notices()).every((row) => row.status === "SENT")).toBe(true);
  });

  it("requires binding after a worker crash during topic creation and fences late writes", async () => {
    const input = { chatId: "-100123456789", bookId: book.id, bookTitle: book.title };
    const started = await topics.claimNotificationTopic(input);
    await expect(topics.bindNotificationTopic(book.id, 222)).rejects.toMatchObject({ code: "TELEGRAM_TOPIC_BUSY" });
    if (!started.topic.leaseToken) throw new Error("No lease");
    await db.prisma.notificationTopic.update({
      where: { id: started.topic.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await record();
    const fake = provider();
    await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).not.toHaveBeenCalled();
    expect((await mappings())[0]?.status).toBe("UNKNOWN");
    await topics.bindNotificationTopic(book.id, 222);
    expect(await topics.completeNotificationTopic(started.topic.id, started.topic.leaseToken, 111)).toBe(false);
    await dispatch.dispatchNextNotification(fake, now());
    expect(fake.send.mock.calls[0]?.[0].messageThreadId).toBe(222);
  });

  it("retries a rejected create only after an explicit retry and recovers waiting siblings", async () => {
    await record();
    await record();
    const fake = provider();
    fake.createTopic.mockRejectedValue(new IntegrationError("TELEGRAM_TOPIC_ACCESS_DENIED", "No permission", "AUTH"));
    await dispatch.dispatchNextNotification(fake, now());
    await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).toHaveBeenCalledTimes(1);
    const failed = await notices();
    fake.createTopic.mockResolvedValue({ messageThreadId: 99 });
    await repo.retryNotification(failed[0]?.id ?? "");
    await dispatch.dispatchNextNotification(fake, now());
    await dispatch.dispatchNextNotification(fake, now());
    expect((await notices()).every((row) => row.status === "SENT")).toBe(true);
    expect(fake.createTopic).toHaveBeenCalledTimes(2);
  });

  it("honours a create rate limit without marking the topic as an unknown outcome", async () => {
    await record();
    const fake = provider();
    fake.createTopic.mockRejectedValueOnce(
      new IntegrationError("TELEGRAM_RATE_LIMITED", "wait", "QUOTA", { retryAfterMs: 120_000 }),
    );
    const start = now();
    await dispatch.dispatchNextNotification(fake, start);
    expect((await mappings())[0]?.status).toBe("PENDING");
    expect((await notices())[0]?.attempts).toBe(0);
    await dispatch.dispatchNextNotification(fake, new Date(start.getTime() + 5000));
    expect(fake.createTopic).toHaveBeenCalledTimes(1);
    await dispatch.dispatchNextNotification(fake, new Date(start.getTime() + 120_001));
    expect(fake.createTopic).toHaveBeenCalledTimes(2);
    expect((await notices())[0]?.status).toBe("SENT");
  });

  it("does not send outside a closed/deleted topic and supports binding a replacement", async () => {
    await record();
    const fake = provider();
    fake.send.mockRejectedValueOnce(new IntegrationError("TELEGRAM_TOPIC_UNAVAILABLE", "Closed topic", "REJECTED"));
    await dispatch.dispatchNextNotification(fake, now());
    expect((await notices())[0]?.status).toBe("FAILED");
    expect(fake.send.mock.calls[0]?.[0].messageThreadId).toBe(101);
    await topics.bindNotificationTopic(book.id, 333);
    await dispatch.dispatchNextNotification(fake, now());
    expect(fake.createTopic).toHaveBeenCalledTimes(1);
    expect(fake.send.mock.calls[1]?.[0].messageThreadId).toBe(333);
    expect((await notices())[0]?.status).toBe("SENT");
  });

  it("rejects invalid recovery inputs without changing the saved mapping", async () => {
    await expect(topics.bindNotificationTopic(book.id, 0)).rejects.toMatchObject({ code: "INVALID_THREAD_ID" });
    await expect(topics.bindNotificationTopic("missing-book", 11)).rejects.toMatchObject({ code: "BOOK_NOT_FOUND" });
    expect(await mappings()).toHaveLength(0);
  });
});
