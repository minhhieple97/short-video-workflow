import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface StreamedFile {
  bytes: number;
  sha256: string;
}

export interface StreamToFileOptions {
  maxBytes: number;
  // Called once with the first bytes (at least `headBytes`, or the whole body if it is shorter); throw to reject the stream.
  headBytes?: number;
  validateHead?: (head: Uint8Array) => void;
  // Throws an error of the caller's choosing when the body grows past maxBytes.
  onTooLarge: () => Error;
  signal?: AbortSignal;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

// Writes a request body to disk chunk by chunk, hashing and counting as it goes, so a large upload is never held in
// memory and an oversized or invalid one is rejected as soon as the offending bytes arrive. Any failure (including an
// abort) deletes the partial file and stops reading the source.
export async function streamToFile(
  source: ReadableStream<Uint8Array>,
  targetPath: string,
  options: StreamToFileOptions,
): Promise<StreamedFile> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const handle = await fs.open(targetPath, "wx");
  const reader = source.getReader();
  const hash = createHash("sha256");
  const headBytes = options.headBytes ?? 0;
  let head: Uint8Array = new Uint8Array(0);
  let headChecked = headBytes === 0 || options.validateHead === undefined;
  let bytes = 0;

  const checkHead = (): void => {
    headChecked = true;
    options.validateHead?.(head);
  };

  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;

      bytes += value.byteLength;
      if (bytes > options.maxBytes) throw options.onTooLarge();
      if (!headChecked) {
        head = concat(head, value);
        if (head.byteLength >= headBytes) checkHead();
      }
      hash.update(value);
      await handle.write(value);
    }
    if (!headChecked) checkHead();
    await handle.close();
    return { bytes, sha256: hash.digest("hex") };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await fs.rm(targetPath, { force: true });
    throw error;
  }
}
