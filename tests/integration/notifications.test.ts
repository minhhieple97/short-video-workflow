import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Db from "@/server/db/client";
import type * as Repo from "@/features/notifications/repositories/notification.repository";
import type * as Dispatch from "@/features/notifications/services/notification-dispatch.service";
import type * as Productions from "@/features/productions/services/production-request.service";
import { IntegrationError } from "@/server/integrations/integration-error";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";

import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof Db;
let repo: typeof Repo;
let dispatch: typeof Dispatch;
let productions: typeof Productions;
let fixture: Awaited<ReturnType<typeof seedProduction>>;

beforeAll(async () => {
  env = setupTestEnvironment();
  Object.assign(process.env, {
    TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "123456:fake-notification-token",
    TELEGRAM_CHAT_ID: "-100123456789",
  });
  db = await import("@/server/db/client");
  repo = await import("@/features/notifications/repositories/notification.repository");
  dispatch = await import("@/features/notifications/services/notification-dispatch.service");
  productions = await import("@/features/productions/services/production-request.service");
}, 60_000);
beforeEach(async () => {
  const { getAppConfig } = await import("@/shared/config/env");
  getAppConfig().telegram.enabled = true;
  await db.prisma.notificationDelivery.deleteMany();
  await db.prisma.providerCooldown.deleteMany();
  fixture = await seedProduction({ db, productions });
});
afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

const record = (eventKey = "event-1") =>
  repo.recordNotification({ eventKey, kind: "TEST", title: "Tin kiểm tra", fields: [["Video", "Ví dụ"]] });
const rows = () => db.prisma.notificationDelivery.findMany({ orderBy: { createdAt: "asc" } });
const row = () => db.prisma.notificationDelivery.findFirstOrThrow();
const later = (ms = 1000) => new Date(Date.now() + ms);

async function render() {
  return db.prisma.renderRecord.create({
    data: {
      videoId: fixture.videoId,
      status: "COMPLETED",
      scriptVersion: 1,
      outputPath: "videos/test/r.mp4",
      qualityPreset: "FINAL",
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 60_000,
    },
  });
}

