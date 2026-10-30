import { describe, expect, it } from "vitest";

import { describeStartup, type StartupFacts } from "../../../scripts/lib/dev-banner";

const facts = (overrides: Partial<StartupFacts> = {}): StartupFacts => ({
  webPort: 3000,
  web: { state: "free" },
  runningWorker: null,
  redis: "127.0.0.1:6379 · DB 0",
  aiMode: "cli-auto",
  telegram: { enabled: false, mode: "chat", chatId: undefined },
  dataDir: "/work/data",
  ...overrides,
});

const text = (startup: ReturnType<typeof describeStartup>) => startup.lines.join("\n");

describe("the startup block of pnpm dev:all", () => {
  it("names the web address, says the worker has no port, and says Telegram needs no separate command", () => {
    const startup = describeStartup(facts({ telegram: { enabled: true, mode: "forum", chatId: "-1001234567890" } }));

    expect(startup).toMatchObject({ startsWeb: true, startsWorker: true });
    expect(text(startup)).toContain("http://127.0.0.1:3000");
    expect(text(startup)).toMatch(/Worker\s+sẽ khởi động · không dùng cổng/);
    expect(text(startup)).toMatch(/Telegram\s+bật · mỗi sách một topic · do worker gửi, không cần chạy riêng/);
    expect(text(startup)).toContain("Nhấn Ctrl+C để dừng web và worker. Log bên dưới mang nhãn [web] [worker].");
  });

  it("shows only the last four digits of the chat, and says when Telegram is off", () => {
    const on = text(describeStartup(facts({ telegram: { enabled: true, mode: "chat", chatId: "-1001234567890" } })));
    expect(on).toContain("(…7890)");
    expect(on).not.toContain("1001234567");
    expect(text(describeStartup(facts()))).toContain("tắt (đặt TELEGRAM_ENABLED=true trong .env để bật)");
  });

  it("leaves a web of this project that already runs alone, and starts only the worker", () => {
    const startup = describeStartup(facts({ web: { state: "project" } }));

    expect(startup).toMatchObject({ startsWeb: false, startsWorker: true });
    expect(text(startup)).toContain("web của dự án đã chạy sẵn, không khởi động thêm");
    expect(text(startup)).toContain("Nhấn Ctrl+C để dừng worker. Log bên dưới mang nhãn [worker].");
  });

  it("says who holds the web port when it is not this project's web, and what to do", () => {
    const startup = describeStartup(
      facts({
        web: { state: "foreign", holder: { pid: 535507, command: "node tsx src/worker/main.ts", cwd: "/work" } },
      }),
    );

    expect(startup.startsWeb).toBe(false);
    expect(text(startup)).toContain(
      "KHÔNG khởi động: cổng 3000 đang bị giữ bởi PID 535507: node tsx src/worker/main.ts (chạy từ /work)",
    );
    expect(text(startup)).toContain("Dừng nó bằng `kill 535507`, hoặc chạy web ở cổng khác: PORT=3001 pnpm dev:all");
  });

  it("still gives the way out when the holder cannot be found", () => {
    const startup = describeStartup(facts({ web: { state: "foreign", holder: null } }));

    expect(text(startup)).toContain("một tiến trình khác (không xác định được là gì)");
    expect(text(startup)).toContain("chạy web ở cổng khác: PORT=3001 pnpm dev:all");
    expect(text(startup)).not.toContain("kill");
  });

  it("is blocked, not finished, when the worker runs and the web port is held by something else", () => {
    const startup = describeStartup(facts({ web: { state: "foreign", holder: null }, runningWorker: ["PID 1234"] }));

    expect(startup).toMatchObject({ startsWeb: false, startsWorker: false, blocked: true });
    expect(text(startup)).toContain("Không khởi động được gì: worker đã chạy, còn web thì cổng đang bị chiếm");
    expect(text(startup)).not.toContain("không có gì để khởi động");
  });

  it("reports a worker that already runs and has nothing to start when the web runs too", () => {
    const startup = describeStartup(
      facts({ web: { state: "project" }, runningWorker: ["PID 1234", "Hàng đợi 0 đang chạy"] }),
    );

    expect(startup).toMatchObject({ startsWeb: false, startsWorker: false, blocked: false });
    expect(text(startup)).toMatch(/Worker\s+đã chạy sẵn, không khởi động thêm/);
    expect(text(startup)).toContain("PID 1234");
    expect(text(startup)).toContain("Web và worker đều đã chạy, không có gì để khởi động.");
  });

  it("never prints a Redis password or a token: it only shows what it was given", () => {
    expect(text(describeStartup(facts()))).not.toMatch(/token|password/i);
  });
});
