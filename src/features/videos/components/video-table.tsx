import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

import { formatPreset, formatRange } from "../domain/duration";
import type { VideoSummary } from "../schemas/video.dto";
import { VideoStatusBadge } from "./video-status-badge";

interface VideoTableProps {
  videos: readonly VideoSummary[];
  showBook?: boolean;
  emptyHint: string;
}

export function VideoTable({ videos, showBook = false, emptyHint }: Readonly<VideoTableProps>) {
  if (videos.length === 0) return <EmptyState title="Chưa có video" description={emptyHint} />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Video</TableHead>
          {showBook ? <TableHead>Sách</TableHead> : null}
          <TableHead>Trạng thái</TableHead>
          <TableHead className="text-right">Thời lượng</TableHead>
          <TableHead className="text-right">Cảnh</TableHead>
          <TableHead>Cập nhật</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {videos.map((video) => (
          <TableRow key={video.id}>
            <TableCell className="max-w-sm whitespace-normal">
              <Link href={`/videos/${video.id}`} className="font-medium hover:underline">
                {video.title}
              </Link>
              <p className="text-muted-foreground text-xs">{video.lessonCount} bài học</p>
            </TableCell>
            {showBook ? (
              <TableCell className="max-w-xs whitespace-normal">
                <Link href={`/books/${video.book.id}`} className="text-sm hover:underline">
                  {video.book.title}
                </Link>
              </TableCell>
            ) : null}
            <TableCell>
              <VideoStatusBadge status={video.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {video.durationProposed ? formatPreset(video.targetDurationSec) : formatRange(video)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{video.sceneCount}</TableCell>
            <TableCell className="text-muted-foreground text-xs">{formatDateTime(video.updatedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
