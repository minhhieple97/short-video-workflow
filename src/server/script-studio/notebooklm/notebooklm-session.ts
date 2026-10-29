import { z } from "zod";

import { IntegrationError } from "@/server/integrations/integration-error";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { McpStdioClient, type McpServerCommand } from "./mcp-stdio-client";
import { readNotebookLmEnvelope, type NotebookLmPayload } from "./notebooklm-envelope";
import { notebookLmQuotaError } from "./notebooklm-usage";

const logger = createLogger("notebooklm.session");

// The tools the script studio relies on; a server without them is a version this app was not built against.
export const REQUIRED_NOTEBOOKLM_TOOLS = [
  "profile",
  "notebook_list",
  "notebook_create",
  "notebook_get",
  "notebook_query",
  "chat_configure",
  "source_add",
  "source_get_content",
  "source_delete",
  "usage_get",
] as const;

export type NotebookLmTool = (typeof REQUIRED_NOTEBOOKLM_TOOLS)[number];

// Tools that change something in NotebookLM: a lost answer means the change may have happened. chat_configure is not one
// of them: setting the same chat settings again is harmless, so its lost answer is simply asked again.
const MUTATING_TOOLS: ReadonlySet<NotebookLmTool> = new Set([
  "profile",
  "notebook_create",
  "source_add",
  "source_delete",
]);

// Only what the server needs to run and find its saved profiles. NOTEBOOKLM_COOKIES in particular is never passed: it
// would override the chosen profile with whatever account those cookies belong to.
const PASSED_ENV = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "DBUS_SESSION_BUS_ADDRESS",
  "UV_CACHE_DIR",
] as const;

export function notebookLmServerCommand(
  config: { command: string; packageSpec: string },
  parentEnv: Record<string, string | undefined>,
): McpServerCommand {
  const env: Record<string, string> = {};
  for (const key of PASSED_ENV) {
    const value = parentEnv[key];
    if (value) env[key] = value;
  }
  return { command: config.command, args: ["--from", config.packageSpec, "notebooklm-mcp"], env };
}

// The command for this worker's environment: only the allow-listed variables of this process are passed on.
export function notebookLmServerForThisProcess(config: { command: string; packageSpec: string }): McpServerCommand {
  return notebookLmServerCommand(config, process.env);
}

const profileListSchema = z.looseObject({ active: z.looseObject({ profile: z.string() }) });

// One NotebookLM server process used by one job, signed in as the configured profile. The profile is switched for this
// process only (make_default false), so the user's own default in `nlm` is never changed.
export class NotebookLmSession {
  private constructor(
    private readonly client: McpStdioClient,
    private readonly callTimeoutMs: number,
  ) {}

  static async open(options: {
    server: McpServerCommand;
    profile: string | undefined;
    callTimeoutMs: number;
    signal?: AbortSignal;
    checkQuota?: boolean;
  }): Promise<NotebookLmSession> {
    const { profile } = options;
    if (!profile) {
      throw new IntegrationError(
        "NOTEBOOKLM_PROFILE_NOT_SET",
        "Chưa cấu hình NOTEBOOKLM_PROFILE (tên profile đã đăng nhập bằng `nlm login --profile <tên>`).",
        "AUTH",
      );
    }
    const client = new McpStdioClient(options.server);
    const session = new NotebookLmSession(client, options.callTimeoutMs);
    try {
      await client.start({ signal: options.signal });
      const available = new Set((await client.listTools({ signal: options.signal })).map((tool) => tool.name));
      const missing = REQUIRED_NOTEBOOKLM_TOOLS.filter((tool) => !available.has(tool));
      if (missing.length > 0) {
        throw new IntegrationError(
          "NOTEBOOKLM_TOOLS_MISSING",
          "Máy chủ NotebookLM MCP thiếu công cụ cần thiết; hãy dùng đúng phiên bản đã ghim.",
          "REJECTED",
          { details: { missing } },
        );
      }
      await session.useProfile(profile, options.signal);
      if (options.checkQuota !== false) {
        const quota = await session.readQuotaError(options.signal);
        if (quota) throw quota;
      }
      return session;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async call(tool: NotebookLmTool, args: Record<string, unknown>, signal?: AbortSignal): Promise<NotebookLmPayload> {
    const mutating = MUTATING_TOOLS.has(tool);
    let result;
    try {
      result = await this.client.callTool(tool, args, { signal, timeoutMs: this.callTimeoutMs });
    } catch (error) {
      // A change whose answer never came (timeout, the process died) may still have been made.
      if (mutating && error instanceof IntegrationError && error.kind === "TRANSIENT") {
        throw new IntegrationError(error.code, error.message, "UNKNOWN_OUTCOME", {
          cause: error,
          details: error.details,
        });
      }
      throw error;
    }
    try {
      return readNotebookLmEnvelope(tool, result, mutating);
    } catch (error) {
      if (error instanceof IntegrationError && error.kind === "QUOTA" && tool !== "usage_get") {
        const quota = await this.readQuotaError(signal);
        if (quota?.retryAfterMs !== undefined) {
          throw new IntegrationError(error.code, error.message, "QUOTA", {
            cause: error,
            details: error.details,
            retryAfterMs: quota.retryAfterMs,
          });
        }
      }
      throw error;
    }
  }

  private async readQuotaError(signal: AbortSignal | undefined): Promise<IntegrationError | null> {
    try {
      return notebookLmQuotaError(await this.call("usage_get", {}, signal));
    } catch (error) {
      if (signal?.aborted || (error instanceof IntegrationError && (error.kind === "AUTH" || error.kind === "QUOTA")))
        throw error;
      logger.warn("NotebookLM usage could not be read", { error: toSafeErrorMessage(error) });
      return null;
    }
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async useProfile(profile: string, signal: AbortSignal | undefined): Promise<void> {
    try {
      await this.call("profile", { action: "switch", name: profile, make_default: false }, signal);
    } catch (error) {
      if (error instanceof IntegrationError && error.code === "NOTEBOOKLM_TOOL_ERROR") throw profileMissing(profile);
      throw error;
    }
    // Checked rather than assumed: every later call must run as this account.
    const listed = profileListSchema.safeParse(await this.call("profile", { action: "list" }, signal));
    if (!listed.success || listed.data.active.profile !== profile) throw profileMissing(profile);
  }
}

const profileMissing = (profile: string) =>
  new IntegrationError(
    "NOTEBOOKLM_PROFILE_MISSING",
    `Không dùng được profile NotebookLM "${profile}". Hãy chạy \`nlm login --profile ${profile}\` trong terminal của bạn.`,
    "AUTH",
  );
