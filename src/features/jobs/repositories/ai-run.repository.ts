import type { AiRun } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

interface NewAiRun {
  jobRecordId: string | null;
  mode: string;
  promptVersion: string;
  inputHash: string;
  stage?: string;
  taskId?: string;
  executionJson?: { model: string; effort: string };
}

// A job resumed after `pnpm ai:run` continues the AI run it started instead of opening a new one.
export async function startAiRun(data: NewAiRun): Promise<AiRun> {
  if (data.jobRecordId) {
    const waiting = await prisma.aiRun.findFirst({
      where: {
        jobRecordId: data.jobRecordId,
        stage: data.stage ?? null,
        ...(data.stage ? { inputHash: data.inputHash } : {}),
        status: "WAITING_FOR_CLI",
      },
    });
    if (waiting) return prisma.aiRun.update({ where: { id: waiting.id }, data: { status: "RUNNING" } });
  }
  return prisma.aiRun.create({ data: { ...data, status: "RUNNING" } });
}

export async function findWaitingTaskId(jobRecordId: string): Promise<string | null> {
  const run = await prisma.aiRun.findFirst({
    where: { jobRecordId, status: "WAITING_FOR_CLI" },
    orderBy: { createdAt: "desc" },
    select: { taskId: true },
  });
  return run?.taskId ?? null;
}

export function markAiRunWaiting(id: string): Promise<AiRun> {
  return prisma.aiRun.update({ where: { id }, data: { status: "WAITING_FOR_CLI" } });
}

export function completeAiRun(id: string, outputPath: string): Promise<AiRun> {
  return prisma.aiRun.update({ where: { id }, data: { status: "COMPLETED", outputPath, completedAt: new Date() } });
}

export function failAiRun(id: string, errorMessage: string): Promise<AiRun> {
  return prisma.aiRun.update({ where: { id }, data: { status: "FAILED", errorMessage, completedAt: new Date() } });
}

export async function hasCompletedAiRun(inputHash: string): Promise<boolean> {
  return (await prisma.aiRun.count({ where: { inputHash, status: "COMPLETED" } })) > 0;
}

// The latest completed run of this kind for this input; with `completedAfter`, only one that finished after that time.
export function findCompletedAiRun(input: {
  mode: string;
  inputHash: string;
  completedAfter: Date | null;
}): Promise<AiRun | null> {
  return prisma.aiRun.findFirst({
    where: {
      mode: input.mode,
      inputHash: input.inputHash,
      status: "COMPLETED",
      ...(input.completedAfter ? { completedAt: { gt: input.completedAfter } } : {}),
    },
    orderBy: { completedAt: "desc" },
  });
}

export async function failWaitingAiRuns(jobRecordId: string, errorMessage: string): Promise<void> {
  await prisma.aiRun.updateMany({
    where: { jobRecordId, status: { in: ["WAITING_FOR_CLI", "RUNNING"] } },
    data: { status: "FAILED", errorMessage, completedAt: new Date() },
  });
}
