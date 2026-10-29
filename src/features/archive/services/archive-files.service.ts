import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import { formatPublishText } from "@/features/videos/domain/publish-metadata";
import type { RenderSnapshot } from "@/features/videos/domain/render-snapshot";
import type { ArchiveFileKind, ArchiveFileSource } from "@/server/archive/video-archive-provider";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { hashFile } from "@/server/storage/file-hash";
import { dataPath } from "@/server/storage/paths";

import {
  archiveFileNames,
  buildArchiveManifest,
  buildArchiveScript,
  toArchiveJson,
  type ArchiveRenderFacts,
} from "../domain/archive-record";

export interface ArchiveLocalFile {
  source: ArchiveFileSource;
  // Relative to DATA_DIR, as stored on the archive entry.
  relativePath: string;
  sha256: string;
}

const RECORD_FILES = { script: "script.json", publish: "publish.txt", manifest: "manifest.json" } as const;

// The script, the publish text and the manifest live next to the render's MP4 and, like it, are never deleted by the
// archive.
export function archiveRecordPath(videoId: string, renderId: string, kind: keyof typeof RECORD_FILES): string {
  return `videos/${videoId}/renders/${renderId}-${RECORD_FILES[kind]}`;
}

async function writeIfChanged(relativePath: string, content: string): Promise<void> {
  const target = dataPath(relativePath);
  const current = await fs.readFile(target, "utf8").catch(() => null);
  if (current !== content) await writeFileAtomic(target, content);
}

function textFile(
  kind: ArchiveFileKind,
  relativePath: string,
  remoteName: string,
  content: string,
  mimeType: string,
): ArchiveLocalFile {
  return {
    relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
    source: {
      kind,
      localPath: dataPath(relativePath),
      remoteName,
      mimeType,
      bytes: Buffer.byteLength(content),
    },
  };
}

// Writes the script, the publish text (when the snapshot has a set) and the manifest for a finished render from its
// snapshot, and describes the files to archive. Rebuilding them gives the same bytes, so a retry never changes a file
// whose upload already started.
export async function materializeArchiveFiles(input: {
  snapshot: RenderSnapshot;
  facts: ArchiveRenderFacts;
  videoOutputPath: string;
}): Promise<Partial<Record<ArchiveFileKind, ArchiveLocalFile>>> {
  const { snapshot, facts } = input;
  const names = archiveFileNames({
    id: facts.renderId,
    ...snapshot.render,
    scriptVersion: snapshot.video.scriptVersion,
  });
  const videoId = snapshot.video.id;

  const videoDigest = await hashFile(dataPath(input.videoOutputPath));
  const video: ArchiveLocalFile = {
    relativePath: input.videoOutputPath,
    sha256: videoDigest.sha256,
    source: {
      kind: "VIDEO",
      localPath: dataPath(input.videoOutputPath),
      remoteName: names.VIDEO,
      mimeType: "video/mp4",
      bytes: videoDigest.bytes,
    },
  };

  const scriptPath = archiveRecordPath(videoId, facts.renderId, "script");
  const scriptContent = toArchiveJson(buildArchiveScript(snapshot, facts));
  const script = textFile("SCRIPT", scriptPath, names.SCRIPT, scriptContent, "application/json");
  await writeIfChanged(scriptPath, scriptContent);

  let publish: ArchiveLocalFile | undefined;
  if (snapshot.publish) {
    const publishPath = archiveRecordPath(videoId, facts.renderId, "publish");
    const publishContent = formatPublishText(snapshot.publish);
    publish = textFile("PUBLISH", publishPath, names.PUBLISH, publishContent, "text/plain");
    await writeIfChanged(publishPath, publishContent);
  }

  const digest = (file: ArchiveLocalFile, name: string) => ({ name, bytes: file.source.bytes, sha256: file.sha256 });
  const manifestPath = archiveRecordPath(videoId, facts.renderId, "manifest");
  const manifestContent = toArchiveJson(
    buildArchiveManifest(snapshot, facts, {
      video: digest(video, names.VIDEO),
      script: digest(script, names.SCRIPT),
      ...(publish ? { publish: digest(publish, names.PUBLISH) } : {}),
    }),
  );
  const manifest = textFile("MANIFEST", manifestPath, names.MANIFEST, manifestContent, "application/json");
  await writeIfChanged(manifestPath, manifestContent);

  return { VIDEO: video, SCRIPT: script, PUBLISH: publish, MANIFEST: manifest };
}
