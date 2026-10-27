import { NotImplementedError } from "@/shared/errors";

import type { JobProcessor } from "./types";

export const processGenerateScript: JobProcessor = () => {
  throw new NotImplementedError("Tạo kịch bản video (GENERATE_VIDEO_SCRIPT)", "M3");
};
