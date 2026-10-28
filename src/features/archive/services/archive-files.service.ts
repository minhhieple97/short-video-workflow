import { createHash } from "node:crypto";
import fs from "node:fs/promises";

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

// The script and the manifest live next to the render's MP4 and, like it, are never deleted by the archive.
export function archiveRecordPath(videoId: string, renderId: string, kind: "script" | "manifest"): string {
  return `videos/${videoId}/renders/${renderId}-${kind}.json`;
}

async function writeIfChanged(relativePath: string, content: string): Promise<void> {
  const target = dataPath(relativePath);
  const current = await fs.readFile(target, "utf8").catch(() => null);
  if (current !== content) await writeFileAtomic(target, content);
}

function jsonFile(kind: ArchiveFileKind, relativePath: string, remoteName: string, content: string): ArchiveLocalFile {
  return {
    relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
    source: {
      kind,
      localPath: dataPath(relativePath),
      remoteName,
      mimeType: "application/json",
      bytes: Buffer.byteLength(content),
    },
  };
}

// Writes the script and the manifest for a finished render from its snapshot, and describes the three files to archive.
// Rebuilding them gives the same bytes, so a retry never changes a file whose upload already started.
export async function materializeArchiveFiles(input: {
  snapshot: RenderSnapshot;
  facts: ArchiveRenderFacts;
  videoOutputPath: string;
}): Promise<Record<ArchiveFileKind, ArchiveLocalFile>> {
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
  const script = jsonFile("SCRIPT", scriptPath, names.SCRIPT, scriptContent);
  await writeIfChanged(scriptPath, scriptContent);

  const manifestPath = archiveRecordPath(videoId, facts.renderId, "manifest");
  const manifestContent = toArchiveJson(
    buildArchiveManifest(snapshot, facts, {
      video: { name: names.VIDEO, bytes: video.source.bytes, sha256: video.sha256 },
      script: { name: names.SCRIPT, bytes: script.source.bytes, sha256: script.sha256 },
    }),
  );
  const manifest = jsonFile("MANIFEST", manifestPath, names.MANIFEST, manifestContent);
  await writeIfChanged(manifestPath, manifestContent);

  return { VIDEO: video, SCRIPT: script, MANIFEST: manifest };
}
