import type { ScriptStudioProvider } from "@/server/script-studio/script-studio-provider";
import { scriptDraftSchema, type ScriptDraft } from "@/server/script-studio/script-studio-contracts";
import { createLogger } from "@/shared/logger";

import { findCachedDraft, storeCachedDraft } from "../repositories/script-draft-cache.repository";

const logger = createLogger("productions.draft-cache");

// A draft written for the same request before (the key includes the lesson). A stored draft that no longer passes the
// draft contract (the contract changed) is ignored, never repaired.
export async function readCachedDraft(cacheKey: string): Promise<ScriptDraft | null> {
  const cached = await findCachedDraft(cacheKey);
  if (!cached) return null;
  let json: unknown;
  try {
    json = JSON.parse(cached.draftJson);
  } catch {
    return null;
  }
  const draft = scriptDraftSchema.safeParse(json);
  if (!draft.success) {
    logger.warn("Cached draft ignored", { cacheKey });
    return null;
  }
  return draft.data;
}

export function cacheDraft(
  cacheKey: string,
  studio: Pick<ScriptStudioProvider, "id" | "draftVersion">,
  draft: ScriptDraft,
): Promise<void> {
  return storeCachedDraft({
    cacheKey,
    provider: studio.id,
    draftVersion: studio.draftVersion,
    lessonId: draft.lessonId,
    draftJson: JSON.stringify(draft),
  });
}
