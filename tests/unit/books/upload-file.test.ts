import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";
import { uploadFile } from "@/lib/upload-file";

class UploadRequest {
  static instances: UploadRequest[] = [];
  upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = "";
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());

  constructor() {
    UploadRequest.instances.push(this);
  }

  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function currentRequest(): UploadRequest {
  const request = UploadRequest.instances.at(-1);
  if (!request) throw new Error("Upload request was not created");
  return request;
}

describe("PDF upload transport", () => {
  const file = new File(["%PDF-1.4\n%%EOF"], "book.pdf", { type: "application/pdf" });
  beforeEach(() => {
    UploadRequest.instances = [];
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the original file and reports bytes without buffering it in JavaScript", async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const result = uploadFile("/api/books/import/pdf?fileName=book.pdf", file, controller.signal, progress);
    const request = currentRequest();
    expect(request.open).toHaveBeenCalledWith("POST", "/api/books/import/pdf?fileName=book.pdf");
    expect(request.setRequestHeader).toHaveBeenCalledWith("content-type", "application/pdf");
    expect(request.send).toHaveBeenCalledWith(file);
    request.upload.onprogress?.({ loaded: 5, total: 0 });
    expect(progress).toHaveBeenCalledWith(5, file.size);
    request.respond(202, { bookId: "book-1" });
    await expect(result).resolves.toEqual({ bookId: "book-1" });
    controller.abort();
    expect(request.abort).not.toHaveBeenCalled();
  });

  it("preserves a server validation error so the caller can handle that file", async () => {
    const result = uploadFile("/upload", file, new AbortController().signal, vi.fn());
    currentRequest().respond(422, { error: { code: "PDF_CORRUPT", message: "Tệp PDF bị hỏng." } });
    await expect(result).rejects.toMatchObject({ name: "ApiError", code: "PDF_CORRUPT", status: 422 });
  });

  it("handles a non-JSON server error", async () => {
    const result = uploadFile("/upload", file, new AbortController().signal, vi.fn());
    const request = currentRequest();
    request.status = 503;
    request.responseText = "Service unavailable";
    request.onload?.();
    await expect(result).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a connection failure and detaches cancellation", async () => {
    const controller = new AbortController();
    const result = uploadFile("/upload", file, controller.signal, vi.fn());
    const request = currentRequest();
    request.onerror?.();
    await expect(result).rejects.toThrow("Không gửi được tệp");
    controller.abort();
    expect(request.abort).not.toHaveBeenCalled();
  });

  it("aborts an in-flight upload", async () => {
    const controller = new AbortController();
    const result = uploadFile("/upload", file, controller.signal, vi.fn());
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(currentRequest().abort).toHaveBeenCalledOnce();
  });

  it("does not send a file after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadFile("/upload", file, controller.signal, vi.fn())).rejects.toMatchObject({ name: "AbortError" });
    expect(UploadRequest.instances).toHaveLength(0);
  });
});
