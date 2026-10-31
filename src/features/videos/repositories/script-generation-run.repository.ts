import { Prisma, type ScriptGenerationRun } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { AiSettings } from "@/features/settings/domain/ai-settings";
import type { GenerationInput } from "@/server/script-draft/contracts";

export function createGenerationRunWithin(
  tx: Prisma.TransactionClient,
  input: {
    ownerKey: string;
    videoId: string;
    baseScriptVersion: number;
    settings: AiSettings;
    context: GenerationInput;
  },
): Promise<ScriptGenerationRun> {
  return tx.scriptGenerationRun.create({
    data: {
      ownerKey: input.ownerKey,
      videoId: input.videoId,
      baseScriptVersion: input.baseScriptVersion,
      settingsJson: input.settings,
      inputJson: input.context,
    },
  });
}

export function findGenerationRun(id: string): Promise<ScriptGenerationRun | null> {
  return prisma.scriptGenerationRun.findUnique({ where: { id } });
}

export async function saveGenerationSourceOnce(
  id: string,
  sourcePack: Prisma.InputJsonObject,
): Promise<ScriptGenerationRun> {
  await prisma.scriptGenerationRun.updateMany({
    where: { id, sourcePackJson: { equals: Prisma.DbNull } },
    data: { sourcePackJson: sourcePack },
  });
  return prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id } });
}

export async function saveGenerationArtifact(
  id: string,
  stage: "draft" | "scene",
  artifact: Prisma.InputJsonObject,
  cast?: Prisma.InputJsonObject,
): Promise<ScriptGenerationRun> {
  await prisma.scriptGenerationRun.updateMany({
    where: {
      id,
      ...(stage === "draft"
        ? { draftArtifactJson: { equals: Prisma.DbNull } }
        : { scenePlanArtifactJson: { equals: Prisma.DbNull } }),
    },
    data:
      stage === "draft"
        ? { draftArtifactJson: artifact, ...(cast ? { castJson: cast } : {}) }
        : { scenePlanArtifactJson: artifact },
  });
  return prisma.scriptGenerationRun.findUniqueOrThrow({ where: { id } });
}
