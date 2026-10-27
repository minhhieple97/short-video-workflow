import { Badge } from "@/components/ui/badge";

import { LESSON_ORIGIN_LABELS, LESSON_STATUS_LABELS, type LessonStatus } from "../domain/lesson-fields";

const STATUS_VARIANTS: Record<LessonStatus, "amber" | "mint" | "slate"> = {
  DRAFT: "amber",
  APPROVED: "mint",
  ARCHIVED: "slate",
};

export function LessonStatusBadge({ status }: Readonly<{ status: LessonStatus }>) {
  return <Badge variant={STATUS_VARIANTS[status]}>{LESSON_STATUS_LABELS[status]}</Badge>;
}

export function LessonOriginBadge({ origin }: Readonly<{ origin: "AI" | "MANUAL" }>) {
  return <Badge variant={origin === "AI" ? "violet" : "slate"}>{LESSON_ORIGIN_LABELS[origin]}</Badge>;
}
