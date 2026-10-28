import fs from "node:fs/promises";
import path from "node:path";

import type { OcrChunkLimits } from "@/server/ocr/ocr-provider";
import { buildPagesPdf, type PopplerConfig } from "@/server/pdf/poppler";

import { groupOcrPages, splitGroup } from "../domain/ocr-chunk-plan";
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
