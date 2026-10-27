import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { NotFoundError } from "@/shared/errors";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const stagedMetaSchema = z.object({
  importId: z.uuid(),
  fileName: z.string().min(1),
  format: z.enum(["md", "txt"]),
  sizeBytes: z.number().int().nonnegative(),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
});

export type StagedImportMeta = z.infer<typeof stagedMetaSchema>;

const stagingDirectory = (importId: string) => dataPath("imports", importId);

export async function stageImport(meta: StagedImportMeta, bytes: Uint8Array): Promise<void> {
  const directory = stagingDirectory(meta.importId);
  await writeFileAtomic(path.join(directory, "source"), bytes);
  await writeFileAtomic(path.join(directory, "meta.json"), JSON.stringify(meta, null, 2));
}

export async function loadStagedImport(importId: string): Promise<{ meta: StagedImportMeta; bytes: Uint8Array }> {
  const directory = stagingDirectory(importId);
  try {
    const [metaRaw, bytes] = await Promise.all([
      fs.readFile(path.join(directory, "meta.json"), "utf8"),
      fs.readFile(path.join(directory, "source")),
    ]);
    return { meta: stagedMetaSchema.parse(JSON.parse(metaRaw)), bytes: new Uint8Array(bytes) };
  } catch {
    throw new NotFoundError("IMPORT_NOT_FOUND", "Phiên nhập sách đã hết hạn hoặc không tồn tại. Hãy tải tệp lên lại.");
  }
}

export async function discardStagedImport(importId: string): Promise<void> {
  await fs.rm(stagingDirectory(importId), { recursive: true, force: true });
}

export async function purgeStaleImports(now: number = Date.now()): Promise<void> {
  const root = dataPath("imports");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = path.join(root, entry.name);
        const stats = await fs.stat(directory);
        if (now - stats.mtimeMs > STALE_AFTER_MS) await fs.rm(directory, { recursive: true, force: true });
      }),
  );
}
