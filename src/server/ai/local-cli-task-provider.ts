import { NotImplementedError } from "@/shared/errors";

import type { AiProvider, AiTaskResult } from "./ai-provider";
import type { ChapterAnalysisOutput } from "./contracts/chapter-analysis";
import type { SceneRegenerationOutput, VideoScriptOutput } from "./contracts/video-script";

const notYet = () =>
  Promise.reject(new NotImplementedError("Tác vụ AI qua Claude Code CLI (đặt AI_MODE=mock để dùng AI mẫu)", "M5"));

export class LocalCliTaskProvider implements AiProvider {
  readonly mode = "cli-task" as const;

  analyzeChapter(): Promise<AiTaskResult<ChapterAnalysisOutput>> {
    return notYet();
  }

  generateVideoScript(): Promise<AiTaskResult<VideoScriptOutput>> {
    return notYet();
  }

  regenerateScene(): Promise<AiTaskResult<SceneRegenerationOutput>> {
    return notYet();
  }
}
