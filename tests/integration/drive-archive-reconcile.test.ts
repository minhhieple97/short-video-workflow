import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GoogleDriveArchiveProvider } from "@/server/archive/google-drive/drive-archive-provider";
import { UPLOAD_CHUNK_UNIT } from "@/server/archive/google-drive/drive-resumable-upload";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";
import type {
  ArchiveDestination,
  ArchiveFileSource,
  ArchiveUploadCheckpoint,
} from "@/server/archive/video-archive-provider";

import { FakeGoogleServer } from "../helpers/fake-google-server";
import { InMemoryArchiveFolderStore } from "../helpers/fakes/in-memory-archive-folder-store";

const CHUNK = UPLOAD_CHUNK_UNIT;
const SIZE = 3 * CHUNK + 500;

let google: FakeGoogleServer;
let directory: string;
let content: Buffer;
let file: ArchiveFileSource;
let folders: InMemoryArchiveFolderStore;
let destination: ArchiveDestination;

const provider = () =>
  new GoogleDriveArchiveProvider({
    drive: new GoogleDriveClient({ getAccessToken: async () => "ya29.token", endpoints: google.endpoints }),
    folders,
    chunkBytes: CHUNK,
  });
const chunkPuts = () =>
  google.requests.filter(
    (entry) => entry.method === "PUT" && !String(entry.headers["content-range"]).startsWith("bytes */"),
  );
const queries = () => google.requests.filter((entry) => String(entry.headers["content-range"]).startsWith("bytes */"));
const starts = () =>
  google.requests.filter((entry) => entry.method === "POST" && entry.path === "/upload/drive/v3/files");
const videoObjects = () => [...google.objects.values()].filter((object) => object.mimeType === "video/mp4");

beforeEach(async () => {
  google = new FakeGoogleServer();
  await google.start();
  folders = new InMemoryArchiveFolderStore();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-reconcile-"));
  content = randomBytes(SIZE);
  const localPath = path.join(directory, "video.mp4");
  fs.writeFileSync(localPath, content);
  file = { kind: "VIDEO", localPath, remoteName: "video.mp4", mimeType: "video/mp4", bytes: SIZE };
  destination = await provider().prepareDestination({ bookId: "b", videoId: "v", renderId: "r" });
});

