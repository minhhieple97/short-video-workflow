import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5_000;

// execFile with an argument array never goes through a shell.
export async function readFirstOutputLine(command: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], { timeout: COMMAND_TIMEOUT_MS });
  return stdout.split("\n")[0]?.trim() ?? "";
}

// Some tools (pdfinfo, for one) print their version on stderr.
export async function readVersionLine(command: string, args: readonly string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, [...args], { timeout: COMMAND_TIMEOUT_MS });
  return (stdout.trim() || stderr.trim()).split("\n")[0]?.trim() ?? "";
}
