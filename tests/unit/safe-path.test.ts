import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveWithinRoot, UnsafePathError } from "@/server/storage/safe-path";

describe("resolveWithinRoot", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "safe-path-"));
    root = path.join(base, "data");
    outside = path.join(base, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  it("resolves nested paths that do not exist yet", () => {
    expect(resolveWithinRoot(root, "books/abc/original.md")).toBe(path.join(root, "books/abc/original.md"));
  });

  it("rejects parent-directory traversal", () => {
    expect(() => resolveWithinRoot(root, "../outside/secret.md")).toThrow(UnsafePathError);
    expect(() => resolveWithinRoot(root, "books/../../outside")).toThrow(UnsafePathError);
  });

  it("rejects absolute paths, empty paths and null bytes", () => {
    expect(() => resolveWithinRoot(root, "/etc/passwd")).toThrow(UnsafePathError);
    expect(() => resolveWithinRoot(root, "")).toThrow(UnsafePathError);
    expect(() => resolveWithinRoot(root, "books/a\0b")).toThrow(UnsafePathError);
  });

  it("rejects symbolic links that point outside the root", () => {
    fs.symlinkSync(outside, path.join(root, "escape"));
    expect(() => resolveWithinRoot(root, "escape/secret.md")).toThrow(UnsafePathError);
  });

  it("allows symbolic links that stay inside the root", () => {
    fs.mkdirSync(path.join(root, "real"));
    fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"));
    expect(resolveWithinRoot(root, "alias/file.txt")).toBe(path.join(root, "alias/file.txt"));
  });
});
