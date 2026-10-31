import { z } from "zod";

const envelopeSchema = z
  .object({
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    structured_output: z.unknown().optional(),
    modelUsage: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export interface ClaudeEnvelope {
  isError: boolean;
  text: string;
  structured: unknown;
  // Every model the CLI says it used. It also lists the small model (Haiku) it calls for housekeeping on every run, so
  // the model that did the task is `primaryModel`: the one that cost the most.
  models?: string[];
  primaryModel?: string;
}

const modelUsageEntrySchema = z.object({ costUSD: z.number().optional(), outputTokens: z.number().optional() }).loose();

function primaryModelOf(usage: Record<string, unknown>): string | undefined {
  const weight = (entry: unknown): [number, number] => {
    const parsed = modelUsageEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data.costUSD ?? 0, parsed.data.outputTokens ?? 0] : [0, 0];
  };
  return Object.entries(usage)
    .map(([model, entry]) => ({ model, weight: weight(entry) }))
    .sort((left, right) => right.weight[0] - left.weight[0] || right.weight[1] - left.weight[1])[0]?.model;
}

// A reported model is the requested one when it is the same ID or a dated snapshot of it (claude-opus-5-5-20261001).
export const isRequestedModel = (reported: string, requested: string): boolean =>
  reported === requested || reported.startsWith(`${requested}-`);

export function parseClaudeEnvelope(stdout: string): ClaudeEnvelope {
  const envelope = envelopeSchema.parse(JSON.parse(stdout));
  const primaryModel = envelope.modelUsage ? primaryModelOf(envelope.modelUsage) : undefined;
  return {
    isError: envelope.is_error ?? false,
    text: envelope.result ?? "",
    structured: envelope.structured_output,
    ...(envelope.modelUsage ? { models: Object.keys(envelope.modelUsage) } : {}),
    ...(primaryModel ? { primaryModel } : {}),
  };
}

// Accepts plain JSON or JSON wrapped in prose / ```json fences and returns the outermost object.
export function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Không tìm thấy đối tượng JSON trong kết quả của Claude.");
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

export type CliFailureKind = "QUOTA" | "AUTH" | "MODEL" | "OTHER";

export function classifyCliFailure(message: string): CliFailureKind {
  if (
    /invalid model|unknown model|model[^\n]*(?:not found|does not exist|not available|unavailable|not supported|not allowed|access denied)|(?:no access|do not have access|not authorized)[^\n]*model/i.test(
      message,
    )
  )
    return "MODEL";
  if (/usage limit|rate.?limit|quota|limit reached|hit your limit|too many requests|429/i.test(message)) return "QUOTA";
  if (/not logged in|log in|login|unauthori[sz]ed|authentication|401/i.test(message)) return "AUTH";
  return "OTHER";
}

export function claudeQuotaRetryAfterMs(output: string, now = Date.now()): number | undefined {
  const values = [...output.matchAll(/"(?:resetsAt|resets_at|reset_at)"\s*:\s*(?:"([^"]+)"|(\d+(?:\.\d+)?))/g)];
  const resets = values.flatMap((match) => {
    const value = match[1] ?? match[2] ?? "";
    const numeric = Number(value);
    const timestamp = Number.isFinite(numeric) ? numeric * (numeric < 1e12 ? 1000 : 1) : Date.parse(value);
    return Number.isFinite(timestamp) && timestamp <= 8.64e15 && timestamp > now ? [timestamp - now] : [];
  });
  if (resets.length > 0) return Math.max(...resets);
  const relative = /resets? in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)/i.exec(output);
  if (relative) return Number(relative[1]) * (/^(hour|hr)/i.test(relative[2] ?? "") ? 3_600_000 : 60_000);
  const clock = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([A-Za-z_]+\/[A-Za-z_+/-]+|UTC)\)/i.exec(
    output,
  );
  if (!clock) return undefined;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  if (clock[3]) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (clock[3].toLowerCase() === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return undefined;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: clock[4],
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    });
    for (let offset = 1; offset <= 26 * 60; offset += 1) {
      const next = Math.floor(now / 60_000) * 60_000 + offset * 60_000;
      const parts = formatter.formatToParts(next);
      if (
        Number(parts.find((part) => part.type === "hour")?.value) === hour &&
        Number(parts.find((part) => part.type === "minute")?.value) === minute
      )
        return next - now;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
