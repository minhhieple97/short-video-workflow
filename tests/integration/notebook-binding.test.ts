import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bindingMarker, hasBindingMarker, titleWithMarker } from "@/features/notebooklm/domain/binding-marker";
import type * as BindingRepository from "@/features/notebooklm/repositories/notebook-binding.repository";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof BindingRepository;
let bookId: string;
let notebookBindingId: string;

const source = (contentHash: string, sourceKey = "chapter:c1") =>
  repo.ensureSourceBinding({ notebookBindingId, sourceKey, contentHash, title: "Chương 1: Bắt đầu nhỏ" });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/notebooklm/repositories/notebook-binding.repository");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  bookId = (
    await db.prisma.book.create({
      data: {
        title: "Sách",
        sourceFilePath: "books/x/original.pdf",
        sourceFileName: "x.pdf",
        sourceHash: `hash-${Math.random()}`,
        sourceFormat: "pdf",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
    })
  ).id;
  notebookBindingId = (await repo.ensureNotebookBinding(bookId, "work")).id;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("binding marker", () => {
  it("puts the binding ID into the title and finds it there", () => {
    const title = titleWithMarker("  Chương 1  ", "id-1");

    expect(title).toBe("Chương 1 [bvs:id-1]");
    expect(hasBindingMarker(`${title} (copy)`, "id-1")).toBe(true);
    expect(hasBindingMarker(title, "id-2")).toBe(false);
    expect(bindingMarker("id-1")).toBe("[bvs:id-1]");
    expect(titleWithMarker("x".repeat(300), "id").length).toBeLessThan(170);
  });
});

describe("notebook bindings", () => {
  it("keeps one notebook per book and account", async () => {
    const again = await repo.ensureNotebookBinding(bookId, "work");
    const other = await repo.ensureNotebookBinding(bookId, "personal");

    expect(again.id).toBe(notebookBindingId);
    expect(other.id).not.toBe(notebookBindingId);
    expect(again).toMatchObject({ status: "PENDING", notebookId: null });
  });

  it("makes one binding when several callers ask at once", async () => {
    const results = await Promise.all([1, 2, 3].map(() => repo.ensureNotebookBinding(bookId, "shared")));

    expect(new Set(results.map((binding) => binding.id)).size).toBe(1);
  });

  it("writes the remote notebook ID once", async () => {
    expect(await repo.moveNotebookStatus(notebookBindingId, ["PENDING"], "CREATING")).toBe(true);
    expect(await repo.moveNotebookStatus(notebookBindingId, ["PENDING"], "CREATING")).toBe(false);

    await repo.saveNotebookId(notebookBindingId, "nb-1");
    const kept = await repo.saveNotebookId(notebookBindingId, "nb-2");

    expect(kept).toMatchObject({ notebookId: "nb-1", status: "READY" });
  });

  it("goes away with its book", async () => {
    await source("h1");
    await db.prisma.book.delete({ where: { id: bookId } });

    expect(await db.prisma.notebookBinding.count()).toBe(0);
    expect(await db.prisma.notebookSourceBinding.count()).toBe(0);
  });
});

describe("source bindings", () => {
  it("reuses the binding for the same part at the same revision", async () => {
    const first = await source("h1");
    const again = await source("h1");

    expect(again.id).toBe(first.id);
    expect(first.title).toBe(`Chương 1: Bắt đầu nhỏ [bvs:${first.id}]`);
    expect(first.status).toBe("PENDING");
  });

  it("makes a new binding for changed text and keeps the old one, with its remote ID, as superseded", async () => {
    const old = await source("h1");
    await repo.saveRemoteSourceId(old.id, "src-old");

    const changed = await source("h2");

    expect(changed.id).not.toBe(old.id);
    const kept = await repo.findSourceBinding(old.id);
    expect(kept).toMatchObject({ remoteSourceId: "src-old", status: "READY" });
    expect(kept?.supersededAt).not.toBeNull();
    expect((await repo.listCurrentSources(notebookBindingId)).map((row) => row.id)).toEqual([changed.id]);
  });

  it("reuses an earlier revision when the text goes back to it", async () => {
    const old = await source("h1");
    const newer = await source("h2");

    const back = await source("h1");

    expect(back.id).toBe(old.id);
    expect(back.supersededAt).toBeNull();
    expect((await repo.findSourceBinding(newer.id))?.supersededAt).not.toBeNull();
  });

  it("leaves the other parts of the book alone", async () => {
    const chapterOne = await source("h1", "chapter:c1");
    const chapterTwo = await source("h9", "chapter:c2");

    await source("h2", "chapter:c1");

    expect((await repo.findSourceBinding(chapterTwo.id))?.supersededAt).toBeNull();
    expect((await repo.listCurrentSources(notebookBindingId)).map((row) => row.sourceKey)).toEqual([
      "chapter:c1",
      "chapter:c2",
    ]);
    expect((await repo.findSourceBinding(chapterOne.id))?.supersededAt).not.toBeNull();
  });

  it("makes one binding when the same revision is asked for at once", async () => {
    const results = await Promise.all([source("h1"), source("h1"), source("h1")]);

    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await db.prisma.notebookSourceBinding.count()).toBe(1);
  });

  it("writes the remote source ID once and moves status only from the expected one", async () => {
    const row = await source("h1");

    expect(await repo.moveSourceStatus(row.id, ["PENDING"], "SUBMITTING")).toBe(true);
    expect(await repo.moveSourceStatus(row.id, ["PENDING"], "SUBMITTING")).toBe(false);
    await repo.saveRemoteSourceId(row.id, "src-1", new Date("2026-10-28T10:00:00.000Z"));

    expect(await repo.saveRemoteSourceId(row.id, "src-2")).toMatchObject({
      remoteSourceId: "src-1",
      status: "READY",
      readyAt: new Date("2026-10-28T10:00:00.000Z"),
    });
  });
});
