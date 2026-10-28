import { createHash } from "node:crypto";

import type { z } from "zod";

import { IntegrationError } from "@/server/integrations/integration-error";
import type { McpServerCommand } from "@/server/script-studio/notebooklm/mcp-stdio-client";
import {
  notebookLmServerForThisProcess,
  NotebookLmSession,
} from "@/server/script-studio/notebooklm/notebooklm-session";
import { getAppConfig, type AppConfig } from "@/shared/config/env";

import { extractJsonFromAnswer } from "../domain/answer-json";
import { ensureNotebookBinding, ensureSourceBinding } from "../repositories/notebook-binding.repository";
import { ensureNotebook, ensureSource, queryNotebook, type NotebookLmCaller } from "./notebook-sync.service";

export interface NotebookStudioSettings {
  profile: string;
  server: McpServerCommand;
  callTimeoutMs: number;
}

// NotebookLM is used only in cli-auto mode (the one mode where the worker calls AI tools unattended) and only once a
// signed-in profile is named. Otherwise null, and callers fall back or stop with that reason.
export function notebookStudioSettings(config: AppConfig = getAppConfig()): NotebookStudioSettings | null {
  const { notebookLm } = config;
  if (config.ai.mode !== "cli-auto" || !notebookLm.profile) return null;
  return {
    profile: notebookLm.profile,
    server: notebookLmServerForThisProcess(notebookLm),
    callTimeoutMs: notebookLm.callTimeoutMs,
  };
}

export const NOTEBOOKLM_NOT_CONFIGURED_MESSAGE =
  "NotebookLM chỉ được dùng khi AI_MODE=cli-auto và đã đặt NOTEBOOKLM_PROFILE (profile đã đăng nhập bằng `nlm login`).";

// One NotebookLM server process for the duration of `work`, closed whatever happens.
export async function withNotebookLm<T>(
  settings: NotebookStudioSettings,
  signal: AbortSignal | undefined,
  work: (caller: NotebookLmCaller) => Promise<T>,
): Promise<T> {
  const session = await NotebookLmSession.open({ ...settings, signal });
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}

export interface BookNotebook {
  caller: NotebookLmCaller;
  bindingId: string;
  notebookId: string;
}

export async function openBookNotebook(
  caller: NotebookLmCaller,
  profile: string,
  book: { id: string; title: string },
  signal?: AbortSignal,
): Promise<BookNotebook> {
  const binding = await ensureNotebookBinding(book.id, profile);
  const notebookId = await ensureNotebook(caller, binding.id, book.title, signal);
  return { caller, bindingId: binding.id, notebookId };
}

export interface NotebookDocument {
  // Which part of the book this is ("chapter:<id>", "outline:<extractionId>"); a new text for the same key is a new revision.
  key: string;
  title: string;
  markdown: string;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// The document as a source of the book's notebook, uploaded once per revision of its text.
export async function ensureNotebookDocument(
  notebook: BookNotebook,
  document: NotebookDocument,
  signal?: AbortSignal,
): Promise<string> {
  const binding = await ensureSourceBinding({
    notebookBindingId: notebook.bindingId,
    sourceKey: document.key,
    contentHash: sha256(document.markdown),
    title: document.title,
  });
  return ensureSource(
    notebook.caller,
    { notebookId: notebook.notebookId, sourceBindingId: binding.id, text: document.markdown },
    signal,
  );
}

// Asks about exactly these sources and reads the JSON the question asked for. An answer that is not that JSON is a
// refusal under `code`, never stored and never patched up.
export async function askNotebookForJson<T>(
  notebook: BookNotebook,
  input: { sourceIds: readonly string[]; query: string; code: string },
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const answer = await queryNotebook(
    notebook.caller,
    { notebookId: notebook.notebookId, sourceIds: input.sourceIds, query: input.query },
    signal,
  );
  const parsed = schema.safeParse(extractJsonFromAnswer(answer.answer));
  if (parsed.success) return parsed.data;
  throw new IntegrationError(input.code, "Câu trả lời của NotebookLM không đúng định dạng JSON yêu cầu.", "REJECTED", {
    details: {
      issues: parsed.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
  });
}
