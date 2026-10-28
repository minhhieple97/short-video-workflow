import type { AiMode } from "@/server/ai/ai-provider";
import { AppError } from "@/shared/errors";

import { MockScriptStudioProvider } from "./mock-script-studio-provider";
import type { ScriptStudioProvider } from "./script-studio-provider";

// The real script studio is NotebookLM (not wired up yet), so only the offline mock can answer today. cli-task would wait
// for a person on every video, which an unattended batch cannot do.
export function createScriptStudioProvider(mode: AiMode): ScriptStudioProvider {
  if (mode === "mock") return new MockScriptStudioProvider();
  if (mode === "cli-auto") {
    throw new AppError(
      "SCRIPT_STUDIO_NOT_AVAILABLE",
      "Chưa có nhà cung cấp kịch bản thật (NotebookLM) được nối vào; hiện chỉ chạy được với AI_MODE=mock.",
      409,
    );
  }
  throw new AppError(
    "AI_MODE_UNSUPPORTED",
    "Sản xuất hàng loạt cần AI_MODE=cli-auto (hoặc mock); chế độ cli-task phải chờ bạn chạy `pnpm ai:run` từng tác vụ.",
    409,
  );
}
