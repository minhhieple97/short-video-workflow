import type { JobType } from "@/shared/types/job";

import { processAnalyzeChapter } from "./analyze-chapter";
import { createJobDispatcher } from "./dispatcher";
import { processDiagnosticPing } from "./diagnostic-ping";
import { processGenerateScript } from "./generate-script";
import { processGenerateTts } from "./generate-tts";
import { processRenderVideo } from "./render-video";
import { processRunProductionItem } from "./run-production-item";
import type { JobProcessor } from "./types";

const PROCESSORS: Record<JobType, JobProcessor> = {
  DIAGNOSTIC_PING: processDiagnosticPing,
  ANALYZE_CHAPTER: processAnalyzeChapter,
  GENERATE_VIDEO_SCRIPT: processGenerateScript,
  GENERATE_SCENE_TTS: processGenerateTts,
  RENDER_VIDEO: processRenderVideo,
  RUN_PRODUCTION_ITEM: processRunProductionItem,
};

export const processJob = createJobDispatcher(PROCESSORS);
