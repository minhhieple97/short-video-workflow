import { Download } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArchiveCell } from "@/features/archive/components/archive-cell";
import type { ArchiveDto } from "@/features/archive/schemas/archive.dto";
import { formatBytes, formatDateTime } from "@/lib/format";

import type { RenderDto } from "../../schemas/video.dto";

const STATUS_LABELS: Record<RenderDto["status"], string> = {
  QUEUED: "Đang chờ",
  RENDERING: "Đang render",
  COMPLETED: "Hoàn tất",
  FAILED: "Lỗi",
  CANCELLED: "Đã huỷ",
};

const STATUS_VARIANT: Record<RenderDto["status"], "amber" | "violet" | "mint" | "rose" | "slate"> = {
  QUEUED: "amber",
  RENDERING: "violet",
  COMPLETED: "mint",
  FAILED: "rose",
  CANCELLED: "slate",
};

interface RenderHistoryProps {
  renders: readonly RenderDto[];
  archives: Readonly<Record<string, ArchiveDto>>;
  driveConnected: boolean;
}

export function RenderHistory({ renders, archives, driveConnected }: Readonly<RenderHistoryProps>) {
  if (renders.length === 0)
    return <EmptyState title="Chưa có bản render" description="Render nháp để kiểm tra, rồi render bản cuối." />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Bản</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="text-right">Thời lượng</TableHead>
          <TableHead className="text-right">Dung lượng</TableHead>
          <TableHead>Tạo lúc</TableHead>
          <TableHead>Google Drive</TableHead>
          <TableHead className="text-right">Tải về</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {renders.map((render) => (
          <TableRow key={render.id}>
            <TableCell>
              <div className="font-medium">
                {render.quality === "FINAL" ? "Bản cuối" : "Nháp"} {render.width}×{render.height}
              </div>
              <div className="text-muted-foreground text-xs">Kịch bản v{render.scriptVersion}</div>
            </TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex flex-wrap gap-1">
                <Badge variant={STATUS_VARIANT[render.status]}>{STATUS_LABELS[render.status]}</Badge>
                {render.outdated ? <Badge variant="amber">Lỗi thời</Badge> : null}
              </div>
              {render.errorMessage ? (
                <p className="text-xs text-red-600 dark:text-red-400">{render.errorMessage}</p>
              ) : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {render.durationMs ? `${(render.durationMs / 1000).toFixed(1)}s` : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {render.sizeBytes ? formatBytes(render.sizeBytes) : "—"}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">{formatDateTime(render.createdAt)}</TableCell>
            <TableCell className="whitespace-normal">
              <ArchiveCell
                renderId={render.id}
                archive={archives[render.id] ?? null}
                archivable={render.quality === "FINAL" && render.status === "COMPLETED"}
                driveConnected={driveConnected}
              />
            </TableCell>
            <TableCell className="text-right">
              {render.downloadUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={render.downloadUrl}>
                    <Download aria-hidden />
                    MP4
                  </a>
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
