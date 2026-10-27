import { z } from "zod";

const envelopeSchema = z
  .object({
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    structured_output: z.unknown().optional(),
  })
  .loose();

export interface ClaudeEnvelope {
  isError: boolean;
  text: string;
  structured: unknown;
}

export function parseClaudeEnvelope(stdout: string): ClaudeEnvelope {
  const envelope = envelopeSchema.parse(JSON.parse(stdout));
  return { isError: envelope.is_error ?? false, text: envelope.result ?? "", structured: envelope.structured_output };
}

// Accepts plain JSON or JSON wrapped in prose / ```json fences and returns the outermost object.
export function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Không tìm thấy đối tượng JSON trong kết quả của Claude.");
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

export type CliFailureKind = "QUOTA" | "AUTH" | "OTHER";

export function classifyCliFailure(message: string): CliFailureKind {
  if (/usage limit|rate limit|quota|limit reached|too many requests|429/i.test(message)) return "QUOTA";
  if (/not logged in|log in|login|unauthori[sz]ed|authentication|401/i.test(message)) return "AUTH";
  return "OTHER";
}

const SESSION_ENV_PREFIXES = ["CLAUDECODE", "CLAUDE_CODE_"];
const API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

// Never inherit a running Claude Code session (no nested sessions) and never fall back to an API key.
export function sanitizeClaudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(sanitized)) {
    if (SESSION_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) || API_KEY_VARIABLES.includes(key)) {
      delete sanitized[key];
    }
  }
  return sanitized;
}
