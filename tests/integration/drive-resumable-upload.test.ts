import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DriveResumableUpload, UPLOAD_CHUNK_UNIT } from "@/server/archive/google-drive/drive-resumable-upload";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";
import type {
  ArchiveFileSource,
  ArchiveUploadCheckpoint,
  ArchiveUploadRequest,
} from "@/server/archive/video-archive-provider";

import { FakeGoogleServer } from "../helpers/fake-google-server";

const CHUNK = UPLOAD_CHUNK_UNIT;
const SIZE = 3 * CHUNK + 1000;

let google: FakeGoogleServer;
let directory: string;
let content: Buffer;
let file: ArchiveFileSource;

const destination = { folderId: "folder-1", fileIds: { VIDEO: "file-v", SCRIPT: "file-s", MANIFEST: "file-m" } };
const uploader = () =>
  new DriveResumableUpload(
    new GoogleDriveClient({ getAccessToken: async () => "ya29.token", endpoints: google.endpoints }),
    { chunkBytes: CHUNK },
  );
const request = (checkpoint: ArchiveUploadCheckpoint | null = null): ArchiveUploadRequest => ({
  destination,
  file,
  checkpoint,
});
const chunkPuts = () =>
  google.requests.filter(
    (entry) => entry.method === "PUT" && !String(entry.headers["content-range"]).startsWith("bytes */"),
  );
const starts = () =>
  google.requests.filter((entry) => entry.method === "POST" && entry.path === "/upload/drive/v3/files");

beforeEach(async () => {
  google = new FakeGoogleServer();
  await google.start();
  google.objects.set("folder-1", {
    id: "folder-1",
    name: "render-1",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["root"],
  });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-upload-"));
  content = randomBytes(SIZE);
  const localPath = path.join(directory, "video.mp4");
  fs.writeFileSync(localPath, content);
  file = { kind: "VIDEO", localPath, remoteName: "video_s1_r_1080x1920.mp4", mimeType: "video/mp4", bytes: SIZE };
});

