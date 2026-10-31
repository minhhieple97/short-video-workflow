import { getAppConfig } from "@/shared/config/env";
import { IntegrationError } from "@/server/integrations/integration-error";
import { AppError, JobCancelledError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";
import type { AiExecution } from "@/features/settings/domain/ai-settings";

import {
  claudeQuotaRetryAfterMs,
  classifyCliFailure,
  extractJsonObject,
  isRequestedModel,
  parseClaudeEnvelope,
} from "./claude-output";
import { checkClaudeAuth, runClaudePrint } from "./claude-runner";
import {
  readTaskMeta,
  readTaskText,
  TASK_OUTPUT_SCHEMAS,
  writeRawOutput,
  writeTaskExecution,
  type TaskKind,
} from "./task-files";

const failure = (code: string, message: string) =>
  ["AI_CLI_TIMEOUT", "AI_CLI_ERROR"].includes(code)
    ? new IntegrationError(code, message, "TRANSIENT")
    : new AppError(code, message, 502);

const logger = createLogger("ai.claude");
const modelFailure = () =>
  failure(
    "AI_CLI_MODEL_UNAVAILABLE",
    "Model Claude không hợp lệ hoặc tài khoản không được phép dùng. Kiểm tra cấu hình AI của tác vụ.",
  );

// Runs one prepared task (prompt.md + schema.json) through the user's own Claude Code CLI and returns the
// schema-valid output. Shared by `pnpm ai:run` and the opt-in AutomatedCliProvider; raw output that cannot be used
// is kept in output.raw.txt.
export async function askClaude(
  taskId: string,
  kind: TaskKind,
  options: { signal?: AbortSignal; onStart?: (authMethod: string) => void; execution?: AiExecution } = {},
): Promise<unknown> {
  const { withProviderCooldown } = await import("@/features/jobs/services/provider-cooldown.service");
  return withProviderCooldown("claude", () => executeClaude(taskId, kind, options));
}

async function executeClaude(
  taskId: string,
  kind: TaskKind,
  options: { signal?: AbortSignal; onStart?: (authMethod: string) => void; execution?: AiExecution },
): Promise<unknown> {
  const ai = getAppConfig().ai;
  const meta = await readTaskMeta(taskId);
  const execution = meta.execution ?? options.execution;
  const { claudeCliCommand, taskTimeoutMs } = ai;
  const claudeModel = execution?.model ?? ai.claudeModel;
  const claudeEffort = execution?.effort ?? ai.claudeEffort;
  const auth = await checkClaudeAuth(claudeCliCommand).catch((error: unknown) => {
    throw failure(
      "AI_CLI_MISSING",
      `Không chạy được "${claudeCliCommand}": ${toSafeErrorMessage(error)}. Cài Claude Code rồi thử lại.`,
    );
  });
  if (!auth.loggedIn) {
    throw failure("AI_CLI_AUTH", "Claude Code chưa đăng nhập. Chạy `claude` rồi `/login` trong terminal của bạn.");
  }

  options.onStart?.(auth.method);
  logger.info("Claude task started", {
    taskId,
    kind,
    requestedModel: claudeModel ?? null,
    requestedEffort: claudeEffort ?? null,
  });
  const result = await runClaudePrint({
    command: claudeCliCommand,
    model: claudeModel,
    effort: claudeEffort,
    prompt: await readTaskText(taskId, "prompt.md"),
    jsonSchema: await readTaskText(taskId, "schema.json"),
    timeoutMs: taskTimeoutMs,
    signal: options.signal,
  });
  if (options.signal?.aborted) throw new JobCancelledError();
  if (result.timedOut) throw failure("AI_CLI_TIMEOUT", `Claude Code chạy quá ${taskTimeoutMs / 1000} giây.`);

  let envelope;
  try {
    envelope = parseClaudeEnvelope(result.stdout);
  } catch {
    await writeRawOutput(taskId, `${result.stdout}\n--- stderr ---\n${result.stderr}`);
    const failureKind = classifyCliFailure(`${result.stderr} ${result.stdout}`);
    if (failureKind === "MODEL") throw modelFailure();
    if (failureKind === "QUOTA") throw quotaFailure(result.stdout, result.stderr);
    throw failure(
      failureKind === "AUTH" ? "AI_CLI_AUTH" : "AI_CLI_ERROR",
      "Claude Code trả về kết quả không đọc được (đã lưu output.raw.txt).",
    );
  }
  if (envelope.isError || result.exitCode !== 0) {
    await writeRawOutput(taskId, envelope.text || result.stderr);
    const failureKind = classifyCliFailure(`${envelope.text} ${result.stderr}`);
    if (failureKind === "MODEL") throw modelFailure();
    if (failureKind === "QUOTA") {
      throw quotaFailure(result.stdout, result.stderr);
    }
    if (failureKind === "AUTH") throw failure("AI_CLI_AUTH", "Claude Code chưa đăng nhập hoặc phiên đã hết hạn.");
    throw failure("AI_CLI_ERROR", "Claude Code báo lỗi; xem output.raw.txt trong thư mục tác vụ.");
  }

  await writeTaskExecution(taskId, {
    requestedModel: claudeModel ?? null,
    requestedEffort: claudeEffort ?? null,
    primaryModel: envelope.primaryModel ?? null,
    observedModels: envelope.models ?? [],
  });
  // Only the model that did the work counts: the CLI also reports a small helper model on every run.
  if (execution && envelope.primaryModel && !isRequestedModel(envelope.primaryModel, execution.model))
    throw failure(
      "AI_CLI_MODEL_MISMATCH",
      "Claude Code đã dùng model khác cấu hình của tác vụ; kết quả không được áp dụng.",
    );

  let candidate: unknown;
  try {
    candidate = envelope.structured ?? extractJsonObject(envelope.text);
  } catch {
    candidate = undefined;
  }
  const parsed = TASK_OUTPUT_SCHEMAS[kind].safeParse(candidate);
  if (!parsed.success) {
    await writeRawOutput(taskId, envelope.text || JSON.stringify(candidate, null, 2));
    throw failure("INVALID_AI_OUTPUT", "Kết quả của Claude không đúng schema; không lưu gì (xem output.raw.txt).");
  }
  return parsed.data;
}

function quotaFailure(stdout: string, stderr: string): IntegrationError {
  return new IntegrationError(
    "AI_QUOTA_EXCEEDED",
    "Đã hết hạn mức Claude. Tự động chờ hạn mức được làm mới.",
    "QUOTA",
    {
      retryAfterMs: claudeQuotaRetryAfterMs(`${stdout}\n${stderr}`),
    },
  );
}
