import { z } from "zod";

import { formatRange, isWithinRange } from "@/features/videos/domain/duration";
import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError } from "@/server/integrations/integration-error";
import { NotebookLmSession } from "@/server/script-studio/notebooklm/notebooklm-session";
import { buildChapterDetectionPrompt } from "@/server/script-studio/notebooklm/prompts/chapter-detection-prompt";
import { buildLessonExtractionPrompt } from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";
import {
  buildScriptDraftPrompt,
  SCRIPT_DRAFT_PROMPT_VERSION,
} from "@/server/script-studio/notebooklm/prompts/script-draft-prompt";
import {
  detectedChapterSchema,
  lessonExtractionSchema,
  proposedDurationSchema,
  scriptDraftBeatSchema,
  scriptDraftSchema,
  type DetectedChapter,
  type LessonExtraction,
  type ScriptDraft,
} from "@/server/script-studio/script-studio-contracts";
import type {
  DetectChaptersRequest,
  EnsureSourceRequest,
  ExtractLessonsRequest,
  ScriptStudioProvider,
  SourceRef,
  WriteDraftRequest,
} from "@/server/script-studio/script-studio-provider";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { recordNotebookLmFailure, recordNotebookLmUsage } from "./notebooklm-status.service";
import {
  askNotebookForJson,
  ensureNotebookDocument,
  notebookStudioSettings,
  openBookNotebook,
  type NotebookStudioSettings,
} from "./notebook-studio.service";

const logger = createLogger("notebooklm.studio");
const MAX_CHAPTERS = 500;
// A source reference names its notebook too, so a question can be asked without looking the book up again.
const REF_SEPARATOR = "#";

const draftAnswerSchema = proposedDurationSchema.extend({ beats: z.array(scriptDraftBeatSchema).min(1).max(12) });

function splitRefs(sources: readonly SourceRef[]): { notebookId: string; sourceIds: string[] } {
  const parsed = sources.map((source) => {
    const [notebookId, sourceId, ...rest] = source.remoteId.split(REF_SEPARATOR);
    return notebookId && sourceId && rest.length === 0 ? { notebookId, sourceId } : null;
  });
  const notebookIds = new Set(parsed.map((ref) => ref?.notebookId));
  const first = parsed[0];
  if (!first || parsed.some((ref) => ref === null) || notebookIds.size !== 1) {
    throw new IntegrationError(
      "NOTEBOOKLM_SOURCES_INVALID",
      "Các nguồn hỏi NotebookLM phải là nguồn của cùng một notebook do ứng dụng tạo.",
      "REJECTED",
    );
  }
  return { notebookId: first.notebookId, sourceIds: parsed.flatMap((ref) => (ref ? [ref.sourceId] : [])) };
}

// The script studio on NotebookLM: one MCP server process, opened on first use and kept for the run (close() ends it).
// Each book has one notebook; each source is uploaded once per revision of its text; every question names exactly the
// sources it is about, and its answer must be the JSON asked for.
export class NotebookLmScriptStudio implements ScriptStudioProvider {
  readonly id = "notebooklm";
  readonly draftVersion = SCRIPT_DRAFT_PROMPT_VERSION;
  private session: Promise<NotebookLmSession> | null = null;

  constructor(private readonly settings: NotebookStudioSettings) {}

  async ensureSource(request: EnsureSourceRequest, options?: CallOptions): Promise<SourceRef> {
    const signal = options?.signal;
    signal?.throwIfAborted();
    const caller = await this.open(signal);
    const notebook = await openBookNotebook(caller, this.settings.profile, request.book, signal);
    const sourceId = await ensureNotebookDocument(notebook, request.document, signal);
    return { key: request.document.key, remoteId: `${notebook.notebookId}${REF_SEPARATOR}${sourceId}` };
  }

  detectChapters(request: DetectChaptersRequest, options?: CallOptions): Promise<DetectedChapter[]> {
    return this.ask(
      request.sources,
      buildChapterDetectionPrompt({
        bookTitle: request.bookTitle,
        pageCount: request.pageCount,
        hints: request.outlineHints,
      }),
      "NOTEBOOKLM_CHAPTERS_INVALID",
      z.array(detectedChapterSchema).max(MAX_CHAPTERS),
      options,
    );
  }

  extractLessons(request: ExtractLessonsRequest, options?: CallOptions): Promise<LessonExtraction> {
    return this.ask(
      request.sources,
      buildLessonExtractionPrompt({
        bookTitle: request.bookTitle,
        chapterTitle: request.chapterTitle,
        partNumber: request.partNumber,
        partCount: request.partCount,
        pages: { first: request.startPage, last: request.endPage },
      }),
      "NOTEBOOKLM_LESSONS_INVALID",
      lessonExtractionSchema,
      options,
    );
  }

  // A draft out of story order (DRAFT_INVALID) or with a length outside the range (DRAFT_LENGTH_OUT_OF_RANGE) is refused;
  // the production pipeline's one correction can fix either.
  async writeDraft(request: WriteDraftRequest, options?: CallOptions): Promise<ScriptDraft> {
    const answer = await this.ask(
      request.sources,
      buildScriptDraftPrompt({ lesson: request.lesson, range: request.range, revisionNote: request.revisionNote }),
      "DRAFT_INVALID",
      draftAnswerSchema,
      options,
    );
    if (!isWithinRange(answer.targetDurationSec, request.range)) {
      throw new IntegrationError(
        "DRAFT_LENGTH_OUT_OF_RANGE",
        `Bản thảo đề xuất ${answer.targetDurationSec} giây, ngoài khoảng ${formatRange(request.range)}: chọn lại một độ dài trong khoảng.`,
        "REJECTED",
      );
    }
    const draft = scriptDraftSchema.safeParse({ lessonId: request.lesson.lessonId, ...answer });
    if (draft.success) return draft.data;
    throw new IntegrationError(
      "DRAFT_INVALID",
      `Bản thảo của NotebookLM không theo mạch kể bắt buộc: ${draft.error.issues[0]?.message ?? "sai cấu trúc"}.`,
      "REJECTED",
    );
  }

  // Reads the account's remaining allowance on the way out, so Settings shows what the last run left.
  async close(): Promise<void> {
    const session = this.session;
    this.session = null;
    const opened = session ? await session.catch(() => null) : null;
    if (!opened) return;
    try {
      await recordNotebookLmUsage(opened, this.settings.profile);
    } catch (error) {
      logger.warn("NotebookLM usage could not be read", { error: toSafeErrorMessage(error) });
    } finally {
      await opened.close();
    }
  }

  private async open(signal: AbortSignal | undefined): Promise<NotebookLmSession> {
    this.session ??= NotebookLmSession.open({ ...this.settings, signal });
    try {
      return await this.session;
    } catch (error) {
      this.session = null;
      if (!signal?.aborted) await recordNotebookLmFailure(this.settings.profile, error);
      throw error;
    }
  }

  private async ask<T>(
    sources: readonly SourceRef[],
    query: string,
    code: string,
    schema: z.ZodType<T>,
    options: CallOptions | undefined,
  ): Promise<T> {
    const signal = options?.signal;
    signal?.throwIfAborted();
    const { notebookId, sourceIds } = splitRefs(sources);
    const caller = await this.open(signal);
    return askNotebookForJson({ caller, notebookId }, { sourceIds, query, code }, schema, signal);
  }
}

export function createNotebookLmScriptStudio(
  settings: NotebookStudioSettings | null = notebookStudioSettings(),
): NotebookLmScriptStudio | null {
  return settings ? new NotebookLmScriptStudio(settings) : null;
}
