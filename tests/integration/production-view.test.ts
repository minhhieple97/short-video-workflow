import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as ProductionView from "@/features/productions/services/production-view.service";
import type * as DbClient from "@/server/db/client";

import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let productions: typeof ProductionRequest;
let view: typeof ProductionView;
let itemId: string;
let videoId: string;
let batchId: string;

const update = (data: Record<string, unknown>) => db.prisma.productionItem.update({ where: { id: itemId }, data });
const viewItem = async () => (await view.getProductionView(batchId)).items[0];

async function render(status: string): Promise<string> {
  const record = await db.prisma.renderRecord.create({
    data: {
      videoId,
      scriptVersion: 1,
      outputPath: "x.mp4",
      status,
      qualityPreset: "FINAL",
      width: 1080,
      height: 1920,
      fps: 30,
    },
  });
  return record.id;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  productions = await import("@/features/productions/services/production-request.service");
  view = await import("@/features/productions/services/production-view.service");
}, 60_000);

beforeEach(async () => {
  ({ itemId, videoId } = await seedProduction({ db, productions }));
  batchId = (await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).batchId;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("getProductionView", () => {
  it("shows a new production as waiting to start, cancellable, with nothing to explain", async () => {
    const production = await view.getProductionView(batchId);

    expect(production).toMatchObject({ status: "QUEUED", inProgress: true, minDurationSec: 30, maxDurationSec: 60 });
    expect(production.counts).toEqual({ PENDING: 1, RUNNING: 0, WAITING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 });
    expect(production.items[0]).toMatchObject({
      position: 1,
      lessonTitle: "Bài",
      videoId,
      status: "PENDING",
      checkpoint: "NONE",
      reason: null,
      proposedDuration: null,
      correction: null,
      render: null,
      archive: null,
      canRetry: false,
      canCancel: true,
    });
  });

  it("says why an item waits: a temporary failure with its tries, or the render", async () => {
    await update({
      status: "WAITING",
      errorMessage: "NotebookLM báo đã chạm giới hạn sử dụng; sẽ thử lại sau.",
      transientRetries: 2,
    });
    expect((await viewItem())?.reason).toBe("NotebookLM báo đã chạm giới hạn sử dụng; sẽ thử lại sau. (đã thử 2 lần)");

    const renderId = await render("RENDERING");
    await update({ errorMessage: null, transientRetries: 0, checkpoint: "READY", renderId });
    expect(await viewItem()).toMatchObject({
      reason: "Đang chờ worker render bản cuối.",
      render: { id: renderId, status: "RENDERING" },
    });
  });

  it("shows a failure's reason, lets it be retried and not cancelled, and names the correction that was used", async () => {
    await update({
      status: "FAILED",
      errorMessage: "Bản render không hoàn tất.",
      aiCorrectionTarget: "SCENE_COMPILER",
    });

    expect(await viewItem()).toMatchObject({
      reason: "Bản render không hoàn tất.",
      correction: "Đã dùng lượt sửa AI ở biên tập cảnh",
      canRetry: true,
      canCancel: false,
    });
    expect((await view.getProductionView(batchId)).inProgress).toBe(false);
  });

  it("links the Drive folder only once the archive is verified, and the video as soon as its own file is", async () => {
    const renderId = await render("COMPLETED");
    await update({ status: "COMPLETED", checkpoint: "RENDERED", renderId });
    const archive = await db.prisma.renderArchive.create({
      data: {
        renderId,
        provider: "google-drive",
        destinationKey: "p1",
        status: "RUNNING",
        remoteFolderId: "folder-1",
        files: {
          create: [
            { kind: "VIDEO", remoteName: "video.mp4", remoteFileId: "file-1", status: "UPLOADING" },
            { kind: "SCRIPT", remoteName: "script.json", remoteFileId: "file-2", status: "PENDING" },
          ],
        },
      },
    });
    expect((await viewItem())?.archive).toEqual({ status: "RUNNING", folderUrl: null, videoUrl: null });
    // The video is done but its archive is not: the page keeps following it.
    expect(await view.getProductionView(batchId)).toMatchObject({ inProgress: false, archiving: true });

    await db.prisma.renderArchiveFile.updateMany({
      where: { archiveId: archive.id, kind: "VIDEO" },
      data: { status: "VERIFIED" },
    });
    expect((await viewItem())?.archive).toEqual({
      status: "RUNNING",
      folderUrl: null,
      videoUrl: "https://drive.google.com/file/d/file-1/view",
    });

    await db.prisma.renderArchive.update({ where: { id: archive.id }, data: { status: "COMPLETED" } });
    expect((await viewItem())?.archive).toEqual({
      status: "COMPLETED",
      folderUrl: "https://drive.google.com/drive/folders/folder-1",
      videoUrl: "https://drive.google.com/file/d/file-1/view",
    });
    expect(await view.getProductionView(batchId)).toMatchObject({ archiving: false });
  });

  it("reports an unknown production as not found", async () => {
    await expect(view.getProductionView("missing")).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("listProductions", () => {
  it("lists productions newest first with how many videos are done", async () => {
    await update({ status: "COMPLETED" });

    const [latest] = await view.listProductions();

    expect(latest).toMatchObject({ id: batchId, itemCount: 1, completedCount: 1, book: { title: "Sách" } });
  });

  it("pages the list and counts every production", async () => {
    const page = await view.listProductionsPage({ page: 1, pageSize: 1 });

    expect(page).toMatchObject({ total: 1, page: 1, pageCount: 1 });
    expect(page.items[0]).toMatchObject({ id: batchId });
    expect((await view.listProductionsPage({ page: 4, pageSize: 1 })).items).toHaveLength(1);
  });
});
