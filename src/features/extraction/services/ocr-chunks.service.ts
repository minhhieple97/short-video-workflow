import fs from "node:fs/promises";
import path from "node:path";

import type { OcrChunkLimits } from "@/server/ocr/ocr-provider";
import { buildPagesPdf, type PopplerConfig } from "@/server/pdf/poppler";

import { groupOcrPages, splitGroup } from "../domain/ocr-chunk-plan";
import type { PlannedOcrChunk } from "../domain/ocr-results";
import type { OcrChunkSpec } from "./ocr-operation.service";

export interface BuiltOcrChunks {
  chunks: OcrChunkSpec[];
  // Pages that alone exceed the provider's byte limit; they cannot be sent and are reported instead.
  oversizedPages: number[];
}

// Writes one PDF per chunk under `outDir`, each within the provider's page and byte limits. The page limit is applied by
// grouping; the byte limit can only be known once a chunk exists, so a chunk that is too large is split in half and
// rebuilt. Chunk IDs are `${prefix}-${n}` in output order, so the same input always gives the same chunks.
export async function buildOcrChunks(input: {
  sourcePath: string;
  pageNumbers: readonly number[];
  limits: OcrChunkLimits;
  outDir: string;
  chunkPrefix: string;
  poppler: PopplerConfig;
  signal?: AbortSignal;
}): Promise<BuiltOcrChunks> {
  const { limits, outDir, poppler, signal } = input;
  await fs.mkdir(outDir, { recursive: true });
  const workDir = path.join(outDir, "pages");
  const chunks: OcrChunkSpec[] = [];
  const oversizedPages: number[] = [];

  const build = async (pages: readonly number[]): Promise<void> => {
    const chunkId = `${input.chunkPrefix}-${chunks.length + 1}`;
    const filePath = path.join(outDir, `${chunkId}.pdf`);
    await buildPagesPdf(input.sourcePath, pages, filePath, workDir, poppler, signal);
    const { size } = await fs.stat(filePath);
    if (size <= limits.maxBytes) {
      chunks.push({ chunkId, pageNumbers: [...pages], filePath, bytes: size });
      return;
    }
    await fs.rm(filePath, { force: true });
    const halves = splitGroup(pages);
    if (!halves) {
      oversizedPages.push(...pages);
      return;
    }
    for (const half of halves) await build(half);
  };

  for (const group of groupOcrPages(input.pageNumbers, limits.maxPages)) await build(group);
  await fs.rm(workDir, { recursive: true, force: true });
  return { chunks, oversizedPages };
}

// The chunk files of an operation that was planned earlier, rebuilt from its stored plan where they are missing (the
// worker stopped, or they were cleaned up). A rebuilt file is written beside its final name and renamed into place, so
// a file that exists is always whole.
export async function materializeOcrChunks(input: {
  sourcePath: string;
  plan: readonly PlannedOcrChunk[];
  outDir: string;
  poppler: PopplerConfig;
  signal?: AbortSignal;
}): Promise<OcrChunkSpec[]> {
  const { outDir, poppler, signal } = input;
  await fs.mkdir(outDir, { recursive: true });
  const workDir = path.join(outDir, "pages");
  const chunks: OcrChunkSpec[] = [];
  for (const { chunkId, pageNumbers } of input.plan) {
    const filePath = path.join(outDir, `${chunkId}.pdf`);
    let size = await fs.stat(filePath).then(
      (stat) => stat.size,
      () => null,
    );
    if (size === null) {
      const partial = `${filePath}.part`;
      await buildPagesPdf(input.sourcePath, pageNumbers, partial, workDir, poppler, signal);
      await fs.rename(partial, filePath);
      size = (await fs.stat(filePath)).size;
    }
    chunks.push({ chunkId, pageNumbers: [...pageNumbers], filePath, bytes: size });
  }
  await fs.rm(workDir, { recursive: true, force: true });
  return chunks;
}
