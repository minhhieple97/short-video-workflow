import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function writeFileAtomic(targetPath: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}
