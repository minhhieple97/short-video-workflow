import type { AiRun } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

interface NewAiRun {
  jobRecordId: string | null;
  mode: string;
  promptVersion: string;
  inputHash: string;
}

export function createAiRun(data: NewAiRun): Promise<AiRun> {
  return prisma.aiRun.create({ data: { ...data, status: "RUNNING" } });
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
