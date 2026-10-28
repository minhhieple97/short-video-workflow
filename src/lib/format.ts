const DATE_TIME = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
const NUMBER = new Intl.NumberFormat("vi-VN");

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${NUMBER.format(Math.round(bytes / 102.4) / 10)} KB`;
  if (bytes < 1024 ** 3) return `${NUMBER.format(Math.round(bytes / 104857.6) / 10)} MB`;
  return `${NUMBER.format(Math.round(bytes / 107374182.4) / 10)} GB`;
}

export function formatDuration(startIso: string, endIso: string): string {
  const seconds = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
