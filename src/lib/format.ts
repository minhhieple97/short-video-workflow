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
  return `${NUMBER.format(Math.round(bytes / 104857.6) / 10)} MB`;
}
