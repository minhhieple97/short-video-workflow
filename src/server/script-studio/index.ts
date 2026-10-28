import type { AiMode } from "@/server/ai/ai-provider";
import { AppError } from "@/shared/errors";

import { MockScriptStudioProvider } from "./mock-script-studio-provider";
import type { ScriptStudioProvider } from "./script-studio-provider";

// The offline mock, or the reason no script studio can run. The real one (NotebookLM) needs the database for its
// notebook and source bindings, so it is built by the productions feature when AI_MODE=cli-auto and a profile is set.
// cli-task would wait for a person on every video, which an unattended batch cannot do.
export function createScriptStudioProvider(mode: AiMode): ScriptStudioProvider {
  if (mode === "mock") return new MockScriptStudioProvider();
  if (mode === "cli-auto") {
    throw new AppError(
      "SCRIPT_STUDIO_NOT_AVAILABLE",
      "Sản xuất với AI_MODE=cli-auto viết bản thảo bằng NotebookLM: hãy đặt NOTEBOOKLM_PROFILE (profile đã `nlm login`).",
      409,
    );
  }
  throw new AppError(
    "AI_MODE_UNSUPPORTED",
    "Sản xuất hàng loạt cần AI_MODE=cli-auto (hoặc mock); chế độ cli-task phải chờ bạn chạy `pnpm ai:run` từng tác vụ.",
    409,
  );
}
