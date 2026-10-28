import Link from "next/link";

import { cn } from "@/lib/utils";

import type { VideoSummary } from "../schemas/video.dto";
import { VideoStatusBadge } from "./video-status-badge";

// Poster colors for the 9:16 thumbnails, picked from the video id so a video keeps its color. They are fixed hexes,
// not theme tokens: a poster stands for the rendered video, which looks the same in light and dark.
const POSTERS = [
  { surface: "bg-brand text-ink", chip: "bg-ink text-white", shadow: "shadow-[0_10px_24px_rgb(255_122_69/0.28)]" },
  {
    surface: "bg-[#5b3fd9] text-white",
    chip: "bg-white text-[#4b32b8]",
    shadow: "shadow-[0_10px_24px_rgb(91_63_217/0.28)]",
  },
  { surface: "bg-[#12a37a] text-ink", chip: "bg-ink text-white", shadow: "shadow-[0_10px_24px_rgb(18_163_122/0.28)]" },
  {
    surface: "bg-[#e5446d] text-white",
    chip: "bg-white text-[#a31844]",
    shadow: "shadow-[0_10px_24px_rgb(229_68_109/0.28)]",
  },
  {
    surface: "bg-[#5b7bff] text-white",
    chip: "bg-white text-[#2d43b3]",
    shadow: "shadow-[0_10px_24px_rgb(91_123_255/0.28)]",
  },
] as const;

function posterFor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return POSTERS[hash % POSTERS.length] ?? POSTERS[0];
}

function clock(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function VideoCard({ video }: Readonly<{ video: VideoSummary }>) {
  const poster = posterFor(video.id);

  return (
    <Link
      href={`/videos/${video.id}`}
      className="group focus-visible:ring-ring/50 flex flex-col gap-3 rounded-2xl outline-none focus-visible:ring-3"
    >
      {video.hookText ? (
        <div
          className={cn(
            "flex aspect-[9/16] flex-col justify-between rounded-3xl p-4 transition-transform group-hover:-translate-y-0.5",
            poster.surface,
            poster.shadow,
          )}
        >
          <span className={cn("w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold", poster.chip)}>HOOK</span>
          <p className="line-clamp-6 text-lg leading-tight font-extrabold break-words">{video.hookText}</p>
          <span className="w-fit rounded-lg bg-black/15 px-2 py-0.5 text-xs font-bold tabular-nums">
            {clock(video.targetDurationSec)}
          </span>
        </div>
      ) : (
        <div className="border-border bg-muted/60 text-muted-foreground flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-3xl border border-dashed p-4 text-center text-sm">
          <span className="font-semibold">Chưa có kịch bản</span>
          <span className="text-xs">Mở video để tạo hook và các cảnh.</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="line-clamp-2 leading-snug font-bold group-hover:underline">{video.title}</p>
        <div className="flex flex-wrap items-center gap-2">
          <VideoStatusBadge status={video.status} />
          <span className="text-muted-foreground text-xs">Short {video.targetDurationSec}s</span>
        </div>
      </div>
    </Link>
  );
}
