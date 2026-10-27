import { NotImplementedError } from "@/shared/errors";

import type { JobProcessor } from "./types";

export const processGenerateTts: JobProcessor = () => {
  throw new NotImplementedError("Tạo giọng đọc (GENERATE_SCENE_TTS)", "M5");
};
