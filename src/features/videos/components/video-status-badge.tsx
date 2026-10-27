import { Badge } from "@/components/ui/badge";

import { VIDEO_STATUS_LABELS, type VideoStatus } from "../domain/video-status";

const VARIANTS: Record<VideoStatus, "slate" | "amber" | "mint"> = {
  DRAFT: "slate",
  NEEDS_REVIEW: "amber",
  APPROVED: "mint",
};

export function VideoStatusBadge({ status }: Readonly<{ status: VideoStatus }>) {
  return <Badge variant={VARIANTS[status]}>{VIDEO_STATUS_LABELS[status]}</Badge>;
}
