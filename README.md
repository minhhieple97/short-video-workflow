# Book Video Studio

Ứng dụng chạy cục bộ (Windows + WSL2, một người dùng) biến bài học rút ra từ sách `.txt` / `.md` thành **video ngắn dọc 9:16** (TikTok, YouTube Shorts, Facebook Reels) với kịch bản, giọng đọc và phụ đề **tiếng Việt**.

- Đặc tả sản phẩm: [`BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md`](./BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md)
- Quy tắc cho AI agent / người đóng góp: [`AGENTS.md`](./AGENTS.md)
- **Không dùng Claude API / API key.** AI chạy bằng `MockAiProvider` hoặc bằng Claude Code CLI của chính bạn (từ M5).

## Trạng thái

Mới hoàn thành **M0 — Scaffold & toolchain**: giao diện khung, schema Prisma đầy đủ, Redis + BullMQ + worker xử lý được một tác vụ thử, trang chẩn đoán. Các tính năng nghiệp vụ (nhập sách, bài học, video, render, giọng đọc) lần lượt ở M1–M6; các màn hình tương ứng hiện chỉ là trang giữ chỗ có ghi rõ "Chưa triển khai".

## Yêu cầu

| Thành phần       | Ghi chú                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| WSL2 Ubuntu      | Clone repo vào filesystem Linux (ví dụ `~/code/...`), **không** dùng `/mnt/c` (I/O chậm). |
| Node.js ≥ 24     | Đã kiểm thử với v24.18.                                                                   |
| pnpm ≥ 9.7       | **Chỉ dùng pnpm.** `npm install` bị chặn bởi `preinstall`.                                |
| Redis ≥ 6.2      | Khuyến nghị Docker (`docker compose up -d`). Xem mục "Redis không dùng Docker".           |
| ffmpeg + ffprobe | `sudo apt install ffmpeg`                                                                 |
| Claude Code CLI  | Tuỳ chọn, chỉ cần khi chạy AI thật (M5).                                                  |

## Cài đặt lần đầu

```bash
cp .env.example .env          # chỉnh nếu cần; không commit .env
pnpm install                  # tự chạy `prisma generate`
docker compose up -d          # Redis (127.0.0.1:6379)
pnpm db:migrate               # tạo data/studio.db
pnpm db:seed                  # kiểm tra DB (dữ liệu demo bổ sung ở M1–M2)
```

## Chạy ứng dụng

Mở 3 terminal trong thư mục dự án:

```bash
docker compose up -d          # 1) Redis (bỏ qua nếu đã chạy)
pnpm worker:dev               # 2) worker (xử lý tác vụ nền)
pnpm dev                      # 3) web tại http://127.0.0.1:3000
```

Mở `http://127.0.0.1:3000` bằng trình duyệt trên Windows. Ứng dụng chỉ lắng nghe `127.0.0.1`.

## Kiểm tra gate M0

1. Mở **Cài đặt** (`/settings`): Node, Redis, SQLite, Worker, FFmpeg, Claude CLI đều hiển thị "Ổn"; khối cấu hình hiển thị `SHORT_VERTICAL (9:16)`, final `1080×1920`, draft `720×1280`, 30 FPS, thời lượng `60s / 90s`, worker/render concurrency = `1`.
2. Bấm **Chạy tác vụ thử**: huy hiệu chuyển `QUEUED → COMPLETED · 100%` và có thông báo thành công. Tác vụ đi qua Next.js → Redis (BullMQ) → worker → SQLite và ghi `data/diagnostics/last-ping.json`.
3. Dòng lệnh tương đương:
   ```bash
   curl http://127.0.0.1:3000/api/health      # JSON chẩn đoán
   pnpm diagnose                               # bản chẩn đoán trong terminal
   ```
4. Chịu lỗi: tắt worker rồi bấm chạy thử → tác vụ giữ `QUEUED`, tự hoàn tất khi bật lại worker. Tắt Redis (`docker stop book-video-studio-redis`) → trang vẫn mở, hiển thị "suy giảm"; enqueue trả `503` kèm hướng dẫn.

## Chế độ AI

