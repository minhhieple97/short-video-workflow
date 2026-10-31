import { createLogger } from "@/shared/logger";

import type { LessonSnapshot } from "../domain/lesson-snapshot";
import { acceptPublishMetadata, publishClaimSources, type PublishMetadataDraft } from "../domain/publish-metadata";
import type { NewSceneRecord } from "../repositories/video.repository";
import type { PublishMetadataWrite } from "../repositories/publish-metadata.repository";
import { scriptTextHash } from "./scene-records";

const logger = createLogger("videos.publish");

export interface PublishProposalOutcome {
  publish?: PublishMetadataWrite;
  // Why nothing is stored, when nothing is: the script is written anyway, so this is how the loss gets reported.
  publishIssue?: { code: string; message: string };
}

// What a script write stores for the title, caption and hashtags an AI proposed with it. A proposal that is missing or
// breaks a rule is dropped on its own: the script is kept, and the previous set (if any) stays, shown as outdated.
export function publishWriteFor(
  proposal: PublishMetadataDraft | undefined,
  context: {
    // Only for the log line.
    logIds: { videoId: string } | { itemId: string };
    promptVersion: string;
    book: { title: string; author: string | null };
    lessons: readonly LessonSnapshot[];
    scenes: readonly NewSceneRecord[];
  },
): PublishProposalOutcome {
  if (!proposal) {
    logger.warn("AI wrote no publish metadata", context.logIds);
    return {
      publishIssue: {
        code: "PUBLISH_METADATA_MISSING",
        message: "AI không viết kèm tiêu đề, caption và hashtag cho kịch bản này.",
      },
    };
  }
  const { metadata, issue } = acceptPublishMetadata(proposal, publishClaimSources(context));
  if (issue) {
    logger.warn("Publish metadata dropped", { ...context.logIds, code: issue.code });
    return { publishIssue: { code: issue.code, message: issue.message } };
  }
  return {
    publish: {
      metadata,
      origin: "AI",
      promptVersion: context.promptVersion,
      sourceTextHash: scriptTextHash(context.scenes),
    },
  };
}
