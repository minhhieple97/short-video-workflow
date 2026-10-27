import { NotImplementedError } from "@/shared/errors";

import type { JobProcessor } from "./types";

export const processAnalyzeChapter: JobProcessor = () => {
  throw new NotImplementedError("Phân tích chương (ANALYZE_CHAPTER)", "M2");
};
