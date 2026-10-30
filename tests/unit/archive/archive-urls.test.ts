import { describe, expect, it } from "vitest";

import { archiveFolderUrl, archiveVideoUrl } from "@/features/archive/domain/archive-labels";

describe("archiveVideoUrl", () => {
  it("links the MP4 once that file is verified, even while the archive goes on", () => {
    expect(archiveVideoUrl({ status: "VERIFIED", remoteFileId: "file-1" })).toBe(
      "https://drive.google.com/file/d/file-1/view",
    );
  });

  it("does not link a file that is only named: its ID exists before its upload starts", () => {
    for (const status of ["PENDING", "UPLOADING", "UPLOADED"]) {
      expect(archiveVideoUrl({ status, remoteFileId: "file-1" })).toBeNull();
    }
  });

  it("has no link without an ID or without the file", () => {
    expect(archiveVideoUrl({ status: "VERIFIED", remoteFileId: null })).toBeNull();
    expect(archiveVideoUrl(undefined)).toBeNull();
  });

  it("keeps an unusual ID inside the address", () => {
    expect(archiveVideoUrl({ status: "VERIFIED", remoteFileId: "a/b c" })).toBe(
      "https://drive.google.com/file/d/a%2Fb%20c/view",
    );
  });
});

describe("archiveFolderUrl", () => {
  it("links the folder only when the whole archive is verified", () => {
    expect(archiveFolderUrl("COMPLETED", "folder-1")).toBe("https://drive.google.com/drive/folders/folder-1");
    expect(archiveFolderUrl("RUNNING", "folder-1")).toBeNull();
    expect(archiveFolderUrl("COMPLETED", null)).toBeNull();
  });
});
