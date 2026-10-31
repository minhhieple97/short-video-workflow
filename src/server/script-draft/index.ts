import type { AiMode } from "@/server/ai/ai-provider";

import { ClaudeScriptDraftWriter } from "./claude-script-draft-writer";
import { MockScriptDraftWriter } from "./mock-script-draft-writer";
import type { ScriptDraftWriter } from "./script-draft-writer";

export function createScriptDraftWriter(mode: AiMode): ScriptDraftWriter {
  return mode === "mock" ? new MockScriptDraftWriter() : new ClaudeScriptDraftWriter(mode);
}
