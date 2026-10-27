import "dotenv/config";

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { failWaitingAiRuns } from "@/features/jobs/repositories/ai-run.repository";
import {
  findJobRecordById,
  listJobsWaitingForCli,
  markJobFailed,
  markJobWaitingForCli,
  requeueJobRecord,
} from "@/features/jobs/repositories/job-record.repository";
import { releaseJobEntity } from "@/features/jobs/services/job-effects";
import { classifyCliFailure, extractJsonObject, parseClaudeEnvelope } from "@/server/ai/cli-task/claude-output";
import { checkClaudeAuth, runClaudePrint } from "@/server/ai/cli-task/claude-runner";
import {
  readTaskMeta,
  readTaskOutput,
  readTaskText,
  taskDirectory,
  TASK_OUTPUT_SCHEMAS,
  writeRawOutput,
  writeTaskOutput,
  type TaskMeta,
} from "@/server/ai/cli-task/task-files";
import { prisma } from "@/server/db/client";
import { addStudioJob, createStudioQueue } from "@/server/queue/producer";
import { getAppConfig } from "@/shared/config/env";
import { toSafeErrorMessage } from "@/shared/logger";

const { values } = parseArgs({
  options: { job: { type: "string" }, list: { type: "boolean" }, "dry-run": { type: "boolean" } },
  strict: true,
});

class TaskFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function listWaiting(): Promise<number> {
  const jobs = await listJobsWaitingForCli();
  if (jobs.length === 0) console.log("Không có tác vụ nào đang chờ Claude Code CLI.");
  for (const job of jobs)
    console.log(`${job.jobType}  ${job.entityType}:${job.entityId}\n  pnpm ai:run --job ${job.id}`);
  return 0;
}

async function askClaude(jobId: string, meta: TaskMeta): Promise<unknown> {
  const { claudeCliCommand, taskTimeoutMs } = getAppConfig().ai;
  const auth = await checkClaudeAuth(claudeCliCommand).catch((error: unknown) => {
    throw new TaskFailure(
      "AI_CLI_MISSING",
      `Không chạy được "${claudeCliCommand}": ${toSafeErrorMessage(error)}. Cài Claude Code rồi thử lại.`,
    );
  });
  if (!auth.loggedIn)
    throw new TaskFailure(
      "AI_CLI_AUTH",
      "Claude Code chưa đăng nhập. Chạy `claude` rồi `/login` trong terminal của bạn.",
    );

  console.log(`Đang gọi Claude Code (${auth.method}) cho ${meta.kind}…`);
  const result = await runClaudePrint({
    command: claudeCliCommand,
    prompt: await readTaskText(jobId, "prompt.md"),
    jsonSchema: await readTaskText(jobId, "schema.json"),
    timeoutMs: taskTimeoutMs,
  });
  if (result.timedOut) throw new TaskFailure("AI_CLI_TIMEOUT", `Claude Code chạy quá ${taskTimeoutMs / 1000} giây.`);

  let envelope;
  try {
    envelope = parseClaudeEnvelope(result.stdout);
  } catch {
    await writeRawOutput(jobId, `${result.stdout}\n--- stderr ---\n${result.stderr}`);
    const kind = classifyCliFailure(`${result.stderr} ${result.stdout}`);
    throw new TaskFailure(
      kind === "QUOTA" ? "AI_QUOTA_EXCEEDED" : kind === "AUTH" ? "AI_CLI_AUTH" : "AI_CLI_ERROR",
      "Claude Code trả về kết quả không đọc được (đã lưu output.raw.txt).",
    );
  }
  if (envelope.isError || result.exitCode !== 0) {
    await writeRawOutput(jobId, envelope.text || result.stderr);
    const kind = classifyCliFailure(`${envelope.text} ${result.stderr}`);
    if (kind === "QUOTA")
      throw new TaskFailure("AI_QUOTA_EXCEEDED", "Đã hết hạn mức Claude. Thử lại sau khi hạn mức được làm mới.");
    if (kind === "AUTH") throw new TaskFailure("AI_CLI_AUTH", "Claude Code chưa đăng nhập hoặc phiên đã hết hạn.");
    throw new TaskFailure("AI_CLI_ERROR", `Claude Code báo lỗi: ${envelope.text.slice(0, 300)}`);
  }

  const candidate = envelope.structured ?? extractJsonObject(envelope.text);
  const parsed = TASK_OUTPUT_SCHEMAS[meta.kind].safeParse(candidate);
  if (!parsed.success) {
    await writeRawOutput(jobId, envelope.text || JSON.stringify(candidate, null, 2));
    throw new TaskFailure(
      "INVALID_AI_OUTPUT",
      "Kết quả của Claude không đúng schema; không lưu gì (xem output.raw.txt).",
    );
  }
  return parsed.data;
}

async function requeue(jobId: string, meta: TaskMeta): Promise<void> {
  if (!meta.resume) throw new TaskFailure("AI_TASK_NOT_RESUMABLE", "Tác vụ này không gắn với job nào để tiếp tục.");
  const queue = createStudioQueue();
  const bullmqJobId = randomUUID();
  try {
    await requeueJobRecord(jobId, bullmqJobId);
    await addStudioJob(queue, meta.resume.jobType, { ...meta.resume.payload, jobRecordId: jobId }, bullmqJobId);
  } catch (error) {
    await markJobWaitingForCli(jobId);
    throw new Error(`Đã lưu kết quả nhưng không đưa lại được vào hàng đợi (Redis?): ${toSafeErrorMessage(error)}`, {
      cause: error,
    });
  } finally {
    await queue.close();
  }
}

async function runTask(jobId: string): Promise<number> {
  const record = await findJobRecordById(jobId);
  if (!record) {
    console.error(`Không tìm thấy tác vụ ${jobId}.`);
    return 1;
  }
  if (record.status !== "WAITING_FOR_CLI") {
    console.error(`Tác vụ đang ở trạng thái ${record.status}, không chờ Claude CLI.`);
    return 1;
  }
  const meta = await readTaskMeta(jobId);
  if (values["dry-run"]) {
    console.log(
      `Thư mục tác vụ: ${taskDirectory(jobId)}\nPrompt: prompt.md · Schema: schema.json · Loại: ${meta.kind}`,
    );
    console.log(
      `Lệnh sẽ chạy: ${getAppConfig().ai.claudeCliCommand} -p --output-format json --tools "" --no-session-persistence --json-schema <schema.json> < prompt.md`,
    );
    return 0;
  }

  try {
    const existing = await readTaskOutput(jobId);
    if (existing === undefined) await writeTaskOutput(jobId, await askClaude(jobId, meta));
    else console.log("Đã có output.json hợp lệ — không gọi lại Claude.");
    await requeue(jobId, meta);
    console.log("Xong. Worker sẽ kiểm tra lại kết quả và lưu vào Studio; theo dõi ở trang Tác vụ.");
    return 0;
  } catch (error) {
    if (!(error instanceof TaskFailure)) throw error;
    await markJobFailed(jobId, error.code, error.message);
    await failWaitingAiRuns(jobId, error.message);
    await releaseJobEntity(record, "FAILED", error.message);
    console.error(`${error.code}: ${error.message}`);
    return 1;
  }
}

async function main(): Promise<number> {
  if (values.list) return listWaiting();
  if (!values.job) {
    console.error("Cách dùng: pnpm ai:run --job <jobId> [--dry-run]  |  pnpm ai:run --list");
    return 2;
  }
  return runTask(values.job);
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error(toSafeErrorMessage(error));
    await prisma.$disconnect();
    process.exit(1);
  });