afterEach(async () => {
  await google.stop();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("upload after a lost answer", () => {
  it("asks where the upload stands when a chunk's answer is lost, and does not resend what Google stored", async () => {
    google.failNext("uploadChunk", { kind: "drop-after" });

    expect(await provider().upload({ destination, file, checkpoint: null })).toEqual({ bytes: SIZE });

    expect(queries()).toHaveLength(1);
    expect(chunkPuts().map((put) => put.headers["content-range"])).toEqual([
      `bytes 0-${CHUNK - 1}/${SIZE}`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/${SIZE}`,
      `bytes ${2 * CHUNK}-${3 * CHUNK - 1}/${SIZE}`,
      `bytes ${3 * CHUNK}-${SIZE - 1}/${SIZE}`,
    ]);
    expect(videoObjects()).toHaveLength(1);
    expect(videoObjects()[0]?.content?.equals(content)).toBe(true);
  });

  it("resends a chunk Google never received", async () => {
    google.failNext("uploadChunk", { kind: "drop" });

    expect(await provider().upload({ destination, file, checkpoint: null })).toEqual({ bytes: SIZE });

    expect(chunkPuts().filter((put) => put.headers["content-range"] === `bytes 0-${CHUNK - 1}/${SIZE}`)).toHaveLength(
      2,
    );
    expect(videoObjects()[0]?.content?.equals(content)).toBe(true);
  });

  it("learns from the status query that a final chunk whose answer was lost finished the file", async () => {
    const result = await provider().upload(
      { destination, file, checkpoint: null },
      {
        onCheckpoint: (checkpoint) => {
          // Arms the fault for the chunk that completes the file.
          if (checkpoint.bytesSent === 3 * CHUNK) google.failNext("uploadChunk", { kind: "drop-after" });
        },
      },
    );

    expect(result).toEqual({ bytes: SIZE });
    expect(queries()).toHaveLength(1);
    expect(
      chunkPuts().filter((put) => put.headers["content-range"] === `bytes ${3 * CHUNK}-${SIZE - 1}/${SIZE}`),
    ).toHaveLength(1);
    expect(videoObjects()).toHaveLength(1);
    expect(videoObjects()[0]?.content?.equals(content)).toBe(true);
  });

  it("lets a failed status query end the attempt, keeping the checkpoint", async () => {
    google.failNext("uploadChunk", { kind: "drop" });
    google.failNext("uploadStatus", { kind: "status", status: 503 });
    const checkpoints: ArchiveUploadCheckpoint[] = [];

    await expect(
      provider().upload(
        { destination, file, checkpoint: null },
        { onCheckpoint: (checkpoint) => void checkpoints.push(checkpoint) },
      ),
    ).rejects.toMatchObject({ kind: "TRANSIENT" });

    expect(checkpoints.at(-1)?.token).toContain("upload_id=");
    expect(await provider().upload({ destination, file, checkpoint: checkpoints.at(-1) ?? null })).toEqual({
      bytes: SIZE,
    });
    expect(starts()).toHaveLength(1);
  });

  it("gives up after a few lost answers in a row, and the next attempt finds the file finished", async () => {
    for (let index = 0; index < 4; index += 1) google.failNext("uploadChunk", { kind: "drop-after" });
    const checkpoints: ArchiveUploadCheckpoint[] = [];

    await expect(
      provider().upload(
        { destination, file, checkpoint: null },
        { onCheckpoint: (checkpoint) => void checkpoints.push(checkpoint) },
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_TRANSPORT", kind: "UNKNOWN_OUTCOME" });
    expect(queries()).toHaveLength(3);
    const sent = chunkPuts().length;

    expect(await provider().upload({ destination, file, checkpoint: checkpoints.at(-1) ?? null })).toEqual({
      bytes: SIZE,
    });
    expect(chunkPuts()).toHaveLength(sent);
    expect(starts()).toHaveLength(1);
    expect(videoObjects()).toHaveLength(1);
  });

  it("stops when Google keeps losing the same chunk, keeping the checkpoint for the next attempt", async () => {
    for (let index = 0; index < 4; index += 1) google.failNext("uploadChunk", { kind: "drop" });
    const checkpoints: ArchiveUploadCheckpoint[] = [];

    await expect(
      provider().upload(
        { destination, file, checkpoint: null },
        { onCheckpoint: (checkpoint) => void checkpoints.push(checkpoint) },
      ),
    ).rejects.toMatchObject({ code: "DRIVE_UPLOAD_STALLED", kind: "TRANSIENT" });
    expect(queries()).toHaveLength(3);

    expect(await provider().upload({ destination, file, checkpoint: checkpoints.at(-1) ?? null })).toEqual({
      bytes: SIZE,
    });
    expect(starts()).toHaveLength(1);
    expect(videoObjects()).toHaveLength(1);
  });

  it("after a restart that lost the session, finds the file already there under its ID instead of making another", async () => {
    const checkpoints: ArchiveUploadCheckpoint[] = [];
    await provider().upload(
      { destination, file, checkpoint: null },
      { onCheckpoint: (checkpoint) => void checkpoints.push(checkpoint) },
    );
    google.uploadSessions.clear();

    const replay = await provider().upload({ destination, file, checkpoint: checkpoints.at(-1) ?? null });

    expect(replay).toEqual({ bytes: SIZE });
    expect(videoObjects()).toHaveLength(1);
    expect(google.requests.at(-1)?.path).toBe(`/drive/v3/files/${destination.fileIds.VIDEO}`);
  });

  it("names the problem when the render's folder was removed in Drive", async () => {
    google.objects.delete(destination.folderId);

    await expect(provider().upload({ destination, file, checkpoint: null })).rejects.toMatchObject({
      code: "ARCHIVE_FOLDER_MISSING",
      kind: "REJECTED",
    });
    expect(videoObjects()).toHaveLength(0);
  });
});

describe("verify", () => {
  const verify = () => provider().verify({ destination, file });

  beforeEach(async () => {
    await provider().upload({ destination, file, checkpoint: null });
  });

  it("verifies the remote file against the local one with SHA-256", async () => {
    expect(await verify()).toEqual({ status: "verified" });
    const [get] = google.requestsTo(`/drive/v3/files/${destination.fileIds.VIDEO}`);
    expect(get?.query.get("fields")).toBe("id,size,md5Checksum,sha256Checksum,trashed");
  });

  it("falls back to MD5 when Drive gives no SHA-256", async () => {
    google.checksums = "md5";

    expect(await verify()).toEqual({ status: "verified" });
  });

  it("asks to check again later when Drive gives no checksum yet, rather than trusting the size", async () => {
    google.checksums = "none";

    await expect(verify()).rejects.toMatchObject({ code: "DRIVE_CHECKSUM_PENDING", kind: "TRANSIENT" });
  });

  it("finds a change of content that keeps the same size", async () => {
    const changed = Buffer.from(content);
    changed[100] = (changed[100] ?? 0) ^ 0xff;
    fs.writeFileSync(file.localPath, changed);

    expect(await verify()).toMatchObject({ status: "mismatch" });
    google.checksums = "md5";
    expect(await verify()).toMatchObject({ status: "mismatch" });
  });

  it("finds a different size, a trashed file and a missing one", async () => {
    fs.appendFileSync(file.localPath, "x");
    expect(await verify()).toMatchObject({ status: "mismatch", reason: expect.stringContaining("Kích thước") });
    fs.writeFileSync(file.localPath, content);

    const object = google.objects.get(destination.fileIds.VIDEO);
    if (object) object.trashed = true;
    expect(await verify()).toMatchObject({ status: "mismatch" });

    google.objects.delete(destination.fileIds.VIDEO);
    expect(await verify()).toEqual({ status: "missing" });
  });
});
