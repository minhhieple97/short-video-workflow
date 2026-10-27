import type { AiProvider } from "./ai-provider";
import { LocalCliTaskProvider } from "./local-cli-task-provider";
import { MockAiProvider } from "./mock-ai-provider";

export function createAiProvider(mode: AiProvider["mode"]): AiProvider {
  return mode === "mock" ? new MockAiProvider() : new LocalCliTaskProvider();
}
