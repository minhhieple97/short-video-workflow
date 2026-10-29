import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildOcrChunks } from "@/features/extraction/services/ocr-chunks.service";
import { extractTextLayer, inspectPdf } from "@/server/pdf/poppler";

import { buildPdf } from "../helpers/pdf-fixtures";
import { popplerTestConfig } from "../helpers/poppler";

const poppler = popplerTestConfig();
let directory: string;
let source: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-chunks-"));
  source = path.join(directory, "book.pdf");
  fs.writeFileSync(
    source,
    buildPdf(Array.from({ length: 10 }, (_, index) => ({ lines: [`Page ${index + 1}`], image: true }))),
  );
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const build = (pageNumbers: number[], maxPages: number, maxBytes: number) =>
  buildOcrChunks({
    sourcePath: source,
    pageNumbers,
    limits: { maxPages, maxBytes },
    outDir: path.join(directory, "ocr"),
    chunkPrefix: "op1",
    poppler: poppler ?? { binDir: undefined, timeoutMs: 30_000 },
  });

describe.skipIf(!poppler)("buildOcrChunks (needs poppler-utils)", () => {
  const config = poppler ?? { binDir: undefined, timeoutMs: 30_000 };

  it("puts non-contiguous pages into chunks whose page order maps back to the source pages", async () => {
    const { chunks, oversizedPages } = await build([9, 2, 5, 7], 3, 10 * 1024 * 1024);

    expect(oversizedPages).toEqual([]);
    expect(chunks.map((chunk) => [chunk.chunkId, chunk.pageNumbers])).toEqual([
      ["op1-1", [2, 5, 7]],
      ["op1-2", [9]],
    ]);
    const firstText = await extractTextLayer(chunks[0]?.filePath ?? "", 3, path.join(directory, "t.txt"), config);
    expect(firstText.map((page) => page.trim())).toEqual(["Page 2", "Page 5", "Page 7"]);
    for (const chunk of chunks) {
      expect(chunk.bytes).toBe(fs.statSync(chunk.filePath).size);
      expect((await inspectPdf(chunk.filePath, config)).pageCount).toBe(chunk.pageNumbers.length);
    }
  });

  it("splits a chunk that is too large in bytes until every chunk fits", async () => {
    const onePage = (await build([1], 50, 10 * 1024 * 1024)).chunks[0]?.bytes ?? 0;
    fs.rmSync(path.join(directory, "ocr"), { recursive: true, force: true });

    const { chunks, oversizedPages } = await build([1, 2, 3, 4], 50, Math.floor(onePage * 2.5));

    expect(oversizedPages).toEqual([]);
    expect(chunks.map((chunk) => chunk.pageNumbers)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(chunks.every((chunk) => chunk.bytes <= Math.floor(onePage * 2.5))).toBe(true);
    expect(fs.readdirSync(path.join(directory, "ocr")).sort()).toEqual(["op1-1.pdf", "op1-2.pdf"]);
  });

  it("reports a page that alone is over the byte limit instead of sending it", async () => {
    const { chunks, oversizedPages } = await build([3, 4], 50, 100);

    expect(chunks).toEqual([]);
    expect(oversizedPages).toEqual([3, 4]);
    expect(fs.readdirSync(path.join(directory, "ocr"))).toEqual([]);
  });

  it("rebuilds the same page content in the same chunk order", async () => {
    const first = await build([1, 3, 5], 2, 10 * 1024 * 1024);
    const textOf = (chunks: typeof first.chunks, label: string) =>
      Promise.all(
        chunks.map(async (chunk) => {
          const pages = await extractTextLayer(
            chunk.filePath,
            chunk.pageNumbers.length,
            path.join(directory, `${label}-${chunk.chunkId}.txt`),
            config,
          );
          return pages.map((page) => page.trim());
        }),
      );
    const firstText = await textOf(first.chunks, "first");
    expect(firstText).toEqual([["Page 1", "Page 3"], ["Page 5"]]);
    const again = await build([5, 3, 1], 2, 10 * 1024 * 1024);

    expect(again.chunks.map((chunk) => [chunk.chunkId, chunk.pageNumbers])).toEqual(
      first.chunks.map((chunk) => [chunk.chunkId, chunk.pageNumbers]),
    );
    expect(await textOf(again.chunks, "again")).toEqual(firstText);
  });
});
