import { CloudUpload, Loader2 } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ARCHIVE_STATUS_LABELS, toArchiveStatus } from "../domain/archive-labels";
import type { ArchiveDto } from "../schemas/archive.dto";
import { ArchiveRenderButton } from "./archive-render-button";
import { DriveLinks } from "./drive-links";

interface DriveCardProps {
  // The newest finished render, draft or final: the one playing above the card, which is, or should be, on Drive. Null before there is one.
  render: { id: string; label: string; outdated: boolean } | null;
  archive: ArchiveDto | null;
  driveConnected: boolean;
}

function ConnectDriveHint() {
  return (
    <p className="text-muted-foreground">
      <Link href="/settings" className="text-foreground font-medium underline underline-offset-4">
        Kết nối Google Drive trong Cài đặt
      </Link>{" "}
      để bản nháp và bản cuối được lưu tự động.
    </p>
  );
}

function DriveCardBody({ render, archive, driveConnected }: Readonly<DriveCardProps>) {
  if (!render) {
    return (
      <>
        <p className="text-muted-foreground">
          Bản nháp và bản cuối tự được lưu lên Google Drive sau khi render xong, và link video hiện ở đây. Chưa có bản
          render nào hoàn tất.
        </p>
        {driveConnected ? null : <ConnectDriveHint />}
      </>
    );
  }
  if (!archive) {
    return driveConnected ? (
      <>
        <p>Bản render này chưa được lưu lên Drive.</p>
        <div>
          <ArchiveRenderButton renderId={render.id} retry={false} />
        </div>
      </>
    ) : (
      <>
        <p>Bản render này chưa được lưu lên Drive vì chưa kết nối Google Drive.</p>
        <ConnectDriveHint />
      </>
    );
  }

  const status = ARCHIVE_STATUS_LABELS[toArchiveStatus(archive.status)];
  const inProgress = archive.status !== "COMPLETED" && archive.status !== "FAILED";
  const verified = archive.files.filter((file) => file.status === "VERIFIED").length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.tone}>
          {inProgress ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {status.label}
        </Badge>
        <span className="text-muted-foreground text-xs">{render.label}</span>
        {inProgress ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {verified}/{archive.files.length} tệp đã xác minh
          </span>
        ) : null}
      </div>
      {archive.errorMessage ? (
        <p className={archive.status === "FAILED" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
          {archive.errorMessage}
        </p>
      ) : null}
      <DriveLinks archive={archive} />
      {archive.status === "FAILED" && driveConnected ? (
        <div>
          <ArchiveRenderButton renderId={render.id} retry />
        </div>
      ) : null}
      {render.outdated ? (
        <p className="text-muted-foreground text-xs">
          Bản trên Drive được render từ kịch bản cũ. Render lại để Drive có bản cập nhật.
        </p>
      ) : null}
    </>
  );
}

// Answers, right under the video just watched: is it on Google Drive yet, and where. The history table below keeps the
// state of every render; this card is the one place for the newest one.
export function DriveCard(props: Readonly<DriveCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudUpload className="size-4" aria-hidden />
          Google Drive
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <DriveCardBody {...props} />
      </CardContent>
    </Card>
  );
}
