import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let bookId: string;
let lessonIds: string[];

async function newBatch(idempotencyKey = `key-${Math.random()}`) {
  return db.prisma.productionBatch.create({
    data: { bookId, idempotencyKey, fingerprint: "fp", targetDurationSec: 60, status: "QUEUED" },
  });
}

async function newItem(batchId: string, lessonId: string, position: number) {
  return db.prisma.productionItem.create({ data: { batchId, lessonId, position, status: "PENDING" } });
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  claim = await import("@/features/productions/repositories/production-claim.repository");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  bookId = (
    await db.prisma.book.create({
      data: {
        title: "Sách",
        sourceFilePath: "books/x/original.md",
        sourceFileName: "x.md",
        sourceHash: `hash-${Math.random()}`,
        sourceFormat: "md",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
    })
  ).id;
  lessonIds = [];
  for (const title of ["Một", "Hai", "Ba"]) {
    const lesson = await db.prisma.lesson.create({
      data: {
        bookId,
        title,
        summary: "s",
        principle: "p",
        realLifeScenario: "r",
        commonMistake: "m",
        betterApproach: "b",
        actionableStep: "a",
        origin: "AI",
      },
    });
    lessonIds.push(lesson.id);
  }
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("production schema", () => {
  it("allows one batch per idempotency key", async () => {
    await newBatch("same-key");

    await expect(newBatch("same-key")).rejects.toThrow();
  });

  it("makes one item per selected lesson within a batch, at its own position", async () => {
    const batch = await newBatch();
    await newItem(batch.id, lessonIds[0] ?? "", 1);

    await expect(newItem(batch.id, lessonIds[0] ?? "", 2)).rejects.toThrow();
    await expect(newItem(batch.id, lessonIds[1] ?? "", 1)).rejects.toThrow();
    await expect(newItem(batch.id, lessonIds[1] ?? "", 2)).resolves.toMatchObject({ position: 2 });
  });

  it("lets the same lesson be produced again in a different batch", async () => {
    const first = await newBatch();
    const second = await newBatch();
    await newItem(first.id, lessonIds[0] ?? "", 1);

    await expect(newItem(second.id, lessonIds[0] ?? "", 1)).resolves.toMatchObject({ status: "PENDING" });
  });

  it("starts an item at checkpoint NONE with no claim", async () => {
    const item = await newItem((await newBatch()).id, lessonIds[0] ?? "", 1);

    expect(item).toMatchObject({ checkpoint: "NONE", claimToken: null, claimExpiresAt: null, videoId: null });
  });

  it("links an item to at most one video, and that video to at most one item", async () => {
    const batch = await newBatch();
    const video = await db.prisma.video.create({ data: { bookId, title: "V" } });
    const first = await newItem(batch.id, lessonIds[0] ?? "", 1);
    const second = await newItem(batch.id, lessonIds[1] ?? "", 2);
    await db.prisma.productionItem.update({ where: { id: first.id }, data: { videoId: video.id } });

    await expect(
      db.prisma.productionItem.update({ where: { id: second.id }, data: { videoId: video.id } }),
    ).rejects.toThrow();
  });

  it("keeps the item but forgets the video when the video is deleted", async () => {
    const batch = await newBatch();
    const video = await db.prisma.video.create({ data: { bookId, title: "V" } });
    const item = await newItem(batch.id, lessonIds[0] ?? "", 1);
    await db.prisma.productionItem.update({ where: { id: item.id }, data: { videoId: video.id } });

    await db.prisma.video.delete({ where: { id: video.id } });

    expect((await db.prisma.productionItem.findUniqueOrThrow({ where: { id: item.id } })).videoId).toBeNull();
  });

  it("refuses to hard-delete a lesson that a production still points at", async () => {
    await newItem((await newBatch()).id, lessonIds[0] ?? "", 1);

    await expect(db.prisma.lesson.delete({ where: { id: lessonIds[0] ?? "" } })).rejects.toThrow();
  });

  it("removes a batch's items with the batch", async () => {
    const batch = await newBatch();
    await newItem(batch.id, lessonIds[0] ?? "", 1);

    await db.prisma.productionBatch.delete({ where: { id: batch.id } });

    expect(await db.prisma.productionItem.count()).toBe(0);
  });
});

describe("claiming an item", () => {
  const LEASE = 60_000;
  let itemId: string;

  beforeEach(async () => {
    itemId = (await newItem((await newBatch()).id, lessonIds[0] ?? "", 1)).id;
  });

  it("lets exactly one of many concurrent workers claim the item", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) => claim.claimProductionItem(itemId, `worker-${index}`, LEASE)),
    );

    expect(attempts.filter(Boolean)).toHaveLength(1);
    const item = await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("RUNNING");
    expect(attempts.indexOf(true)).toBe(Number(item.claimToken?.replace("worker-", "")));
  });

  it("refuses a second claim while the lease is valid, and allows it once the lease has expired", async () => {
    const now = new Date();
    expect(await claim.claimProductionItem(itemId, "a", LEASE, now)).toBe(true);

    expect(await claim.claimProductionItem(itemId, "b", LEASE, new Date(now.getTime() + LEASE - 1))).toBe(false);
    expect(await claim.claimProductionItem(itemId, "b", LEASE, new Date(now.getTime() + LEASE + 1))).toBe(true);
    expect((await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).claimToken).toBe("b");
  });

  it("lets only the current holder renew, so a worker that lost its lease finds out", async () => {
    const now = new Date();
    await claim.claimProductionItem(itemId, "a", LEASE, now);
    await claim.claimProductionItem(itemId, "b", LEASE, new Date(now.getTime() + LEASE + 1));

    expect(await claim.renewProductionClaim(itemId, "a", LEASE, new Date(now.getTime() + LEASE + 2))).toBe(false);
    expect(await claim.renewProductionClaim(itemId, "b", LEASE, new Date(now.getTime() + LEASE + 2))).toBe(true);
  });

  it("refuses to renew a lease that has already expired", async () => {
    const now = new Date();
    await claim.claimProductionItem(itemId, "a", LEASE, now);

    expect(await claim.renewProductionClaim(itemId, "a", LEASE, new Date(now.getTime() + LEASE + 1))).toBe(false);
  });

  it("releases with the next status only for the holder, and frees the item for others", async () => {
    await claim.claimProductionItem(itemId, "a", LEASE);

    expect(await claim.releaseProductionClaim(itemId, "intruder", "COMPLETED")).toBe(false);
    expect(await claim.releaseProductionClaim(itemId, "a", "WAITING")).toBe(true);

    const item = await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item).toMatchObject({ status: "WAITING", claimToken: null, claimExpiresAt: null, completedAt: null });
    expect(await claim.claimProductionItem(itemId, "b", LEASE)).toBe(true);
  });

  it("stamps the completion time on a terminal release and never offers a finished item again", async () => {
    await claim.claimProductionItem(itemId, "a", LEASE);
    await claim.releaseProductionClaim(itemId, "a", "COMPLETED");

    expect((await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).completedAt).not.toBeNull();
    expect(await claim.claimProductionItem(itemId, "b", LEASE)).toBe(false);
  });

  it("does not claim a failed or cancelled item", async () => {
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { status: "FAILED" } });

    expect(await claim.claimProductionItem(itemId, "a", LEASE)).toBe(false);
  });
});
