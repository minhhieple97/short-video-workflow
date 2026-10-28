import { z } from "zod";

import { IntegrationError } from "@/server/integrations/integration-error";

import { GOOGLE_ENDPOINTS, GOOGLE_READ_TIMEOUT_MS, sendGoogleRequest, type GoogleEndpoints } from "./google-http";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().regex(/^bearer$/i),
});

export interface GoogleTokenSet {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string | null;
  scopes: string[];
}

export interface GoogleOAuthClientOptions {
  clientId: string;
  // Desktop clients are public (Google's own wording), so the secret is optional, but it is still never logged.
  clientSecret?: string;
  endpoints?: GoogleEndpoints;
}

// Talks to Google's token endpoint. Tokens and the client secret stay in memory here and in the credential store only.
export class GoogleOAuthClient {
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;
  private readonly endpoints: GoogleEndpoints;

  constructor(options: GoogleOAuthClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.endpoints = options.endpoints ?? GOOGLE_ENDPOINTS;
  }

  exchangeCode(
    input: { code: string; codeVerifier: string; redirectUri: string },
    signal?: AbortSignal,
    now: Date = new Date(),
  ): Promise<GoogleTokenSet> {
    return this.requestTokens(
      {
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
      },
      signal,
      now,
    );
  }

  refresh(refreshToken: string, signal?: AbortSignal, now: Date = new Date()): Promise<GoogleTokenSet> {
    return this.requestTokens({ grant_type: "refresh_token", refresh_token: refreshToken }, signal, now);
  }

  // Revoking either token removes every permission the user gave this client. The token goes in the form body (as in
  // Google's own Node example), never in the URL. A token Google no longer knows counts as revoked.
  async revoke(token: string, signal?: AbortSignal): Promise<void> {
    try {
      await sendGoogleRequest({
        url: this.endpoints.revokeUrl,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
        mutating: false,
        timeoutMs: GOOGLE_READ_TIMEOUT_MS,
        signal,
        parse: async () => undefined,
      });
    } catch (error) {
      if (error instanceof IntegrationError && error.code === "GOOGLE_INVALID_TOKEN") return;
      throw error;
    }
  }

  private async requestTokens(
    fields: Record<string, string>,
    signal: AbortSignal | undefined,
    now: Date,
  ): Promise<GoogleTokenSet> {
    const form = new URLSearchParams({ client_id: this.clientId, ...fields });
    if (this.clientSecret) form.set("client_secret", this.clientSecret);
    const tokens = await sendGoogleRequest({
      url: this.endpoints.tokenUrl,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      mutating: false,
      timeoutMs: GOOGLE_READ_TIMEOUT_MS,
      signal,
      parse: async (response) => tokenResponseSchema.parse(await response.json()),
    });
    return {
      accessToken: tokens.access_token,
      expiresAt: new Date(now.getTime() + tokens.expires_in * 1000),
      refreshToken: tokens.refresh_token ?? null,
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    };
  }
}
