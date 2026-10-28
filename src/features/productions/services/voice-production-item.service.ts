import { AppError } from "@/shared/errors";

import { hasReachedCheckpoint } from "../domain/production-status";
import { advanceProductionCheckpoint } from "../repositories/production-step.repository";
import { outOfOrder, requireHeldProductionItem } from "./production-step";
import { voiceVideoScenes, type SynthesizeScene, type VoiceSummary } from "./voice-video-scenes.service";

export type VoiceItemOutcome = ({ status: "VOICED" } & VoiceSummary) | { status: "ALREADY_VOICED" };

// The VOICED step of one item. Checkpoint APPLIED means the scenes are on the video; every scene then gets audio, and only
// when all of them have it does the item move to VOICED. A failure part-way leaves the checkpoint where it was, so the
// step can simply run again.
export async function voiceProductionItem(input: {
  itemId: string;
  claimToken: string;
  signal?: AbortSignal;
  synthesize?: SynthesizeScene;
  onProgress?: (done: number, pending: number) => Promise<void> | void;
}): Promise<VoiceItemOutcome> {
  const item = await requireHeldProductionItem(input.itemId, input.claimToken);
  if (hasReachedCheckpoint(item.checkpoint, "VOICED")) return { status: "ALREADY_VOICED" };
  if (item.checkpoint !== "APPLIED") {
    throw outOfOrder(item.checkpoint, "Phải áp dụng kế hoạch cảnh trước khi tạo giọng đọc.");
  }

  const summary = await voiceVideoScenes({
    videoId: item.videoId,
    signal: input.signal,
    synthesize: input.synthesize,
    onProgress: input.onProgress,
  });
  if (!(await advanceProductionCheckpoint(input.itemId, input.claimToken, "APPLIED", "VOICED"))) {
    throw new AppError("PRODUCTION_CLAIM_LOST", "Mục sản xuất đã bị thay đổi trong lúc tạo giọng đọc.", 409);
  }
  return { status: "VOICED", ...summary };
}
