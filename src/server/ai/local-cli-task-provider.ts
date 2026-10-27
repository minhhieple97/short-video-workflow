import { NotImplementedError } from "@/shared/errors";

import type { AiProvider, AiTaskResult } from "./ai-provider";
import type { ChapterAnalysisOutput } from "./contracts/chapter-analysis";

export class LocalCliTaskProvider implements AiProvider {
  readonly mode = "cli-task" as const;

  analyzeChapter(): Promise<AiTaskResult<ChapterAnalysisOutput>> {
    return Promise.reject(
      new NotImplementedError("Tác vụ AI qua Claude Code CLI (đặt AI_MODE=mock để dùng AI mẫu)", "M5"),
    );
  }
}
