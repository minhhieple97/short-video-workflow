import { z } from "zod";

import type { NotebookBinding, NotebookSourceBinding } from "@/generated/prisma/client";
import { IntegrationError } from "@/server/integrations/integration-error";
import type { NotebookLmPayload } from "@/server/script-studio/notebooklm/notebooklm-envelope";
import { countQueryWords, NOTEBOOKLM_QUERY_MAX_WORDS } from "@/server/script-studio/notebooklm/notebooklm-query-limit";
import type { NotebookLmTool } from "@/server/script-studio/notebooklm/notebooklm-session";
import { CHAT_RESPONSE_LENGTH, type ChatPersona } from "@/server/script-studio/notebooklm/prompts/chat-persona-prompt";
import { createLogger } from "@/shared/logger";

import { hasBindingMarker, titleWithMarker } from "../domain/binding-marker";
import {
  findNotebookBinding,
  findSourceBinding,
  moveNotebookStatus,
  moveSourceStatus,
  saveChatPersonaVersion,
  saveNotebookId,
  saveRemoteSourceId,
} from "../repositories/notebook-binding.repository";

const logger = createLogger("notebooklm.sync");
// Enough to find this app's notebook among a user's notebooks without paging.
const NOTEBOOK_LIST_LIMIT = 1000;

export interface NotebookLmCaller {
  call(tool: NotebookLmTool, args: Record<string, unknown>, signal?: AbortSignal): Promise<NotebookLmPayload>;
}

const createdNotebookSchema = z.looseObject({ notebook_id: z.string().min(1) });
const notebookListSchema = z.looseObject({ notebooks: z.array(z.looseObject({ id: z.string(), title: z.string() })) });
const notebookSourcesSchema = z.looseObject({ sources: z.array(z.looseObject({ id: z.string(), title: z.string() })) });
const addedSourceSchema = z.looseObject({ source_id: z.string().min(1) });
const chatConfiguredSchema = z.looseObject({
  goal: z.literal("custom"),
  response_length: z.literal(CHAT_RESPONSE_LENGTH),
});
const answerSchema = z.looseObject({
  answer: z.string(),
  conversation_id: z.string().nullish(),
  sources_used: z.array(z.string()).default([]),
});

export type NotebookAnswer = z.infer<typeof answerSchema>;

function parse<T>(schema: z.ZodType<T>, payload: NotebookLmPayload, tool: string, mutating: boolean): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new IntegrationError(
    "NOTEBOOKLM_BAD_RESPONSE",
    "Phản hồi của NotebookLM không đúng định dạng mong đợi.",
    mutating ? "UNKNOWN_OUTCOME" : "REJECTED",
    { details: { tool } },
  );
}

const isUnknownOutcome = (error: unknown) => error instanceof IntegrationError && error.kind === "UNKNOWN_OUTCOME";

// The book's notebook in the connected account, created once. A create whose answer was lost is never simply repeated:
// the notebook list is searched for the binding's marker first, and only a notebook that is not there is created again.
export async function ensureNotebook(
  caller: NotebookLmCaller,
  bindingId: string,
  bookTitle: string,
  signal?: AbortSignal,
): Promise<string> {
  const binding = await requireNotebook(bindingId);
  if (binding.notebookId) return binding.notebookId;

  if (binding.status === "CREATING" || binding.status === "UNKNOWN_OUTCOME") {
    const listed = parse(
      notebookListSchema,
      await caller.call("notebook_list", { max_results: NOTEBOOK_LIST_LIMIT }, signal),
      "notebook_list",
      false,
    );
    const found = listed.notebooks.find((notebook) => hasBindingMarker(notebook.title, binding.id));
    if (found) return (await saveNotebookId(binding.id, found.id)).notebookId ?? found.id;
    await moveNotebookStatus(binding.id, ["CREATING", "UNKNOWN_OUTCOME"], "PENDING");
  }

  if (!(await moveNotebookStatus(binding.id, ["PENDING"], "CREATING"))) {
    throw new IntegrationError(
      "NOTEBOOKLM_BUSY",
      "Notebook của sách đang được tạo ở nơi khác; sẽ thử lại sau.",
      "TRANSIENT",
    );
  }
  try {
    const created = parse(
      createdNotebookSchema,
      await caller.call(
        "notebook_create",
        { title: titleWithMarker(`Book Video Studio · ${bookTitle}`, binding.id) },
        signal,
      ),
      "notebook_create",
      true,
    );
    logger.info("Notebook created", { bindingId: binding.id });
    return (await saveNotebookId(binding.id, created.notebook_id)).notebookId ?? created.notebook_id;
  } catch (error) {
    await moveNotebookStatus(binding.id, ["CREATING"], isUnknownOutcome(error) ? "UNKNOWN_OUTCOME" : "PENDING");
    throw error;
  }
}

