import type { ScriptDraftCache } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export function findCachedDraft(cacheKey: string): Promise<ScriptDraftCache | null> {
  return prisma.scriptDraftCache.findUnique({ where: { cacheKey } });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// The first draft stored for a key stays; a second writer with the same key (a replayed step) changes nothing.
export async function storeCachedDraft(input: {
  cacheKey: string;
  provider: string;
  draftVersion: string;
  lessonId: string;
  draftJson: string;
}): Promise<void> {
  try {
    await prisma.scriptDraftCache.create({ data: input });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}
