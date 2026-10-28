import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/shared/errors";

export type PopplerTool = "pdfinfo" | "pdftotext" | "pdfseparate" | "pdfunite" | "pdfimages";

export interface PopplerConfig {
  // Where the tools live; undefined means they are found on PATH.
  binDir: string | undefined;
  timeoutMs: number;
}

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

const MESSAGES = {
  PDF_TOOL_MISSING:
    "Chưa cài Poppler (poppler-utils) nên chưa đọc được PDF. Cài bằng `sudo apt-get install -y poppler-utils`.",
  PDF_ENCRYPTED: "PDF được đặt mật khẩu nên không đọc được. Hãy bỏ mật khẩu rồi nhập lại.",
  PDF_CORRUPT: "Tệp PDF bị hỏng hoặc không đọc được.",
  PDF_TOOL_TIMEOUT: "Đọc PDF quá lâu và đã bị dừng.",
  PDF_TOOL_FAILED: "Công cụ đọc PDF gặp lỗi.",
} as const;

export class PdfError extends AppError {
  constructor(code: keyof typeof MESSAGES, httpStatus = 422) {
    super(code, MESSAGES[code], httpStatus);
    this.name = "PdfError";
  }
}

// Poppler's own message is only matched to pick the error; it is never shown, since it can name local paths.
function classifyFailure(stderr: string): keyof typeof MESSAGES {
  if (/incorrect password/i.test(stderr)) return "PDF_ENCRYPTED";
  if (/syntax error|xref|trailer|may not be a pdf|couldn't open file|i\/o error/i.test(stderr)) return "PDF_CORRUPT";
  return "PDF_TOOL_FAILED";
}

// Runs one Poppler tool from a fixed argument array (never a shell), with a time limit and cancellation. Every file
// argument must be an absolute path, so no file name can be read as an option.
export function runPoppler(
  tool: PopplerTool,
  args: readonly string[],
  config: PopplerConfig,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const command = config.binDir ? path.join(config.binDir, tool) : tool;
  return new Promise((resolve, reject) => {
    // Only what the tools need; a UTF-8 locale keeps pdftotext output in UTF-8. Next's ProcessEnv typing (which requires
    // NODE_ENV) does not apply to the child's environment.
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
    const child = spawn(command, [...args], { env: env as NodeJS.ProcessEnv, stdio: "pipe", shell: false });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let failure: Error | null = null;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop(new PdfError("PDF_TOOL_TIMEOUT", 504)), config.timeoutMs);
    const onAbort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) stop(new PdfError("PDF_TOOL_FAILED", 500));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_STDERR_BYTES);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      failure ??= error.code === "ENOENT" ? new PdfError("PDF_TOOL_MISSING", 500) : error;
    });
    let settled = false;
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new PdfError(classifyFailure(stderr)));
      else resolve(Buffer.concat(stdout).toString("utf8"));
    };
    // A stopped tool is done when it exits, even if something it started still holds its output open.
    child.on("exit", () => {
      if (!failure) return;
      child.stdout.destroy();
      child.stderr.destroy();
      settle(null);
    });
    child.on("close", settle);
  });
}

function absolute(filePath: string): string {
  if (!path.isAbsolute(filePath)) throw new Error("Poppler is only ever given absolute paths.");
  return filePath;
}

export interface PdfInfo {
  pageCount: number;
  // A PDF that opens without a password may still be encrypted (permission flags); that is not an error here.
  encrypted: boolean;
}

export async function inspectPdf(filePath: string, config: PopplerConfig, signal?: AbortSignal): Promise<PdfInfo> {
  const output = await runPoppler("pdfinfo", [absolute(filePath)], config, signal);
  const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(output)?.[1]?.trim();
  const pageCount = Number(field("Pages"));
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new PdfError("PDF_CORRUPT");
  return { pageCount, encrypted: (field("Encrypted") ?? "no").startsWith("yes") };
}

// The text layer of every page, in page order. pdftotext ends each page with a form feed, which separates them here.
export async function extractTextLayer(
  filePath: string,
  pageCount: number,
  workFile: string,
  config: PopplerConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  await fs.mkdir(path.dirname(absolute(workFile)), { recursive: true });
  await runPoppler(
    "pdftotext",
    ["-enc", "UTF-8", "-eol", "unix", absolute(filePath), absolute(workFile)],
    config,
    signal,
  );
  try {
    const pages = (await fs.readFile(workFile, "utf8")).split("\f");
    return Array.from({ length: pageCount }, (_, index) => pages[index] ?? "");
  } finally {
    await fs.rm(workFile, { force: true });
  }
}

// How many pictures each page draws; a page with pictures and no text is most likely a scan.
export async function countPageImages(
  filePath: string,
  config: PopplerConfig,
  signal?: AbortSignal,
): Promise<Map<number, number>> {
  const output = await runPoppler("pdfimages", ["-list", absolute(filePath)], config, signal);
  const counts = new Map<number, number>();
  // Header lines do not start with a page number and are skipped by the check below.
  for (const line of output.split("\n")) {
    const page = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(page) && page > 0) counts.set(page, (counts.get(page) ?? 0) + 1);
  }
  return counts;
}

// Writes a PDF holding the given pages of the source, in the given order. Single pages are cut out into the work folder
// first and removed afterwards; the source file is only read.
export async function buildPagesPdf(
  sourcePath: string,
  pageNumbers: readonly number[],
  outFile: string,
  workDir: string,
  config: PopplerConfig,
  signal?: AbortSignal,
): Promise<void> {
  if (pageNumbers.length === 0) throw new Error("A page PDF needs at least one page.");
  await fs.mkdir(workDir, { recursive: true });
  const pageFile = (page: number) => path.join(absolute(workDir), `page-${page}.pdf`);
  try {
    for (const page of pageNumbers) {
      await runPoppler(
        "pdfseparate",
        ["-f", String(page), "-l", String(page), absolute(sourcePath), path.join(workDir, "page-%d.pdf")],
        config,
        signal,
      );
    }
    await runPoppler("pdfunite", [...pageNumbers.map(pageFile), absolute(outFile)], config, signal);
  } finally {
    await Promise.all(pageNumbers.map((page) => fs.rm(pageFile(page), { force: true })));
  }
}
