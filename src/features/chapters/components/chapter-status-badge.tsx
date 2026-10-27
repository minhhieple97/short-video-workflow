import { Badge } from "@/components/ui/badge";

import { CHAPTER_ANALYSIS_STATUS_LABELS, type ChapterAnalysisStatus } from "../domain/analysis-status";

const VARIANTS: Record<ChapterAnalysisStatus, "default" | "secondary" | "destructive" | "outline"> = {
  NOT_ANALYZED: "outline",
  QUEUED: "secondary",
  ANALYZING: "secondary",
  WAITING_FOR_CLI: "secondary",
  ANALYZED: "default",
  FAILED: "destructive",
};

export function ChapterStatusBadge({ status }: Readonly<{ status: ChapterAnalysisStatus }>) {
  return <Badge variant={VARIANTS[status]}>{CHAPTER_ANALYSIS_STATUS_LABELS[status]}</Badge>;
}
