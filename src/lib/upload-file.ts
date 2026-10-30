import { ApiError } from "./api-client";

export function uploadFile(
  url: string,
  file: File,
  signal: AbortSignal,
  onProgress: (sent: number, total: number) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", "application/pdf");
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.total || file.size);
    xhr.onload = () => {
      cleanup();
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      const error = typeof body === "object" && body !== null && "error" in body ? body.error : null;
      const message =
        typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
          ? error.message
          : `Tải lên thất bại (HTTP ${xhr.status}).`;
      const code =
        typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
          ? error.code
          : "UPLOAD_FAILED";
      reject(new ApiError(code, message, xhr.status));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Không gửi được tệp tới ứng dụng. Hãy kiểm tra kết nối rồi thử lại."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}