| `AI_MODE`  | Ý nghĩa                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock`     | `MockAiProvider`: dữ liệu mẫu, không gọi mạng, không tốn hạn mức. Dùng để kiểm thử/demo.                                                                              |
| `cli-task` | Mặc định cho AI thật: Studio tạo tác vụ, trạng thái `WAITING_FOR_CLI`, **bạn** chạy `pnpm ai:run --job <jobId>` trong terminal WSL. _Chưa triển khai — dự kiến ở M5._ |

Không có Anthropic SDK / API key trong dự án. Không nhập mật khẩu, token hay cookie Claude vào Studio.

## Scripts

| Lệnh                                                | Tác dụng                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`            | Next.js (bind `127.0.0.1`)                                                                  |
| `pnpm worker:dev` / `pnpm worker:start`             | Worker nền (có / không watch)                                                               |
| `pnpm db:migrate` / `db:generate` / `db:seed`       | Prisma migrate / generate client / seed                                                     |
| `pnpm diagnose`                                     | Chẩn đoán môi trường trong terminal (Redis, SQLite, worker, ffmpeg, Claude CLI, tài nguyên) |
| `pnpm ai:run --job <id>`                            | Chạy tác vụ AI qua Claude Code CLI (M5; hiện chỉ in thông báo)                              |
| `pnpm remotion:studio`                              | Mở Remotion Studio để xem composition                                                       |
| `pnpm lint` / `typecheck` / `test` / `format:check` | Kiểm tra chất lượng                                                                         |

> `pnpm doctor` là lệnh có sẵn của pnpm, không phải script của dự án — dùng `pnpm diagnose`.

Trước khi báo hoàn thành một thay đổi: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Cấu trúc thư mục

```
src/app/            Trang và API route mỏng (Next.js App Router)
src/components/     ui/ (shadcn) và layout/
src/features/       Module theo tính năng (jobs đã có; books/chapters/lessons/videos ở M1–M4)
src/server/         Hạ tầng phía server: db, queue, storage, ai, diagnostics, http
src/worker/         Tiến trình worker độc lập: main.ts, processors/, lifecycle/
src/remotion/       Mã video (React thuần): root, compositions, theme
src/shared/         Cấu hình env (Zod), logger, lỗi, kiểu dùng chung
prisma/             schema.prisma, migrations/, seed.ts
scripts/            run-claude-task.ts, diagnose.ts
tests/              Vitest
data/               Dữ liệu chạy thật (gitignored): studio.db, books/, ai-tasks/, videos/
```

## Redis không dùng Docker

Gói `redis-server` mặc định của Ubuntu (5.x) **quá cũ** cho BullMQ. Nếu không muốn dùng Docker, thêm kho APT chính thức của Redis:

```bash
sudo apt-get install -y lsb-release curl gpg
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
sudo apt-get update && sudo apt-get install -y redis
sudo service redis-server start
```

(Trong WSL thường dùng `sudo service ...` thay vì `systemctl` nếu chưa bật systemd.)

## Xử lý sự cố

| Triệu chứng                         | Cách xử lý                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Redis báo lỗi trong `/settings`     | `docker compose up -d` (hoặc khởi động `redis-server`). Web vẫn mở được khi Redis tắt.                                              |
| "Worker chưa chạy"                  | Chạy `pnpm worker:dev`. Tác vụ đã enqueue vẫn nằm trong hàng đợi và tự chạy khi worker bật.                                         |
| Worker thoát ngay khi khởi động     | Redis chưa chạy hoặc `REDIS_URL` sai (xem log, mã thoát 1).                                                                         |
| `Invalid environment configuration` | Đối chiếu `.env` với `.env.example` (kích thước phải đúng tỉ lệ 9:16, preset ∈ 30/45/60/90, tối đa 90 s).                           |
| `DATA_DIR resolves to /mnt/...`     | Đưa dự án và `DATA_DIR` về filesystem Linux.                                                                                        |
| Không thấy `claude`                 | Cài Claude Code, hoặc đặt `AI_MODE=mock`. Chỉ cần khi chạy AI thật.                                                                 |
| `pnpm install` bị chặn              | Dự án chỉ dùng pnpm; đừng chạy `npm install`/`yarn`.                                                                                |
| Lỗi thư viện khi render (M4)        | Cài thư viện Chromium theo hướng dẫn của Remotion cho Linux; trên máy hiện tại Remotion tải được Chromium và render thử thành công. |
| Cần chỉnh RAM/CPU của WSL           | Tự sửa `%UserProfile%\.wslconfig` sau khi đo (`free -h`, `nproc`, Task Manager); ứng dụng **không** tự thay đổi cấu hình máy.       |

## Bản quyền & giới hạn

- Chỉ nhập nội dung sách bạn có quyền xử lý; đầu ra hướng tới tóm lược, diễn giải và ví dụ mới.
- Tài khoản Claude Max và Claude Code CLI không phải API để bán hoặc chia sẻ. Ở MVP chỉ dùng cá nhân, thao tác chủ động trong terminal; không tự động hoá web → CLI cho người khác.
- `edge-tts` (M5) là thư viện không chính thức, phụ thuộc dịch vụ trực tuyến; luôn có phương án tải âm thanh lên.
- Kiểm tra giấy phép Remotion cho trường hợp sử dụng của bạn.
