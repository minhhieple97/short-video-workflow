import { createLogger } from "@/shared/logger";

import type { LessonSnapshot } from "../domain/lesson-snapshot";
import { acceptPublishMetadata, publishClaimSources, type PublishMetadataDraft } from "../domain/publish-metadata";
import type { NewSceneRecord } from "../repositories/video.repository";
import type { PublishMetadataWrite } from "../repositories/publish-metadata.repository";
import { scriptTextHash } from "./scene-records";

const logger = createLogger("videos.publish");

// What a script write stores for the title, caption and hashtags an AI proposed with it. A proposal that is missing or
// breaks a rule is dropped on its own: the script is kept, and the previous set (if any) stays, shown as outdated.
export function publishWriteFor(
  proposal: PublishMetadataDraft | undefined,
  context: {
    videoId: string;
    promptVersion: string;
    book: { title: string; author: string | null };
    lessons: readonly LessonSnapshot[];
    scenes: readonly NewSceneRecord[];
  },
): PublishMetadataWrite | undefined {
  if (!proposal) {
    logger.warn("AI wrote no publish metadata", { videoId: context.videoId });
    return undefined;
  }
  const { metadata, issue } = acceptPublishMetadata(proposal, publishClaimSources(context));
  if (issue) {
    logger.warn("Publish metadata dropped", { videoId: context.videoId, code: issue.code });
    return undefined;
  }
  return {
    metadata,
    origin: "AI",
    promptVersion: context.promptVersion,
    sourceTextHash: scriptTextHash(context.scenes),
  };
}
