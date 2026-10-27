import type { AiMode, AiProvider } from "./ai-provider";
import { AutomatedCliProvider } from "./automated-cli-provider";
import { LocalCliTaskProvider } from "./local-cli-task-provider";
import { MockAiProvider } from "./mock-ai-provider";

export function createAiProvider(mode: AiMode): AiProvider {
  if (mode === "mock") return new MockAiProvider();
  return mode === "cli-auto" ? new AutomatedCliProvider() : new LocalCliTaskProvider();
}
