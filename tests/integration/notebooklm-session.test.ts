import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { McpCallResult } from "@/server/script-studio/notebooklm/mcp-stdio-client";
import { readNotebookLmEnvelope } from "@/server/script-studio/notebooklm/notebooklm-envelope";
import { notebookLmServerCommand, NotebookLmSession } from "@/server/script-studio/notebooklm/notebooklm-session";

const SERVER = path.join(import.meta.dirname, "../helpers/fake-mcp-server.mjs");

let directory: string;
let logFile: string;
let session: NotebookLmSession | null = null;

function open(options: { profile?: string; env?: Record<string, string>; script?: Record<string, unknown[]> } = {}) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    FAKE_MCP_PERSONA: "notebooklm",
    FAKE_MCP_LOG: logFile,
    FAKE_NLM_PROFILES: "default,work",
    ...options.env,
  };
  if (options.script) {
    const scriptFile = path.join(directory, "script.json");
    fs.writeFileSync(scriptFile, JSON.stringify(options.script));
    env.FAKE_NLM_SCRIPT = scriptFile;
  }
  return NotebookLmSession.open({
    server: { command: process.execPath, args: [SERVER], env },
    profile: "profile" in options ? options.profile : "work",
    callTimeoutMs: 2_000,
  }).then((opened) => (session = opened));
}

const calls = () =>
  fs
    .readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } },
    )
    .filter((message) => message.method === "tools/call")
    .map((message) => ({ tool: message.params?.name, args: message.params?.arguments }));

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-nlm-"));
  logFile = path.join(directory, "received.jsonl");
});

