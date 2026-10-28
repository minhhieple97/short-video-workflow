import type { AiMode } from "@/server/ai/ai-provider";
import { AppError } from "@/shared/errors";

import { ClaudeScenePlanCompiler } from "./claude-scene-plan-compiler";
import { MockScenePlanCompiler } from "./mock-scene-plan-compiler";
import type { ScenePlanCompiler } from "./scene-plan-compiler";

// The production pipeline runs unattended, so it needs a compiler that answers by itself: the mock, or Claude through
// cli-auto. cli-task waits for a human to run `pnpm ai:run`, which a batch of videos cannot do.
export function createScenePlanCompiler(mode: AiMode): ScenePlanCompiler {
  if (mode === "mock") return new MockScenePlanCompiler();
  if (mode === "cli-auto") return new ClaudeScenePlanCompiler();
  throw new AppError(
    "AI_MODE_UNSUPPORTED",
    "Sản xuất hàng loạt cần AI_MODE=cli-auto (hoặc mock); chế độ cli-task phải chờ bạn chạy `pnpm ai:run` từng tác vụ.",
    409,
  );
}
