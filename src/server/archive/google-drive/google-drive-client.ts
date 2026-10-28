import { z } from "zod";

import { GOOGLE_ENDPOINTS, GOOGLE_READ_TIMEOUT_MS, sendGoogleRequest, type GoogleEndpoints } from "./google-http";

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
  endpoints?: GoogleEndpoints;
}

export class GoogleDriveClient {
  private readonly getAccessToken: () => Promise<string>;
  private readonly endpoints: GoogleEndpoints;

  constructor(options: GoogleDriveClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.endpoints = options.endpoints ?? GOOGLE_ENDPOINTS;
  }

  // about.get is allowed with drive.file alone and requires `fields`.
  async getAccount(signal?: AbortSignal): Promise<DriveAccount> {
    const about = await sendGoogleRequest({
      url: `${this.endpoints.driveApiUrl}/about?${new URLSearchParams({ fields: "user(permissionId,emailAddress)" })}`,
      method: "GET",
      headers: { authorization: `Bearer ${await this.getAccessToken()}` },
      mutating: false,
      timeoutMs: GOOGLE_READ_TIMEOUT_MS,
      signal,
      parse: async (response) => aboutSchema.parse(await response.json()),
    });
    return { permissionId: about.user.permissionId, emailAddress: about.user.emailAddress ?? null };
  }
}
