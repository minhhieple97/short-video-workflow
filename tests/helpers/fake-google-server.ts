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

  failNext(route: "token" | "about", fault: GoogleFault): void {
    const key = route === "token" ? TOKEN : ABOUT;
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

    if (key === TOKEN) return this.json(response, this.token());
    if (key === ABOUT) return this.json(response, { user: this.account });
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } }));
  }

  private token(): Record<string, unknown> {
    this.issued += 1;
    return {
      access_token: `ya29.access-${this.issued}`,
      expires_in: 3599,
      ...(this.issueRefreshToken ? { refresh_token: `1//refresh-${this.issued}` } : {}),
      scope: this.grantedScope,
      token_type: "Bearer",
    };
  }

  private json(response: http.ServerResponse, body: unknown): void {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}
