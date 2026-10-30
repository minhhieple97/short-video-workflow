import { runChapterAnalysis } from "@/features/chapters/services/chapter-analysis.service";
import {
  notebookAnalysisSettingsFor,
  runNotebookChapterAnalysis,
} from "@/features/chapters/services/notebook-chapter-analysis.service";
import { analyzeChapterPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { withProviderCooldown } from "@/features/jobs/services/provider-cooldown.service";

import type { JobProcessor } from "./types";

export const processAnalyzeChapter: JobProcessor = async ({ job, jobRecordId, signal, reportProgress }) => {
  const payload = analyzeChapterPayloadSchema.parse(job.data);
  const notebook = await notebookAnalysisSettingsFor(payload.chapterId);
  if (notebook) {
    return withProviderCooldown(
      "notebooklm",
      () =>
        runNotebookChapterAnalysis({
          chapterId: payload.chapterId,
          jobRecordId,
          force: payload.force,
          settings: notebook,
          signal,
          onProgress: reportProgress,
        }),
      { isSuccessful: (result) => !result.skipped },
    );
  }
  return runChapterAnalysis({
    chapterId: payload.chapterId,
    jobRecordId,
    force: payload.force,
    resume: { jobType: "ANALYZE_CHAPTER", payload: { chapterId: payload.chapterId, force: payload.force } },
    signal,
    onProgress: reportProgress,
  });
};
