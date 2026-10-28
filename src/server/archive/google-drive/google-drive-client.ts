import { z } from "zod";

import { IntegrationError } from "@/server/integrations/integration-error";

import {
  GOOGLE_ENDPOINTS,
  GOOGLE_READ_TIMEOUT_MS,
  sendGoogleRequest,
  type GoogleEndpoints,
  type GoogleRequest,
} from "./google-http";

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const generatedIdsSchema = z.object({ ids: z.array(z.string().min(1)) });
const uploadedSchema = z.object({ id: z.string().min(1), size: z.coerce.number().int().nonnegative() });

const UPLOAD_CHUNK_TIMEOUT_MS = 5 * 60_000;

// Where a resumable upload stands on Google's side.
export type DriveUploadState =
  | { kind: "incomplete"; receivedBytes: number }
  | { kind: "complete"; fileId: string; size: number }
  | { kind: "expired" };

// "Range: bytes=0-524287" means 524288 bytes were stored; no Range header means none were.
function receivedBytes(response: Response): number {
  const match = /^bytes=0-(\d+)$/.exec(response.headers.get("range") ?? "");
  return match ? Number(match[1]) + 1 : 0;
}

async function uploadState(response: Response): Promise<DriveUploadState> {
  if (response.status === 308) return { kind: "incomplete", receivedBytes: receivedBytes(response) };
  if (response.status === 404) return { kind: "expired" };
  const file = uploadedSchema.parse(await response.json());
  return { kind: "complete", fileId: file.id, size: file.size };
}
const createdSchema = z.object({ id: z.string().min(1) });

const aboutSchema = z.object({
  user: z.object({ permissionId: z.string().min(1), emailAddress: z.string().min(1).optional() }),
});

export interface DriveAccount {
  // Stable for the Google account; it decides which archives belong to which connection.
  permissionId: string;
  // Google may leave it out when the user has not made it visible.
  emailAddress: string | null;
}

export interface GoogleDriveClientOptions {
  getAccessToken: () => Promise<string>;
  // Called when Drive refuses the token (401) so the next one is refreshed; the request is then sent once more.
  invalidateAccessToken?: () => void;
  endpoints?: GoogleEndpoints;
}

type DriveRequest<TResult> = Omit<GoogleRequest<TResult>, "headers" | "timeoutMs"> & {
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export class GoogleDriveClient {
  private readonly getAccessToken: () => Promise<string>;
  private readonly invalidateAccessToken: (() => void) | undefined;
  private readonly endpoints: GoogleEndpoints;

  constructor(options: GoogleDriveClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.invalidateAccessToken = options.invalidateAccessToken;
    this.endpoints = options.endpoints ?? GOOGLE_ENDPOINTS;
  }

  // about.get is allowed with drive.file alone and requires `fields`.
  async getAccount(signal?: AbortSignal): Promise<DriveAccount> {
    const about = await this.send({
      url: `${this.endpoints.driveApiUrl}/about?${new URLSearchParams({ fields: "user(permissionId,emailAddress)" })}`,
      method: "GET",
      mutating: false,
      signal,
      parse: async (response) => aboutSchema.parse(await response.json()),
    });
    return { permissionId: about.user.permissionId, emailAddress: about.user.emailAddress ?? null };
  }

  // IDs Drive reserves for this user; a file or folder created with one of them can be retried safely (Drive answers
  // 409 to a second create instead of making a duplicate).
  async generateIds(count: number, signal?: AbortSignal): Promise<string[]> {
    const query = new URLSearchParams({ count: String(count), space: "drive", type: "files" });
    const { ids } = await this.send({
      url: `${this.endpoints.driveApiUrl}/files/generateIds?${query}`,
      method: "GET",
      mutating: false,
      signal,
      parse: async (response) => generatedIdsSchema.parse(await response.json()),
    });
    if (ids.length !== count) {
      throw new IntegrationError("DRIVE_IDS_SHORT", "Google Drive trả về ít ID hơn số đã xin.", "TRANSIENT");
    }
    return ids;
  }

  // Without a parent the folder goes to the top of the user's My Drive.
  async createFolder(
    input: { id: string; name: string; parentId: string | null },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.send({
      url: `${this.endpoints.driveApiUrl}/files?${new URLSearchParams({ fields: "id" })}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: input.id,
        name: input.name,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        ...(input.parentId ? { parents: [input.parentId] } : {}),
      }),
      mutating: true,
      signal,
      parse: async (response) => createdSchema.parse(await response.json()),
    });
  }

  // Opens a resumable upload into a file ID reserved earlier. The returned session URI lets anyone holding it write to the
  // upload, so it is kept like a credential: in the checkpoint only, never in a log, an error or the UI.
  async startResumableUpload(
    input: { id: string; name: string; parentId: string; mimeType: string; bytes: number },
    signal?: AbortSignal,
  ): Promise<string> {
    const query = new URLSearchParams({ uploadType: "resumable", fields: "id,size" });
    return this.send({
      url: `${this.endpoints.driveUploadUrl}/files?${query}`,
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": input.mimeType,
        "x-upload-content-length": String(input.bytes),
      },
      body: JSON.stringify({ id: input.id, name: input.name, mimeType: input.mimeType, parents: [input.parentId] }),
      mutating: true,
      signal,
      parse: async (response) => {
        const location = response.headers.get("location");
        if (!location) throw new Error("The upload session has no Location header.");
        return location;
      },
    });
  }

  uploadChunk(
    sessionUri: string,
    input: { start: number; chunk: Uint8Array<ArrayBuffer>; total: number },
    signal?: AbortSignal,
  ): Promise<DriveUploadState> {
    const end = input.start + input.chunk.byteLength - 1;
    return this.send({
      url: sessionUri,
      method: "PUT",
      headers: { "content-range": `bytes ${input.start}-${end}/${input.total}` },
      body: input.chunk,
      mutating: true,
      timeoutMs: UPLOAD_CHUNK_TIMEOUT_MS,
      signal,
      acceptStatuses: [308, 404],
      parse: uploadState,
    });
  }

  // Asks how much of the upload Google holds, without sending data.
  queryUpload(sessionUri: string, total: number, signal?: AbortSignal): Promise<DriveUploadState> {
    return this.send({
      url: sessionUri,
      method: "PUT",
      headers: { "content-range": `bytes */${total}` },
      mutating: false,
      signal,
      acceptStatuses: [308, 404],
      parse: uploadState,
    });
  }

  async getFileSize(fileId: string, signal?: AbortSignal): Promise<number> {
    const file = await this.send({
      url: `${this.endpoints.driveApiUrl}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({ fields: "id,size" })}`,
      method: "GET",
      mutating: false,
      signal,
      parse: async (response) => uploadedSchema.parse(await response.json()),
    });
    return file.size;
  }

  private async send<TResult>(request: DriveRequest<TResult>, retried = false): Promise<TResult> {
    try {
      return await sendGoogleRequest({
        ...request,
        timeoutMs: request.timeoutMs ?? GOOGLE_READ_TIMEOUT_MS,
        headers: { ...request.headers, authorization: `Bearer ${await this.getAccessToken()}` },
      });
    } catch (error) {
      if (retried || !this.invalidateAccessToken || !isUnauthorized(error)) throw error;
      this.invalidateAccessToken();
      return this.send(request, true);
    }
  }
}

export function googleStatusOf(error: unknown): number | null {
  if (!(error instanceof IntegrationError)) return null;
  const status = error.details?.status;
  return typeof status === "number" ? status : null;
}

const isUnauthorized = (error: unknown): boolean => googleStatusOf(error) === 401;
