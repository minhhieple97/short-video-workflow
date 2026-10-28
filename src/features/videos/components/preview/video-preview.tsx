"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import { sendJson } from "@/lib/api-client";

import type { ShortVideoProps } from "../../domain/composition-props";
import type { PlatformPreviewMode } from "../../domain/safe-zones";

const PhonePlayer = dynamic(() => import("./phone-player").then((module) => module.PhonePlayer), {
  ssr: false,
  loading: () => <Skeleton className="h-[700px] w-[min(26.5rem,100%)] rounded-3xl" />,
});

interface VideoPreviewProps {
  videoId: string;
  props: ShortVideoProps | null;
  initialMode: PlatformPreviewMode;
}

export function VideoPreview({ videoId, props, initialMode }: Readonly<VideoPreviewProps>) {
  if (!props) {
    return (
      <p className="bg-tone-violet text-muted-foreground w-full rounded-3xl p-6 text-center text-sm">
        Tạo kịch bản để xem trước video 9:16.
      </p>
    );
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
