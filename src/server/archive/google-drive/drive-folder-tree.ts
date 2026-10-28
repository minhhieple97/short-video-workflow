import { ARCHIVE_FILE_KINDS, type ArchiveDestination, type ArchiveDestinationRequest } from "../video-archive-provider";
import { googleStatusOf, type GoogleDriveClient } from "./google-drive-client";

export const ARCHIVE_ROOT_FOLDER_NAME = "Book Video Studio";

export interface ArchiveFolderBinding {
  path: string;
  remoteId: string;
  confirmed: boolean;
}

// Durable bindings from a folder's path in the archive tree to its remote ID, for one destination.
export interface ArchiveFolderStore {
  find(paths: readonly string[]): Promise<ArchiveFolderBinding[]>;
  // Write-once: returns the ID stored for the path, which is the one given only if none was stored before.
  reserve(path: string, remoteId: string): Promise<string>;
  confirm(path: string): Promise<void>;
  // The remote folder is gone: its binding and every binding below it are dropped, so they are created afresh.
  forget(path: string): Promise<void>;
}

interface FolderStep {
  path: string;
  name: string;
}

// Book Video Studio/books/<bookId>/videos/<videoId>/renders/<renderId>/
export function archiveFolderChain(request: ArchiveDestinationRequest): FolderStep[] {
  const book = `books/${request.bookId}`;
  const video = `${book}/videos/${request.videoId}`;
  return [
    { path: "", name: ARCHIVE_ROOT_FOLDER_NAME },
    { path: "books", name: "books" },
    { path: book, name: request.bookId },
    { path: `${book}/videos`, name: "videos" },
    { path: video, name: request.videoId },
    { path: `${video}/renders`, name: "renders" },
    { path: `${video}/renders/${request.renderId}`, name: request.renderId },
  ];
}

class MissingParentError extends Error {
  constructor(readonly parentPath: string) {
    super("A bound archive folder no longer exists in Drive.");
  }
}

// Makes sure the render's folder chain exists and hands out fresh IDs for the files that will go into it. Every folder ID
// is stored before the folder is created, and a create Drive already performed answers 409, so repeating this after a
// lost answer never makes a second folder.
export class DriveFolderTree {
  constructor(
    private readonly drive: GoogleDriveClient,
    private readonly folders: ArchiveFolderStore,
  ) {}

  // Someone may have removed folders of the tree in Drive. A create under a missing parent reveals only that parent, so
  // the tree is rebuilt one level further up per attempt, at most once per level, without ever searching the Drive.
  async prepare(request: ArchiveDestinationRequest, signal?: AbortSignal): Promise<ArchiveDestination> {
    const levels = archiveFolderChain(request).length;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.attempt(request, signal);
      } catch (error) {
        if (!(error instanceof MissingParentError) || attempt >= levels) throw error;
        await this.folders.forget(error.parentPath);
      }
    }
  }

  private async attempt(request: ArchiveDestinationRequest, signal?: AbortSignal): Promise<ArchiveDestination> {
    const chain = archiveFolderChain(request);
    const known = new Map((await this.folders.find(chain.map((step) => step.path))).map((b) => [b.path, b]));
    const missing = chain.filter((step) => !known.has(step.path));
    const ids = await this.drive.generateIds(missing.length + ARCHIVE_FILE_KINDS.length, signal);

    let parent: ArchiveFolderBinding | null = null;
    let next = 0;
    for (const step of chain) {
      const binding = known.get(step.path) ?? {
        path: step.path,
        remoteId: await this.folders.reserve(step.path, ids[next++] ?? ""),
        confirmed: false,
      };
      if (!binding.confirmed) {
        await this.createFolder(binding.remoteId, step.name, parent, signal);
        await this.folders.confirm(step.path);
      }
      parent = binding;
    }
    if (!parent) throw new Error("The archive folder chain is never empty.");

    const [video = "", script = "", manifest = ""] = ids.slice(missing.length);
    return { folderId: parent.remoteId, fileIds: { VIDEO: video, SCRIPT: script, MANIFEST: manifest } };
  }

  private async createFolder(
    id: string,
    name: string,
    parent: ArchiveFolderBinding | null,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    try {
      await this.drive.createFolder({ id, name, parentId: parent?.remoteId ?? null }, signal);
    } catch (error) {
      const status = googleStatusOf(error);
      // An earlier attempt already created it (its answer was lost): Drive refuses the same ID a second time.
      if (status === 409) return;
      if (status === 404 && parent) throw new MissingParentError(parent.path);
      throw error;
    }
  }
}
