import { resolveLessonSources } from "@/features/notebooklm/services/lesson-sources.service";
import { NotebookLmScriptStudio } from "@/features/notebooklm/services/notebooklm-script-studio";
import {
  notebookStudioSettings,
  type NotebookStudioSettings,
} from "@/features/notebooklm/services/notebook-studio.service";
import type { AiMode } from "@/server/ai/ai-provider";
import { createScenePlanCompiler } from "@/server/scene-plan";
import { createScriptStudioProvider } from "@/server/script-studio";

import type { PipelineDeps } from "./production-pipeline.service";

// Chosen once per run from AI_MODE. In cli-auto the script studio is NotebookLM, reading the chapters the lesson cites;
// its server process lives for the run and is closed by `close`. An unsupported mode throws here, before any work.
export function createPipelineDeps(
  mode: AiMode,
  notebook: NotebookStudioSettings | null = notebookStudioSettings(),
): PipelineDeps {
  if (mode === "cli-auto" && notebook) {
    const studio = new NotebookLmScriptStudio(notebook);
    return {
      scriptStudio: studio,
      compiler: createScenePlanCompiler(mode),
      resolveSources: (input) => resolveLessonSources(studio, input),
      close: () => studio.close(),
    };
  }
  return {
    scriptStudio: createScriptStudioProvider(mode),
    compiler: createScenePlanCompiler(mode),
    // The offline mock reads no sources.
    resolveSources: async () => [],
  };
}
