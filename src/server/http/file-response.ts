import "server-only";

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";

import { NotFoundError } from "@/shared/errors";

interface FileResponseOptions {
  contentType: string;
  downloadName?: string;
}

function contentDisposition(name: string): string {
  const ascii =
    name
      .normalize("NFD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/["\\]/g, "") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function stream(path: string, range?: { start: number; end: number }): ReadableStream {
  return Readable.toWeb(createReadStream(path, range)) as ReadableStream;
}

// Streams a file that was already resolved inside DATA_DIR, with byte-range support so <video>/<audio> can seek.
export async function fileResponse(
  request: Request,
  absolutePath: string,
  options: FileResponseOptions,
): Promise<Response> {
  const stats = await fs.stat(absolutePath).catch(() => null);
  if (!stats?.isFile()) throw new NotFoundError("FILE_MISSING", "Tệp không còn trên ổ đĩa.");

  const headers = new Headers({
    "Content-Type": options.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
  });
  if (options.downloadName) headers.set("Content-Disposition", contentDisposition(options.downloadName));

  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!match) {
    headers.set("Content-Length", String(stats.size));
    return new Response(stream(absolutePath), { status: 200, headers });
  }

  const start = match[1] ? Number(match[1]) : Math.max(0, stats.size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
  if (Number.isNaN(start) || start > end || start >= stats.size) {
    headers.set("Content-Range", `bytes */${stats.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(stream(absolutePath, { start, end }), { status: 206, headers });
}
