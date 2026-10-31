import { z } from "zod";

import { formatRange, isWithinRange } from "@/features/videos/domain/duration";
import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError } from "@/server/integrations/integration-error";
import { NotebookLmSession } from "@/server/script-studio/notebooklm/notebooklm-session";
import { buildChapterDetectionPrompt } from "@/server/script-studio/notebooklm/prompts/chapter-detection-prompt";
import {
  ANALYSIS_PERSONA,
  DRAFT_PERSONA,
  type ChatPersona,
} from "@/server/script-studio/notebooklm/prompts/chat-persona-prompt";
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

import { PersonaGate } from "../domain/persona-gate";
import { recordNotebookLmFailure, recordNotebookLmUsage } from "./notebooklm-status.service";
import {
  askNotebookForJson,
  ensureNotebookDocument,
  notebookStudioSettings,
  openBookNotebook,
  type NotebookStudioSettings,
} from "./notebook-studio.service";
import { ensureChatPersona } from "./notebook-sync.service";

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
// sources it is about, and its answer must be the JSON asked for. The notebook's chat persona is set before each question
// to the one its kind of work needs (ANALYSIS_PERSONA for the catalogue, DRAFT_PERSONA for a draft), never left to chance.
// Shared by every studio of the worker: each job opens its own studio, but a notebook belongs to the book.
const personaGate = new PersonaGate();

export class NotebookLmScriptStudio implements ScriptStudioProvider {
  readonly id = "notebooklm";
  // The notebook's chat persona shapes the draft as much as the question does, so both versions key the draft cache.
  readonly draftVersion = `${SCRIPT_DRAFT_PROMPT_VERSION}+${DRAFT_PERSONA.version}`;
  private session: Promise<NotebookLmSession> | null = null;
  // The binding of each notebook this studio opened, which a question needs to record the persona it set.
  private readonly bindingIds = new Map<string, string>();

  constructor(private readonly settings: NotebookStudioSettings) {}

  async ensureSource(request: EnsureSourceRequest, options?: CallOptions): Promise<SourceRef> {
    const signal = options?.signal;
    signal?.throwIfAborted();
    const caller = await this.open(signal);
    const notebook = await openBookNotebook(caller, this.settings.profile, request.book, signal);
    this.bindingIds.set(notebook.notebookId, notebook.bindingId);
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
      ANALYSIS_PERSONA,
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
      ANALYSIS_PERSONA,
      options,
    );
  }

  // A draft out of story order (DRAFT_INVALID) or with a length outside the range (DRAFT_LENGTH_OUT_OF_RANGE) is refused;
  // the production pipeline's one correction can fix either.
  async writeDraft(request: WriteDraftRequest, options?: CallOptions): Promise<ScriptDraft> {
    const answer = await this.ask(
      request.sources,
      buildScriptDraftPrompt({
        lesson: request.lesson,
        range: request.range,
        pace: request.pace,
        storyAngle: request.storyAngle,
        revisionNote: request.revisionNote,
      }),
      "DRAFT_INVALID",
      draftAnswerSchema,
      DRAFT_PERSONA,
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
    persona: ChatPersona,
    options: CallOptions | undefined,
  ): Promise<T> {
    const signal = options?.signal;
    signal?.throwIfAborted();
    const { notebookId, sourceIds } = splitRefs(sources);
    const caller = await this.open(signal);
    const bindingId = this.bindingIds.get(notebookId);
    if (!bindingId) {
      throw new IntegrationError(
        "NOTEBOOKLM_SOURCES_INVALID",
        "Các nguồn hỏi NotebookLM phải do chính phiên làm việc này tạo.",
        "REJECTED",
      );
    }
    // Setting the persona and asking happen together: another kind of work on this notebook waits for the question.
    return personaGate.run(notebookId, persona.version, async () => {
      await ensureChatPersona(caller, bindingId, notebookId, persona, signal);
      return askNotebookForJson({ caller, notebookId }, { sourceIds, query, code }, schema, signal);
    });
  }
}

export function createNotebookLmScriptStudio(
  settings: NotebookStudioSettings | null = notebookStudioSettings(),
): NotebookLmScriptStudio | null {
  return settings ? new NotebookLmScriptStudio(settings) : null;
}
