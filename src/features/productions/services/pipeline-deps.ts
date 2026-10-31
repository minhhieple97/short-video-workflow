import { resolveLessonSources } from "@/features/notebooklm/services/lesson-sources.service";
import { NotebookLmScriptStudio } from "@/features/notebooklm/services/notebooklm-script-studio";
import {
  notebookStudioSettings,
  type NotebookStudioSettings,
} from "@/features/notebooklm/services/notebook-studio.service";
import type { AiMode } from "@/server/ai/ai-provider";
import { createScenePlanCompiler } from "@/server/scene-plan";
import { createScriptStudioProvider } from "@/server/script-studio";
import { createScriptDraftWriter } from "@/server/script-draft";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";

import type { PipelineDeps } from "./production-pipeline.service";

// Chosen once per run from AI_MODE. An item with a script generation run (`opusDraft`) is drafted by the script writer
// from its local source pack. An older item keeps the script studio: in cli-auto NotebookLM, reading the chapters the
// lesson cites, whose server process lives for the run and is closed by `close`. An unsupported mode throws here,
// before any work.
export function createPipelineDeps(
  mode: AiMode,
  notebook: NotebookStudioSettings | null = notebookStudioSettings(),
  opusDraft = false,
): PipelineDeps {
  if (opusDraft) {
    return {
      mode,
      scriptWriter: createScriptDraftWriter(mode),
      scriptStudio: new MockScriptStudioProvider(),
      compiler: createScenePlanCompiler(mode),
      resolveSources: async () => [],
    };
  }
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
