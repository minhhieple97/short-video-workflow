import { createHash } from "node:crypto";

import { ZodError } from "zod";

import { completeAiRun, failAiRun, markAiRunWaiting, startAiRun } from "@/features/jobs/repositories/ai-run.repository";
import type { AiTaskContext } from "@/server/ai/ai-provider";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { AppError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

export interface AiWaitingForCli {
  waitingForCli: true;
  taskDir: string;
}

export type AiWorkResult<T> = { kind: "waiting"; taskDir: string } | { kind: "done"; value: T; output: unknown };

export const inputHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Records one AI task as an AiRun: waiting for the CLI, completed with its output saved under ai-tasks/, or failed. Output
// that does not match its schema fails with INVALID_AI_OUTPUT and `invalidOutputMessage`, and nothing is stored.
export async function withAiRun<T>(
  meta: {
    jobRecordId: string | null;
    mode: string;
    promptVersion: string;
    hash: string;
    invalidOutputMessage: string;
    resume?: AiTaskContext["resume"];
    signal?: AbortSignal;
  },
  work: (context: AiTaskContext) => Promise<AiWorkResult<T>>,
): Promise<T | AiWaitingForCli> {
  const aiRun = await startAiRun({
    jobRecordId: meta.jobRecordId,
    mode: meta.mode,
    promptVersion: meta.promptVersion,
    inputHash: meta.hash,
  });
  const taskId = meta.jobRecordId ?? aiRun.id;
  try {
    const result = await work({ taskId, resume: meta.resume, signal: meta.signal });
    if (result.kind === "waiting") {
      await markAiRunWaiting(aiRun.id);
      return { waitingForCli: true, taskDir: result.taskDir };
    }
    const { value, output } = result;
    const outputPath = `ai-tasks/${taskId}/output.json`;
    await writeFileAtomic(dataPath(outputPath), `${JSON.stringify(output, null, 2)}\n`);
    await completeAiRun(aiRun.id, outputPath);
    return value;
  } catch (error) {
    const failure =
      error instanceof ZodError
        ? new AppError("INVALID_AI_OUTPUT", meta.invalidOutputMessage, 422, { cause: error })
        : error;
    await failAiRun(aiRun.id, toSafeErrorMessage(failure));
    throw failure;
  }
}