describe("durable notification delivery", () => {
  it("deduplicates events, filters secrets and rolls back the event with its business transition", async () => {
    await record();
    await record();
    expect(await rows()).toHaveLength(1);
    await db.prisma.notificationDelivery.deleteMany();
    await expect(
      db.prisma.$transaction(async (tx) => {
        await tx.video.update({ where: { id: fixture.videoId }, data: { title: "Should roll back" } });
        await repo.recordNotificationWithin(tx, { eventKey: "rollback", kind: "TEST", title: "Test", fields: [] });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await rows()).toHaveLength(0);
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: fixture.videoId } })).title).not.toBe(
      "Should roll back",
    );
    await repo.recordNotification({
      eventKey: "safe",
      kind: "TEST",
      title: "Test",
      fields: [
        ["Lỗi", "https://api.telegram.org/bot123456:fake-notification-token Authorization: Bearer abc token=abc"],
        ["Dài", "x".repeat(10_000)],
      ],
    });
    const saved = await row();
    expect(saved.text.length).toBeLessThan(4096);
    expect(saved.text).not.toContain("fake-notification-token");
    expect(saved.text).not.toContain("Bearer abc");
    expect(saved.text).toContain(`Mã sự kiện: ${saved.id}`);
  });

  it("does not queue or send while disabled, and diagnostics never calls Telegram", async () => {
    const { getAppConfig } = await import("@/shared/config/env");
    getAppConfig().telegram.enabled = false;
    await record();
    const send = vi.fn(async () => ({ messageId: "1" }));
    await dispatch.dispatchNextNotification({ send });
    const { checkTelegram } = await import("@/server/diagnostics/checks/telegram");
    expect(await checkTelegram()).toMatchObject({ status: "info" });
    expect(send).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("sends one pending message and persists its remote ID", async () => {
    await record();
    const send = vi.fn(async () => ({ messageId: "123" }));
    await dispatch.dispatchNextNotification({ send }, later());
    await dispatch.dispatchNextNotification({ send }, later());
    expect(send).toHaveBeenCalledTimes(1);
    expect(await row()).toMatchObject({ status: "SENT", messageId: "123", attempts: 1, leaseToken: null });
  });

  it("parks the entire channel for retry_after without spending retry attempts", async () => {
    await record("one");
    await record("two");
    const send = vi.fn(async () => {
      throw new IntegrationError("TELEGRAM_RATE_LIMITED", "wait", "QUOTA", { retryAfterMs: 120_000 });
    });
    const now = later();
    await dispatch.dispatchNextNotification({ send }, now);
    await dispatch.dispatchNextNotification({ send }, new Date(now.getTime() + 5000));
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rows()).map((entry) => entry.attempts)).toEqual([0, 0]);
    await dispatch.dispatchNextNotification(
      { send: async () => ({ messageId: "ok" }) },
      new Date(now.getTime() + 120_001),
    );
    expect(await db.prisma.notificationDelivery.count({ where: { status: "SENT" } })).toBe(1);
  });

  it("recovers an expired send lease after a crash and repeats the same event ID", async () => {
    await record();
    const now = later();
    const claimed = await repo.claimNextNotification(now);
    if (!claimed) throw new Error("Expected claim");
    const sent: string[] = [];
    const send = async ({ text }: { text: string }) => {
      sent.push(text);
      return { messageId: String(sent.length) };
    };
    await send(claimed);
    await dispatch.dispatchNextNotification({ send }, new Date(now.getTime() + repo.NOTIFICATION_LEASE_MS + 1));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
    expect(await row()).toMatchObject({ status: "SENT", attempts: 2, messageId: "2" });
    await repo.settleNotification(claimed.id, claimed.leaseToken, { status: "SENT", messageId: "stale" });
    expect((await row()).messageId).toBe("2");
  });

  it("bounds unknown-outcome retries and permits retrying only the notification", async () => {
    await record();
    const before = await db.prisma.productionItem.findUniqueOrThrow({ where: { id: fixture.itemId } });
    const send = vi.fn(async () => {
      throw new IntegrationError("TELEGRAM_DELIVERY_UNKNOWN", "lost", "UNKNOWN_OUTCOME");
    });
    for (let attempt = 0; attempt < 10; attempt += 1)
      await dispatch.dispatchNextNotification({ send }, later((attempt + 1) * 3_600_000));
    expect(send).toHaveBeenCalledTimes(8);
    expect(await row()).toMatchObject({ status: "FAILED", attempts: 8 });
    await repo.retryNotification((await row()).id);
    expect(await row()).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await db.prisma.productionItem.findUniqueOrThrow({ where: { id: fixture.itemId } })).toEqual(before);
  });
});

