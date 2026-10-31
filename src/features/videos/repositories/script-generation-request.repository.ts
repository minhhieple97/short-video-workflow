import { randomUUID } from "node:crypto";

import { createJobIntentWithin } from "@/features/jobs/repositories/job-dispatch.repository";
import type { AiSettings } from "@/features/settings/domain/ai-settings";
import { prisma } from "@/server/db/client";
import type { GenerationInput } from "@/server/script-draft/contracts";
import { AppError } from "@/shared/errors";
import { ACTIVE_JOB_STATUSES } from "@/shared/types/job";

import { createGenerationRunWithin } from "./script-generation-run.repository";

export function createScriptGenerationIntent(input: {
  context: GenerationInput;
  settings: AiSettings;
  baseScriptVersion: number;
}) {
  return prisma.$transaction(async (tx) => {
    const videoId = input.context.videoId;
    const gate = await tx.video.updateMany({
      where: { id: videoId, scriptVersion: input.baseScriptVersion },
      data: { updatedAt: new Date() },
    });
    if (!gate.count)
      throw new AppError("SCRIPT_GENERATION_STALE", "Video vừa được sửa. Hãy tải lại rồi tạo kịch bản.", 409);
    const active = await tx.jobRecord.findFirst({
      where: {
        jobType: "GENERATE_VIDEO_SCRIPT",
        entityType: "VIDEO",
        entityId: videoId,
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
    });
    if (active) throw new AppError("SCRIPT_GENERATION_RUNNING", "Kịch bản đang được tạo.", 409);
    const run = await createGenerationRunWithin(tx, {
      ownerKey: `manual:${randomUUID()}`,
      videoId,
      baseScriptVersion: input.baseScriptVersion,
      settings: input.settings,
      context: input.context,
    });
    return createJobIntentWithin(tx, {
      bullmqJobId: randomUUID(),
      jobType: "GENERATE_VIDEO_SCRIPT",
      entityType: "VIDEO",
      entityId: videoId,
      payload: { videoId, generationRunId: run.id },
    });
  });
}
