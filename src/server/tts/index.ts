import { AppError } from "@/shared/errors";
import { getAppConfig, type AppConfig } from "@/shared/config/env";

import { EdgeTtsProvider } from "./edge/edge-tts-provider";
import { edgeTtsWordsScript, resolveEdgeTtsPython } from "./edge/edge-tts-python";
import type { TtsProvider } from "./tts-provider";

// edge-tts is the only provider today; another one is a new TTS_MODE value that is chosen here.
export function createTtsProvider(tts: AppConfig["tts"] = getAppConfig().tts): TtsProvider {
  switch (tts.mode) {
    case "edge-tts":
      return new EdgeTtsProvider({
        python: resolveEdgeTtsPython({ explicit: tts.edgeTtsPython, command: tts.edgeTtsCommand }),
        script: edgeTtsWordsScript(),
      });
    case "upload":
      throw new AppError("TTS_DISABLED", "TTS_MODE=upload: hãy tải âm thanh lên cho từng cảnh.", 409);
  }
}
