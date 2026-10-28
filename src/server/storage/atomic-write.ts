import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// `mode` applies from the moment the file exists, so a file holding a secret is never readable by others, even briefly.
export async function writeFileAtomic(
  targetPath: string,
  data: string | Uint8Array,
  options: { mode?: number } = {},
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, data, { mode: options.mode });
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}
