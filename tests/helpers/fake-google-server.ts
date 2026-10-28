import http from "node:http";
import type { AddressInfo } from "node:net";

import type { GoogleEndpoints } from "@/server/archive/google-drive/google-http";

export interface RecordedGoogleRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: string;
  rawBody: Buffer;
}

// What the next request to a route gets instead of its normal answer.
export type GoogleFault =
  | { kind: "status"; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: "json"; body: unknown }
  | { kind: "drop" }
  // The request takes effect, then the connection dies, so the client never learns the outcome.
  | { kind: "drop-after" };

export interface FakeGoogleAccount {
  permissionId: string;
  emailAddress?: string;
}

const TOKEN = "POST /token";
const REVOKE = "POST /revoke";
const ABOUT = "GET /drive/v3/about";
const GENERATE_IDS = "GET /drive/v3/files/generateIds";
const CREATE_FILE = "POST /drive/v3/files";
const START_UPLOAD = "POST /upload/drive/v3/files";
const UPLOAD_CHUNK = "PUT /upload/drive/v3/files";
const GET_FILE = "GET /drive/v3/files/:id";

interface UploadSession {
  meta: { id: string; name: string; mimeType: string; parents: string[] };
  total: number;
  received: Buffer;
}

export interface FakeDriveObject {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content?: Buffer;
}

type Answer = { status: number; body: unknown; headers?: Record<string, string> };

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

  // Everything this fake Drive holds, by ID; tests may remove entries to play a user deleting things in Drive.
  readonly objects = new Map<string, FakeDriveObject>();
  readonly uploadSessions = new Map<string, UploadSession>();
  private generated = 0;
  private sessions = 0;
  // Google may store less of a chunk than was sent; the next chunk keeps only this many bytes.
  private nextChunkLimit: number | null = null;

  keepOnlyOfNextChunk(bytes: number): void {
    this.nextChunkLimit = bytes;
  }

  failNext(
    route: "token" | "revoke" | "about" | "generateIds" | "createFile" | "startUpload" | "uploadChunk" | "getFile",
    fault: GoogleFault,
  ): void {
    const key = {
      token: TOKEN,
      revoke: REVOKE,
      about: ABOUT,
      generateIds: GENERATE_IDS,
      createFile: CREATE_FILE,
      startUpload: START_UPLOAD,
      uploadChunk: UPLOAD_CHUNK,
      getFile: GET_FILE,
    }[route];
    this.faults.set(key, [...(this.faults.get(key) ?? []), fault]);
  }

  requestsTo(path: string): RecordedGoogleRequest[] {
    return this.requests.filter((request) => request.path === path);
  }

  async start(): Promise<void> {
    this.server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => this.handle(request, Buffer.concat(chunks), response));
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private handle(request: http.IncomingMessage, rawBody: Buffer, response: http.ServerResponse): void {
    const body = rawBody.toString("utf8");
    const url = new URL(request.url ?? "/", this.baseUrl);
    const recorded: RecordedGoogleRequest = {
      method: request.method ?? "",
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
      rawBody,
    };
    this.requests.push(recorded);
    const key =
      recorded.method === "GET" && /^\/drive\/v3\/files\/(?!generateIds)[^/]+$/.test(recorded.path)
        ? GET_FILE
        : `${recorded.method} ${recorded.path}`;

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
    const answer = this.drive(key, recorded);
    if (fault?.kind === "drop-after") {
      request.socket.destroy();
      return;
    }
    response.writeHead(answer.status, { "content-type": "application/json", ...answer.headers });
    response.end(answer.status === 308 ? undefined : JSON.stringify(answer.body));
  }

  private drive(key: string, request: RecordedGoogleRequest): Answer {
    if (key === ABOUT) return { status: 200, body: { user: this.account } };
    if (key === GENERATE_IDS) {
      const count = Number(request.query.get("count"));
      const ids = Array.from({ length: count }, () => `gen-${++this.generated}`);
      return { status: 200, body: { kind: "drive#generatedIds", space: "drive", ids } };
    }
    if (key === CREATE_FILE) return this.createMetadataOnly(request);
    if (key === START_UPLOAD) return this.startUpload(request);
    if (key === UPLOAD_CHUNK) return this.uploadChunk(request);
    if (key === GET_FILE) {
      const object = this.objects.get(decodeURIComponent(request.path.split("/").at(-1) ?? ""));
      if (!object) return driveError(404, "notFound");
      return { status: 200, body: { id: object.id, size: String(object.content?.byteLength ?? 0) } };
    }
    return driveError(404, "notFound");
  }

  private startUpload(request: RecordedGoogleRequest): Answer {
    const meta = JSON.parse(request.body) as UploadSession["meta"];
    if (this.objects.has(meta.id)) return driveError(409, "conflict");
    if (meta.parents.some((parent) => !this.objects.has(parent))) return driveError(404, "notFound");
    const id = `session-${++this.sessions}`;
    const total = Number(request.headers["x-upload-content-length"]);
    this.uploadSessions.set(id, { meta, total, received: Buffer.alloc(0) });
    return { status: 200, body: {}, headers: { location: `${this.baseUrl}/upload/drive/v3/files?upload_id=${id}` } };
  }

  private uploadChunk(request: RecordedGoogleRequest): Answer {
    const session = this.uploadSessions.get(request.query.get("upload_id") ?? "");
    if (!session) return driveError(404, "notFound");
    const range = /^bytes (\*|(\d+)-(\d+))\/(\d+)$/.exec(String(request.headers["content-range"] ?? ""));
    if (!range || Number(range[4]) !== session.total) return driveError(400, "badContentRange");
    if (range[1] !== "*") {
      const start = Number(range[2]);
      if (start > session.received.byteLength) return driveError(400, "badContentRange");
      let data = request.rawBody.subarray(session.received.byteLength - start);
      if (this.nextChunkLimit !== null) {
        data = data.subarray(0, this.nextChunkLimit);
        this.nextChunkLimit = null;
      }
      session.received = Buffer.concat([session.received, data]);
    }
    if (session.received.byteLength < session.total) {
      const stored = session.received.byteLength;
      return { status: 308, body: null, headers: stored > 0 ? { range: `bytes=0-${stored - 1}` } : {} };
    }
    const { meta } = session;
    if (!this.objects.has(meta.id)) {
      this.objects.set(meta.id, { ...meta, content: session.received });
    }
    return { status: 200, body: { id: meta.id, size: String(session.received.byteLength) } };
  }

  private createMetadataOnly(request: RecordedGoogleRequest): Answer {
    const meta = JSON.parse(request.body) as { id: string; name: string; mimeType: string; parents?: string[] };
    if (this.objects.has(meta.id)) return driveError(409, "conflict");
    const parents = meta.parents ?? ["root"];
    if (parents.some((parent) => parent !== "root" && !this.objects.has(parent))) return driveError(404, "notFound");
    this.objects.set(meta.id, { id: meta.id, name: meta.name, mimeType: meta.mimeType, parents });
    return { status: 200, body: { id: meta.id } };
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

function driveError(status: number, reason: string): Answer {
  return { status, body: { error: { code: status, message: reason, errors: [{ reason, domain: "global" }] } } };
}
