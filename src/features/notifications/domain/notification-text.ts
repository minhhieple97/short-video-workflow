export function sanitizeNotificationValue(value: string, secrets: readonly (string | undefined)[] = []): string {
  let safe = value;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join("[đã ẩn]");
  return safe
    .replace(/https?:\/\/\S+/gi, "[đường dẫn đã ẩn]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{15,}\b/g, "[token đã ẩn]")
    .replace(
      /\b(?:Bearer\s+\S+|(?:token|api[_-]?key|authorization|cookie|secret|password)\s*[:=]\s*\S+)/gi,
      "[thông tin xác thực đã ẩn]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

export function formatNotificationTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Saigon", dateStyle: "short", timeStyle: "medium" }).format(
    date,
  );
}
