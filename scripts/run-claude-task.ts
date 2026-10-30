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
import { askClaude } from "@/server/ai/cli-task/ask-claude";
import {
  readTaskMeta,
  readTaskOutput,
  taskDirectory,
  writeTaskOutput,
  type TaskMeta,
} from "@/server/ai/cli-task/task-files";
import { prisma } from "@/server/db/client";
import { addStudioJob, createStudioQueue } from "@/server/queue/producer";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

const { values } = parseArgs({
  options: { job: { type: "string" }, list: { type: "boolean" }, "dry-run": { type: "boolean" } },
  strict: true,
});

async function listWaiting(): Promise<number> {
  const jobs = await listJobsWaitingForCli();
  if (jobs.length === 0) console.log("Không có tác vụ nào đang chờ Claude Code CLI.");
  for (const job of jobs)
    console.log(`${job.jobType}  ${job.entityType}:${job.entityId}\n  pnpm ai:run --job ${job.id}`);
  return 0;
}

async function requeue(jobId: string, meta: TaskMeta): Promise<void> {
  if (!meta.resume) throw new AppError("AI_TASK_NOT_RESUMABLE", "Tác vụ này không gắn với job nào để tiếp tục.");
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
    const ai = getAppConfig().ai;
    console.log(
      `Thư mục tác vụ: ${taskDirectory(jobId)}\nPrompt: prompt.md · Schema: schema.json · Loại: ${meta.kind}`,
    );
    console.log(
      `Lệnh sẽ chạy: ${ai.claudeCliCommand} -p${ai.claudeModel ? " --model <CLAUDE_MODEL>" : ""}${ai.claudeEffort ? ` --effort ${ai.claudeEffort}` : ""} --output-format json --tools "" --strict-mcp-config --no-session-persistence --json-schema <schema.json> < prompt.md`,
    );
    console.log(`Model yêu cầu: ${ai.claudeModel ?? "Theo mặc định Claude CLI"}`);
    console.log(`Effort yêu cầu: ${ai.claudeEffort ?? "Theo mặc định Claude CLI"}`);
    return 0;
  }

  try {
    const existing = await readTaskOutput(jobId);
    if (existing === undefined) {
      const output = await askClaude(jobId, meta.kind, {
        onStart: (method) => console.log(`Đang gọi Claude Code (${method}) cho ${meta.kind}…`),
      });
      await writeTaskOutput(jobId, output);
    } else console.log("Đã có output.json hợp lệ — không gọi lại Claude.");
    await requeue(jobId, meta);
    console.log("Xong. Worker sẽ kiểm tra lại kết quả và lưu vào Studio; theo dõi ở trang Tác vụ.");
    return 0;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
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