afterEach(async () => {
  await google.stop();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("DriveResumableUpload", () => {
  it("uploads the file in 256 KiB-multiple chunks into its reserved ID and reports what Google holds", async () => {
    const checkpoints: ArchiveUploadCheckpoint[] = [];

    const result = await uploader().upload(request(), {
      onCheckpoint: (checkpoint) => void checkpoints.push(checkpoint),
    });

    expect(result).toEqual({ bytes: SIZE });
    expect(google.objects.get("file-v")?.content?.equals(content)).toBe(true);
    expect(google.objects.get("file-v")).toMatchObject({
      name: file.remoteName,
      parents: ["folder-1"],
      mimeType: "video/mp4",
    });
    const [start] = starts();
    expect(start?.query.get("uploadType")).toBe("resumable");
    expect(start?.headers["x-upload-content-length"]).toBe(String(SIZE));
    expect(start?.headers["x-upload-content-type"]).toBe("video/mp4");
    expect(JSON.parse(start?.body ?? "{}")).toMatchObject({ id: "file-v", parents: ["folder-1"] });
    expect(chunkPuts().map((put) => put.headers["content-range"])).toEqual([
      `bytes 0-${CHUNK - 1}/${SIZE}`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/${SIZE}`,
      `bytes ${2 * CHUNK}-${3 * CHUNK - 1}/${SIZE}`,
      `bytes ${3 * CHUNK}-${SIZE - 1}/${SIZE}`,
    ]);
    expect(chunkPuts().every((put) => put.rawBody.byteLength <= CHUNK)).toBe(true);
    expect(checkpoints.map((checkpoint) => checkpoint.bytesSent)).toEqual([0, CHUNK, 2 * CHUNK, 3 * CHUNK]);
    expect(new Set(checkpoints.map((checkpoint) => checkpoint.token)).size).toBe(1);
    expect(google.requests.every((entry) => entry.headers.authorization === "Bearer ya29.token")).toBe(true);
  });

  it("resumes from a checkpoint where Google stands, without a new session or resending stored bytes", async () => {
    const controller = new AbortController();
    const checkpoints: ArchiveUploadCheckpoint[] = [];
    await expect(
      uploader().upload(request(), {
        signal: controller.signal,
        onCheckpoint: (checkpoint) => {
          checkpoints.push(checkpoint);
          if (checkpoint.bytesSent === 2 * CHUNK) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const sentBefore = chunkPuts().length;

    const result = await uploader().upload(request(checkpoints.at(-1) ?? null));

    expect(result).toEqual({ bytes: SIZE });
    expect(starts()).toHaveLength(1);
    const resumed = google.requests.slice(
      google.requests.findIndex((entry) => entry.headers["content-range"] === `bytes */${SIZE}`),
    );
    expect(resumed[0]?.headers["content-range"]).toBe(`bytes */${SIZE}`);
    expect(
      chunkPuts()
        .slice(sentBefore)
        .map((put) => put.headers["content-range"]),
    ).toEqual([`bytes ${2 * CHUNK}-${3 * CHUNK - 1}/${SIZE}`, `bytes ${3 * CHUNK}-${SIZE - 1}/${SIZE}`]);
    expect(google.objects.get("file-v")?.content?.equals(content)).toBe(true);
  });

  it("sends again whatever part of a chunk Google did not keep", async () => {
    google.keepOnlyOfNextChunk(1000);
    const checkpoints: number[] = [];

    await uploader().upload(request(), { onCheckpoint: (checkpoint) => void checkpoints.push(checkpoint.bytesSent) });

    expect(checkpoints.slice(0, 2)).toEqual([0, 1000]);
    expect(chunkPuts()[1]?.headers["content-range"]).toBe(`bytes 1000-${1000 + CHUNK - 1}/${SIZE}`);
    expect(google.objects.get("file-v")?.content?.equals(content)).toBe(true);
  });

  it("starts a new session into the same file ID when the old one expired", async () => {
    const checkpoints: ArchiveUploadCheckpoint[] = [];
    const controller = new AbortController();
    await uploader()
      .upload(request(), {
        signal: controller.signal,
        onCheckpoint: (checkpoint) => {
          checkpoints.push(checkpoint);
          if (checkpoint.bytesSent === CHUNK) controller.abort();
        },
      })
      .catch(() => undefined);
    google.uploadSessions.clear();

    const result = await uploader().upload(request(checkpoints.at(-1) ?? null));

    expect(result).toEqual({ bytes: SIZE });
    expect(starts()).toHaveLength(2);
    expect(starts().map((start) => (JSON.parse(start.body) as { id: string }).id)).toEqual(["file-v", "file-v"]);
    expect(google.objects.get("file-v")?.content?.equals(content)).toBe(true);
  });

  it("does not make a second file when a finished upload is replayed", async () => {
    await uploader().upload(request());

    const result = await uploader().upload(request());

    expect(result).toEqual({ bytes: SIZE });
    expect([...google.objects.keys()].filter((id) => id === "file-v")).toHaveLength(1);
    expect(chunkPuts()).toHaveLength(4);
  });

  it("treats only a 409 as an upload that already finished", async () => {
    google.failNext("startUpload", { kind: "status", status: 500 });

    await expect(uploader().upload(request())).rejects.toMatchObject({ kind: "UNKNOWN_OUTCOME" });
    expect(google.requests.some((entry) => entry.path === "/drive/v3/files/file-v")).toBe(false);
  });

  it("finishes at once when the checkpoint's session already completed", async () => {
    const checkpoints: ArchiveUploadCheckpoint[] = [];
    await uploader().upload(request(), { onCheckpoint: (checkpoint) => void checkpoints.push(checkpoint) });

    const result = await uploader().upload(request(checkpoints.at(-1) ?? null));

    expect(result).toEqual({ bytes: SIZE });
    expect(chunkPuts()).toHaveLength(4);
  });

  it("refuses a local file whose size changed, before talking to Google", async () => {
    fs.appendFileSync(file.localPath, "x");

    await expect(uploader().upload(request())).rejects.toMatchObject({
      code: "ARCHIVE_LOCAL_FILE_CHANGED",
      kind: "REJECTED",
    });
    expect(google.requests).toHaveLength(0);
  });

  it("sends nothing once cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(uploader().upload(request(), { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(google.requests).toHaveLength(0);
  });

  it("keeps the session URI out of errors", async () => {
    google.failNext("uploadChunk", { kind: "status", status: 500 });
    let token = "";

    const error = await uploader()
      .upload(request(), { onCheckpoint: (checkpoint) => void (token = checkpoint.token) })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: "UNKNOWN_OUTCOME" });
    expect(token).toContain("upload_id=");
    expect(JSON.stringify(error)).not.toContain("upload_id");
    expect((error as Error).message).not.toContain("upload_id");
  });

  it("stops instead of sending forever when Google keeps none of the data", async () => {
    // Every chunk is answered with "nothing stored".
    google.keepOnlyOfNextChunk(0);

    const result = uploader().upload(request(), { onCheckpoint: () => google.keepOnlyOfNextChunk(0) });

    await expect(result).rejects.toMatchObject({ code: "DRIVE_UPLOAD_STALLED", kind: "TRANSIENT" });
    expect(chunkPuts()).toHaveLength(3);
  });

  it("only accepts chunk sizes Google allows", () => {
    const drive = new GoogleDriveClient({ getAccessToken: async () => "t" });
    expect(() => new DriveResumableUpload(drive, { chunkBytes: 1000 })).toThrow(RangeError);
    expect(() => new DriveResumableUpload(drive, { chunkBytes: 0 })).toThrow(RangeError);
    expect(() => new DriveResumableUpload(drive, { chunkBytes: 2 * CHUNK })).not.toThrow();
  });
});
