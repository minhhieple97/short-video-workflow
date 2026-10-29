import { diagnosticPingPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { checkNotebookLm } from "@/features/notebooklm/services/notebooklm-status.service";
import {
  NOTEBOOKLM_NOT_CONFIGURED_MESSAGE,
  notebookStudioSettings,
} from "@/features/notebooklm/services/notebook-studio.service";
import type { AiProvider } from "@/server/ai/ai-provider";
import { chapterAnalysisOutputSchema } from "@/server/ai/contracts/chapter-analysis";
import { videoScriptOutputSchema } from "@/server/ai/contracts/video-script";
import { MockAiProvider } from "@/server/ai/mock-ai-provider";
import { CHAPTER_ANALYSIS_PROMPT_VERSION } from "@/server/ai/prompts/chapter-analysis-prompt";
import { VIDEO_SCRIPT_PROMPT_VERSION } from "@/server/ai/prompts/video-script-prompt";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { AppError } from "@/shared/errors";

import type { JobProcessor } from "./types";

const SAMPLE_CHAPTER =
  "Môi trường xung quanh ảnh hưởng đến hành vi nhiều hơn ý chí. Đặt sẵn chai nước trên bàn giúp bạn nhớ uống nước.\n\nMột thói quen nhỏ lặp lại mỗi ngày sẽ tạo ra khác biệt lớn sau vài tháng.";

// Exercises the whole mock AI contract (analysis + script) inside the worker without touching any book data.
async function runMockAiCheck(taskId: string) {
  const provider: AiProvider = new MockAiProvider();
  const analysis = await provider.analyzeChapter(
    {
      bookTitle: "Kiểm tra",
      chapterId: "diagnostic",
      chapterTitle: "Chương kiểm tra",
      chapterContent: SAMPLE_CHAPTER,
      promptVersion: CHAPTER_ANALYSIS_PROMPT_VERSION,
    },
    { taskId },
  );
  if (analysis.status !== "completed") throw new AppError("MOCK_AI_FAILED", "Mock AI không trả kết quả.");
  const lessons = chapterAnalysisOutputSchema.parse(analysis.output).lessons;
  const [lesson] = lessons;
  if (!lesson) throw new AppError("MOCK_AI_FAILED", "Mock AI không tạo bài học nào.");

  const script = await provider.generateVideoScript(
    {
      videoId: "diagnostic",
      title: "Kiểm tra",
      minDurationSec: 30,
      maxDurationSec: 60,
      pace: "STANDARD",
      storyAngle: "PEAK_FIRST",
      videoProfile: "SHORT_VERTICAL",
      book: { title: "Kiểm tra", author: null },
      lessons: [
        { lessonId: "diagnostic", ...lesson, contentHash: null, sources: [], capturedAt: new Date().toISOString() },
      ],
      promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
    },
    { taskId },
  );
  if (script.status !== "completed") throw new AppError("MOCK_AI_FAILED", "Mock AI không trả kịch bản.");
  const output = videoScriptOutputSchema.parse(script.output);
  return { lessons: lessons.length, hookOptions: output.hookOptions.length, scenes: output.scenes.length };
}

async function runNotebookLmCheck(signal: AbortSignal) {
  const settings = notebookStudioSettings();
  if (!settings) throw new AppError("NOTEBOOKLM_NOT_CONFIGURED", NOTEBOOKLM_NOT_CONFIGURED_MESSAGE, 409);
  const status = await checkNotebookLm(settings, signal);
  if (status.state !== "OK") throw new AppError(`NOTEBOOKLM_${status.state}`, status.message ?? "NotebookLM lỗi.", 502);
  return { state: status.state, tier: status.tier, windows: status.windows.length };
}

export const processDiagnosticPing: JobProcessor = async ({ job, jobRecordId, reportProgress, signal }) => {
  const payload = diagnosticPingPayloadSchema.parse(job.data);
  await reportProgress(50);

  const mockAi = payload.kind === "mock-ai" ? await runMockAiCheck(jobRecordId) : null;
  const notebookLm = payload.kind === "notebooklm" ? await runNotebookLmCheck(signal) : null;
  const result = {
    kind: payload.kind,
    message: payload.message,
    jobId: job.id,
    workerPid: process.pid,
    processedAt: new Date().toISOString(),
    mockAi,
    notebookLm,
  };
  await writeFileAtomic(dataPath("diagnostics", `last-${payload.kind}.json`), `${JSON.stringify(result, null, 2)}\n`);

  await reportProgress(100);
  return result;
};
