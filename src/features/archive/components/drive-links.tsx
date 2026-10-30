import { ExternalLink, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { ArchiveDto } from "../schemas/archive.dto";
import { CopyLinkButton } from "./copy-link-button";

// The ways into a render's copy on Drive: the video itself (open or copy the link) and the folder that holds it with the
// script and the post text. Shows only the links that are ready.
export function DriveLinks({ archive }: Readonly<{ archive: Pick<ArchiveDto, "videoUrl" | "folderUrl"> }>) {
  if (!archive.videoUrl && !archive.folderUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {archive.videoUrl ? (
        <>
          <Button asChild size="sm">
            <a href={archive.videoUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              Mở video trên Drive
            </a>
          </Button>
          <CopyLinkButton url={archive.videoUrl} />
        </>
      ) : null}
      {archive.folderUrl ? (
        <Button asChild size="sm" variant="outline">
          <a href={archive.folderUrl} target="_blank" rel="noreferrer">
            <FolderOpen aria-hidden />
            Mở thư mục Drive
          </a>
        </Button>
      ) : null}
    </div>
  );
}
