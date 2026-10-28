import type { AiMode } from "@/server/ai/ai-provider";
import { createScenePlanCompiler } from "@/server/scene-plan";
import { createScriptStudioProvider } from "@/server/script-studio";

import type { PipelineDeps } from "./production-pipeline.service";

// Chosen once per run from AI_MODE. An unsupported mode throws here, before the item does any work.
export function createPipelineDeps(mode: AiMode): PipelineDeps {
  return {
    scriptStudio: createScriptStudioProvider(mode),
    compiler: createScenePlanCompiler(mode),
    // The real script studio reads the book through NotebookLM sources (group C); the offline mock needs none.
    resolveSources: async () => [],
  };
}
