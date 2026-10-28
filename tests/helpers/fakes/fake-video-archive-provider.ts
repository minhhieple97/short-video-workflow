import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import type { CallOptions } from "@/server/integrations/call-options";
import {
  type ArchiveDestination,
  type ArchiveDestinationRequest,
  type ArchiveUploadOptions,
  type ArchiveUploadRequest,
  type ArchiveUploadResult,
  type ArchiveVerification,
  type ArchiveVerifyRequest,
  type VideoArchiveProvider,
} from "@/server/archive/video-archive-provider";

interface RemoteObject {
  bytes: number;
  sha256: string;
}

export class FakeVideoArchiveProvider implements VideoArchiveProvider {
  readonly id = "fake-archive";

  private readonly remote = new Map<string, RemoteObject>();
  private destinations = 0;

  get remoteObjectCount(): number {
    return this.remote.size;
  }

  async prepareDestination(_request: ArchiveDestinationRequest, options?: CallOptions): Promise<ArchiveDestination> {
    options?.signal?.throwIfAborted();
    this.destinations += 1;
    const prefix = `fake-${this.destinations}`;
    return {
      folderId: `${prefix}-folder`,
      fileIds: { VIDEO: `${prefix}-video`, SCRIPT: `${prefix}-script`, MANIFEST: `${prefix}-manifest` },
    };
  }

  async upload(request: ArchiveUploadRequest, options?: ArchiveUploadOptions): Promise<ArchiveUploadResult> {
    options?.signal?.throwIfAborted();
    const content = await fs.readFile(request.file.localPath);
    this.remote.set(request.destination.fileIds[request.file.kind], {
      bytes: content.byteLength,
      sha256: sha256Of(content),
    });
    return { bytes: content.byteLength };
  }

  async verify(request: ArchiveVerifyRequest, options?: CallOptions): Promise<ArchiveVerification> {
    options?.signal?.throwIfAborted();
    const stored = this.remote.get(request.destination.fileIds[request.file.kind]);
    if (!stored) return { status: "missing" };

    const content = await fs.readFile(request.file.localPath);
    if (stored.bytes !== content.byteLength) return { status: "mismatch", reason: "size differs" };
    if (stored.sha256 !== sha256Of(content)) return { status: "mismatch", reason: "checksum differs" };
    return { status: "verified" };
  }
}

function sha256Of(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
