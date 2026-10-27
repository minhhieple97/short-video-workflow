type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function write(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, scope, message, ...fields });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, fields) => write("debug", scope, message, fields),
    info: (message, fields) => write("info", scope, message, fields),
    warn: (message, fields) => write("warn", scope, message, fields),
    error: (message, fields) => write("error", scope, message, fields),
  };
}

export function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}
