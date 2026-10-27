import { NotImplementedError } from "@/shared/errors";

import type { JobProcessor } from "./types";

export const processRenderVideo: JobProcessor = () => {
  throw new NotImplementedError("Render video (RENDER_VIDEO)", "M4");
};
