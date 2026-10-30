import fs from "node:fs";
import path from "node:path";

const PYTHON_NAME = /^python[\d.]*$/;

function findOnPath(command: string, pathEnv: string): string | null {
  if (command.includes("/")) return fs.existsSync(command) ? command : null;
  for (const directory of pathEnv.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// The first line of a file, read from its first bytes only (the command may be a large binary); "" when it cannot be read.
function firstLineOf(file: string): string {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(file, "r");
    const buffer = Buffer.alloc(256);
    const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes).toString("utf8").split("\n")[0] ?? "";
  } catch {
    return "";
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

// The interpreter named on a script's first line (`#!/usr/bin/python3` or `#!/usr/bin/env [-S] python3`), when it is a
// Python; anything else (a binary, a Node script) yields null.
export function pythonFromShebang(firstLine: string): string | null {
  const match = /^#!\s*(\S+)(.*)$/.exec(firstLine.trim());
  if (!match) return null;
  const [, program = "", rest = ""] = match;
  const words = rest
    .trim()
    .split(/\s+/)
    .filter((word) => word && word !== "-S");
  const interpreter = path.basename(program) === "env" ? (words[0] ?? "") : program;
  return PYTHON_NAME.test(path.basename(interpreter)) ? interpreter : null;
}

// Which Python runs edge-tts-words.py: the configured one, else the Python the installed `edge-tts` command was written for
// (pip puts its interpreter on the command's first line, which is where the edge_tts module lives), else python3.
export function resolveEdgeTtsPython(options: { explicit?: string; command: string; pathEnv?: string }): string {
  if (options.explicit) return options.explicit;
  const script = findOnPath(options.command, options.pathEnv ?? process.env.PATH ?? "");
  const python = script ? pythonFromShebang(firstLineOf(script)) : null;
  return python ?? "python3";
}

// Absolute path of the helper script, resolved from the project folder like the Remotion entry point.
export function edgeTtsWordsScript(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), "src/server/tts/edge/edge-tts-words.py");
}
