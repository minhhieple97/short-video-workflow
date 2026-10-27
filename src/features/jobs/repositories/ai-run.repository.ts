import type { AiRun } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

interface NewAiRun {
  jobRecordId: string | null;
  mode: string;
  promptVersion: string;
  inputHash: string;
}

// A job resumed after `pnpm ai:run` continues the AI run it started instead of opening a new one.
export async function startAiRun(data: NewAiRun): Promise<AiRun> {
  if (data.jobRecordId) {
    const waiting = await prisma.aiRun.findFirst({
      where: { jobRecordId: data.jobRecordId, status: "WAITING_FOR_CLI" },
    });
    if (waiting) return prisma.aiRun.update({ where: { id: waiting.id }, data: { status: "RUNNING" } });
  }
  return prisma.aiRun.create({ data: { ...data, status: "RUNNING" } });
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

export async function failWaitingAiRuns(jobRecordId: string, errorMessage: string): Promise<void> {
  await prisma.aiRun.updateMany({
    where: { jobRecordId, status: { in: ["WAITING_FOR_CLI", "RUNNING"] } },
    data: { status: "FAILED", errorMessage, completedAt: new Date() },
  });
}
