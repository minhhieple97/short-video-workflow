# Book Video Studio

Ứng dụng chạy cục bộ (Windows + WSL2, một người dùng) biến bài học rút ra từ sách `.txt` / `.md` thành **video ngắn dọc 9:16** cho TikTok, YouTube Shorts và Facebook Reels — kịch bản, giọng đọc và phụ đề **tiếng Việt**, render MP4 ngay trên máy.

- Đặc tả sản phẩm: [`BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md`](./BOOK_VIDEO_STUDIO_REQUIREMENTS_VI_v1.1.md)
- Kiến trúc: [`docs/architecture.md`](./docs/architecture.md) · Quy tắc cho AI agent / người đóng góp: [`AGENTS.md`](./AGENTS.md)
- **Không dùng Claude API / API key.** AI chạy bằng dữ liệu mẫu (`mock`) hoặc bằng Claude Code CLI do chính bạn chạy trong terminal.

## Tính năng

| Phần      | Bạn làm được gì                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tổng quan | Tác vụ đang chờ/đang chạy (tự cập nhật), video và sách gần đây                                                                                                          |
| Thư viện  | Nhập `.md`/`.txt` (tải lên hoặc dán), tìm kiếm không phân biệt dấu, sửa thông tin sách, xoá mềm                                                                         |
| Chương    | Nhận diện chương tự động (heading Markdown hoặc dòng "Chương 1 / CHƯƠNG IV / Chapter One / Phần 2"), bỏ mục lục/lời nói đầu, đổi tên, tách, gộp, sắp xếp trước khi nhập |
| Bài học   | AI rút bài học từ từng chương kèm trích đoạn đã kiểm chứng; sửa, duyệt, lưu trữ, gộp, tạo thủ công                                                                      |
| Video     | Tạo video từ 1–N bài học đã duyệt (khuyên 1), preset 30 / 45 / **60** giây hoặc Extended 90 giây, lưu snapshot bài học                                                  |
| Kịch bản  | 2–3 phương án hook ≤ 4 giây; các cảnh tình huống → sai lầm → cách xử lý → điều cần nhớ → hành động; sửa, ẩn, thêm, xoá, sắp xếp, viết lại một cảnh, duyệt               |
| Giọng đọc | edge-tts tiếng Việt hoặc tải lên MP3/WAV; thời lượng cảnh theo âm thanh thật                                                                                            |
| Xem trước | Khung điện thoại 9:16, lớp vùng an toàn TikTok / Shorts / Reels, nút "Xem 4 giây đầu"                                                                                   |
| Render    | Nháp 720×1280 và bản cuối 1080×1920, 30 FPS, H.264 + AAC; kiểm tra trước khi render; ffprobe xác nhận MP4; lịch sử và tải về                                            |
| Tác vụ    | Theo dõi, thử lại, huỷ mọi tác vụ nền; lệnh `pnpm ai:run` cho tác vụ chờ Claude                                                                                         |
| Chẩn đoán | Node, Redis, SQLite, worker, ffmpeg, Claude CLI, edge-tts, Chromium, tài nguyên WSL; chạy tác vụ thử và kiểm tra AI mẫu; hướng dẫn khởi động                            |

## Yêu cầu

