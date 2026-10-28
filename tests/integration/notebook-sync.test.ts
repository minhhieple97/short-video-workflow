import fs from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as BindingRepository from "@/features/notebooklm/repositories/notebook-binding.repository";
import type * as NotebookSync from "@/features/notebooklm/services/notebook-sync.service";
import type * as DbClient from "@/server/db/client";
import { NotebookLmSession } from "@/server/script-studio/notebooklm/notebooklm-session";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const SERVER = path.join(import.meta.dirname, "../helpers/fake-mcp-server.mjs");

let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof BindingRepository;
let sync: typeof NotebookSync;
let session: NotebookLmSession | null = null;
let directory: string;
let bookId: string;
let notebookBindingId: string;

const statePath = () => path.join(directory, "nlm-state.json");
const scriptPath = () => path.join(directory, "nlm-script.json");
const logPath = () => path.join(directory, "nlm-log.jsonl");
const remote = () =>
  JSON.parse(fs.readFileSync(statePath(), "utf8")) as {
    notebooks: { id: string; title: string; sources: { id: string; title: string; length: number }[] }[];
  };
const toolCalls = (tool: string) =>
  fs
    .readFileSync(logPath(), "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } },
    )
    .filter((message) => message.method === "tools/call" && message.params?.name === tool)
    .map((message) => message.params?.arguments ?? {});

async function open(script: Record<string, unknown[]> = {}): Promise<NotebookLmSession> {
  await session?.close();
  fs.writeFileSync(scriptPath(), JSON.stringify(script));
  session = await NotebookLmSession.open({
    server: {
      command: process.execPath,
      args: [SERVER],
      env: {
        PATH: process.env.PATH ?? "",
        FAKE_MCP_PERSONA: "notebooklm",
        FAKE_MCP_LOG: logPath(),
        FAKE_NLM_STATE: statePath(),
        FAKE_NLM_SCRIPT: scriptPath(),
      },
    },
    profile: "default",
    callTimeoutMs: 1_000,
  });
  return session;
}

const source = (contentHash: string, sourceKey = "chapter:c1") =>
  repo.ensureSourceBinding({ notebookBindingId, sourceKey, contentHash, title: "Chương 1" });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/notebooklm/repositories/notebook-binding.repository");
  sync = await import("@/features/notebooklm/services/notebook-sync.service");
}, 60_000);

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(env.dataDir, "nlm-"));
  await db.prisma.book.deleteMany();
  bookId = (
    await db.prisma.book.create({
      data: {
        title: "Sách",
        sourceFilePath: "books/x/original.pdf",
        sourceFileName: "x.pdf",
        sourceHash: `hash-${Math.random()}`,
        sourceFormat: "pdf",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
    })
  ).id;
  notebookBindingId = (await repo.ensureNotebookBinding(bookId, "default")).id;
});

