import { runChapterAnalysis } from "@/features/chapters/services/chapter-analysis.service";
import { analyzeChapterPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";

import type { JobProcessor } from "./types";

export const processAnalyzeChapter: JobProcessor = async ({ job, jobRecordId, reportProgress }) => {
  const payload = analyzeChapterPayloadSchema.parse(job.data);
  return runChapterAnalysis({
    chapterId: payload.chapterId,
    jobRecordId,
    force: payload.force,
    onProgress: reportProgress,
  });
};
