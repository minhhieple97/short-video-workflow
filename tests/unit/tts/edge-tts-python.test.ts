import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pythonFromShebang, resolveEdgeTtsPython } from "@/server/tts/edge/edge-tts-python";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-edge-python-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const script = (name: string, firstLine: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${firstLine}\nimport sys\n`);
  return file;
};

describe("the Python that runs edge-tts-words.py", () => {
  it.each([
    ["#!/usr/bin/python3", "/usr/bin/python3"],
    ["#!/home/me/.venv/bin/python3.12", "/home/me/.venv/bin/python3.12"],
    ["#!/usr/bin/env python3", "python3"],
    ["#!/usr/bin/env -S python3 -u", "python3"],
    ["#!/usr/bin/env node", null],
    ["\u007fELF binary", null],
  ])("reads %j as %j", (line, expected) => {
    expect(pythonFromShebang(line)).toBe(expected);
  });

  it("prefers the configured Python", () => {
    expect(resolveEdgeTtsPython({ explicit: "/opt/py/bin/python", command: "edge-tts", pathEnv: dir })).toBe(
      "/opt/py/bin/python",
    );
  });

  it("uses the Python the edge-tts command found on PATH was installed for", () => {
    script("edge-tts", "#!/usr/bin/python3.12");
    expect(resolveEdgeTtsPython({ command: "edge-tts", pathEnv: `/nonexistent${path.delimiter}${dir}` })).toBe(
      "/usr/bin/python3.12",
    );
  });

  it("falls back to python3 when the command is missing or is not a Python script", () => {
    expect(resolveEdgeTtsPython({ command: "edge-tts", pathEnv: dir })).toBe("python3");
    const binary = script("edge-tts-bin", "\u007fELF");
    expect(resolveEdgeTtsPython({ command: binary, pathEnv: "" })).toBe("python3");
  });
});
