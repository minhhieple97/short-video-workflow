"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import { sendJson } from "@/lib/api-client";

import type { ShortVideoProps } from "../../domain/composition-props";
import type { PlatformPreviewMode } from "../../domain/safe-zones";

const PhonePlayer = dynamic(() => import("./phone-player").then((module) => module.PhonePlayer), {
  ssr: false,
  loading: () => <Skeleton className="h-[700px] w-[420px] rounded-3xl" />,
});

interface VideoPreviewProps {
  videoId: string;
  props: ShortVideoProps | null;
  initialMode: PlatformPreviewMode;
}

export function VideoPreview({ videoId, props, initialMode }: Readonly<VideoPreviewProps>) {
  if (!props) {
    return <p className="text-muted-foreground text-sm">Tạo kịch bản để xem trước video 9:16.</p>;
  }
  return (
    <PhonePlayer
      props={props}
      initialMode={initialMode}
      onModeChange={(mode) =>
        void sendJson(`/api/videos/${videoId}/preview-mode`, "PUT", { platformPreviewMode: mode }).catch(
          () => undefined,
        )
      }
    />
  );
}
