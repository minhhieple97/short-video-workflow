import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { z } from "zod";

import { IntegrationError } from "@/server/integrations/integration-error";

// The protocol revisions this client speaks; the server must answer with one of them.
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const REQUEST_TIMEOUT_MS = 60_000;
const CLOSE_GRACE_MS = 3_000;
const STDERR_KEEP_BYTES = 16 * 1024;
// A single message larger than this is treated as a broken server rather than buffered without bound.
const MAX_LINE_BYTES = 32 * 1024 * 1024;

const responseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const serverRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]),
  method: z.string(),
});
const initializeResultSchema = z.object({
  protocolVersion: z.string(),
  serverInfo: z.object({ name: z.string(), version: z.string() }).optional(),
});
const toolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
const toolsPageSchema = z.object({ tools: z.array(toolSchema), nextCursor: z.string().optional() });
const callResultSchema = z.object({
  content: z.array(z.unknown()).default([]),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

export type McpTool = z.infer<typeof toolSchema>;
export type McpCallResult = z.infer<typeof callResultSchema>;

export interface McpServerCommand {
  command: string;
  args: readonly string[];
  // The child's whole environment: nothing is inherited, so secrets of this process never reach the server.
  env: Record<string, string>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const transportFailure = (code: string, message: string, cause?: unknown) =>
  new IntegrationError(code, message, "TRANSIENT", cause ? { cause } : undefined);

// A minimal MCP client over a server subprocess's stdin/stdout (newline-delimited JSON-RPC 2.0). The process is spawned
// from an argument array with an explicit environment, never through a shell. Its stderr is kept, bounded, for
// diagnostics only and never put into an error. A server that exits, hangs or writes garbage fails the pending calls
// with a TRANSIENT error instead of hanging the worker.
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private exited: Error | null = null;
  serverInfo: { name: string; version: string } | null = null;

  private readonly closeGraceMs: number;

  constructor(
    private readonly server: McpServerCommand,
    options: { closeGraceMs?: number } = {},
  ) {
    this.closeGraceMs = options.closeGraceMs ?? CLOSE_GRACE_MS;
  }

  async start(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const child = spawn(this.server.command, [...this.server.args], {
      // The child gets exactly this environment; Next's ProcessEnv typing (which requires NODE_ENV) does not apply to it.
      env: this.server.env as NodeJS.ProcessEnv,
      stdio: "pipe",
      shell: false,
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_KEEP_BYTES);
    });
    child.on("error", (error) =>
      this.fail(transportFailure("MCP_SPAWN_FAILED", "Không khởi động được tiến trình MCP.", error)),
    );
    child.on("exit", () => this.fail(transportFailure("MCP_PROCESS_EXITED", "Tiến trình MCP đã dừng giữa chừng.")));

    const init = initializeResultSchema.safeParse(
      await this.request(
        "initialize",
        {
          protocolVersion: MCP_PROTOCOL_VERSIONS[0],
          capabilities: {},
          clientInfo: { name: "book-video-studio", version: "1" },
        },
        options,
      ),
    );
    if (!init.success) throw transportFailure("MCP_BAD_HANDSHAKE", "Máy chủ MCP trả lời bắt tay không hợp lệ.");
    if (!MCP_PROTOCOL_VERSIONS.some((version) => version === init.data.protocolVersion)) {
      throw new IntegrationError(
        "MCP_PROTOCOL_UNSUPPORTED",
        "Máy chủ MCP dùng phiên bản giao thức không được hỗ trợ.",
        "REJECTED",
        {
          details: { protocolVersion: init.data.protocolVersion },
        },
      );
    }
    this.serverInfo = init.data.serverInfo ?? null;
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(options: { signal?: AbortSignal } = {}): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = toolsPageSchema.safeParse(await this.request("tools/list", cursor ? { cursor } : {}, options));
      if (!page.success) throw transportFailure("MCP_BAD_RESPONSE", "Danh sách công cụ MCP không hợp lệ.");
      tools.push(...page.data.tools);
      cursor = page.data.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<McpCallResult> {
    const result = callResultSchema.safeParse(await this.request("tools/call", { name, arguments: args }, options));
    if (!result.success) throw transportFailure("MCP_BAD_RESPONSE", "Kết quả công cụ MCP không hợp lệ.");
    return result.data;
  }

  // The last part of the server's stderr, for a diagnostics page that redacts it first; never for errors or logs.
  stderrTail(): string {
    return this.stderr;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.stdin.end();
    const graceful = await Promise.race([exited.then(() => true), delay(this.closeGraceMs).then(() => false)]);
    if (graceful) return;
    child.kill("SIGTERM");
    const terminated = await Promise.race([exited.then(() => true), delay(this.closeGraceMs).then(() => false)]);
    if (!terminated) child.kill("SIGKILL");
    await exited;
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exited);
    options.signal?.throwIfAborted();
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const call = method === "tools/call" && typeof params.name === "string" ? params.name : method;
    return new Promise((resolve, reject) => {
      const cancel = (error: Error) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        // Lets the server stop working on a call nobody waits for any more.
        this.write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });
        reject(error);
      };
      const timer = setTimeout(
        () =>
          cancel(
            new IntegrationError(
              "MCP_TIMEOUT",
              `Máy chủ MCP không trả lời "${call}" sau ${timeoutMs / 1000} s.`,
              "TRANSIENT",
              { details: { call, timeoutMs } },
            ),
          ),
        timeoutMs,
      );
      const onAbort = () =>
        cancel(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Aborted"));
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          options.signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        timer,
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private write(message: Record<string, unknown>): void {
    const child = this.child;
    if (!child || this.exited || !child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES && !this.buffer.includes("\n")) {
      this.fail(transportFailure("MCP_MESSAGE_TOO_LARGE", "Máy chủ MCP gửi thông điệp quá lớn."));
      this.child?.kill("SIGKILL");
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = serverRequestSchema.safeParse(message);
    if (
      request.success &&
      !(typeof message === "object" && message !== null && ("result" in message || "error" in message))
    ) {
      // The server may ping; nothing else is offered to it (no sampling, roots or elicitation).
      this.write(
        request.data.method === "ping"
          ? { jsonrpc: "2.0", id: request.data.id, result: {} }
          : { jsonrpc: "2.0", id: request.data.id, error: { code: -32601, message: "Method not found" } },
      );
      return;
    }
    const response = responseSchema.safeParse(message);
    if (!response.success || typeof response.data.id !== "number") return;
    const pending = this.pending.get(response.data.id);
    if (!pending) return;
    this.pending.delete(response.data.id);
    clearTimeout(pending.timer);
    if (response.data.error) {
      pending.reject(
        new IntegrationError("MCP_PROTOCOL_ERROR", "Máy chủ MCP từ chối yêu cầu.", "REJECTED", {
          details: { rpcCode: response.data.error.code },
        }),
      );
    } else {
      pending.resolve(response.data.result);
    }
  }

  private fail(error: Error): void {
    this.exited ??= error;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
