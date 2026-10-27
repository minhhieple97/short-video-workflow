import fs from "node:fs";
import path from "node:path";

export class UnsafePathError extends Error {
  readonly code = "UNSAFE_PATH";
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realpathOfDeepestExisting(target: string): string {
  let current = target;
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing.reverse());
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export function resolveWithinRoot(root: string, relativePath: string): string {
  if (relativePath.length === 0 || relativePath.includes("\0")) {
    throw new UnsafePathError("Path must be a non-empty string without null bytes");
  }
  if (path.isAbsolute(relativePath)) {
    throw new UnsafePathError("Absolute paths are not allowed");
  }

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  if (!isInside(resolvedRoot, target)) {
    throw new UnsafePathError("Path escapes the data directory");
  }
  if (!isInside(realpathOfDeepestExisting(resolvedRoot), realpathOfDeepestExisting(target))) {
    throw new UnsafePathError("Path escapes the data directory through a symbolic link");
  }
  return target;
}