afterEach(async () => {
  await session?.close();
  session = null;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("ensureNotebook", () => {
  it("creates the book's notebook once, marked with its binding, and reuses it", async () => {
    const caller = await open();

    const first = await sync.ensureNotebook(caller, notebookBindingId, "Thói quen nhỏ");
    const again = await sync.ensureNotebook(caller, notebookBindingId, "Thói quen nhỏ");

    expect(again).toBe(first);
    expect(remote().notebooks).toHaveLength(1);
    expect(remote().notebooks[0]?.title).toBe(`Book Video Studio · Thói quen nhỏ [bvs:${notebookBindingId}]`);
    expect(await repo.findNotebookBinding(notebookBindingId)).toMatchObject({ status: "READY", notebookId: first });
  });

  it("finds the notebook a lost answer created instead of making a second one", async () => {
    const caller = await open({ notebook_create: [{ __applyThenHang: true }] });
    await expect(sync.ensureNotebook(caller, notebookBindingId, "Sách")).rejects.toMatchObject({
      code: "MCP_TIMEOUT",
      kind: "UNKNOWN_OUTCOME",
    });
    expect(await repo.findNotebookBinding(notebookBindingId)).toMatchObject({ status: "UNKNOWN_OUTCOME" });

    const id = await sync.ensureNotebook(await open(), notebookBindingId, "Sách");

    expect(remote().notebooks.map((notebook) => notebook.id)).toEqual([id]);
    expect(toolCalls("notebook_create")).toHaveLength(1);
  });

  it("records an unknown outcome when the create's answer is unreadable, and adopts the notebook next time", async () => {
    const caller = await open({ notebook_create: [{ status: "error", error: "Request timed out" }] });

    await expect(sync.ensureNotebook(caller, notebookBindingId, "Sách")).rejects.toMatchObject({
      kind: "UNKNOWN_OUTCOME",
    });
    expect(await repo.findNotebookBinding(notebookBindingId)).toMatchObject({ status: "UNKNOWN_OUTCOME" });

    const id = await sync.ensureNotebook(caller, notebookBindingId, "Sách");
    expect(remote().notebooks.map((notebook) => notebook.id)).toEqual([id]);
    expect(toolCalls("notebook_list")).toHaveLength(1);
  });

  it("creates the notebook again when a crash left it half-started and nothing was made", async () => {
    await db.prisma.notebookBinding.update({ where: { id: notebookBindingId }, data: { status: "CREATING" } });

    const id = await sync.ensureNotebook(await open(), notebookBindingId, "Sách");

    expect(remote().notebooks.map((notebook) => notebook.id)).toEqual([id]);
    expect(toolCalls("notebook_list")).toHaveLength(1);
  });

  it("goes back to the start after a plain refusal", async () => {
    const caller = await open({ notebook_create: [{ status: "error", error: "Something odd" }] });

    await expect(sync.ensureNotebook(caller, notebookBindingId, "Sách")).rejects.toMatchObject({ kind: "REJECTED" });
    expect(await repo.findNotebookBinding(notebookBindingId)).toMatchObject({ status: "PENDING" });
  });
});

describe("ensureSource", () => {
  it("uploads a part of the book once as a text source with its marker, and waits for it to be processed", async () => {
    const caller = await open();
    const notebookId = await sync.ensureNotebook(caller, notebookBindingId, "Sách");
    const binding = await source("h1");

    const id = await sync.ensureSource(caller, { notebookId, sourceBindingId: binding.id, text: "Nội dung chương." });
    const again = await sync.ensureSource(caller, {
      notebookId,
      sourceBindingId: binding.id,
      text: "Nội dung chương.",
    });

    expect(again).toBe(id);
    expect(toolCalls("source_add")).toEqual([
      { notebook_id: notebookId, source_type: "text", text: "Nội dung chương.", title: binding.title, wait: true },
    ]);
    expect(remote().notebooks[0]?.sources).toEqual([{ id, title: `Chương 1 [bvs:${binding.id}]`, length: 16 }]);
  });

  it("finds a source whose upload answer was lost instead of uploading it twice", async () => {
    const caller = await open({ source_add: [{ __applyThenHang: true }] });
    const notebookId = await sync.ensureNotebook(caller, notebookBindingId, "Sách");
    const binding = await source("h1");

    await expect(
      sync.ensureSource(caller, { notebookId, sourceBindingId: binding.id, text: "x" }),
    ).rejects.toMatchObject({
      code: "MCP_TIMEOUT",
      kind: "UNKNOWN_OUTCOME",
    });
    expect(await repo.findSourceBinding(binding.id)).toMatchObject({ status: "UNKNOWN_OUTCOME" });

    const id = await sync.ensureSource(await open(), { notebookId, sourceBindingId: binding.id, text: "x" });

    expect(remote().notebooks[0]?.sources.map((entry) => entry.id)).toEqual([id]);
    expect(toolCalls("source_add")).toHaveLength(1);
  });

  it("uploads again when the lost upload never arrived", async () => {
    const caller = await open({ source_add: [{ status: "error", error: "deadline exceeded" }] });
    const notebookId = await sync.ensureNotebook(caller, notebookBindingId, "Sách");
    const binding = await source("h1");

    await expect(
      sync.ensureSource(caller, { notebookId, sourceBindingId: binding.id, text: "x" }),
    ).rejects.toMatchObject({
      kind: "UNKNOWN_OUTCOME",
    });
    expect(await repo.findSourceBinding(binding.id)).toMatchObject({ status: "UNKNOWN_OUTCOME" });

    const id = await sync.ensureSource(caller, { notebookId, sourceBindingId: binding.id, text: "x" });
    expect(remote().notebooks[0]?.sources.map((entry) => entry.id)).toEqual([id]);
  });

  it("lets a refused upload be tried again later", async () => {
    const caller = await open({ source_add: [{ status: "error", error: "Something odd" }] });
    const notebookId = await sync.ensureNotebook(caller, notebookBindingId, "Sách");
    const binding = await source("h1");

    await expect(
      sync.ensureSource(caller, { notebookId, sourceBindingId: binding.id, text: "x" }),
    ).rejects.toMatchObject({
      kind: "REJECTED",
    });
    expect(await repo.findSourceBinding(binding.id)).toMatchObject({ status: "FAILED" });
    expect(await sync.ensureSource(caller, { notebookId, sourceBindingId: binding.id, text: "x" })).toMatch(/^src-/);
  });
});

describe("queryNotebook", () => {
  it("always names the sources to ask about, in a fresh conversation", async () => {
    const caller = await open();
    const notebookId = await sync.ensureNotebook(caller, notebookBindingId, "Sách");

    const answer = await sync.queryNotebook(caller, {
      notebookId,
      sourceIds: ["src-a", "src-b"],
      query: "Bài học?",
      timeoutSec: 180,
    });

    expect(answer).toMatchObject({ answer: "Trả lời: Bài học?", sources_used: ["src-a", "src-b"] });
    expect(toolCalls("notebook_query")).toEqual([
      {
        notebook_id: notebookId,
        query: "Bài học?",
        source_ids: ["src-a", "src-b"],
        new_conversation: true,
        timeout: 180,
      },
    ]);
  });

  it("refuses to ask without sources, which NotebookLM would read as every source in the notebook", async () => {
    const caller = await open();

    await expect(sync.queryNotebook(caller, { notebookId: "nb", sourceIds: [], query: "q" })).rejects.toMatchObject({
      code: "NOTEBOOKLM_NO_SOURCES",
    });
    expect(toolCalls("notebook_query")).toHaveLength(0);
  });
});
