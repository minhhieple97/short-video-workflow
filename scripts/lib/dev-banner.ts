export interface PortHolder {
  pid: number;
  command: string;
  // Where it runs from, which tells the project's checkouts apart.
  cwd: string | null;
}

export type WebProbe =
  | { state: "free" }
  // This project's web is already serving on the port.
  | { state: "project" }
  | { state: "foreign"; holder: PortHolder | null };

export interface StartupFacts {
  webPort: number;
  web: WebProbe;
  // The lines `pnpm worker:status` prints when a worker already runs, else null.
  runningWorker: string[] | null;
  // host:port of Redis, never the password.
  redis: string;
  aiMode: string;
  telegram: { enabled: boolean; mode: "chat" | "forum"; chatId: string | undefined };
  dataDir: string;
}

export interface Startup {
  lines: string[];
  startsWeb: boolean;
  startsWorker: boolean;
  // Nothing was started and the web is missing: its port is held by something that is not this project's web.
  blocked: boolean;
}

const LABEL_WIDTH = 11;
const row = (label: string, text: string): string => `  ${label.padEnd(LABEL_WIDTH)}${text}`;

function webRows({ webPort, web }: Pick<StartupFacts, "webPort" | "web">): string[] {
  const url = `http://127.0.0.1:${webPort}`;
  switch (web.state) {
    case "free":
      return [row("Web", `${url}  (sẽ khởi động)`)];
    case "project":
      return [row("Web", `${url}  (web của dự án đã chạy sẵn, không khởi động thêm)`)];
    case "foreign": {
      const who = web.holder
        ? `PID ${web.holder.pid}: ${web.holder.command}${web.holder.cwd ? ` (chạy từ ${web.holder.cwd})` : ""}`
        : "một tiến trình khác (không xác định được là gì)";
      return [
        row("Web", `${url}  KHÔNG khởi động: cổng ${webPort} đang bị giữ bởi ${who}`),
        row("", "Đó không phải web của dự án."),
        row(
          "",
          `${web.holder ? `Dừng nó bằng \`kill ${web.holder.pid}\`, hoặc ` : ""}chạy web ở cổng khác: PORT=${webPort + 1} pnpm dev:all`,
        ),
      ];
    }
  }
}

function telegramRows({ telegram }: Pick<StartupFacts, "telegram">): string[] {
  if (!telegram.enabled) return [row("Telegram", "tắt (đặt TELEGRAM_ENABLED=true trong .env để bật)")];
  const where =
    telegram.mode === "forum"
      ? "mỗi sách một topic"
      : `một chat${telegram.chatId ? ` (…${telegram.chatId.slice(-4)})` : ""}`;
  return [
    row("Telegram", `bật · ${where} · do worker gửi, không cần chạy riêng`),
    row("", "Thử kết nối: pnpm telegram --test"),
  ];
}

// The block printed before the services' own logs: what runs, where, and what was left alone and why.
export function describeStartup(facts: StartupFacts): Startup {
  const startsWeb = facts.web.state === "free";
  const startsWorker = facts.runningWorker === null;
  const workerRows = startsWorker
    ? [row("Worker", `sẽ khởi động · không dùng cổng, chạy nền và nhận việc từ Redis`)]
    : [row("Worker", "đã chạy sẵn, không khởi động thêm"), ...(facts.runningWorker ?? []).map((line) => row("", line))];
  const names = [startsWeb ? "web" : null, startsWorker ? "worker" : null].filter((name) => name !== null);
  const blocked = names.length === 0 && facts.web.state === "foreign";
  const footer = blocked
    ? "Không khởi động được gì: worker đã chạy, còn web thì cổng đang bị chiếm (xem ở trên)."
    : names.length === 0
      ? "Web và worker đều đã chạy, không có gì để khởi động."
      : `Nhấn Ctrl+C để dừng ${names.join(" và ")}. Log bên dưới mang nhãn ${names.map((name) => `[${name}]`).join(" ")}.`;
  return {
    lines: [
      "Book Video Studio (chạy cục bộ)",
      "",
      ...webRows(facts),
      ...workerRows,
      ...telegramRows(facts),
      row("Chế độ AI", facts.aiMode),
      row("Redis", facts.redis),
      row("Dữ liệu", facts.dataDir),
      "",
      footer,
    ],
    startsWeb,
    startsWorker,
    blocked,
  };
}
