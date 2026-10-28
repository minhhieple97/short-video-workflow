import http from "node:http";
import type { AddressInfo } from "node:net";

import type { GoogleEndpoints } from "@/server/archive/google-drive/google-http";

export interface RecordedGoogleRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// What the next request to a route gets instead of its normal answer.
export type GoogleFault =
  | { kind: "status"; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: "json"; body: unknown }
  | { kind: "drop" };

export interface FakeGoogleAccount {
  permissionId: string;
  emailAddress?: string;
}

const TOKEN = "POST /token";
const REVOKE = "POST /revoke";
const ABOUT = "GET /drive/v3/about";

// A local stand-in for Google's token endpoint and Drive API: it answers like Google, records every request and can be
// told to fail, so tests never reach the real services or spend quota.
export class FakeGoogleServer {
  readonly requests: RecordedGoogleRequest[] = [];
  account: FakeGoogleAccount = { permissionId: "permission-1", emailAddress: "ban@example.com" };
  grantedScope = "https://www.googleapis.com/auth/drive.file";
  issueRefreshToken = true;
  private readonly faults = new Map<string, GoogleFault[]>();
  private issued = 0;
  private server: http.Server | null = null;
  private baseUrl = "";

  get endpoints(): GoogleEndpoints {
    return {
      tokenUrl: `${this.baseUrl}/token`,
      revokeUrl: `${this.baseUrl}/revoke`,
      driveApiUrl: `${this.baseUrl}/drive/v3`,
      driveUploadUrl: `${this.baseUrl}/upload/drive/v3`,
    };
  }

  // Refresh tokens Google still honours; revoking one (or its access token) removes it.
  readonly liveRefreshTokens = new Set<string>();

  failNext(route: "token" | "revoke" | "about", fault: GoogleFault): void {
    const key = { token: TOKEN, revoke: REVOKE, about: ABOUT }[route];
    this.faults.set(key, [...(this.faults.get(key) ?? []), fault]);
  }

  requestsTo(path: string): RecordedGoogleRequest[] {
    return this.requests.filter((request) => request.path === path);
  }

  async start(): Promise<void> {
    this.server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => this.handle(request, Buffer.concat(chunks).toString("utf8"), response));
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private handle(request: http.IncomingMessage, body: string, response: http.ServerResponse): void {
    const url = new URL(request.url ?? "/", this.baseUrl);
    const recorded = {
      method: request.method ?? "",
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
    };
    this.requests.push(recorded);
    const key = `${recorded.method} ${recorded.path}`;

    const fault = this.faults.get(key)?.shift();
    if (fault?.kind === "drop") {
      request.socket.destroy();
      return;
    }
    if (fault?.kind === "status") {
      response.writeHead(fault.status, { "content-type": "application/json", ...fault.headers });
      response.end(JSON.stringify(fault.body ?? {}));
      return;
    }
    if (fault?.kind === "json") return this.json(response, fault.body);

    if (key === TOKEN) return this.tokenGrant(new URLSearchParams(body), response);
    if (key === REVOKE) return this.revoke(new URLSearchParams(body), response);
    if (key === ABOUT) return this.json(response, { user: this.account });
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } }));
  }

  private tokenGrant(form: URLSearchParams, response: http.ServerResponse): void {
    this.issued += 1;
    const accessToken = `ya29.access-${this.issued}`;
    if (form.get("grant_type") === "refresh_token") {
      if (!this.liveRefreshTokens.has(form.get("refresh_token") ?? "")) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }),
        );
        return;
      }
      return this.json(response, {
        access_token: accessToken,
        expires_in: 3599,
        scope: this.grantedScope,
        token_type: "Bearer",
      });
    }
    const refreshToken = `1//refresh-${this.issued}`;
    if (this.issueRefreshToken) this.liveRefreshTokens.add(refreshToken);
    return this.json(response, {
      access_token: accessToken,
      expires_in: 3599,
      ...(this.issueRefreshToken ? { refresh_token: refreshToken } : {}),
      scope: this.grantedScope,
      token_type: "Bearer",
    });
  }

  private revoke(form: URLSearchParams, response: http.ServerResponse): void {
    const token = form.get("token") ?? "";
    if (!this.liveRefreshTokens.delete(token)) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_token", error_description: "Token expired or revoked" }));
      return;
    }
    this.json(response, {});
  }

  private json(response: http.ServerResponse, body: unknown): void {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}
