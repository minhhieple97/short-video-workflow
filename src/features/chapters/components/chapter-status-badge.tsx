import { Clock, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { CHAPTER_ANALYSIS_STATUS_LABELS, type ChapterAnalysisStatus } from "../domain/analysis-status";

const VARIANTS: Record<ChapterAnalysisStatus, "slate" | "amber" | "violet" | "blue" | "mint" | "rose"> = {
  NOT_ANALYZED: "slate",
  QUEUED: "amber",
  ANALYZING: "violet",
  WAITING_FOR_CLI: "blue",
  ANALYZED: "mint",
  PARTIAL: "amber",
  FAILED: "rose",
};

export function ChapterStatusBadge({ status }: Readonly<{ status: ChapterAnalysisStatus }>) {
  return (
    <Badge variant={VARIANTS[status]}>
      {status === "ANALYZING" ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {status === "QUEUED" ? <Clock aria-hidden /> : null}
      {CHAPTER_ANALYSIS_STATUS_LABELS[status]}
    </Badge>
  );
}
