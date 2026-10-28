import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as FolderRepository from "@/features/archive/repositories/archive-folder.repository";
import type * as DriveClient from "@/server/archive/google-drive/google-drive-client";
import type * as FolderTree from "@/server/archive/google-drive/drive-folder-tree";
import type * as DbClient from "@/server/db/client";

import { FakeGoogleServer } from "../helpers/fake-google-server";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof FolderRepository;
let clientModule: typeof DriveClient;
let treeModule: typeof FolderTree;
let google: FakeGoogleServer;

const REQUEST = { bookId: "book-1", videoId: "video-1", renderId: "render-1" };

function tree(destinationKey = "permission-1", invalidate?: () => void) {
  const drive = new clientModule.GoogleDriveClient({
    getAccessToken: async () => "ya29.token",
    invalidateAccessToken: invalidate,
    endpoints: google.endpoints,
  });
  return new treeModule.DriveFolderTree(drive, repo.archiveFolderStore("google-drive", destinationKey));
}

const folderCreates = () =>
  google.requests.filter((request) => request.method === "POST" && request.path === "/drive/v3/files");
const createdBodies = () => folderCreates().map((request) => JSON.parse(request.body) as Record<string, unknown>);
const folders = () => [...google.objects.values()];
const folderAt = (name: string) => folders().filter((folder) => folder.name === name);

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/archive/repositories/archive-folder.repository");
  clientModule = await import("@/server/archive/google-drive/google-drive-client");
  treeModule = await import("@/server/archive/google-drive/drive-folder-tree");
}, 60_000);

beforeEach(async () => {
  await db.prisma.archiveFolder.deleteMany();
  google = new FakeGoogleServer();
  await google.start();
});

