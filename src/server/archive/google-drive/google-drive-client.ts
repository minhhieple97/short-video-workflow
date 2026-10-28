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
