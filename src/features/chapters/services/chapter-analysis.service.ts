import { createHash } from "node:crypto";

import { ZodError } from "zod";

import {
  completeAiRun,
  failAiRun,
  hasCompletedAiRun,
  markAiRunWaiting,
  startAiRun,
} from "@/features/jobs/repositories/ai-run.repository";
import { pickLessonText } from "@/features/lessons/domain/lesson-fields";
import { verifyExcerpts } from "@/features/lessons/domain/source-excerpts";
import { replaceChapterDraftLessons, type AnalysisDraft } from "@/features/lessons/repositories/lesson.repository";
import { lessonContentHash } from "@/features/lessons/services/lesson-hash";
import { createAiProvider } from "@/server/ai";
import type { AiProvider, AiTaskContext } from "@/server/ai/ai-provider";
import { chapterAnalysisOutputSchema } from "@/server/ai/contracts/chapter-analysis";
import { CHAPTER_ANALYSIS_PROMPT_VERSION } from "@/server/ai/prompts/chapter-analysis-prompt";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

import { findChapterWithBook, setChapterAnalysisStatus } from "../repositories/chapter.repository";
import { readChapterContent } from "./chapter.service";

export interface ChapterAnalysisRun {
  chapterId: string;
  jobRecordId: string | null;
  force: boolean;
  provider?: AiProvider;
  resume?: AiTaskContext["resume"];
  onProgress?: (progress: number) => Promise<void>;
}

export interface ChapterAnalysisResult {
  skipped: boolean;
  lessonsCreated: number;
  lessonsArchived: number;
  excerptsRejected: number;
}

export interface AnalysisWaitingForCli {
  waitingForCli: true;
  taskDir: string;
}

export function analysisInputHash(parts: {
  mode: string;
  contentHash: string;
  chapterTitle: string;
  bookTitle: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion: CHAPTER_ANALYSIS_PROMPT_VERSION, ...parts }))
    .digest("hex");
}

function toDrafts(lessons: readonly Parameters<typeof pickLessonText>[0][], excerpts: AnalysisDraft["sources"][]) {
  return lessons.map((lesson, index) => {
    const text = pickLessonText(lesson);
    return { text, contentHash: lessonContentHash(text), sources: excerpts[index] ?? [] };
  });
}

export async function runChapterAnalysis(
  run: ChapterAnalysisRun,
): Promise<ChapterAnalysisResult | AnalysisWaitingForCli> {
  const chapter = await findChapterWithBook(run.chapterId);
  if (!chapter) throw new NotFoundError("CHAPTER_NOT_FOUND", "Không tìm thấy chương.");

  const provider = run.provider ?? createAiProvider(getAppConfig().ai.mode);
  const inputHash = analysisInputHash({
    mode: provider.mode,
    contentHash: chapter.contentHash,
    chapterTitle: chapter.title,
    bookTitle: chapter.book.title,
  });

  const upToDate =
    chapter.analysisStatus === "ANALYZED" &&
    chapter.analysisPromptVersion === CHAPTER_ANALYSIS_PROMPT_VERSION &&
    (await hasCompletedAiRun(inputHash));
  if (upToDate && !run.force) {
    return { skipped: true, lessonsCreated: 0, lessonsArchived: 0, excerptsRejected: 0 };
  }

  await setChapterAnalysisStatus(chapter.id, "ANALYZING");
  const aiRun = await startAiRun({
    jobRecordId: run.jobRecordId,
    mode: provider.mode,
    promptVersion: CHAPTER_ANALYSIS_PROMPT_VERSION,
    inputHash,
  });

  try {
    const content = await readChapterContent(chapter);
    await run.onProgress?.(20);

    const taskId = run.jobRecordId ?? aiRun.id;
    const result = await provider.analyzeChapter(
      {
        bookTitle: chapter.book.title,
        author: chapter.book.author ?? undefined,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterContent: content,
        promptVersion: CHAPTER_ANALYSIS_PROMPT_VERSION,
      },
      { taskId, resume: run.resume },
    );
    if (result.status === "waiting_for_cli") {
      await markAiRunWaiting(aiRun.id);
      await setChapterAnalysisStatus(chapter.id, "WAITING_FOR_CLI");
      return { waitingForCli: true, taskDir: result.taskDir };
    }

    const output = chapterAnalysisOutputSchema.parse(result.output);
    if (output.chapterId !== chapter.id) {
      throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI không khớp với chương đang phân tích.", 422);
    }
    await run.onProgress?.(60);

    let excerptsRejected = 0;
    const sources = output.lessons.map((lesson) => {
      const { verified, rejected } = verifyExcerpts(lesson.sourceExcerpts, chapter.id, content);
      excerptsRejected += rejected;
      return verified.length > 0
        ? verified.map((excerpt) => ({
            chapterId: chapter.id,
            sourceExcerpt: excerpt.text,
            sourceLocator: `offset:${excerpt.offset}`,
            confidence: 1,
          }))
        : [{ chapterId: chapter.id, sourceExcerpt: null, sourceLocator: null, confidence: null }];
    });

    const outputPath = `ai-tasks/${taskId}/output.json`;
    await writeFileAtomic(dataPath(outputPath), `${JSON.stringify(output, null, 2)}\n`);

    const { created, archived } = await replaceChapterDraftLessons({
      bookId: chapter.bookId,
      chapterId: chapter.id,
      promptVersion: CHAPTER_ANALYSIS_PROMPT_VERSION,
      drafts: toDrafts(output.lessons, sources),
    });
    await completeAiRun(aiRun.id, outputPath);
    await setChapterAnalysisStatus(chapter.id, "ANALYZED", {
      analyzedAt: new Date(),
      analysisPromptVersion: CHAPTER_ANALYSIS_PROMPT_VERSION,
    });
    await run.onProgress?.(100);

    return { skipped: false, lessonsCreated: created.length, lessonsArchived: archived, excerptsRejected };
  } catch (error) {
    const failure =
      error instanceof ZodError
        ? new AppError(
            "INVALID_AI_OUTPUT",
            "Kết quả AI không đúng định dạng JSON yêu cầu; không lưu bài học nào.",
            422,
            {
              cause: error,
            },
          )
        : error;
    await failAiRun(aiRun.id, toSafeErrorMessage(failure));
    await setChapterAnalysisStatus(chapter.id, "FAILED");
    throw failure;
  }
}
