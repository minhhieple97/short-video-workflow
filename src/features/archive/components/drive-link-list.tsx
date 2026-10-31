import type { BookDriveLinksDto } from "../schemas/archive.dto";
import { formatDriveLinkLines } from "../domain/drive-link-lines";
import { CopyButton } from "./copy-button";
import { VideoDriveStatus } from "./video-drive-status";

// The videos of a book with where each is on Drive, and one button that copies every link there is, with its title.
export function DriveLinkList({ videos }: Readonly<{ videos: BookDriveLinksDto["videos"] }>) {
  const linked = videos.filter((video) => video.drive?.archive?.videoUrl);
  if (videos.length === 0) return <p className="text-muted-foreground text-sm">Sách này chưa có video nào.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm" role="status">
          {linked.length}/{videos.length} video đã có link Drive
        </p>
        {linked.length > 0 ? (
          <CopyButton
            text={formatDriveLinkLines(
              videos.map((video) => ({ title: video.title, videoUrl: video.drive?.archive?.videoUrl ?? null })),
            )}
            label={`Sao chép ${linked.length} link`}
            successMessage={`Đã sao chép ${linked.length} link Drive (mỗi dòng: tiêu đề, tab, link).`}
          />
        ) : null}
      </div>
      <ol className="border-border flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg border p-3 text-sm">
        {videos.map((video, index) => (
          <li key={video.id} className="flex items-start gap-2">
            <span className="text-muted-foreground w-7 shrink-0 text-right tabular-nums">{index + 1}.</span>
            {/* On a phone the status goes under the title: beside it, it leaves the title a few letters. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
              <span title={video.title} className="line-clamp-2 min-w-0 flex-1 wrap-break-word">
                {video.title}
              </span>
              <div className="sm:shrink-0">
                <VideoDriveStatus videoId={video.id} drive={video.drive} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
