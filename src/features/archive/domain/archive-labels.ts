import type { ArchiveStatus } from "./archive-status";

export const ARCHIVE_STATUS_LABELS: Record<
  ArchiveStatus,
  { label: string; tone: "slate" | "violet" | "amber" | "mint" | "rose" }
> = {
  PENDING: { label: "Chờ lưu Drive", tone: "slate" },
  RUNNING: { label: "Đang lưu Drive", tone: "violet" },
  WAITING: { label: "Đang chờ lưu Drive", tone: "amber" },
  COMPLETED: { label: "Đã lưu Drive", tone: "mint" },
  FAILED: { label: "Lưu Drive lỗi", tone: "rose" },
};

export function toArchiveStatus(value: string): ArchiveStatus {
  return (
    (["PENDING", "RUNNING", "WAITING", "COMPLETED", "FAILED"] as const).find((status) => status === value) ?? "FAILED"
  );
}

// The Drive folder is linked only once every file in it was verified; before that the link could show a partial archive.
export function archiveFolderUrl(status: string, remoteFolderId: string | null): string | null {
  return status === "COMPLETED" && remoteFolderId
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(remoteFolderId)}`
    : null;
}

// The MP4 itself is linked as soon as that one file is verified: it is whole even while the other files of the archive
// are still going up. A file's ID is allocated before its upload starts, so the ID alone proves nothing.
export function archiveVideoUrl(file: { status: string; remoteFileId: string | null } | undefined): string | null {
  return file?.status === "VERIFIED" && file.remoteFileId
    ? `https://drive.google.com/file/d/${encodeURIComponent(file.remoteFileId)}/view`
    : null;
}
