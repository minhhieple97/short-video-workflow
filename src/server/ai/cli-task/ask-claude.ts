import { getAppConfig } from "@/shared/config/env";
import { AppError, JobCancelledError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

import { classifyCliFailure, extractJsonObject, parseClaudeEnvelope } from "./claude-output";
import { checkClaudeAuth, runClaudePrint } from "./claude-runner";
import { readTaskText, TASK_OUTPUT_SCHEMAS, writeRawOutput, type TaskKind } from "./task-files";

const failure = (code: string, message: string) => new AppError(code, message, 502);

// Runs one prepared task (prompt.md + schema.json) through the user's own Claude Code CLI and returns the
// schema-valid output. Shared by `pnpm ai:run` and the opt-in AutomatedCliProvider; raw output that cannot be used
// is kept in output.raw.txt.
export async function askClaude(
  taskId: string,
  kind: TaskKind,
  options: { signal?: AbortSignal; onStart?: (authMethod: string) => void } = {},
): Promise<unknown> {
  const { claudeCliCommand, taskTimeoutMs } = getAppConfig().ai;
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
  const result = await runClaudePrint({
    command: claudeCliCommand,
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
    throw failure(
      failureKind === "QUOTA" ? "AI_QUOTA_EXCEEDED" : failureKind === "AUTH" ? "AI_CLI_AUTH" : "AI_CLI_ERROR",
      "Claude Code trả về kết quả không đọc được (đã lưu output.raw.txt).",
    );
  }
  if (envelope.isError || result.exitCode !== 0) {
    await writeRawOutput(taskId, envelope.text || result.stderr);
    const failureKind = classifyCliFailure(`${envelope.text} ${result.stderr}`);
    if (failureKind === "QUOTA") {
      throw failure("AI_QUOTA_EXCEEDED", "Đã hết hạn mức Claude. Thử lại sau khi hạn mức được làm mới.");
    }
    if (failureKind === "AUTH") throw failure("AI_CLI_AUTH", "Claude Code chưa đăng nhập hoặc phiên đã hết hạn.");
    throw failure("AI_CLI_ERROR", `Claude Code báo lỗi: ${envelope.text.slice(0, 300)}`);
  }

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
