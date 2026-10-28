import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export interface FileDigest {
  bytes: number;
  sha256: string;
  md5: string;
}

// Streams the file once, so hashing a large MP4 never holds it in memory.
export async function hashFile(filePath: string, signal?: AbortSignal): Promise<FileDigest> {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath, { signal })) {
    const data = chunk as Buffer;
    bytes += data.byteLength;
    sha256.update(data);
    md5.update(data);
  }
  return { bytes, sha256: sha256.digest("hex"), md5: md5.digest("hex") };
}