| Thành phần             | Ghi chú                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| WSL2 Ubuntu            | Đặt dự án trên filesystem Linux (ví dụ `~/code/...`), **không** dùng `/mnt/c`.                                             |
| Node.js ≥ 24           | Đã kiểm thử với v24.18.                                                                                                    |
| pnpm ≥ 9.7             | **Chỉ dùng pnpm** — `npm install` / `yarn` bị chặn.                                                                        |
| Redis ≥ 6.2            | Khuyến nghị `docker compose up -d` (Redis 7, chỉ mở `127.0.0.1`). Xem [Redis không dùng Docker](#redis-không-dùng-docker). |
| ffmpeg + ffprobe       | `sudo apt install ffmpeg`                                                                                                  |
| Chromium cho Remotion  | Tự tải ở lần render đầu, hoặc `pnpm exec remotion browser ensure` (cần Internet một lần).                                  |
| edge-tts (tuỳ chọn)    | `pip install -U edge-tts` — chỉ cần khi tạo giọng đọc tự động.                                                             |
| Claude Code (tuỳ chọn) | Chỉ cần khi dùng AI thật (`AI_MODE=cli-task`).                                                                             |

## Cài đặt lần đầu

```bash
cp .env.example .env          # đặt AI_MODE=mock để thử ngay mà không cần Claude
pnpm install                  # tự chạy `prisma generate`
docker compose up -d          # Redis tại 127.0.0.1:6379
pnpm db:migrate               # tạo data/studio.db
pnpm db:seed                  # sách mẫu + bài học nháp bằng AI mẫu (chạy lại không tạo trùng)
pnpm diagnose                 # kiểm tra môi trường
```

## Chạy hằng ngày

Mỗi lệnh một terminal WSL trong thư mục dự án (trang **Cài đặt** cũng hiển thị hướng dẫn này):

```bash
docker compose up -d          # 1) Redis (nếu chưa chạy)
pnpm worker:dev               # 2) worker: phân tích, kịch bản, giọng đọc, render
pnpm dev                      # 3) web tại http://127.0.0.1:3000
```

Mở `http://127.0.0.1:3000` trong trình duyệt trên Windows. Web chỉ lắng nghe `127.0.0.1` và vẫn mở được khi Redis hoặc worker tắt (trang Cài đặt báo "suy giảm").

Bản production: `pnpm build && pnpm start`, kèm `pnpm worker:start` ở terminal khác.

## Quy trình làm một video

1. **Sách → Nhập sách**: tải tệp lên hoặc dán văn bản, kiểm tra danh sách chương (bỏ chọn mục lục, đổi tên, **Tách**, **Gộp**, sắp xếp), **Xác nhận nhập**. Tệp gốc được lưu nguyên byte, chỉ đọc; nhập lại tệp trùng nội dung sẽ được cảnh báo.
2. Tab **Chương** → **Phân tích tất cả chương** (worker chạy lần lượt). Bài học tạo ra ở trạng thái nháp.
3. Tab **Bài học**: mở từng bài, đối chiếu trích đoạn nguồn, sửa rồi **Duyệt**. Tình huống do AI sáng tác luôn được ghi rõ là minh họa.
4. Tab **Video** → **Tạo video**: chọn bài học đã duyệt và preset (mặc định 60 giây; 90 giây chỉ khi tích **Extended Short**).
5. Trong video: **Tạo kịch bản** → tab **Hook** chọn phương án (HOOK luôn ở frame 0 và ≤ 4 giây) → tab **Kịch bản** chỉnh từng cảnh → **Duyệt kịch bản**. Sửa sau khi duyệt sẽ cần duyệt lại.
6. Tab **Giọng đọc**: tạo bằng edge-tts hoặc tải âm thanh lên. Thanh thời lượng so tổng thời lượng với preset; nếu vượt, hãy rút gọn lời dẫn hoặc đổi preset — ứng dụng không tự cắt lời hay tăng tốc.
7. **Xem trước**: trên màn hình rộng (từ 1280 px) khung điện thoại luôn nằm bên phải trình biên tập và đứng yên khi cuộn, nên sửa cảnh nào xem được ngay cảnh đó; màn hình hẹp hơn có thêm tab **Xem trước**. Phát trong khung, bật vùng an toàn, **Xem 4 giây đầu**.
8. **Render**: render nháp để duyệt nhanh, rồi render bản cuối và tải MP4 trong lịch sử render.

## AI: mock và Claude Code CLI

| `AI_MODE`  | Hoạt động                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mock`     | `MockAiProvider` trả bài học, hook và kịch bản mẫu tất định — không mạng, không tốn hạn mức. Dùng cho demo và kiểm thử.     |
| `cli-task` | AI thật qua **Claude Code CLI của bạn**. Studio chỉ tạo tác vụ; bạn tự chạy lệnh trong terminal.                            |
| `cli-auto` | AI thật, **tự động**: worker tự chạy Claude Code CLI đã đăng nhập của bạn ngay khi tác vụ tới lượt. Tuỳ chọn, mặc định tắt. |

Luồng `cli-task`:

1. Bấm **Phân tích** / **Tạo kịch bản** / **Viết lại cảnh này** → worker tạo `data/ai-tasks/{jobId}/` (`prompt.md` có version, `input.json`, `schema.json`) và tác vụ chuyển sang **Chờ Claude CLI** (không có tiến độ vì đang chờ bạn). Trang video hiện sẵn lệnh cần chạy và tự cập nhật sau khi bạn chạy lệnh. Trong lúc kịch bản đang được tạo, hoặc một cảnh đang được viết lại, video bị khoá: cài đặt, hook, kịch bản, giọng đọc, duyệt, render và xoá đều tạm tắt (API cũng từ chối với mã `SCRIPT_GENERATION_IN_PROGRESS`); bấm **Huỷ tạo kịch bản** / **Huỷ viết lại cảnh** nếu muốn mở khoá.
2. Trong terminal WSL đã đăng nhập Claude Code: `pnpm ai:run --list`, rồi `pnpm ai:run --job <jobId>` (thêm `--dry-run` để xem trước lệnh).
3. Lệnh chạy `claude -p` **không bật tool nào**, không lưu phiên, kèm JSON Schema; prompt đi qua stdin; biến môi trường phiên Claude Code và mọi API key bị loại bỏ. Kết quả hợp lệ được lưu và tác vụ quay lại hàng đợi để worker ghi vào Studio.
4. Hết hạn mức, chưa đăng nhập, quá `AI_TASK_TIMEOUT_SEC` hoặc sai schema → tác vụ **Lỗi** với mã rõ ràng (`AI_QUOTA_EXCEEDED`, `AI_CLI_AUTH`, `AI_CLI_TIMEOUT`…), không tự thử lại; đầu ra thô nằm ở `output.raw.txt`.

Chế độ `cli-auto` (requirements §9.2C, `AutomatedCliProvider`) bỏ bước 2: worker gọi đúng lệnh `claude -p` như trên (không tool, không MCP server nào từ cấu hình của bạn, không lưu phiên, env đã làm sạch, mỗi lần một tác vụ) ngay khi tác vụ chạy, rồi lưu kết quả. Tác vụ ở trạng thái **Đang chạy** trong lúc Claude xử lý; **Huỷ** dừng luôn tiến trình `claude`. Cần đăng nhập Claude Code trên chính máy chạy worker (`claude`, rồi `/login`). Chế độ này dùng hạn mức tài khoản Claude của bạn cho mọi tác vụ AI và chỉ dành cho dùng cá nhân trên `127.0.0.1` — không chia sẻ, không mở cho người khác; hãy tự đối chiếu điều khoản Anthropic hiện hành trước khi bật.

Nội dung sách luôn được bọc như **dữ liệu không đáng tin**: câu lệnh nằm trong sách (ví dụ "bỏ qua mọi hướng dẫn…") không điều khiển được AI. Trích dẫn không có thật trong chương bị loại tự động. Không nhập mật khẩu, token hay cookie Claude vào Studio.

## Giọng đọc

- edge-tts (`TTS_MODE=edge-tts`, `TTS_VOICE`, `TTS_SPEED`): âm thanh được cắt khoảng lặng đầu/cuối để lời hook bắt đầu ngay, và được cache theo lời dẫn + giọng + tốc độ.
- Tải lên MP3/WAV (≤ `MAX_AUDIO_UPLOAD_MB`): giữ nguyên tệp, chỉ đo khoảng lặng đầu (cảnh báo nếu > 0,5 giây). `TTS_MODE=upload` tắt hẳn TTS.
- Độ dài cảnh = âm thanh thật + `SCENE_AUDIO_PADDING_MS`. Sửa chữ trên màn hình giữ nguyên audio; sửa lời dẫn gỡ audio cũ. Thay audio làm các bản render trước **lỗi thời** (tệp không bị xoá).
- edge-tts là dịch vụ trực tuyến **không chính thức** và hay chập chờn: khi dịch vụ không trả âm thanh, Studio tự thử lại tối đa 4 lần (sau 2, 5, 10 giây). Lỗi 403 nghĩa là bản edge-tts đã cũ: chạy `pip install -U edge-tts` (hoặc trỏ `EDGE_TTS_COMMAND` tới bản mới), hoặc dùng tải lên.

## Xem trước và render

- Preview và render dùng **cùng một composition** Remotion và cùng font Be Vietnam Pro (OFL, trong `public/fonts`), nên dấu tiếng Việt hiển thị giống nhau.
- Vùng an toàn là **giá trị ước lượng có thể chỉnh** (`src/features/videos/domain/safe-zones.ts`), không phải thông số chính thức của nền tảng, và không bao giờ được render vào MP4.
- Kiểm tra trước khi render: HOOK ở frame 0 và ≤ 120 frame (4 giây), có chữ trên màn hình, không vượt preset và ≤ 90 giây, kịch bản đã duyệt (bắt buộc với bản cuối), cảnh báo cảnh chưa có giọng đọc / hook im lặng.
- Worker render lần lượt (`WORKER_CONCURRENCY=1`, `RENDER_CONCURRENCY=1`), ghi tệp tạm rồi đổi tên; sau đó ffprobe xác nhận H.264 + AAC, kích thước, 30 FPS và thời lượng. Lần render đầu cần bundle composition (vài chục giây).
- Tự kiểm tra một tệp: `ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact <tệp.mp4>`

## Tác vụ và chẩn đoán

- **Tác vụ** (`/jobs`): trạng thái, tiến độ, lỗi rút gọn; **Thử lại** (tạo tác vụ mới), **Huỷ** (đang chờ: ngay; đang chạy: yêu cầu dừng — render dừng giữa chừng và xoá tệp dở), **Chi tiết** kèm lệnh `pnpm ai:run`. Khi worker tắt, tác vụ vẫn nằm trong Redis và chạy tiếp khi worker bật lại; lúc khởi động, worker đối soát trạng thái với BullMQ.
- **Cài đặt** (`/settings`), `GET /api/health` và `pnpm diagnose` dùng chung một bộ kiểm tra. Trang Cài đặt có nút **Chạy tác vụ thử** (web → Redis → worker → SQLite) và **Kiểm tra AI mẫu**.

> `pnpm doctor` là lệnh có sẵn của pnpm, không phải script của dự án — hãy dùng `pnpm diagnose`.

## Scripts

| Lệnh                                                | Tác dụng                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`            | Next.js (chỉ `127.0.0.1`)                             |
| `pnpm worker:dev` / `pnpm worker:start`             | Worker nền (có / không watch)                         |
| `pnpm db:migrate` / `db:generate` / `db:seed`       | Prisma migrate / sinh client / dữ liệu mẫu            |
| `pnpm ai:run --list` · `pnpm ai:run --job <id>`     | Liệt kê / chạy tác vụ AI bằng Claude Code CLI         |
| `pnpm diagnose`                                     | Chẩn đoán môi trường trong terminal                   |
| `pnpm remotion:studio`                              | Mở Remotion Studio để xem composition với dữ liệu mẫu |
| `pnpm lint` / `typecheck` / `test` / `format:check` | Kiểm tra chất lượng                                   |
| `pnpm test:e2e`                                     | Build rồi chạy smoke test E2E bằng Playwright         |

## Cấu hình (`.env`)

| Biến                                                                                                    | Mặc định                                                    | Ý nghĩa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` / `DATA_DIR`                                                                             | `file:./data/studio.db` / `./data`                          | SQLite và thư mục dữ liệu (tương đối với thư mục dự án; không được nằm dưới `/mnt`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `REDIS_URL`                                                                                             | `redis://127.0.0.1:6379`                                    | Hàng đợi BullMQ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `MAX_IMPORT_SIZE_MB`, `CHAPTER_HEADING_PATTERNS`                                                        | `10`, `[]`                                                  | Giới hạn tệp sách; mảng JSON regex nhận diện chương bổ sung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `MISTRAL_API_KEY`, `MISTRAL_API_BASE_URL`, `MISTRAL_OCR_MODEL`, `MISTRAL_OCR_USD_PER_1000_PAGES`        | _(trống)_, `https://api.mistral.ai`, `mistral-ocr-4-1`, `2` | OCR Mistral Batch: khóa API (chỉ worker đọc, để trống tới khi chạy OCR), model ghim cố định (không dùng alias `latest`; hãy kiểm tra model tồn tại với tài khoản của bạn) và đơn giá batch dùng cho dự trù chi phí                                                                                                                                                                                                                                                                                                                                                                                 |
| `NOTEBOOKLM_PROFILE`, `NOTEBOOKLM_MCP_COMMAND`, `NOTEBOOKLM_MCP_PACKAGE`, `NOTEBOOKLM_CALL_TIMEOUT_SEC` | _(trống)_, `uvx`, `notebooklm-mcp-cli==0.15.8`, `180`       | NotebookLM qua `notebooklm-mcp-cli` (worker tự chạy bằng `uvx`, ghim phiên bản vì công cụ dùng API không chính thức của NotebookLM). Đăng nhập một lần trong terminal của bạn: `uvx --from notebooklm-mcp-cli nlm login --profile <tên>`, rồi đặt tên đó vào `NOTEBOOKLM_PROFILE`; worker chỉ dùng profile này cho tiến trình của nó và không đổi profile mặc định của bạn. NotebookLM chỉ được dùng khi `AI_MODE=cli-auto`: xác định chương và lập danh mục bài học cho sách PDF, viết bản thảo cho mọi video sản xuất hàng loạt (`cli-auto` mà chưa đặt profile thì sản xuất báo thiếu cấu hình) |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`                                                  | _(trống)_                                                   | OAuth client **Desktop app** trong Google Cloud project của bạn (bật Google Drive API) để lưu video lên Drive; ứng dụng chỉ xin quyền `drive.file`. Để trống thì video chỉ lưu local. Nếu màn hình đồng ý OAuth để trạng thái **Testing**, Google cấp refresh token hết hạn sau 7 ngày nên phải kết nối lại                                                                                                                                                                                                                                                                                        |
| `DRIVE_MIN_REQUEST_INTERVAL_MS`, `DRIVE_MAX_REQUESTS_PER_DAY`, `DRIVE_MAX_UPLOAD_GIB_PER_DAY`           | `1000`, `5000`, `10`                                        | Giới hạn **của riêng ứng dụng** khi lưu lên Drive: tối đa một yêu cầu mỗi khoảng, và trong 24 giờ trượt tối đa bấy nhiêu yêu cầu và GiB dữ liệu gửi đi. Đây không phải quota của Google Cloud project và không suy ra từ gói dung lượng Drive của bạn                                                                                                                                                                                                                                                                                                                                              |
| `MAX_PDF_PAGES`, `POPPLER_BIN_DIR`, `PDF_TOOL_TIMEOUT_SEC`                                              | `1000`, _(trống)_, `300`                                    | Sách PDF đọc bằng Poppler (`sudo apt-get install -y poppler-utils`): số trang tối đa, thư mục chứa công cụ nếu không nằm trên PATH, thời gian tối đa cho mỗi lần chạy công cụ. Các bộ test cần Poppler sẽ bị bỏ qua nếu chưa cài (hoặc chạy với `TEST_POPPLER_BIN_DIR`)                                                                                                                                                                                                                                                                                                                            |
| `OCR_COST_CEILING_USD`                                                                                  | `3`                                                         | Trần chi phí OCR mỗi sách (USD), chép vào lần trích xuất khi tạo và không bao giờ tự tăng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MAX_PDF_SIZE_MB`                                                                                       | `500`                                                       | Giới hạn tệp PDF tải lên qua `POST /api/books/import/pdf` (ghi thẳng ra đĩa, không giữ trong RAM)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `AI_MODE`, `CLAUDE_CLI_COMMAND`, `AI_TASK_TIMEOUT_SEC`                                                  | `cli-task`, `claude`, `600`                                 | Chế độ AI (`mock` / `cli-task` / `cli-auto`) và lệnh Claude Code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `TTS_MODE`, `TTS_VOICE`, `TTS_SPEED`, `EDGE_TTS_COMMAND`                                                | `edge-tts`, `vi-VN-NamMinhNeural`, `0`, `edge-tts`          | Giọng đọc (`TTS_MODE=upload` chỉ dùng âm thanh tải lên)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SCENE_AUDIO_PADDING_MS`, `MAX_AUDIO_UPLOAD_MB`                                                         | `300`, `20`                                                 | Khoảng nghỉ sau mỗi đoạn đọc; giới hạn tải lên                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `DEFAULT_VIDEO_DURATION_SEC`, `MAX_VIDEO_DURATION_SEC`                                                  | `60`, `90`                                                  | Preset mặc định và giới hạn tuyệt đối                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RENDER_WIDTH/HEIGHT/FPS`, `DRAFT_RENDER_WIDTH/HEIGHT`                                                  | `1080×1920@30`, `720×1280`                                  | Kích thước 9:16 (được kiểm tra khi khởi động)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `WORKER_CONCURRENCY`, `RENDER_CONCURRENCY`, `MAX_AI_CONCURRENCY`                                        | `1`, `1`, `1`                                               | Chỉ tăng sau khi đo trên máy thật                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Dự án không có và không cần `ANTHROPIC_API_KEY`.

## Dữ liệu, sao lưu và khôi phục

```
data/                         # không commit
  studio.db                   # SQLite (chế độ WAL)
  books/{bookId}/original.*   # tệp gốc, chỉ đọc
  books/{bookId}/chapters/    # nội dung từng chương
  ai-tasks/{jobId}/           # prompt, input, schema, output của tác vụ AI
  videos/{videoId}/audio/     # giọng đọc
  videos/{videoId}/renders/   # MP4
  credentials/                # token Google Drive (chỉ chủ tài khoản đọc được, không nằm trong studio.db)
```

- **Sao lưu:** dừng `pnpm dev` và worker, rồi sao chép toàn bộ `data/` (gồm `studio.db`, `studio.db-wal`, `studio.db-shm`), ví dụ `tar czf ~/backup-$(date +%F).tgz data`.
- **Khôi phục:** dừng các tiến trình, giải nén đè `data/`, chạy `pnpm exec prisma migrate deploy` (chỉ áp migration còn thiếu, không bao giờ xoá dữ liệu), rồi khởi động lại.
- Hàng đợi Redis nằm trong volume Docker `redis-data` (AOF). `docker compose down -v` xoá volume này; khi đó worker đánh dấu các tác vụ dở là lỗi ("Tác vụ không còn trong hàng đợi…") để bạn thử lại.

## Kiểm thử

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # cổng chất lượng
pnpm test:e2e                                            # smoke E2E (Playwright, khoảng 3–5 phút)
```

- `pnpm test` — unit + integration với SQLite tạm và migration thật: parser chương, đường dẫn an toàn, pipeline bài học, kịch bản, preflight, audio và các tình huống lỗi (Redis tắt, TTS không khả dụng, JSON AI sai, trích dẫn bịa, prompt injection…).
- `pnpm test:e2e` — build, rồi dựng một stack riêng (DB và dữ liệu trong `/tmp/book-video-studio-e2e`, Redis **DB số 14** — bị xoá sạch mỗi lần chạy, worker, web ở cổng 3100) và chạy kịch bản E2E-01: nhập sách → phân tích → duyệt → 2 video → hook → sửa một cảnh → snapshot → xem trước → tải âm thanh → render nháp và bản cuối → ffprobe → tải lại trang. Dùng Chromium của Remotion nên không cần `playwright install`; cần Redis đang chạy.

## Tài nguyên WSL

Máy 48 GB RAM không có nghĩa WSL được cấp 48 GB — kiểm tra bằng `free -h`, `nproc` (trang Cài đặt cũng hiển thị). Mặc định chỉ chạy một tác vụ và một luồng render tại một thời điểm. Nếu render chậm: render nháp trước, hoặc đo rồi mới tăng `RENDER_CONCURRENCY`. Muốn đổi RAM/CPU của WSL, **tự** chỉnh `%UserProfile%\.wslconfig` rồi chạy `wsl --shutdown`; ứng dụng không thay đổi cấu hình máy.

## Redis không dùng Docker

Gói `redis-server` mặc định của Ubuntu (5.x) quá cũ cho BullMQ. Dùng kho APT chính thức của Redis:

```bash
sudo apt-get install -y lsb-release curl gpg
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
sudo apt-get update && sudo apt-get install -y redis
sudo service redis-server start
```

(Trong WSL chưa bật systemd, dùng `sudo service ...` thay cho `systemctl`.)

## Xử lý sự cố

| Triệu chứng                                       | Cách xử lý                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "Không thể kết nối Redis…" (HTTP 503)             | `docker compose up -d`, rồi thử lại.                                                                   |
| "Worker không chạy" trên trang Tác vụ             | `pnpm worker:dev`. Tác vụ đã xếp hàng sẽ tự chạy.                                                      |
| Worker thoát ngay khi khởi động                   | Redis chưa chạy hoặc `REDIS_URL` sai (mã thoát 1, xem log).                                            |
| `Invalid environment configuration`               | Đối chiếu `.env` với `.env.example` (tỉ lệ 9:16, preset 30/45/60/90, tối đa 90 giây).                  |
| Tác vụ "Chờ Claude CLI" mãi                       | Chạy `pnpm ai:run --job <id>` (lệnh có trên trang video), đặt `AI_MODE=cli-auto`, hoặc `AI_MODE=mock`. |
| `AI_CLI_AUTH` / `AI_QUOTA_EXCEEDED`               | Đăng nhập lại Claude Code (`claude`, rồi `/login`) / đợi hạn mức làm mới, sau đó **Thử lại**.          |
| `AI_CLI_MISSING`                                  | Cài Claude Code hoặc chỉnh `CLAUDE_CLI_COMMAND`.                                                       |
| `TTS_REJECTED` (403)                              | `pip install -U edge-tts`, hoặc tải âm thanh lên.                                                      |
| `TTS_FAILED` "không trả về âm thanh"              | Dịch vụ edge-tts đang chập chờn; thử lại sau ít phút hoặc tải âm thanh lên.                            |
| API báo "is not a function" sau khi cập nhật code | Cache của `pnpm dev` bị cũ: dừng `pnpm dev`, xoá `.next/dev`, chạy lại.                                |
| Render báo thiếu Chromium / thư viện hệ thống     | `pnpm exec remotion browser ensure`; nếu vẫn thiếu thư viện, cài theo hướng dẫn Linux của Remotion.    |
| Chữ tiếng Việt lỗi dấu                            | Kiểm tra `public/fonts` còn đủ tệp Be Vietnam Pro.                                                     |
| `DATA_DIR resolves to /mnt/...`                   | Đưa dự án và dữ liệu về filesystem Linux.                                                              |
| `pnpm install` bị chặn / dùng nhầm npm            | Dự án chỉ dùng pnpm.                                                                                   |

## Cấu trúc mã

```
src/app/         Trang và API route mỏng (Next.js App Router)
src/components/  ui/ (shadcn đã chỉnh theme "Studio Ink") và layout/ (khung, thanh bên, nút Sáng/Tối/Theo hệ thống, tiêu đề trang…)
src/features/    books, chapters, lessons, videos, jobs — mỗi phần có domain/, schemas/, services/, repositories/, components/
src/server/      Hạ tầng phía server: db, queue, storage, ai, tts, media, render, diagnostics, http
src/worker/      Tiến trình worker: main.ts, processors/, lifecycle/
src/remotion/    Composition video (React thuần, chỉ nhận props)
src/shared/      Cấu hình env (Zod), logger, lỗi, kiểu dùng chung
prisma/          schema.prisma, migrations/, seed.ts
scripts/         run-claude-task.ts (pnpm ai:run), diagnose.ts
tests/           unit/, integration/ (Vitest), e2e/ (Playwright)
```

Chi tiết luồng dữ liệu và trách nhiệm từng tiến trình: [`docs/architecture.md`](./docs/architecture.md).

## Giới hạn đã biết

- Sách PDF (Poppler + OCR Mistral Batch, tab "Sách PDF" ở trang Nhập sách) chưa được thử với tài khoản Mistral thật; sách không tìm thấy tiêu đề chương dừng ở "Chưa xác định chương". Chưa hỗ trợ EPUB.
- Phụ đề hiển thị theo cụm từ, căn theo số âm tiết — không đồng bộ chính xác từng từ.
- Chưa có nhạc nền. Studio chỉ tự gọi Claude khi bạn bật `AI_MODE=cli-auto`.
- Vùng an toàn là ước lượng; hãy kiểm tra lại trên ứng dụng thật trước khi đăng.
- Không có đăng nhập/phân quyền: chỉ dùng trên `127.0.0.1`. Nếu mở ra mạng LAN/Internet phải bổ sung xác thực, CSRF và giới hạn tần suất trước.

## Bản quyền và điều khoản

- Chỉ nhập nội dung sách bạn có quyền xử lý; đầu ra hướng tới tóm lược, diễn giải và ví dụ mới thay vì sao chép.
- Tài khoản Claude và Claude Code CLI không phải API để bán hay chia sẻ. Studio dành cho cá nhân; mọi lần gọi Claude đều do bạn chủ động chạy trong terminal. Hãy đọc điều khoản hiện hành của Anthropic trước khi tự động hoá thêm.
- edge-tts phụ thuộc dịch vụ của Microsoft Edge, không đảm bảo hoạt động lâu dài hay quyền dùng thương mại; luôn có phương án tải âm thanh lên.
- Kiểm tra giấy phép Remotion cho trường hợp sử dụng của bạn. Font Be Vietnam Pro theo giấy phép SIL OFL (`public/fonts/BeVietnamPro-OFL.txt`).
