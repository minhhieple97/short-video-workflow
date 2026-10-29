import http from "node:http";
import type { AddressInfo } from "node:net";

export interface StoredFile {
  id: string;
  filename: string;
  purpose: string;
  bytes: Buffer;
}

export interface FakeBatchJob {
  id: string;
  status: string;
  endpoint: string;
  model: string;
  input_files: string[];
  metadata: Record<string, string>;
  output_file: string | null;
  error_file: string | null;
  total_requests: number;
  succeeded_requests: number;
  failed_requests: number;
  createdOrder: number;
  cancelObserved: boolean;
}

export interface CompleteJobOptions {
  failChunks?: string[];
  omitChunks?: string[];
  oneBasedPages?: boolean;
  // null leaves the page confidence out of the response, as Mistral does when none is requested.
  confidence?: number | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
}

// What the next matching request gets instead of a normal answer.
export type Fault =
  | { kind: "status"; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: "drop" }
  // The request takes effect and then the connection dies, so the client never learns the outcome.
  | { kind: "drop-after" }
  | { kind: "garbage" };

type RouteHandler = (request: IncomingRequest) => Promise<unknown> | unknown;

export interface IncomingRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

// A local stand-in for the parts of Mistral's REST API the OCR adapter uses. Routes for more endpoints are added with
// addRoute(); every request is recorded, and faults can be injected per method and path.
export class FakeMistralServer {
  readonly files = new Map<string, StoredFile>();
  readonly jobs = new Map<string, FakeBatchJob>();
  readonly requests: RecordedRequest[] = [];
  // Lets a test make the server report a different size than it received.
  reportedBytes: ((file: StoredFile) => number) | null = null;
  normalizeBatchUploads = false;

  private readonly routes: Route[] = [];
  private readonly faults: { method: string; pattern: RegExp; fault: Fault }[] = [];
  private fileCounter = 0;
  private jobCounter = 0;

  private constructor(
    private readonly server: http.Server,
    private readonly apiKey: string,
    readonly baseUrl: string,
  ) {}

