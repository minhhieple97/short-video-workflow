import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";

import { ARCHIVE_STATUS_LABELS, toArchiveStatus } from "../domain/archive-labels";
import type { VideoDriveDto } from "../schemas/archive.dto";

// One line on whether a video is on Google Drive, for a list row or a page header: the state of its newest finished FINAL
// render and, once the MP4 is there, the link to it. Everything else (copying the link, the folder, retrying) is on the
// video's Render page, which every state that needs an action points to.
export function VideoDriveStatus({ videoId, drive }: Readonly<{ videoId: string; drive: VideoDriveDto | undefined }>) {
  const renderPage = `/videos/${videoId}/render`;
  if (!drive) {
    return (
      <Link href={renderPage} className="text-muted-foreground text-xs hover:underline">
        Chưa render bản cuối
      </Link>
    );
  }
  if (!drive.archive) {
    return (
      <Link href={renderPage} title="Mở trang Render để lưu lên Drive">
        <Badge variant="amber">Chưa lưu Drive</Badge>
      </Link>
    );
  }

  const status = ARCHIVE_STATUS_LABELS[toArchiveStatus(drive.archive.status)];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={status.tone}>{status.label}</Badge>
      {drive.outdated ? (
        <Badge variant="outline" title="Kịch bản đã đổi sau bản render này, nên bản trên Drive là bản cũ.">
          Bản cũ
        </Badge>
      ) : null}
      {drive.archive.videoUrl ? (
        <a
          href={drive.archive.videoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Mở video
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
