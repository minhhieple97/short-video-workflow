// WAITING is an archive parked on purpose (quota pacing, a retry pause); it is neither running nor failed.
export const ARCHIVE_STATUSES = ["PENDING", "RUNNING", "WAITING", "COMPLETED", "FAILED"] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export const UNFINISHED_ARCHIVE_STATUSES = [
  "PENDING",
  "RUNNING",
  "WAITING",
] as const satisfies readonly ArchiveStatus[];