// The notebook's chat persona and answer length, set before the work the persona is for and again whenever the notebook holds
// another one (a different version, which also covers the other kind of work having run last). It is saved only once
// NotebookLM confirms it, so a failed attempt is made again on the next use.
export async function ensureChatPersona(
  caller: NotebookLmCaller,
  bindingId: string,
  notebookId: string,
  persona: ChatPersona,
  signal?: AbortSignal,
): Promise<void> {
  const binding = await requireNotebook(bindingId);
  if (binding.chatPersonaVersion === persona.version) return;
  parse(
    chatConfiguredSchema,
    await caller.call(
      "chat_configure",
      {
        notebook_id: notebookId,
        goal: "custom",
        custom_prompt: persona.prompt,
        response_length: CHAT_RESPONSE_LENGTH,
      },
      signal,
    ),
    "chat_configure",
    false,
  );
  await saveChatPersonaVersion(binding.id, persona.version);
  logger.info("Notebook chat persona applied", { bindingId: binding.id, version: persona.version });
}

// One part of the book as a text source, uploaded once per revision. After a lost answer the notebook's sources are
// searched for the binding's marker before anything is uploaded again.
export async function ensureSource(
  caller: NotebookLmCaller,
  input: { notebookId: string; sourceBindingId: string; text: string },
  signal?: AbortSignal,
): Promise<string> {
  const binding = await requireSource(input.sourceBindingId);
  if (binding.remoteSourceId) return binding.remoteSourceId;

  if (binding.status === "SUBMITTING" || binding.status === "UNKNOWN_OUTCOME") {
    const notebook = parse(
      notebookSourcesSchema,
      await caller.call("notebook_get", { notebook_id: input.notebookId }, signal),
      "notebook_get",
      false,
    );
    const found = notebook.sources.find((source) => hasBindingMarker(source.title, binding.id));
    if (found) return (await saveRemoteSourceId(binding.id, found.id)).remoteSourceId ?? found.id;
    await moveSourceStatus(binding.id, ["SUBMITTING", "UNKNOWN_OUTCOME"], "PENDING");
  }

  if (!(await moveSourceStatus(binding.id, ["PENDING", "FAILED"], "SUBMITTING"))) {
    throw new IntegrationError(
      "NOTEBOOKLM_BUSY",
      "Nguồn này đang được tải lên ở nơi khác; sẽ thử lại sau.",
      "TRANSIENT",
    );
  }
  try {
    const added = parse(
      addedSourceSchema,
      await caller.call(
        "source_add",
        { notebook_id: input.notebookId, source_type: "text", text: input.text, title: binding.title, wait: true },
        signal,
      ),
      "source_add",
      true,
    );
    return (await saveRemoteSourceId(binding.id, added.source_id)).remoteSourceId ?? added.source_id;
  } catch (error) {
    await moveSourceStatus(binding.id, ["SUBMITTING"], isUnknownOutcome(error) ? "UNKNOWN_OUTCOME" : "FAILED");
    throw error;
  }
}

// Asks about the given sources only. NotebookLM would otherwise use every source in the notebook, including revisions this
// app has superseded, so a question without source IDs is refused. So is a question over NotebookLM's word limit: it would
// only come back as an opaque `invalid_argument`. It is refused, never cut: shortening what the question says would change
// what is asked.
export async function queryNotebook(
  caller: NotebookLmCaller,
  input: { notebookId: string; sourceIds: readonly string[]; query: string; timeoutSec?: number },
  signal?: AbortSignal,
): Promise<NotebookAnswer> {
  if (input.sourceIds.length === 0) {
    throw new IntegrationError("NOTEBOOKLM_NO_SOURCES", "Không có nguồn nào để hỏi NotebookLM.", "REJECTED");
  }
  const words = countQueryWords(input.query);
  if (words > NOTEBOOKLM_QUERY_MAX_WORDS) {
    throw new IntegrationError(
      "NOTEBOOKLM_QUERY_TOO_LONG",
      `Câu hỏi gửi NotebookLM dài ${words} từ, quá giới hạn ${NOTEBOOKLM_QUERY_MAX_WORDS} từ của một câu hỏi: bài học (hoặc ghi chú sửa) quá dài. Hãy rút ngắn bài học rồi tạo lại video; ứng dụng không tự cắt bài học.`,
      "REJECTED",
      { details: { words } },
    );
  }
  return parse(
    answerSchema,
    await caller.call(
      "notebook_query",
      {
        notebook_id: input.notebookId,
        query: input.query,
        source_ids: [...input.sourceIds],
        new_conversation: true,
        ...(input.timeoutSec ? { timeout: input.timeoutSec } : {}),
      },
      signal,
    ),
    "notebook_query",
    false,
  );
}

async function requireNotebook(id: string): Promise<NotebookBinding> {
  const binding = await findNotebookBinding(id);
  if (!binding) throw new Error(`Notebook binding ${id} does not exist.`);
  return binding;
}

async function requireSource(id: string): Promise<NotebookSourceBinding> {
  const binding = await findSourceBinding(id);
  if (!binding) throw new Error(`Source binding ${id} does not exist.`);
  return binding;
}