afterEach(async () => {
  await session?.close();
  session = null;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("notebookLmServerCommand", () => {
  it("runs the pinned package through uvx with only the variables the server needs", () => {
    const command = notebookLmServerCommand(
      { command: "uvx", packageSpec: "notebooklm-mcp-cli==0.15.8" },
      {
        PATH: "/usr/bin",
        HOME: "/home/u",
        LANG: "vi_VN.UTF-8",
        NOTEBOOKLM_COOKIES: "SID=account-cookie",
        MISTRAL_API_KEY: "secret",
        GOOGLE_OAUTH_CLIENT_SECRET: "secret",
        DATABASE_URL: "file:x",
        XDG_CACHE_HOME: "",
      },
    );

    expect(command).toEqual({
      command: "uvx",
      args: ["--from", "notebooklm-mcp-cli==0.15.8", "notebooklm-mcp"],
      env: { PATH: "/usr/bin", HOME: "/home/u", LANG: "vi_VN.UTF-8" },
    });
  });
});

describe("NotebookLmSession", () => {
  it("switches this process to the configured profile without making it the default, and checks it took", async () => {
    await open();

    expect(calls()).toEqual([
      { tool: "profile", args: { action: "switch", name: "work", make_default: false } },
      { tool: "profile", args: { action: "list" } },
    ]);
    expect(await session?.call("notebook_get", { notebook_id: "n1" })).toMatchObject({
      status: "success",
      profile: "work",
    });
  });

  it("refuses to start without a configured profile", async () => {
    await expect(open({ profile: undefined })).rejects.toMatchObject({
      code: "NOTEBOOKLM_PROFILE_NOT_SET",
      kind: "AUTH",
    });
  });

  it("tells the user to sign in when the profile does not exist", async () => {
    const error = await open({ profile: "missing" }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "NOTEBOOKLM_PROFILE_MISSING", kind: "AUTH" });
    expect((error as Error).message).toContain("nlm login --profile missing");
  });

  it("refuses a server that says it switched but still runs as another account", async () => {
    await expect(open({ env: { FAKE_NLM_IGNORE_SWITCH: "1" } })).rejects.toMatchObject({
      code: "NOTEBOOKLM_PROFILE_MISSING",
      kind: "AUTH",
    });
  });

  it("treats a timed-out change as an unknown outcome and a timed-out read as temporary", async () => {
    const timedOut = { status: "error", error: "Request timed out" };
    await open({ script: { source_add: [timedOut], notebook_get: [timedOut] } });

    await expect(session?.call("source_add", { notebook_id: "n", source_type: "text" })).rejects.toMatchObject({
      kind: "UNKNOWN_OUTCOME",
    });
    await expect(session?.call("notebook_get", { notebook_id: "n" })).rejects.toMatchObject({ kind: "TRANSIENT" });
  });

  it("refuses a server that lacks a tool the app relies on", async () => {
    await expect(open({ env: { FAKE_NLM_TOOLS: "profile,notebook_get,usage_get" } })).rejects.toMatchObject({
      code: "NOTEBOOKLM_TOOLS_MISSING",
      kind: "REJECTED",
      details: {
        missing: [
          "notebook_list",
          "notebook_create",
          "notebook_query",
          "chat_configure",
          "source_add",
          "source_get_content",
          "source_delete",
        ],
      },
    });
  });

  it("does not trust a call's success flag: an error envelope fails, classified, without its text", async () => {
    await open({
      script: {
        notebook_get: [
          { status: "error", error: "No authentication found. Either:\n1. Run 'nlm login'... cookie SID=abc" },
          { status: "error", error: "Rate limit exceeded for this account" },
          { status: "error", error: "Something odd at /home/u/.notebooklm-mcp-cli/profiles/work" },
        ],
      },
    });

    const auth = await session?.call("notebook_get", { notebook_id: "n" }).catch((caught: unknown) => caught);
    expect(auth).toMatchObject({ code: "NOTEBOOKLM_AUTH_REQUIRED", kind: "AUTH" });
    expect(JSON.stringify(auth)).not.toContain("SID=abc");
    await expect(session?.call("notebook_get", { notebook_id: "n" })).rejects.toMatchObject({
      code: "NOTEBOOKLM_QUOTA",
      kind: "QUOTA",
    });
    const odd = await session?.call("notebook_get", { notebook_id: "n" }).catch((caught: unknown) => caught);
    expect(odd).toMatchObject({ code: "NOTEBOOKLM_TOOL_ERROR", kind: "REJECTED" });
    expect((odd as Error).message).not.toContain(".notebooklm-mcp-cli");
  });

  it("reads an answer that only came as text, and calls one without a status a bad response", async () => {
    await open({
      script: {
        notebook_get: [{ __textOnly: true, body: { status: "success", title: "Sách" } }, { title: "no status" }],
      },
    });

    expect(await session?.call("notebook_get", { notebook_id: "n" })).toMatchObject({ title: "Sách" });
    await expect(session?.call("notebook_get", { notebook_id: "n" })).rejects.toMatchObject({
      code: "NOTEBOOKLM_BAD_RESPONSE",
      kind: "REJECTED",
    });
  });

  it("treats a hung read as a transport timeout, and a hung change as an unknown outcome", async () => {
    await open({ script: { notebook_query: [{ __hang: true }], source_add: [{ __hang: true }] } });

    await expect(session?.call("notebook_query", { notebook_id: "n", query: "q" })).rejects.toMatchObject({
      code: "MCP_TIMEOUT",
      kind: "TRANSIENT",
    });
    await expect(session?.call("source_add", { notebook_id: "n", source_type: "text" })).rejects.toMatchObject({
      code: "MCP_TIMEOUT",
      kind: "UNKNOWN_OUTCOME",
    });
  });
});

describe("readNotebookLmEnvelope", () => {
  const result = (structuredContent: unknown, isError = false): McpCallResult => ({
    content: [],
    structuredContent,
    isError,
  });

  it("reports a timeout of a change as an unknown outcome, and of a read as temporary", () => {
    const timedOut = result({ status: "error", error: "Request timed out after 120s" });

    expect(() => readNotebookLmEnvelope("source_add", timedOut, true)).toThrow(
      expect.objectContaining({ code: "NOTEBOOKLM_TIMEOUT", kind: "UNKNOWN_OUTCOME" }),
    );
    expect(() => readNotebookLmEnvelope("notebook_query", timedOut, false)).toThrow(
      expect.objectContaining({ code: "NOTEBOOKLM_TIMEOUT", kind: "TRANSIENT" }),
    );
  });

  it("asks for a new sign-in when the server says the login expired", () => {
    expect(() =>
      readNotebookLmEnvelope(
        "notebook_get",
        result({ status: "expired", error: "Cached auth is no longer valid" }),
        false,
      ),
    ).toThrow(expect.objectContaining({ code: "NOTEBOOKLM_AUTH_REQUIRED", kind: "AUTH" }));
  });

  it("does not accept a success envelope marked as an error", () => {
    expect(() => readNotebookLmEnvelope("notebook_get", result({ status: "success" }, true), false)).toThrow(
      expect.objectContaining({ code: "NOTEBOOKLM_TOOL_ERROR" }),
    );
  });

  it("calls a change with an unreadable answer an unknown outcome", () => {
    expect(() => readNotebookLmEnvelope("source_add", result(null), true)).toThrow(
      expect.objectContaining({ code: "NOTEBOOKLM_BAD_RESPONSE", kind: "UNKNOWN_OUTCOME" }),
    );
  });

  it.each([
    ["Authentication expired, run nlm login", "NOTEBOOKLM_AUTH_REQUIRED"],
    ["Session expired", "NOTEBOOKLM_AUTH_REQUIRED"],
    ["Please sign in again", "NOTEBOOKLM_AUTH_REQUIRED"],
    ["HTTP 429 Too Many Requests", "NOTEBOOKLM_QUOTA"],
    ["Weekly usage limit reached", "NOTEBOOKLM_QUOTA"],
    ["Daily limit reached", "NOTEBOOKLM_QUOTA"],
    ["deadline exceeded", "NOTEBOOKLM_TIMEOUT"],
  ])("classifies %j as %s", (text, code) => {
    expect(() => readNotebookLmEnvelope("notebook_query", result({ status: "error", error: text }), false)).toThrow(
      expect.objectContaining({ code }),
    );
  });
});
