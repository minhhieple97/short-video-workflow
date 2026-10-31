import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpStdioClient } from "@/server/script-studio/notebooklm/mcp-stdio-client";

const SERVER = path.join(import.meta.dirname, "../helpers/fake-mcp-server.mjs");

let directory: string;
let logFile: string;
let client: McpStdioClient | null = null;

function server(mode = "", extraEnv: Record<string, string> = {}, options: { closeGraceMs?: number } = {}) {
  client = new McpStdioClient(
    {
      command: process.execPath,
      args: [SERVER],
      env: { PATH: process.env.PATH ?? "", FAKE_MCP_MODE: mode, FAKE_MCP_LOG: logFile, ...extraEnv },
    },
    options,
  );
  return client;
}

const received = () =>
  fs.existsSync(logFile)
    ? fs
        .readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-mcp-"));
  logFile = path.join(directory, "received.jsonl");
});

afterEach(async () => {
  await client?.close();
  client = null;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("McpStdioClient", () => {
  it("shakes hands, says it is initialised, and reads every page of tools", async () => {
    const mcp = server();
    await mcp.start();

    const tools = await mcp.listTools();

    expect(mcp.serverInfo).toEqual({ name: "fake-mcp", version: "9.9" });
    expect(tools.map((tool) => tool.name)).toEqual(["echo", "env"]);
    const methods = received().map((message) => message.method);
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/list"]);
    expect(received()[0]).toMatchObject({ params: { protocolVersion: "2025-06-18", capabilities: {} } });
  });

  it("calls a tool and returns its content and structured result", async () => {
    const mcp = server();
    await mcp.start();

    const result = await mcp.callTool("echo", { notebook_id: "n1" });

    expect(result).toMatchObject({
      isError: false,
      structuredContent: { status: "success", echo: { notebook_id: "n1" } },
    });
  });

  it("answers the server's ping while a call is in progress, and ignores lines that are not JSON", async () => {
    const mcp = server("ping-first,garbage");
    await mcp.start();

    expect((await mcp.callTool("echo", { a: 1 })).structuredContent).toEqual({ status: "success", echo: { a: 1 } });
    expect(received().find((message) => "pingReply" in message)).toEqual({
      pingReply: { jsonrpc: "2.0", id: 1000, result: {} },
    });
  });

  it("gives the server only the environment it was handed", async () => {
    process.env.BVS_PARENT_SECRET = "should-not-leak";
    try {
      const mcp = server("", { HOME: directory });
      await mcp.start();

      const result = await mcp.callTool("env", {});

      expect((result.structuredContent as { keys: string[] }).keys).not.toContain("BVS_PARENT_SECRET");
      expect((result.structuredContent as { keys: string[] }).keys).toContain("HOME");
    } finally {
      delete process.env.BVS_PARENT_SECRET;
    }
  });

  it("refuses a server that speaks another protocol revision", async () => {
    const mcp = server("", { FAKE_MCP_PROTOCOL: "1999-01-01" });

    await expect(mcp.start()).rejects.toMatchObject({ code: "MCP_PROTOCOL_UNSUPPORTED", kind: "REJECTED" });
  });

  it("fails the pending call when the server dies, and every call after it", async () => {
    const mcp = server("crash-on-call");
    await mcp.start();

    await expect(mcp.callTool("echo", {})).rejects.toMatchObject({ code: "MCP_PROCESS_EXITED", kind: "TRANSIENT" });
    await expect(mcp.callTool("echo", {})).rejects.toMatchObject({ code: "MCP_PROCESS_EXITED" });
  });

  it("gives up on a call the server never answers, and tells the server to stop working on it", async () => {
    const mcp = server("hang-on-call");
    await mcp.start();

    await expect(mcp.callTool("echo", {}, { timeoutMs: 200 })).rejects.toMatchObject({
      code: "MCP_TIMEOUT",
      kind: "TRANSIENT",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cancelled = received().find((message) => message.method === "notifications/cancelled");
    expect(cancelled).toMatchObject({ params: { requestId: 2 } });
  });

  it("says which call it gave up on and after how long, for a tool and for the handshake", async () => {
    const mcp = server("hang-on-call");
    await mcp.start();

    await expect(mcp.callTool("echo", {}, { timeoutMs: 200 })).rejects.toMatchObject({
      message: 'Máy chủ MCP không trả lời "echo" sau 0.2 s.',
      details: { call: "echo", timeoutMs: 200 },
    });
    await mcp.close();

    client = new McpStdioClient({
      command: process.execPath,
      args: ["-e", "process.stdin.resume()"],
      env: { PATH: process.env.PATH ?? "" },
    });
    await expect(client.start({ timeoutMs: 200 })).rejects.toMatchObject({
      message: 'Máy chủ MCP không trả lời "initialize" sau 0.2 s.',
      details: { call: "initialize", timeoutMs: 200 },
    });
  });

  it("stops waiting when the caller cancels, sending nothing once already cancelled", async () => {
    const mcp = server("hang-on-call");
    await mcp.start();
    const controller = new AbortController();

    const call = mcp.callTool("echo", {}, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("cancelled by user")), 50);
    await expect(call).rejects.toThrow("cancelled by user");

    const before = received().length;
    await expect(mcp.callTool("echo", {}, { signal: controller.signal })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      received()
        .slice(before)
        .filter((message) => message.method === "tools/call"),
    ).toHaveLength(0);
  });

  it("reports a JSON-RPC error without the server's own words, and keeps stderr out of errors", async () => {
    const mcp = server("rpc-error,stderr-secret");
    await mcp.start();

    const error = await mcp.callTool("echo", {}).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "MCP_PROTOCOL_ERROR", kind: "REJECTED", details: { rpcCode: -32602 } });
    expect(JSON.stringify(error)).not.toContain("SECRET");
    expect((error as Error).message).not.toContain("SECRET");
    expect(mcp.stderrTail()).toContain("cookie=SID-SECRET-VALUE");
  });

  it("fails to start when the command does not exist", async () => {
    client = new McpStdioClient({ command: path.join(directory, "missing-binary"), args: [], env: {} });

    await expect(client.start()).rejects.toMatchObject({ code: "MCP_SPAWN_FAILED", kind: "TRANSIENT" });
  });

  it("closes a server that stops on its own, asks one that stays open to stop, and kills one that ignores that", async () => {
    const polite = server();
    await polite.start();
    await polite.close();
    expect(received().some((message) => "signal" in message)).toBe(false);

    const lingering = server("stay-open", {}, { closeGraceMs: 100 });
    await lingering.start();
    await lingering.close();
    expect(received().filter((message) => "signal" in message)).toEqual([{ signal: "SIGTERM" }]);

    const stubborn = server("ignore-sigterm", {}, { closeGraceMs: 100 });
    await stubborn.start();
    const started = Date.now();
    await stubborn.close();
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(stubborn.callTool("echo", {})).rejects.toMatchObject({ code: "MCP_PROCESS_EXITED" });
  });
});
