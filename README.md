# Book Video Studio

Ứng dụng chạy cục bộ (Windows + WSL2, một người dùng) biến bài học rút ra từ sách `.txt` / `.md` thành **video ngắn dọc 9:16** (TikTok, YouTube Shorts, Facebook Reels) với kịch bản, giọng đọc và phụ đề **tiếng Việt**.

- Đặc tả sản phẩm: [`BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md`](./BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md)
- Quy tắc cho AI agent / người đóng góp: [`AGENTS.md`](./AGENTS.md)
- **Không dùng Claude API / API key.** AI chạy bằng `MockAiProvider` hoặc bằng Claude Code CLI của chính bạn (từ M5).

## Trạng thái

Đã hoàn thành **M0–M5**: nhập sách, bài học, tạo video & kịch bản, xem trước & render MP4, giọng đọc tiếng Việt, luồng Claude Code CLI thật và bảng tác vụ. **M6** (hoàn thiện, kiểm thử E2E, tài liệu) đang tiếp tục.

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
pnpm db:seed                  # nhập sách mẫu + bài học nháp bằng AI mẫu (chạy lại không tạo trùng)
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

## Nhập sách (M1)

1. **Sách → Nhập sách**: tải tệp `.md`/`.txt` (UTF-8, tối đa `MAX_IMPORT_SIZE_MB`, mặc định 10 MB) hoặc dán văn bản.
2. Studio nhận diện chương: Markdown theo heading (bỏ qua tiêu đề sách, mục lục, lời nói đầu); TXT theo dòng riêng như `Chương 1`, `CHƯƠNG IV`, `Chapter One`, `Phần 2`. Có thể thêm mẫu riêng qua `CHAPTER_HEADING_PATTERNS` (mảng JSON regex).
3. Kiểm tra danh sách: bỏ chọn mục không phải chương, đổi tên, **Tách** tại một đoạn, **Gộp** với mục liền sau, sắp xếp lại, xem nội dung.
4. **Xác nhận nhập**. Tệp gốc được lưu nguyên byte, chỉ đọc, tại `data/books/{bookId}/original.*`; mỗi chương là `data/books/{bookId}/chapters/{chapterId}.md`.
5. Nhập lại cùng một tệp (trùng SHA-256) sẽ được cảnh báo; mặc định không tạo bản trùng.

Xoá sách là xoá mềm (ẩn khỏi thư viện, giữ nguyên tệp) và bị chặn khi sách đã có video.

## Bài học (M2)

1. Trong tab **Chương** của sách: bấm **Phân tích** từng chương hoặc **Phân tích tất cả chương**. Worker xử lý lần lượt (một tác vụ một lúc); trang tự cập nhật khi xong.
2. Mỗi chương sinh bài học ở trạng thái **Bản nháp**, kèm trích đoạn nguồn đã được đối chiếu với nội dung chương (trích dẫn không có trong chương bị loại).
3. Tab **Bài học**: lọc theo chương, trạng thái, đã/chưa dùng trong video; mở bài học để sửa, **Duyệt**, **Từ chối (lưu trữ)**, **Khôi phục**, hoặc **Gộp** bài học trùng ý. Có thể **Tạo bài học thủ công** (gắn với ít nhất một chương).
4. **Phân tích lại** chương đã phân tích cần xác nhận: bản nháp AI cũ của chương được lưu trữ, bài học đã duyệt/thủ công giữ nguyên. Chương không đổi nội dung và phiên bản prompt sẽ không bị phân tích lại nếu không chọn.

## Video & kịch bản (M3)

1. Duyệt ít nhất một bài học, mở tab **Video** của sách → **Tạo video**. Chọn 1 bài học (khuyên dùng) hoặc 2 bài học bổ trợ nhau, preset **30 / 45 / 60 giây** (mặc định 60) hoặc tích **Extended Short 90 giây**. Video luôn dọc 9:16, 1080×1920, 30 FPS.
2. Mỗi video lưu **bản chụp (snapshot)** bài học tại thời điểm tạo — sửa bài học sau đó không làm đổi video.
3. Trong trình biên tập video, bấm **Tạo kịch bản**: AI đề xuất 2–3 hook (câu hỏi / sai lầm / tương phản) và các cảnh tình huống → sai lầm → cách xử lý → điều cần nhớ → hành động.
4. Tab **Hook**: chọn phương án, sửa lời và chữ trên màn hình. Hook luôn là cảnh đầu (frame 0) và phải đọc xong trong 3 giây.
5. Tab **Kịch bản**: sửa, ẩn, sắp xếp, xoá, **Viết lại cảnh này** (chỉ cảnh đó thay đổi) hoặc thêm cảnh từ mẫu. Thanh **Thời lượng ước tính** so với preset (ước lượng ~4 âm tiết/giây; thời lượng thật đo từ audio ở M5).
6. **Duyệt kịch bản**; mọi chỉnh sửa sau khi duyệt đưa kịch bản về trạng thái cần duyệt lại.

## Xem trước & render (M4)

