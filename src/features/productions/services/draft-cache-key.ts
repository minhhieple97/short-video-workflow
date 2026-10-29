import { createHash } from "node:crypto";

import type { StoryAngle } from "@/features/videos/domain/story-angle";
import type { ScriptStudioProvider } from "@/server/script-studio/script-studio-provider";

export interface DraftRequestIdentity {
  lessonId: string;
  // Null for a lesson snapshot taken before content hashes existed; such a draft is still keyed by the lesson id.
  lessonContentHash: string | null;
  // The draft proposes its own length inside this range, so the range (not a length) is part of the request.
  minDurationSec: number;
  maxDurationSec: number;
  // How fast the narration will be voiced: the draft is written to the words that fit at that speed.
  pace: string;
  // The same lesson told another way is another draft.
  storyAngle: StoryAngle;
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