afterEach(async () => {
  await google.stop();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("archiveFolderChain", () => {
  it("follows the archive layout from the app's root down to the render", async () => {
    expect((await import("@/server/archive/google-drive/drive-folder-tree")).archiveFolderChain(REQUEST)).toEqual([
      { path: "", name: "Book Video Studio" },
      { path: "books", name: "books" },
      { path: "books/book-1", name: "book-1" },
      { path: "books/book-1/videos", name: "videos" },
      { path: "books/book-1/videos/video-1", name: "video-1" },
      { path: "books/book-1/videos/video-1/renders", name: "renders" },
      { path: "books/book-1/videos/video-1/renders/render-1", name: "render-1" },
    ]);
  });
});

describe("DriveFolderTree.prepare", () => {
  it("creates the whole chain with IDs it reserved first, and hands out three fresh file IDs", async () => {
    const destination = await tree().prepare(REQUEST);

    const bodies = createdBodies();
    expect(bodies.map((body) => body.name)).toEqual([
      "Book Video Studio",
      "books",
      "book-1",
      "videos",
      "video-1",
      "renders",
      "render-1",
    ]);
    expect(bodies[0]).not.toHaveProperty("parents");
    for (let index = 1; index < bodies.length; index += 1) {
      expect(bodies[index]?.parents).toEqual([bodies[index - 1]?.id]);
    }
    expect(bodies.every((body) => body.mimeType === "application/vnd.google-apps.folder")).toBe(true);
    expect(destination.folderId).toBe(bodies.at(-1)?.id);
    const fileIds = Object.values(destination.fileIds);
    expect(new Set(fileIds).size).toBe(3);
    expect(fileIds.some((id) => google.objects.has(id))).toBe(false);
    expect(google.requestsTo("/drive/v3/files/generateIds").map((request) => request.query.get("count"))).toEqual([
      "10",
    ]);

    const bindings = await db.prisma.archiveFolder.findMany({ orderBy: { path: "asc" } });
    expect(bindings).toHaveLength(7);
    expect(bindings.every((binding) => binding.confirmedAt !== null && binding.destinationKey === "permission-1")).toBe(
      true,
    );
  });

  it("reuses the folders it already has: a second render of the video only adds its own folder", async () => {
    const first = await tree().prepare(REQUEST);

    const second = await tree().prepare({ ...REQUEST, renderId: "render-2" });

    expect(
      createdBodies()
        .slice(7)
        .map((body) => body.name),
    ).toEqual(["render-2"]);
    expect(createdBodies()[7]?.parents).toEqual([createdBodies()[5]?.id]);
    expect(second.folderId).not.toBe(first.folderId);
    expect(google.requestsTo("/drive/v3/files/generateIds").map((request) => request.query.get("count"))).toEqual([
      "10",
      "4",
    ]);
  });

  it("never searches the Drive: it only asks for IDs and creates folders", async () => {
    await tree().prepare(REQUEST);
    await tree().prepare({ ...REQUEST, renderId: "render-2" });

    const kinds = new Set(google.requests.map((request) => `${request.method} ${request.path}`));
    expect(kinds).toEqual(new Set(["GET /drive/v3/files/generateIds", "POST /drive/v3/files"]));
  });

  it("repeats a create whose answer was lost with the same ID, ending with one folder", async () => {
    google.failNext("createFile", { kind: "drop" });
    google.failNext("createFile", { kind: "drop-after" });

    await expect(tree().prepare(REQUEST)).rejects.toMatchObject({ kind: "UNKNOWN_OUTCOME" });
    await expect(tree().prepare(REQUEST)).rejects.toMatchObject({ kind: "UNKNOWN_OUTCOME" });
    const destination = await tree().prepare(REQUEST);

    expect(folderAt("Book Video Studio")).toHaveLength(1);
    expect(folders()).toHaveLength(7);
    const rootCreates = createdBodies().filter((body) => body.name === "Book Video Studio");
    expect(new Set(rootCreates.map((body) => body.id)).size).toBe(1);
    expect(google.objects.has(destination.folderId)).toBe(true);
  });

  it("makes one folder per path when two renders are prepared at once", async () => {
    await Promise.all([tree().prepare(REQUEST), tree().prepare({ ...REQUEST, renderId: "render-2" })]);

    expect(folderAt("Book Video Studio")).toHaveLength(1);
    expect(folderAt("video-1")).toHaveLength(1);
    expect(folders()).toHaveLength(8);
    expect(await db.prisma.archiveFolder.count()).toBe(8);
  });

  it("rebuilds from a folder someone removed in Drive, keeping the folders above it", async () => {
    await tree().prepare(REQUEST);
    const above = await db.prisma.archiveFolder.findMany({ where: { path: { in: ["", "books", "books/book-1"] } } });
    google.objects.delete(folderAt("videos")[0]?.id ?? "");
    google.objects.delete(folderAt("video-1")[0]?.id ?? "");
    google.objects.delete(folderAt("renders")[0]?.id ?? "");
    google.objects.delete(folderAt("render-1")[0]?.id ?? "");

    const destination = await tree().prepare({ ...REQUEST, renderId: "render-2" });

    expect(google.objects.has(destination.folderId)).toBe(true);
    const rebuilt = await db.prisma.archiveFolder.findMany({ where: { path: { in: ["", "books", "books/book-1"] } } });
    expect(rebuilt.map((row) => row.remoteId).sort()).toEqual(above.map((row) => row.remoteId).sort());
    expect(folderAt("videos")).toHaveLength(1);
    expect(folderAt("videos")[0]?.parents).toEqual([folderAt("book-1")[0]?.id]);
    expect(
      await db.prisma.archiveFolder.count({ where: { path: "books/book-1/videos/video-1/renders/render-1" } }),
    ).toBe(0);
  });

  it("rebuilds the whole tree for the next render when the app's root folder was removed", async () => {
    await tree().prepare(REQUEST);
    google.objects.clear();

    const destination = await tree().prepare({ ...REQUEST, renderId: "render-2" });

    expect(folders()).toHaveLength(7);
    expect(google.objects.has(destination.folderId)).toBe(true);
    expect(folderAt("Book Video Studio")[0]?.parents).toEqual(["root"]);
    expect(folderAt("render-1")).toHaveLength(0);
  });

  it("keeps a separate tree for another account", async () => {
    await tree("permission-1").prepare(REQUEST);
    await tree("permission-2").prepare(REQUEST);

    expect(folderAt("Book Video Studio")).toHaveLength(2);
    expect(await db.prisma.archiveFolder.count({ where: { destinationKey: "permission-2" } })).toBe(7);
  });

  it("asks for a fresh token once when Drive refuses the current one", async () => {
    let invalidated = 0;
    google.failNext("generateIds", {
      kind: "status",
      status: 401,
      body: { error: { errors: [{ reason: "authError" }] } },
    });

    await tree("permission-1", () => {
      invalidated += 1;
    }).prepare(REQUEST);

    expect(invalidated).toBe(1);
    expect(google.requestsTo("/drive/v3/files/generateIds")).toHaveLength(2);
  });

  it("creates nothing when Drive hands out fewer IDs than asked for", async () => {
    google.failNext("generateIds", { kind: "json", body: { ids: ["only-one"] } });

    await expect(tree().prepare(REQUEST)).rejects.toMatchObject({ code: "DRIVE_IDS_SHORT", kind: "TRANSIENT" });
    expect(folderCreates()).toHaveLength(0);
    expect(await db.prisma.archiveFolder.count()).toBe(0);
  });

  it("gives up after a second refusal instead of looping", async () => {
    for (let index = 0; index < 2; index += 1) {
      google.failNext("generateIds", {
        kind: "status",
        status: 401,
        body: { error: { errors: [{ reason: "authError" }] } },
      });
    }

    await expect(tree("permission-1", () => undefined).prepare(REQUEST)).rejects.toMatchObject({ kind: "AUTH" });
    expect(google.requestsTo("/drive/v3/files/generateIds")).toHaveLength(2);
  });
});

describe("archiveFolderStore", () => {
  const store = () => repo.archiveFolderStore("google-drive", "permission-1");

  it("keeps the first ID reserved for a path", async () => {
    expect(await store().reserve("books", "id-a")).toBe("id-a");
    expect(await store().reserve("books", "id-b")).toBe("id-a");
    expect(await store().find(["books", "other"])).toEqual([{ path: "books", remoteId: "id-a", confirmed: false }]);
  });

  it("confirms a folder only in its own destination", async () => {
    const other = repo.archiveFolderStore("google-drive", "permission-2");
    await store().reserve("books", "id-a");
    await other.reserve("books", "id-b");

    await store().confirm("books");

    expect(await other.find(["books"])).toEqual([{ path: "books", remoteId: "id-b", confirmed: false }]);
    expect(await store().find(["books"])).toEqual([{ path: "books", remoteId: "id-a", confirmed: true }]);
  });

  it("forgets a path and everything below it, and nothing beside it", async () => {
    for (const path of ["", "books", "books/b1", "books/b1/videos", "books/b10", "booksX"]) {
      await store().reserve(path, `id-${path}`);
    }

    await store().forget("books/b1");

    const left = (await db.prisma.archiveFolder.findMany()).map((row) => row.path).sort();
    expect(left).toEqual(["", "books", "books/b10", "booksX"]);

    await store().forget("");
    expect(await db.prisma.archiveFolder.count()).toBe(0);
  });
});
