import type { AiTaskContext, AiTaskResult } from "@/server/ai/ai-provider";

import type { DraftRequest, StoryDraft } from "./contracts";

export interface ScriptDraftWriter {
  readonly id: string;
  writeDraft(request: DraftRequest, context: AiTaskContext): Promise<AiTaskResult<StoryDraft>>;
}
