import { createHash } from "node:crypto";

import type { ScriptStudioProvider } from "@/server/script-studio/script-studio-provider";

export interface DraftRequestIdentity {
  lessonId: string;
  // Null for a lesson snapshot taken before content hashes existed; such a draft is still keyed by the lesson id.
  lessonContentHash: string | null;
  targetDurationSec: number;
  // Remote source references change with every new revision of a source's text.
  sourceRemoteIds: readonly string[];
  revisionNote: string | null;
}

// Everything a draft is written from: two requests with the same key would be answered the same way.
export function draftCacheKey(
  studio: Pick<ScriptStudioProvider, "id" | "draftVersion">,
  request: DraftRequestIdentity,
) {
  const normalized = {
    provider: studio.id,
    draftVersion: studio.draftVersion,
    ...request,
    sourceRemoteIds: [...new Set(request.sourceRemoteIds)].sort(),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
