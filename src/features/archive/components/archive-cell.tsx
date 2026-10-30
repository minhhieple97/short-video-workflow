import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";

import { ARCHIVE_STATUS_LABELS, toArchiveStatus } from "../domain/archive-labels";
import type { ArchiveDto } from "../schemas/archive.dto";
import { ArchiveRenderButton } from "./archive-render-button";

interface ArchiveCellProps {
  renderId: string;
  archive: ArchiveDto | null;
  // Only finished FINAL renders are archived.
  archivable: boolean;
  driveConnected: boolean;
}

// Where a render stands on Google Drive, kept apart from its local MP4: the local file is the original either way.
export function ArchiveCell({ renderId, archive, archivable, driveConnected }: Readonly<ArchiveCellProps>) {
  if (!archivable) return <span className="text-muted-foreground text-xs">Chỉ lưu bản cuối</span>;
  if (!archive) {
    return driveConnected ? (
      <ArchiveRenderButton renderId={renderId} retry={false} />
    ) : (
      <Link href="/settings" className="text-muted-foreground text-xs hover:underline">
        Kết nối Google Drive để lưu
      </Link>
    );
  }
  const status = ARCHIVE_STATUS_LABELS[toArchiveStatus(archive.status)];
  const verified = archive.files.filter((file) => file.status === "VERIFIED").length;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={status.tone}>{status.label}</Badge>
        {archive.status !== "COMPLETED" ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {verified}/{archive.files.length} tệp đã xác minh
          </span>
        ) : null}
      </div>
      {archive.errorMessage ? (
        <p
          className={
            archive.status === "FAILED" ? "text-xs text-red-600 dark:text-red-400" : "text-muted-foreground text-xs"
          }
        >
          {archive.errorMessage}
        </p>
      ) : null}
      {archive.videoUrl ? (
        <a
          href={archive.videoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Mở video trên Drive
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
      {archive.folderUrl ? (
        <a
          href={archive.folderUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Mở thư mục Drive
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
      {archive.status === "FAILED" && driveConnected ? <ArchiveRenderButton renderId={renderId} retry /> : null}
    </div>
  );
}