  static async start(apiKey = "test-key"): Promise<FakeMistralServer> {
    let instance: FakeMistralServer | null = null;
    const server = http.createServer((request, response) => {
      void instance?.handle(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    instance = new FakeMistralServer(server, apiKey, `http://127.0.0.1:${port}`);
    instance.installFileRoutes();
    instance.installBatchRoutes();
    return instance;
  }

  addRoute(method: string, pattern: RegExp, handler: RouteHandler): void {
    this.routes.push({ method, pattern, handler });
  }

  failNext(method: string, pattern: RegExp, fault: Fault): void {
    this.faults.push({ method, pattern, fault });
  }

  nextFileId(): string {
    this.fileCounter += 1;
    return `file-${this.fileCounter}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // Finishes a queued job the way Mistral would: one output line per chunk, one error line per failed chunk.
  completeJob(jobId: string, options: CompleteJobOptions = {}): void {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) return;

    const requestText = job.input_files.map((id) => this.files.get(id)?.bytes.toString("utf8") ?? "").join("\n");
    const outputLines: string[] = [];
    const errorLines: string[] = [];
    for (const raw of requestText.split("\n").filter(Boolean)) {
      const request = JSON.parse(raw) as { custom_id: string; body: { document: { file_id: string } } };
      const customId = request.custom_id;
      if (options.omitChunks?.includes(customId)) continue;
      if (options.failChunks?.includes(customId)) {
        errorLines.push(
          JSON.stringify({
            id: `batch_err_${customId}`,
            custom_id: customId,
            response: null,
            error: { message: "ocr failed" },
          }),
        );
        continue;
      }

      const document = this.files.get(request.body.document.file_id)?.bytes.toString("latin1") ?? "";
      // Test documents say how many pages they stand for; a real PDF (a chunk cut by Poppler) has its page objects counted.
      const marker = /pages=(\d+)/.exec(document)?.[1];
      const pageCount = marker ? Number(marker) : Math.max(1, document.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0);
      const base = options.oneBasedPages ? 1 : 0;
      const confidence = options.confidence === undefined ? 0.97 : options.confidence;
      const pages = Array.from({ length: pageCount }, (_, position) => ({
        index: base + position,
        markdown: `Trang ${position + 1} của ${customId}`,
        ...(confidence === null ? {} : { confidence_scores: { average_page_confidence_score: confidence } }),
      }));
      outputLines.push(
        JSON.stringify({
          id: `batch_req_${customId}`,
          custom_id: customId,
          response: {
            status_code: 200,
            body: { pages, model: "fake-ocr", usage_info: { pages_processed: pageCount } },
          },
          error: null,
        }),
      );
    }

    const store = (lines: string[]): string | null => {
      if (lines.length === 0) return null;
      const id = this.nextFileId();
      this.files.set(id, {
        id,
        filename: `${jobId}.jsonl`,
        purpose: "batch",
        bytes: Buffer.from(`${lines.join("\n")}\n`),
      });
      return id;
    };
    job.output_file = store(outputLines);
    job.error_file = store(errorLines);
    job.succeeded_requests = outputLines.length;
    job.failed_requests = errorLines.length;
    job.status = "SUCCESS";
  }

  setJobStatus(jobId: string, status: string): void {
    const job = this.jobs.get(jobId);
    if (job) job.status = status;
  }

  private installFileRoutes(): void {
    this.addRoute("POST", /^\/v1\/files$/, async (request) => {
      const contentType = request.headers["content-type"];
      const form = await new Request("http://fake.invalid/", {
        method: "POST",
        headers: contentType ? { "content-type": contentType } : {},
        body: Uint8Array.from(request.body),
      }).formData();
      const upload = form.get("file");
      const purpose = form.get("purpose");
      if (!(upload instanceof File) || typeof purpose !== "string") {
        return { status: 422, body: { message: "file and purpose are required" } };
      }

      const stored: StoredFile = {
        id: this.nextFileId(),
        filename: upload.name,
        purpose,
        bytes: Buffer.from(await upload.arrayBuffer()),
      };
      if (purpose === "batch" && this.normalizeBatchUploads) {
        const lines = stored.bytes
          .toString("utf8")
          .trim()
          .split("\n")
          .map((raw, index) => {
            const line = JSON.parse(raw) as { body: Record<string, unknown> };
            return JSON.stringify({
              id: `batch_req_${index}`,
              ...line,
              body: { id: null, extract_header: false, extract_footer: false, ...line.body },
            });
          });
        stored.bytes = Buffer.from(`${lines.join("\n")}\n`);
      }
      this.files.set(stored.id, stored);
      return {
        id: stored.id,
        object: "file",
        bytes: this.reportedBytes ? this.reportedBytes(stored) : stored.bytes.byteLength,
        created_at: 1_700_000_000,
        filename: stored.filename,
        purpose: stored.purpose,
        sample_type: "batch_request",
        source: "upload",
      };
    });

    this.addRoute("DELETE", /^\/v1\/files\/([^/]+)$/, (request) => {
      const id = decodeURIComponent(request.path.split("/")[3] ?? "");
      if (!this.files.delete(id)) return { status: 404, body: { message: "File not found" } };
      return { id, object: "file", deleted: true };
    });

    this.addRoute("GET", /^\/v1\/files\/([^/]+)\/content$/, (request) => {
      const stored = this.files.get(decodeURIComponent(request.path.split("/")[3] ?? ""));
      return stored ? { raw: stored.bytes } : { status: 404, body: { message: "File not found" } };
    });
  }

  private installBatchRoutes(): void {
    const publicJob = ({ createdOrder: _order, cancelObserved: _observed, ...job }: FakeBatchJob) => job;

    this.addRoute("POST", /^\/v1\/batch\/jobs$/, (request) => {
      const body = JSON.parse(request.body.toString("utf8")) as {
        model: string;
        endpoint: string;
        input_files: string[];
        metadata?: Record<string, string>;
      };
      const inputs = body.input_files.map((id) => this.files.get(id));
      if (inputs.some((file) => file === undefined)) return { status: 422, body: { message: "Unknown input file" } };

      this.jobCounter += 1;
      const job: FakeBatchJob = {
        id: `job-${this.jobCounter}`,
        status: "QUEUED",
        endpoint: body.endpoint,
        model: body.model,
        input_files: body.input_files,
        metadata: body.metadata ?? {},
        output_file: null,
        error_file: null,
        total_requests: inputs.reduce(
          (sum, file) => sum + (file?.bytes.toString("utf8").split("\n").filter(Boolean).length ?? 0),
          0,
        ),
        succeeded_requests: 0,
        failed_requests: 0,
        createdOrder: this.jobCounter,
        cancelObserved: false,
      };
      this.jobs.set(job.id, job);
      return publicJob(job);
    });

    this.addRoute("GET", /^\/v1\/batch\/jobs$/, (request) => {
      const page = Number(request.query.get("page") ?? "0");
      const pageSize = Number(request.query.get("page_size") ?? "100");
      const newestFirst = [...this.jobs.values()].sort((left, right) => right.createdOrder - left.createdOrder);
      return {
        data: newestFirst.slice(page * pageSize, (page + 1) * pageSize).map(publicJob),
        object: "list",
        total: newestFirst.length,
      };
    });

    this.addRoute("GET", /^\/v1\/batch\/jobs\/([^/]+)$/, (request) => {
      const job = this.jobs.get(decodeURIComponent(request.path.split("/")[4] ?? ""));
      if (!job) return { status: 404, body: { message: "Job not found" } };
      // Cancellation is asynchronous, as with the real API: it is requested first and takes effect a poll later.
      if (job.status === "CANCELLATION_REQUESTED") {
        if (job.cancelObserved) job.status = "CANCELLED";
        job.cancelObserved = true;
      }
      return publicJob(job);
    });

    this.addRoute("POST", /^\/v1\/batch\/jobs\/([^/]+)\/cancel$/, (request) => {
      const job = this.jobs.get(decodeURIComponent(request.path.split("/")[4] ?? ""));
      if (!job) return { status: 404, body: { message: "Job not found" } };
      if (job.status === "QUEUED" || job.status === "RUNNING") job.status = "CANCELLATION_REQUESTED";
      return publicJob(job);
    });
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://fake.invalid");
    const method = request.method ?? "GET";
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const incoming: IncomingRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body: Buffer.concat(chunks),
      headers: request.headers,
    };
    this.requests.push({ method, path: url.pathname, authorization: request.headers.authorization });

    if (request.headers.authorization !== `Bearer ${this.apiKey}`) {
      return this.send(response, { status: 401, body: { message: "Unauthorized" } });
    }

    const faultIndex = this.faults.findIndex((entry) => entry.method === method && entry.pattern.test(url.pathname));
    const injected = faultIndex >= 0 ? this.faults.splice(faultIndex, 1)[0]?.fault : undefined;
    if (injected?.kind === "drop") {
      request.socket.destroy();
      return;
    }
    if (injected?.kind === "drop-after") {
      const applied = this.routes.find(
        (candidate) => candidate.method === method && candidate.pattern.test(url.pathname),
      );
      await applied?.handler(incoming);
      request.socket.destroy();
      return;
    }
    if (injected?.kind === "garbage") {
      response.writeHead(200, { "content-type": "application/json" }).end("<<not json>>");
      return;
    }
    if (injected?.kind === "status") {
      return this.send(response, {
        status: injected.status,
        body: injected.body ?? { message: "injected" },
        headers: injected.headers,
      });
    }

    const route = this.routes.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
    if (!route)
      return this.send(response, { status: 404, body: { message: `No route for ${method} ${url.pathname}` } });
    return this.send(response, await route.handler(incoming));
  }

  private send(response: http.ServerResponse, result: unknown): void {
    if (typeof result === "object" && result !== null && "raw" in result && Buffer.isBuffer(result.raw)) {
      response.writeHead(200, { "content-type": "application/octet-stream" }).end(result.raw);
      return;
    }
    if (typeof result === "object" && result !== null && "status" in result && typeof result.status === "number") {
      const headers =
        "headers" in result && typeof result.headers === "object" ? (result.headers as Record<string, string>) : {};
      response.writeHead(result.status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify("body" in result ? result.body : {}));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  }
}
