import { readDriveCredential } from "@/server/archive/google-drive/drive-credential-store";
import { GOOGLE_DRIVE_PROVIDER_ID } from "@/server/archive/google-drive/drive-archive-provider";
import { createLogger } from "@/shared/logger";

import { archiveFileNames } from "../domain/archive-record";
import {
  createArchiveWithJob,
  ensureArchiveJob,
  findRenderForArchive,
  listRendersAwaitingArchive,
  listUnfinishedArchiveIds,
} from "../repositories/render-archive.repository";

const logger = createLogger("archive.request");

export interface ArchiveDestinationRef {
  provider: string;
  destinationKey: string;
}

// Archives go to the account that is connected now; without a usable connection there is nowhere to archive to.
export async function currentArchiveDestination(): Promise<ArchiveDestinationRef | null> {
  const credential = await readDriveCredential();
  if (credential?.status !== "CONNECTED" || !credential.accountId) return null;
  return { provider: GOOGLE_DRIVE_PROVIDER_ID, destinationKey: credential.accountId };
}

export type ArchiveRequestOutcome =
  { status: "REQUESTED"; archiveId: string; created: boolean } | { status: "NOT_CONNECTED" | "NOT_ARCHIVABLE" };

// Creates the archive of a finished FINAL render, with its job, for the connected account. Asking again returns the same
// archive. Without a connection nothing happens: the render keeps its archive intent and the sweep picks it up later.
export async function requestRenderArchive(
  renderId: string,
  destination?: ArchiveDestinationRef | null,
): Promise<ArchiveRequestOutcome> {
  const target = destination === undefined ? await currentArchiveDestination() : destination;
  if (!target) return { status: "NOT_CONNECTED" };
  const render = await findRenderForArchive(renderId);
  if (!render || render.status !== "COMPLETED" || render.qualityPreset !== "FINAL" || !render.archiveIntentAt) {
    return { status: "NOT_ARCHIVABLE" };
  }
  const names = archiveFileNames(render);
  const { archiveId, created } = await createArchiveWithJob({ renderId, ...target }, [
    { kind: "VIDEO", remoteName: names.VIDEO },
    { kind: "SCRIPT", remoteName: names.SCRIPT },
    { kind: "MANIFEST", remoteName: names.MANIFEST },
  ]);
  if (created) logger.info("Archive requested", { renderId, archiveId });
  return { status: "REQUESTED", archiveId, created };
}

// Run when the worker starts and then every minute: archives renders that finished while nothing could archive them (no
// connection yet, a crash right after the render), and gives back a job to any unfinished archive that lost its own.
// Failed archives are left alone; they wait for the user's retry.
export async function sweepRenderArchives(): Promise<{ requested: number; resumed: number }> {
  const destination = await currentArchiveDestination();
  if (!destination) return { requested: 0, resumed: 0 };

  let requested = 0;
  for (const render of await listRendersAwaitingArchive(destination)) {
    const outcome = await requestRenderArchive(render.id, destination);
    if (outcome.status === "REQUESTED" && outcome.created) requested += 1;
  }
  let resumed = 0;
  for (const archiveId of await listUnfinishedArchiveIds(destination)) {
    if ((await ensureArchiveJob(archiveId))?.started) resumed += 1;
  }
  if (requested + resumed > 0) logger.info("Archive sweep", { requested, resumed });
  return { requested, resumed };
}
