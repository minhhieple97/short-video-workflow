const MAX_FIELDS_CHARS = 200;
const RESERVED = new Set(["time", "level", "scope", "message"]);

const pad = (value: number) => String(value).padStart(2, "0");

function formatValue(value: unknown): string {
  if (typeof value === "string") return /^[\w./:@-]+$/.test(value) ? value : JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}

// The app's own log lines are JSON (one object per line, for machines). In the terminal of `pnpm dev:all` they read better as
// "18:18:00 info  worker  Worker started  queue=studio-jobs"; any other line (Next's own output, say) is left as it is.
export function formatDevLog(line: string): string {
  if (!line.startsWith("{")) return line;
  try {
    const entry: unknown = JSON.parse(line);
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return line;
    const { time, level, scope, message, ...rest } = entry as Record<string, unknown>;
    if (typeof message !== "string" || typeof level !== "string") return line;
    const at = typeof time === "string" ? new Date(time) : null;
    const clock =
      at && !Number.isNaN(at.getTime())
        ? `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
        : "--:--:--";
    const fields = Object.entries(rest)
      .filter(([key, value]) => !RESERVED.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ");
    const shown = fields.length > MAX_FIELDS_CHARS ? `${fields.slice(0, MAX_FIELDS_CHARS)}…` : fields;
    const severity = level === "error" ? "ERROR" : level === "warn" ? "WARN " : level.padEnd(5);
    return `${clock} ${severity} ${typeof scope === "string" ? scope : ""}  ${message}${shown ? `  ${shown}` : ""}`;
  } catch {
    return line;
  }
}
