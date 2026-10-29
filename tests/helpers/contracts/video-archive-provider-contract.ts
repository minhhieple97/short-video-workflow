import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ARCHIVE_FILE_KINDS,
  type ArchiveFileSource,
  type VideoArchiveProvider,
} from "@/server/archive/video-archive-provider";

export interface ArchiveContractHarness {
  provider: VideoArchiveProvider;
  remoteObjectCount(): number;
}

const REQUEST = { bookId: "book-1", videoId: "video-1", renderId: "render-1" };

export function describeVideoArchiveProviderContract(name: string, createHarness: () => ArchiveContractHarness): void {
  describe(`VideoArchiveProvider contract: ${name}`, () => {
    let directory: string;

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-archive-contract-"));
    });

    afterEach(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    function localFile(content: string): ArchiveFileSource {
      const localPath = path.join(directory, "script.json");
      fs.writeFileSync(localPath, content);
      return {
        kind: "SCRIPT",
        localPath,
        remoteName: "script.json",
        mimeType: "application/json",
        bytes: Buffer.byteLength(content),
      };
    }

    it("allocates a folder and a distinct remote ID for every file kind before anything is uploaded", async () => {
      const { provider, remoteObjectCount } = createHarness();

      const destination = await provider.prepareDestination(REQUEST);

      expect(destination.folderId.length).toBeGreaterThan(0);
      const ids = ARCHIVE_FILE_KINDS.map((kind) => destination.fileIds[kind]);
      expect(ids.every((id) => (id ?? "").length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ARCHIVE_FILE_KINDS.length);
      expect(remoteObjectCount()).toBe(0);
    });

    it("reports a file as missing until it is uploaded, then verifies it", async () => {
      const { provider } = createHarness();
      const destination = await provider.prepareDestination(REQUEST);
      const file = localFile('{"scenes":[]}');

      expect(await provider.verify({ destination, file })).toEqual({ status: "missing" });

      const result = await provider.upload({ destination, file, checkpoint: null });

      expect(result.bytes).toBe(file.bytes);
      expect(await provider.verify({ destination, file })).toEqual({ status: "verified" });
    });

    it("does not create a second remote object when an upload is replayed", async () => {
      const { provider, remoteObjectCount } = createHarness();
      const destination = await provider.prepareDestination(REQUEST);
      const file = localFile('{"scenes":[]}');

      await provider.upload({ destination, file, checkpoint: null });
      await provider.upload({ destination, file, checkpoint: null });

      expect(remoteObjectCount()).toBe(1);
      expect(await provider.verify({ destination, file })).toEqual({ status: "verified" });
    });

    it("detects that the local file no longer matches what was uploaded", async () => {
      const { provider } = createHarness();
      const destination = await provider.prepareDestination(REQUEST);
      await provider.upload({ destination, file: localFile('{"scenes":[]}'), checkpoint: null });

      const changed = localFile('{"scenes":["đã sửa"]}');
      const verification = await provider.verify({ destination, file: changed });

      expect(verification.status).toBe("mismatch");
    });

    it("uploads nothing when the signal is already aborted", async () => {
      const { provider, remoteObjectCount } = createHarness();
      const destination = await provider.prepareDestination(REQUEST);
      const controller = new AbortController();
      controller.abort();

      await expect(
        provider.upload({ destination, file: localFile("{}"), checkpoint: null }, { signal: controller.signal }),
      ).rejects.toThrow();
      expect(remoteObjectCount()).toBe(0);
    });
  });
}
