import { Badge } from "@/components/ui/badge";

import { LESSON_ORIGIN_LABELS, LESSON_STATUS_LABELS, type LessonStatus } from "../domain/lesson-fields";

const STATUS_VARIANTS: Record<LessonStatus, "default" | "secondary" | "outline"> = {
  DRAFT: "secondary",
  APPROVED: "default",
  ARCHIVED: "outline",
};

export function LessonStatusBadge({ status }: Readonly<{ status: LessonStatus }>) {
  return <Badge variant={STATUS_VARIANTS[status]}>{LESSON_STATUS_LABELS[status]}</Badge>;
}

export function LessonOriginBadge({ origin }: Readonly<{ origin: "AI" | "MANUAL" }>) {
  return <Badge variant="outline">{LESSON_ORIGIN_LABELS[origin]}</Badge>;
}
