import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPagesPdf, countPageImages, extractTextLayer, inspectPdf, runPoppler } from "@/server/pdf/poppler";

import { buildPdf } from "../helpers/pdf-fixtures";
import { popplerTestConfig } from "../helpers/poppler";

const config = popplerTestConfig();
let directory: string;

const write = (name: string, bytes: Buffer) => {
  const file = path.join(directory, name);
  fs.writeFileSync(file, bytes);
  return file;
};

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-poppler-"));
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("runPoppler without the tools", () => {
  it("says how to install Poppler when it is missing", async () => {
    const error = await inspectPdf("/tmp/x.pdf", {
      binDir: path.join(os.tmpdir(), "no-poppler-here"),
      timeoutMs: 5_000,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "PDF_TOOL_MISSING" });
    expect((error as Error).message).toContain("sudo apt-get install -y poppler-utils");
  });

  it("stops a tool that takes too long, and one whose job is cancelled", async () => {
    const slow = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-slow-poppler-"));
    fs.writeFileSync(path.join(slow, "pdfinfo"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    try {
      const started = Date.now();
      await expect(inspectPdf("/tmp/x.pdf", { binDir: slow, timeoutMs: 200 })).rejects.toMatchObject({
        code: "PDF_TOOL_TIMEOUT",
      });
      expect(Date.now() - started).toBeLessThan(5_000);

      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("cancelled by user")), 100);
      await expect(inspectPdf("/tmp/x.pdf", { binDir: slow, timeoutMs: 30_000 }, controller.signal)).rejects.toThrow(
        "cancelled by user",
      );
    } finally {
      fs.rmSync(slow, { recursive: true, force: true });
    }
  });

  it("calls a PDF without a readable page count damaged", async () => {
    const odd = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-odd-poppler-"));
    fs.writeFileSync(path.join(odd, "pdfinfo"), "#!/bin/sh\necho 'Title: x'\n", { mode: 0o755 });
    try {
      await expect(inspectPdf("/tmp/x.pdf", { binDir: odd, timeoutMs: 5_000 })).rejects.toMatchObject({
        code: "PDF_CORRUPT",
      });
    } finally {
      fs.rmSync(odd, { recursive: true, force: true });
    }
  });

  it("refuses a relative path, so no file name can pass for an option", async () => {
    await expect(inspectPdf("-v", { binDir: undefined, timeoutMs: 1_000 })).rejects.toThrow("absolute paths");
  });
});

describe.skipIf(!config)("Poppler wrapper (needs poppler-utils)", () => {
  const poppler = config ?? { binDir: undefined, timeoutMs: 30_000 };

  it("reads the page count of a PDF, encrypted or not", async () => {
    const plain = write("plain.pdf", buildPdf([{ lines: ["A"] }, { image: true }, {}]));
    const restricted = write(
      "restricted.pdf",
      buildPdf([{ lines: ["B"] }], { userPassword: "", ownerPassword: "o", allowCopy: false }),
    );

    expect(await inspectPdf(plain, poppler)).toEqual({ pageCount: 3, encrypted: false });
    expect(await inspectPdf(restricted, poppler)).toEqual({ pageCount: 1, encrypted: true });
  });

  it("tells a password-protected PDF apart from a damaged one, without Poppler's own words", async () => {
    const locked = write(
      "locked.pdf",
      buildPdf([{ lines: ["C"] }], { userPassword: "pw", ownerPassword: "o", allowCopy: true }),
    );
    const damaged = write("damaged.pdf", Buffer.from("%PDF-1.4\nnot really a pdf\n"));

    const lockedError = await inspectPdf(locked, poppler).catch((caught: unknown) => caught);
    expect(lockedError).toMatchObject({ code: "PDF_ENCRYPTED", httpStatus: 422 });
    expect((lockedError as Error).message).not.toContain(directory);
    await expect(inspectPdf(damaged, poppler)).rejects.toMatchObject({ code: "PDF_CORRUPT" });
    await expect(inspectPdf(path.join(directory, "missing.pdf"), poppler)).rejects.toMatchObject({
      code: "PDF_CORRUPT",
    });
  });

  it("reads each page's text layer in page order, including pages with none", async () => {
    const file = write(
      "text.pdf",
      buildPdf([{ lines: ["Chapter 1", "First page."] }, { image: true }, {}, { lines: ["Last (page) \\ here"] }]),
    );
    const workFile = path.join(directory, "text.txt");

    const pages = await extractTextLayer(file, 4, workFile, poppler);

    expect(pages.map((page) => page.trim())).toEqual(["Chapter 1\nFirst page.", "", "", "Last (page) \\ here"]);
    expect(fs.existsSync(workFile)).toBe(false);
  });

  it("counts the pictures on each page", async () => {
    const file = write("images.pdf", buildPdf([{ lines: ["x"] }, { image: true }, { image: true, lines: ["y"] }]));

    expect(await countPageImages(file, poppler)).toEqual(
      new Map([
        [2, 1],
        [3, 1],
      ]),
    );
  });

  it("builds a PDF from chosen pages in the given order and leaves no single pages behind", async () => {
    const file = write(
      "source.pdf",
      buildPdf([{ lines: ["one"] }, { lines: ["two"] }, { lines: ["three"] }, { lines: ["four"] }]),
    );
    const workDir = path.join(directory, "work");
    const chunk = path.join(directory, "chunk.pdf");

    await buildPagesPdf(file, [4, 2], chunk, workDir, poppler);

    expect((await inspectPdf(chunk, poppler)).pageCount).toBe(2);
    const text = await extractTextLayer(chunk, 2, path.join(directory, "chunk.txt"), poppler);
    expect(text.map((page) => page.trim())).toEqual(["four", "two"]);
    expect(fs.readdirSync(workDir)).toEqual([]);

    const single = path.join(directory, "single.pdf");
    await buildPagesPdf(file, [3], single, workDir, poppler);
    expect((await inspectPdf(single, poppler)).pageCount).toBe(1);
  });

  it("passes a file name with spaces and shell characters as a plain argument", async () => {
    const file = write("my book; echo hacked $(whoami).pdf", buildPdf([{ lines: ["safe"] }]));

    expect((await inspectPdf(file, poppler)).pageCount).toBe(1);
    await expect(runPoppler("pdfinfo", [file], poppler)).resolves.toContain("Pages:");
  });
});