- Tab **Xem trước** của video phát đúng composition sẽ render, trong khung điện thoại 360×640. Chọn **TikTok / YouTube Shorts / Facebook Reels** để hiện lớp vùng an toàn ước lượng (chỉ là hướng dẫn trong editor, không có trong MP4; giá trị nằm ở `src/features/videos/domain/safe-zones.ts` và có thể chỉnh). **Xem 3 giây đầu** phát riêng phần HOOK.
- Trang **Render** (`/videos/{id}/render`): kiểm tra trước khi render (HOOK ≤ 3 giây, không vượt preset, kịch bản đã duyệt, có chữ trên màn hình…), rồi **Render nháp 720×1280** (cho phép khi còn cảnh báo) hoặc **Render bản cuối 1080×1920** (chặn khi còn lỗi).
- Worker render lần lượt (render concurrency = 1), H.264 + AAC, 30 FPS, BT.709; kết quả được ffprobe kiểm tra rồi lưu tại `data/videos/{videoId}/renders/`. Sửa kịch bản sau khi render sẽ đánh dấu bản cũ là **lỗi thời** (không xoá tệp).
- Lần render đầu tiên bundle composition (vài chục giây). Remotion cần trình duyệt headless: nếu máy chưa có, chạy `pnpm exec remotion browser ensure` (cần Internet một lần).
- Font Be Vietnam Pro (giấy phép OFL, `public/fonts`) được dùng cho cả preview và render để dấu tiếng Việt hiển thị giống nhau.
- Kiểm tra tệp: `ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact <file.mp4>`.

## Giọng đọc (M5)

- Tab **Giọng đọc** của video: **Tạo giọng đọc** từng cảnh hoặc **Tạo giọng cho các cảnh còn thiếu** bằng edge-tts (`TTS_MODE=edge-tts`, giọng `TTS_VOICE`, tốc độ `TTS_SPEED` %), hoặc **Tải lên MP3/WAV** (tối đa `MAX_AUDIO_UPLOAD_MB`). Nghe thử, thay, gỡ ngay trong tab.
- Độ dài mỗi cảnh = thời lượng âm thanh thật (ffprobe) + `SCENE_AUDIO_PADDING_MS`. Âm thanh TTS được cắt khoảng lặng đầu/cuối để lời hook bắt đầu ngay; âm thanh tải lên được giữ nguyên và chỉ đo khoảng lặng đầu (cảnh báo nếu > 0,5 giây).
- Giọng TTS được cache theo `hash(lời dẫn + giọng + tốc độ + phiên bản)`: sửa chữ trên màn hình không làm mất audio; sửa lời dẫn thì audio cũ bị gỡ. Thay audio làm các bản render trước **lỗi thời**.
- edge-tts là dịch vụ trực tuyến không chính thức. Nếu báo lỗi 403/không tạo được tệp, nâng cấp: `pip install -U edge-tts` (hoặc trỏ `EDGE_TTS_COMMAND` tới bản mới), hoặc dùng tải lên. `TTS_MODE=upload` tắt hẳn TTS.

## Claude Code CLI (AI thật, không API key)

1. Đặt `AI_MODE=cli-task` trong `.env`, khởi động lại web và worker.
2. Khi bạn bấm **Phân tích** / **Tạo kịch bản** / **Viết lại cảnh này**, worker tạo thư mục `data/ai-tasks/{jobId}/` (prompt có version, dữ liệu đầu vào, JSON Schema đầu ra) và tác vụ chuyển sang **Chờ Claude CLI**.
3. Trong terminal WSL nơi Claude Code đã đăng nhập: `pnpm ai:run --list` để xem tác vụ chờ, rồi `pnpm ai:run --job <jobId>` (thêm `--dry-run` để xem trước lệnh). Lệnh gọi `claude -p` **không bật tool nào**, không lưu phiên, kèm JSON Schema; prompt đi qua stdin; biến môi trường phiên Claude Code và mọi API key bị loại bỏ.
4. Kết quả hợp lệ được lưu `output.json` và tác vụ quay lại hàng đợi; worker kiểm tra lại schema rồi lưu vào Studio. Hết hạn mức, chưa đăng nhập, quá thời gian (`AI_TASK_TIMEOUT_SEC`) hoặc sai schema → tác vụ **Lỗi** với mã rõ ràng, không tự thử lại; kết quả thô lưu ở `output.raw.txt`.

Studio không bao giờ tự gọi Claude từ web hay worker và không cần `ANTHROPIC_API_KEY`.

## Bảng tác vụ (M5)

Trang **Tác vụ** liệt kê phân tích, kịch bản, giọng đọc, render với trạng thái, tiến độ, lỗi rút gọn; **Thử lại** (tác vụ lỗi/đã huỷ), **Huỷ** (đang chờ: huỷ ngay; đang chạy: yêu cầu dừng — render dừng giữa chừng và xoá tệp dở), **Chi tiết** (kèm lệnh `pnpm ai:run` để sao chép). Có cảnh báo khi worker không chạy; tác vụ vẫn nằm trong Redis và chạy tiếp khi worker bật lại. Khi khởi động, worker đối soát trạng thái với BullMQ.

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
src/features/       Module theo tính năng: books, chapters, jobs (lessons/videos ở M2–M4)
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