describe("business notification sources", () => {
  it("reports partial chapter analysis once even when its job completes normally", async () => {
    const chapters = await import("@/features/chapters/repositories/chapter.repository");
    const chapter = await db.prisma.chapter.findFirstOrThrow({ where: { bookId: fixture.bookId } });
    await chapters.setChapterAnalysisStatus(chapter.id, "PARTIAL");
    await chapters.setChapterAnalysisStatus(chapter.id, "PARTIAL");
    expect(await rows()).toHaveLength(1);
    expect((await row()).text).toContain("CHAPTER_ANALYSIS_PARTIAL");
  });
  it("reports an actual failing TTS scene once and suppresses its job wrapper", async () => {
    const claim = await import("@/features/productions/repositories/production-claim.repository");
    const pipeline = await import("@/features/productions/services/production-pipeline.service");
    const jobs = await import("@/features/jobs/repositories/job-record.repository");
    await claim.claimProductionItem(fixture.itemId, "test-worker", 600_000);
    await db.prisma.productionItem.update({
      where: { id: fixture.itemId },
      data: { checkpoint: "APPLIED", transientRetries: 5 },
    });
    for (const order of [0, 1])
      await db.prisma.videoScene.create({
        data: {
          videoId: fixture.videoId,
          order,
          type: order ? "SITUATION" : "HOOK",
          narration: "Lời dẫn",
          onScreenText: "Chữ",
          visualVariant: "SCENARIO_CARD",
          contentHash: `scene-${order}`,
        },
      });
    const scenes = await db.prisma.videoScene.findMany({
      where: { videoId: fixture.videoId },
      orderBy: { order: "asc" },
    });
    const brokenId = scenes[1]?.id;
    const outcome = await pipeline.runProductionStep({
      itemId: fixture.itemId,
      claimToken: "test-worker",
      deps: {
        scriptStudio: new MockScriptStudioProvider(),
        compiler: new MockScenePlanCompiler(),
        resolveSources: async () => [],
        synthesize: async ({ sceneId }) => {
          if (sceneId === brokenId)
            throw new IntegrationError("TTS_FAILED", "Không nhận được audio sau các lần thử.", "TRANSIENT");
          return { sceneId, cached: false };
        },
      },
    });
    expect(outcome).toMatchObject({ kind: "FAILED", stage: "Lồng tiếng", sceneId: brokenId });
    if (outcome.kind !== "FAILED") throw new Error("Expected failed TTS");
    await pipeline.settleProductionRun({ itemId: fixture.itemId, claimToken: "test-worker", outcome });
    const job = await db.prisma.jobRecord.findFirstOrThrow({ where: { entityId: fixture.itemId } });
    await jobs.markJobFailed(job.id, outcome.code, outcome.message);
    expect(await rows()).toHaveLength(1);
    expect((await row()).text).toContain(String(brokenId));
    expect((await row()).text).toContain("Lồng tiếng");
    expect((await row()).bookId).toBe(fixture.bookId);
    const retry = await import("@/features/productions/repositories/production-jobs.repository");
    await retry.resetItemForRetry(fixture.itemId);
    await claim.claimProductionItem(fixture.itemId, "second-worker", 600_000);
    await claim.releaseProductionClaim(fixture.itemId, "second-worker", "FAILED", outcome);
    expect(await rows()).toHaveLength(2);
  });

  it("queues a ready link only after every archive file is verified, once per render", async () => {
    const archive = await import("@/features/archive/repositories/render-archive.repository");
    const saved = await render();
    for (const destinationKey of ["account-1", "account-2"]) {
      const { archive: item } = await archive.ensureRenderArchive(
        { renderId: saved.id, provider: "google-drive", destinationKey },
        [
          { kind: "VIDEO", remoteName: "video.mp4" },
          { kind: "MANIFEST", remoteName: "manifest.json" },
        ],
      );
      await archive.saveRemoteIds(item.id, {
        folderId: "folder",
        fileIds: { VIDEO: "correct-video-id", MANIFEST: "manifest-id" },
      });
      expect(await archive.completeArchive(item.id)).toBe(false);
      for (const kind of ["VIDEO", "MANIFEST"] as const) {
        await archive.markFileUploaded(item.id, kind, 10);
        await archive.markFileVerified(item.id, kind);
      }
      expect(await archive.completeArchive(item.id)).toBe(true);
      await archive.completeArchive(item.id);
    }
    expect(await rows()).toHaveLength(1);
    expect((await row()).text).toContain("https://drive.google.com/file/d/correct-video-id/view");
    expect((await row()).bookId).toBe(fixture.bookId);
  });

  it("reports a Drive failure without changing the completed render, then reports recovery", async () => {
    const archive = await import("@/features/archive/repositories/render-archive.repository");
    const saved = await render();
    const { archive: item } = await archive.ensureRenderArchive(
      { renderId: saved.id, provider: "google-drive", destinationKey: "account" },
      [{ kind: "VIDEO", remoteName: "video.mp4" }],
    );
    await archive.setArchiveStatus(item.id, "FAILED", { code: "DRIVE_STORAGE_FULL", message: "Drive hết dung lượng." });
    await archive.setArchiveStatus(item.id, "FAILED", { code: "DRIVE_STORAGE_FULL", message: "Drive hết dung lượng." });
    expect(await rows()).toHaveLength(1);
    expect((await row()).text).toContain("video đã render thành công");
    expect((await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe("COMPLETED");
    await archive.setArchiveStatus(item.id, "RUNNING");
    await archive.saveRemoteIds(item.id, { folderId: "folder", fileIds: { VIDEO: "recovered-video" } });
    await archive.markFileUploaded(item.id, "VIDEO", 10);
    await archive.markFileVerified(item.id, "VIDEO");
    await archive.completeArchive(item.id);
    expect((await rows()).map((entry) => entry.kind)).toEqual(["PIPELINE_FAILED", "VIDEO_READY"]);
  });

  it("records the missing-Drive warning atomically with a completed FINAL render", async () => {
    const renders = await import("@/features/videos/repositories/render.repository");
    const saved = await render();
    await renders.completeRenderRecord(
      saved,
      { durationMs: 60_000, sizeBytes: 100 },
      { archive: true, missingDrive: true },
    );
    expect(await rows()).toHaveLength(1);
    expect((await row()).kind).toBe("VIDEO_LINK_UNAVAILABLE");
  });

  it.each(["PARTIAL", "NEEDS_CHAPTERS", "HELD"])(
    "reports %s extraction stops before a video exists and avoids job duplicates",
    async (status) => {
      const extractions = await import("@/features/extraction/repositories/extraction.repository");
      const jobs = await import("@/features/jobs/repositories/job-record.repository");
      const extraction = await db.prisma.bookExtraction.create({
        data: { bookId: fixture.bookId, status: "OCR_PENDING", sourceHash: "hash", costCeilingMicroUsd: 3_000_000 },
      });
      const failure = { code: "OCR_PAGES_FAILED", message: "Trang 12 chưa đọc được." };
      if (status === "HELD") {
        await extractions.holdExtraction(extraction.id, failure);
        await extractions.holdExtraction(extraction.id, failure);
      } else {
        await extractions.moveExtractionStatus(extraction.id, ["OCR_PENDING"], {
          status,
          errorCode: failure.code,
          errorMessage: failure.message,
        });
      }
      const job = await jobs.createJobRecord({
        bullmqJobId: `extract-${status}`,
        jobType: "EXTRACT_PDF",
        entityType: "EXTRACTION",
        entityId: extraction.id,
      });
      await jobs.markJobFailed(job.id, failure.code, failure.message);
      expect(await rows()).toHaveLength(1);
      expect((await row()).text).toContain("Trang 12");
      expect((await row()).bookId).toBe(fixture.bookId);
    },
  );

  it("reports manual job failures with their original error and suppresses cancellation", async () => {
    const jobs = await import("@/features/jobs/repositories/job-record.repository");
    const job = await jobs.createJobRecord({
      bullmqJobId: "manual-script",
      jobType: "GENERATE_VIDEO_SCRIPT",
      entityType: "VIDEO",
      entityId: fixture.videoId,
    });
    await jobs.markJobFailed(job.id, "AI_CLI_MODEL_UNAVAILABLE", "Model không được phép dùng.");
    await jobs.markJobFailed(job.id, "AI_CLI_MODEL_UNAVAILABLE", "Model không được phép dùng.");
    const cancel = await jobs.createJobRecord({
      bullmqJobId: "cancel",
      jobType: "RENDER_VIDEO",
      entityType: "VIDEO",
      entityId: fixture.videoId,
    });
    await jobs.markJobCancelled(cancel.id);
    expect(await rows()).toHaveLength(1);
    expect((await row()).text).toContain("AI_CLI_MODEL_UNAVAILABLE");
  });

  it("shares one quota episode across tasks, restarts and extensions; resumes only after success", async () => {
    const cooldown = await import("@/features/jobs/services/provider-cooldown.service");
    const saved = await import("@/features/jobs/repositories/provider-cooldown.repository");
    const call = vi.fn(async () => {
      throw new IntegrationError("AI_QUOTA_EXCEEDED", "Đợi quota", "QUOTA", { retryAfterMs: 3_600_000 });
    });
    for (let index = 0; index < 10; index += 1)
      await cooldown.withProviderCooldown("claude", call).catch(() => undefined);
    expect(call).toHaveBeenCalledTimes(1);
    await saved.saveProviderCooldown({
      provider: "claude",
      kind: "QUOTA",
      errorCode: "AI_QUOTA_EXCEEDED",
      message: "Đợi thêm",
      blockedUntil: later(7_200_000),
    });
    await db.prisma.$disconnect();
    expect(await rows()).toHaveLength(1);
    await db.prisma.providerCooldown.update({ where: { provider: "claude" }, data: { blockedUntil: new Date(0) } });
    expect(await rows()).toHaveLength(1);
    await cooldown.withProviderCooldown("claude", async () => "cached", { isSuccessful: () => false });
    expect(await rows()).toHaveLength(1);
    expect(await db.prisma.providerCooldown.count()).toBe(1);
    await cooldown.withProviderCooldown("claude", async () => "success");
    expect((await rows()).map((entry) => entry.kind)).toEqual(["PROVIDER_WAITING", "PROVIDER_RESUMED"]);
  });
});
