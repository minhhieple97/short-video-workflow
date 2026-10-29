import type { Prisma, VideoPublishMetadata } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import type { PublishMetadata, PublishOrigin } from "../domain/publish-metadata";

type Tx = Prisma.TransactionClient;

export interface PublishMetadataWrite {
  metadata: PublishMetadata;
  origin: PublishOrigin;
  promptVersion: string | null;
  sourceTextHash: string;
}

function toRow(write: PublishMetadataWrite) {
  return {
    title: write.metadata.title,
    caption: write.metadata.caption,
    hashtagsJson: write.metadata.hashtags,
    origin: write.origin,
    promptVersion: write.promptVersion,
    sourceTextHash: write.sourceTextHash,
  };
}

export function upsertPublishMetadataWithin(
  tx: Tx,
  videoId: string,
  write: PublishMetadataWrite,
): Promise<VideoPublishMetadata> {
  const row = toRow(write);
  return tx.videoPublishMetadata.upsert({ where: { videoId }, create: { videoId, ...row }, update: row });
}

export function upsertPublishMetadata(videoId: string, write: PublishMetadataWrite): Promise<VideoPublishMetadata> {
  return upsertPublishMetadataWithin(prisma, videoId, write);
}
