# Vận hành Book Video Studio

Sổ tay cho người chạy ứng dụng trên máy của mình: cài và kết nối công cụ, `.env`, vận hành, sự cố, sao lưu. Phạm vi
sản phẩm và quy tắc nghiệp vụ: [requirements.md](requirements.md). Bên trong hệ thống (tiến trình, dữ liệu, job, đổi nhà
cung cấp): [architecture.md](architecture.md). Cài nhanh: [README](../README.md). Quy tắc kỹ thuật:
[AGENTS.md](../AGENTS.md).

> Mistral OCR, NotebookLM và Google Drive đã có trong mã nhưng mới được kiểm thử với fake cục bộ, **chưa chạy với tài
> khoản thật** (xem §8 và §9).

**An toàn khi vận hành**

- Bí mật chỉ nằm trong `.env` (khoá Mistral, OAuth client Google) và `data/credentials/` (token Drive, tệp `0600`, không
  nằm trong `studio.db`). Không bao giờ commit `.env`, `.env.local` hay `data/`.
- Ứng dụng chỉ lắng nghe `127.0.0.1`, không có đăng nhập. Mở ra LAN/Internet thì phải có xác thực, CSRF và giới hạn tần
  suất trước.
- Không có và không cần `ANTHROPIC_API_KEY`. Không dán token, cookie hay mật khẩu Claude vào Studio: Claude chỉ chạy qua
  Claude Code CLI đã đăng nhập của bạn. `AI_MODE=cli-auto` là tuỳ chọn cho dùng cá nhân trên `127.0.0.1`, mặc định tắt.
- Nội dung sách là dữ liệu không đáng tin, không điều khiển được AI. Log chỉ chứa ID và hash.

## 1. Chuẩn bị máy

| Thành phần            | Cần cho                | Cài / ghi chú                                               |
| --------------------- | ---------------------- | ----------------------------------------------------------- |
| WSL2 Ubuntu           | Luôn                   | Dự án trên filesystem Linux, không dùng `/mnt/c`            |
| Node.js ≥ 24          | Luôn                   | Đã kiểm thử với v24.18                                      |
| pnpm ≥ 9.7            | Luôn                   | Chỉ dùng pnpm; `npm install` / `yarn` bị chặn               |
| Redis ≥ 6.2           | Luôn                   | `docker compose up -d` (Redis 7, `127.0.0.1:6379`)          |
| ffmpeg + ffprobe      | Giọng đọc, render      | `sudo apt install ffmpeg`                                   |
| Chromium cho Remotion | Render                 | Tự tải khi render, hoặc `pnpm exec remotion browser ensure` |
| edge-tts              | Giọng đọc tự động      | `pip install -U edge-tts` (§3.6)                            |
| Claude Code CLI       | `cli-task`, `cli-auto` | §3.1                                                        |
| Poppler               | Sách PDF               | §3.2                                                        |
| uv                    | NotebookLM             | §3.4                                                        |

Lần đầu: làm theo phần cài nhanh trong [README](../README.md), rồi `pnpm diagnose`.

**Redis không dùng Docker.** Gói `redis-server` mặc định của Ubuntu (5.x) quá cũ cho BullMQ; dùng kho APT của Redis (WSL
chưa bật systemd thì dùng `sudo service ...` thay cho `systemctl`):

```bash
sudo apt-get install -y lsb-release curl gpg
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
sudo apt-get update && sudo apt-get install -y redis
sudo service redis-server start
```

**Tài nguyên WSL.** Máy 48 GB RAM không có nghĩa WSL được cấp 48 GB: xem `free -h`, `nproc` hoặc thẻ "Tài nguyên máy"
ở trang Cài đặt. Mặc định chỉ chạy một tác vụ và một luồng render; render chậm thì render nháp trước, hoặc đo rồi mới
tăng `RENDER_CONCURRENCY`. Muốn đổi RAM/CPU của WSL, **bạn tự** chỉnh `%UserProfile%\.wslconfig` rồi `wsl --shutdown`;
ứng dụng không bao giờ đổi cấu hình máy.

## 2. Cấu hình `.env`

Tạo bằng `cp .env.example .env` (dùng đúng các mặc định dưới đây). Web, worker và lệnh `pnpm` đọc cùng tệp; giá trị sai
làm tiến trình dừng với `Invalid environment configuration — <biến>: <lý do>`. Đổi `.env` thì khởi động lại web và
worker.

**Cơ bản và nhập sách**

| Biến                       | Mặc định      | Ý nghĩa                                              |
| -------------------------- | ------------- | ---------------------------------------------------- |
| `NODE_ENV`                 | `development` | `development`, `test` hoặc `production`              |
| `DATABASE_URL`             | _(bắt buộc)_  | SQLite `file:`; mẫu `file:./data/studio.db`          |
| `DATA_DIR`                 | `./data`      | Thư mục dữ liệu, tương đối dự án; không dưới `/mnt`  |
| `REDIS_URL`                | _(bắt buộc)_  | Mẫu `redis://127.0.0.1:6379`; `rediss://` cũng được  |
| `MAX_IMPORT_SIZE_MB`       | `10`          | Giới hạn tệp `.md`/`.txt` (tối đa 100)               |
| `CHAPTER_HEADING_PATTERNS` | `[]`          | Mảng JSON regex tiêu đề chương bổ sung               |
| `MAX_PDF_SIZE_MB`          | `500`         | Giới hạn PDF tải lên (tối đa 2048), ghi thẳng ra đĩa |
| `MAX_PDF_PAGES`            | `1000`        | Số trang PDF tối đa                                  |
| `POPPLER_BIN_DIR`          | _(trống)_     | Thư mục công cụ Poppler; trống thì tìm trên `PATH`   |
| `PDF_TOOL_TIMEOUT_SEC`     | `300`         | Thời gian tối đa mỗi lần chạy một công cụ Poppler    |

**OCR, NotebookLM, Google Drive**

| Biến                             | Mặc định                     | Ý nghĩa                                             |
| -------------------------------- | ---------------------------- | --------------------------------------------------- |
| `OCR_COST_CEILING_USD`           | `3`                          | Trần OCR mỗi sách (≤ 1000), chép vào lần trích xuất |
| `MISTRAL_API_KEY`                | _(trống)_                    | Khoá API của bạn, chỉ worker đọc                    |
| `MISTRAL_API_BASE_URL`           | `https://api.mistral.ai`     | Địa chỉ API Mistral                                 |
| `MISTRAL_OCR_MODEL`              | `mistral-ocr-4-1`            | Model ghim cố định (không dùng alias `latest`)      |
| `MISTRAL_OCR_USD_PER_1000_PAGES` | `2`                          | Đơn giá batch dùng để dự trù chi phí                |
| `NOTEBOOKLM_PROFILE`             | _(trống)_                    | Profile đã `nlm login` (≤ 64 ký tự: chữ, số, `_.-`) |
| `NOTEBOOKLM_MCP_COMMAND`         | `uvx`                        | Lệnh worker dùng để chạy máy chủ MCP                |
| `NOTEBOOKLM_MCP_PACKAGE`         | `notebooklm-mcp-cli==0.15.8` | Gói ghim phiên bản (dùng API không chính thức)      |
| `NOTEBOOKLM_CALL_TIMEOUT_SEC`    | `180`                        | Thời gian tối đa mỗi lời gọi NotebookLM             |
| `GOOGLE_OAUTH_CLIENT_ID`         | _(trống)_                    | OAuth client Desktop app; trống thì chỉ lưu local   |
| `GOOGLE_OAUTH_CLIENT_SECRET`     | _(trống)_                    | Secret của client đó (không bao giờ ghi log)        |
| `GOOGLE_API_BASE_URL`            | _(trống)_                    | Chỉ cho kiểm thử: API Google từ fake cục bộ         |
| `DRIVE_MIN_REQUEST_INTERVAL_MS`  | `1000`                       | Khoảng tối thiểu giữa hai yêu cầu Drive (0–60000)   |
| `DRIVE_MAX_REQUESTS_PER_DAY`     | `5000`                       | Số yêu cầu Drive tối đa mỗi 24 giờ trượt            |
| `DRIVE_MAX_UPLOAD_GIB_PER_DAY`   | `750`                        | GiB tải lên Drive tối đa mỗi 24 giờ trượt (≤ 750)   |

Ba giới hạn `DRIVE_*` là của riêng ứng dụng, không phải quota Google Cloud và không liên quan gói dung lượng Drive.
Trần upload mặc định cao để đợt nhiều sách không bị chặn ở 10 GiB. Nếu `.env` cũ đã đặt
`DRIVE_MAX_UPLOAD_GIB_PER_DAY=10`, đổi thành `750` để áp dụng mức mới; giá trị đặt riêng vẫn được giữ.

**AI, giọng đọc, video**

| Biến                             | Mặc định              | Ý nghĩa                                                                            |
| -------------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `AI_MODE`                        | `cli-task`            | `mock`, `cli-task` hoặc `cli-auto` (§3.1)                                          |
| `MAX_AI_CONCURRENCY`             | `1`                   | Số tác vụ AI cùng lúc                                                              |
| `CLAUDE_CLI_COMMAND`             | `claude`              | Lệnh Claude Code CLI                                                               |
| `AI_TASK_TIMEOUT_SEC`            | `600`                 | Thời gian tối đa một lần gọi Claude                                                |
| `TTS_MODE`                       | `edge-tts`            | `edge-tts`, hoặc `upload` (chỉ âm thanh tải lên)                                   |
| `TTS_VOICE`                      | `vi-VN-NamMinhNeural` | Giọng edge-tts                                                                     |
| `EDGE_TTS_COMMAND`               | `edge-tts`            | Lệnh edge-tts (đường dẫn tuyệt đối cũng được)                                      |
| `MAX_AUDIO_UPLOAD_MB`            | `20`                  | Giới hạn âm thanh tải lên (tối đa 100)                                             |
| `VIDEO_PROFILE`                  | `SHORT_VERTICAL`      | Giá trị duy nhất được nhận                                                         |
| `DEFAULT_MIN_VIDEO_DURATION_SEC` | `30`                  | Mức ngắn nhất mặc định của khoảng (30, 45, 60, 90, 120, 180, 240, 300)             |
| `DEFAULT_PACE`                   | `STANDARD`            | Nhịp độ video và lô mới: `STANDARD`, `FAST` (+15%) hoặc `FASTER` (+30%)            |
| `MAX_VIDEO_DURATION_SEC`         | `300`                 | Mức dài nhất mặc định và trần của mọi khoảng (cùng các mức trên); server cũng kiểm |
| `RENDER_WIDTH`                   | `1080`                | Chiều rộng bản cuối                                                                |
| `RENDER_HEIGHT`                  | `1920`                | Chiều cao bản cuối; tỉ lệ phải đúng 9:16                                           |
| `RENDER_FPS`                     | `30`                  | FPS của cả bản cuối và bản nháp                                                    |
| `DRAFT_RENDER_WIDTH`             | `720`                 | Chiều rộng bản nháp                                                                |
| `DRAFT_RENDER_HEIGHT`            | `1280`                | Chiều cao bản nháp; tỉ lệ phải đúng 9:16                                           |
| `RENDER_CONCURRENCY`             | `1`                   | Luồng render Remotion; chỉ tăng sau khi đo                                         |
| `WORKER_CONCURRENCY`             | `1`                   | Số job worker chạy cùng lúc; chỉ tăng sau khi đo                                   |

## 3. AI và tích hợp

### 3.1 Claude Code CLI và chế độ AI

| `AI_MODE`             | Hoạt động                                          | Sản xuất hàng loạt            |
| --------------------- | -------------------------------------------------- | ----------------------------- |
| `mock`                | Dữ liệu mẫu, không mạng, không tốn hạn mức         | Có, với dữ liệu mẫu           |
| `cli-task` (mặc định) | Claude thật; bạn tự chạy `pnpm ai:run` từng tác vụ | Không (`AI_MODE_UNSUPPORTED`) |
| `cli-auto` (tuỳ chọn) | Claude thật; worker tự chạy Claude Code CLI ngay   | Có, kèm NotebookLM (§3.4)     |

Cài Claude Code CLI và đăng nhập **trên chính máy chạy worker**: `claude`, rồi `/login`. Lệnh khác `claude` hoặc không
nằm trên `PATH` thì đặt `CLAUDE_CLI_COMMAND`. Thẻ "Claude Code CLI" ở Cài đặt cho biết đã sẵn sàng chưa.

Luồng `cli-task`: bấm **Phân tích** / **Tạo kịch bản** / **Viết lại cảnh này** → worker tạo `data/ai-tasks/<jobId>/`
(`prompt.md` có phiên bản, `input.json`, `schema.json`), tác vụ sang **Chờ Claude CLI** và trang video hiện sẵn lệnh cần
chạy. Video bị khoá trong lúc đó (`SCRIPT_GENERATION_IN_PROGRESS`); **Huỷ tạo kịch bản** / **Huỷ viết lại cảnh** để mở
khoá. Trong terminal WSL đã đăng nhập Claude Code:

```bash
pnpm ai:run --list
pnpm ai:run --job <jobId>    # thêm --dry-run để xem trước lệnh
```

Lệnh chạy `claude -p` không tool, không MCP server từ cấu hình của bạn, không lưu phiên, env đã loại mọi API key; kết
quả hợp lệ được lưu và worker ghi vào Studio. Chưa đăng nhập, hết hạn mức, quá `AI_TASK_TIMEOUT_SEC` hoặc sai schema →
tác vụ **Lỗi** với mã rõ ràng (§6), không tự thử lại; đầu ra thô ở `output.raw.txt`.

`cli-auto` bỏ bước chạy tay: worker gọi đúng lệnh đó, mỗi lần một tác vụ; tác vụ **Đang chạy** trong lúc Claude xử lý,
**Huỷ** dừng luôn tiến trình `claude`. Chế độ này dùng hạn mức tài khoản Claude của bạn cho mọi tác vụ AI; hãy tự đối
chiếu điều khoản Anthropic hiện hành trước khi bật.

### 3.2 Poppler

Sách PDF cần Poppler: `sudo apt-get install -y poppler-utils`, hoặc đặt `POPPLER_BIN_DIR` tới thư mục chứa `pdfinfo`,
`pdftotext`, `pdfimages`, `pdfseparate`, `pdfunite`. Thẻ "Poppler (PDF)" phải là "Ổn". Thiếu Poppler thì trích xuất dừng
với `PDF_TOOL_MISSING` trước khi gọi dịch vụ trả phí nào; cài xong bấm **Thử lại**.

### 3.3 Mistral OCR

- Chỉ cần khi sách có trang scan/ảnh hoặc font tiếng Việt cũ (TCVN3/VNI); trang đã có lớp chữ không đi OCR.
- Đặt `MISTRAL_API_KEY` (chỉ worker đọc, không bao giờ vào log hay lỗi), khởi động lại worker.
- Xác nhận model `MISTRAL_OCR_MODEL` có trong tài khoản và `MISTRAL_OCR_USD_PER_1000_PAGES` khớp bảng giá batch của
  Mistral: cả hai giá trị mặc định chưa được kiểm chứng.
- Thẻ "Mistral OCR" chỉ đọc cấu hình, không gọi Mistral; lần OCR thật đầu tiên mới là phép thử (§9).
- OCR chạy theo lô, có thể mất vài giờ tuỳ hàng đợi của Mistral; worker tự kiểm tra lại, không cần mở trang.

### 3.4 NotebookLM

Xác định chương và lập danh mục bài học cho sách PDF, viết bản thảo cho mọi video sản xuất hàng loạt. Chỉ hoạt động
khi `AI_MODE=cli-auto` và đã đặt `NOTEBOOKLM_PROFILE`.

1. Cài [uv](https://docs.astral.sh/uv/): worker chạy `notebooklm-mcp-cli` bằng `uvx`.
2. Đăng nhập một lần trong terminal của bạn: `uvx --from notebooklm-mcp-cli nlm login --profile <tên>`.
3. Đặt `NOTEBOOKLM_PROFILE=<tên>`, `AI_MODE=cli-auto`, khởi động lại worker. Worker chỉ dùng profile này cho tiến trình
   của nó (không đổi profile mặc định của bạn) và không truyền khoá Mistral/Google cho máy chủ MCP.
4. Cài đặt → Tích hợp → NotebookLM → **Kiểm tra NotebookLM** (worker phải đang chạy): worker đăng nhập bằng profile và
   đọc hạn mức còn lại. Thẻ chẩn đoán "NotebookLM" chỉ kiểm tra lệnh `uvx` và profile đã đặt.

Gói được ghim (`NOTEBOOKLM_MCP_PACKAGE`) vì dùng API không chính thức; đừng nâng phiên bản khi chưa kiểm tra lại.

Bản thảo của mỗi video được viết theo một góc kể (xoay tự động theo đợt và vị trí của mục, [requirements.md](requirements.md) §6.4).
Khi nâng cấp lên persona v2 và bản thảo v6: persona được áp lại một lần cho mỗi notebook ở lần mở sau; bản thảo đã cache với phiên
bản cũ không được dùng lại, nên video sản xuất sau nâng cấp tốn một lượt NotebookLM cho bản thảo (video đã có bản thảo giữ nguyên).
Sản xuất lại cùng bài học ở đợt khác thường ra góc kể khác, tức một lượt NotebookLM mới.

### 3.5 Google Drive

1. Trong Google Cloud project của bạn: bật Google Drive API, tạo OAuth client loại **Desktop app**; màn hình đồng ý ở
   trạng thái **Testing** thì thêm tài khoản của bạn vào test users.
2. Đặt `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, khởi động lại web và worker.
3. Mở `http://127.0.0.1:3000` (yêu cầu không từ loopback bị từ chối) → Cài đặt → Tích hợp → **Kết nối Google Drive**.
   Google đưa trình duyệt về `http://127.0.0.1:<cổng>`, rồi ứng dụng chuyển sang `/settings?drive=connected` hoặc
   `?drive_error=<mã>`. Thẻ Google Drive báo "Đã kết nối (quyền drive.file)" kèm email.

- Chỉ xin quyền `drive.file`: ứng dụng chỉ thấy tệp do nó tạo. Ở Testing, refresh token sống 7 ngày, sau đó phải **Kết
  nối lại Google Drive**; mỗi tài khoản có tối đa 100 refresh token cho một client (token cũ nhất bị huỷ khi vượt).
- Mọi bản render cuối hoàn tất được lưu lên Drive khi đã kết nối, kể cả bản xong trước khi kết nối (worker quét lúc khởi
  động và mỗi phút); bản render có nút **Lưu lên Drive** / **Thử lại lưu Drive**. Thư mục
  `Book Video Studio/books/<bookId>/videos/<videoId>/renders/<renderId>/` gồm MP4, `script.json`, `publish.txt` (tiêu đề,
  caption, hashtag — khi bản render có bộ này), `manifest.json`, tệp nào cũng được xác minh checksum với bản local.
- **Ngắt kết nối** thu hồi refresh token ở Google và xoá credential local; không xoá gì trên Drive.

### 3.6 Giọng đọc

- edge-tts: âm thanh được cắt khoảng lặng đầu/cuối để hook có lời ngay, cache theo lời dẫn + giọng + tốc độ. Đây là
  dịch vụ trực tuyến **không chính thức**, hay chập chờn: không có âm thanh trả về thì Studio tự thử lại tối đa 4 lần
  (sau 2, 5, 10 giây). Lỗi 403 nghĩa là bản edge-tts đã cũ.
- Tải lên MP3/WAV (≤ `MAX_AUDIO_UPLOAD_MB`): giữ nguyên tệp, chỉ đo; cảnh báo nếu khoảng lặng đầu quá 0,5 giây.
  `TTS_MODE=upload` tắt hẳn TTS; sản xuất hàng loạt luôn lồng tiếng bằng edge-tts nên cần `TTS_MODE=edge-tts`.
- Độ dài cảnh = âm thanh thật + khoảng nghỉ của nhịp độ video; Studio không cắt lời hay tự đổi nhịp độ cho vừa khoảng thời lượng. `TTS_SPEED` và
  `SCENE_AUDIO_PADDING_MS` đã bỏ: tốc độ giọng và khoảng nghỉ nay theo nhịp độ chọn cho từng video (giá trị lạ trong `.env` bị bỏ qua). Sửa chữ trên
  màn hình giữ audio; sửa lời dẫn gỡ audio cũ.

## 4. Vận hành hằng ngày

Chạy Redis rồi `pnpm dev:all` (web và worker trong một terminal, log gắn nhãn `[web]` / `[worker]`, Ctrl+C dừng cả hai), mở
`http://127.0.0.1:3000`. Hoặc mỗi tiến trình một terminal: `pnpm worker:dev`, `pnpm dev`. Bản production: `pnpm build && pnpm start`
kèm `pnpm worker:start`. Web vẫn mở khi Redis hoặc worker tắt (Cài đặt báo "suy giảm"); worker thoát mã 1 nếu không tới
được Redis.

**Chỉ một worker mỗi Redis DB.** Hai worker sẽ cùng nhận tác vụ và phá giới hạn "một việc AI, một lượt render một lúc", nên worker
giữ khoá `studio:worker:lock` (PID, máy, giờ khởi động, thư mục dữ liệu; hết hạn sau 30 giây nếu heartbeat không gia hạn). Nếu đã có
worker khác thì **từ chối chạy, in trạng thái của worker đó** rồi thoát mã 1: `pnpm worker:dev` và `pnpm worker:start` làm việc này ngay
từ đầu (không để `tsx watch` treo chờ), còn `pnpm dev:all` chỉ khởi động thứ còn thiếu: bỏ qua worker nếu đã có, bỏ qua web nếu cổng
web (3000, hoặc `PORT`) đã có tiến trình (Next sẽ tự nhảy sang cổng kế tiếp và để hai dev server cùng một thư mục). `pnpm worker:status` in cùng trạng thái đó
(mã thoát 0 khi có worker, 1 khi không có, 2 khi không tới được Redis). Worker bị giết đột ngột (`kill -9`, đóng terminal, `tsx watch`
buộc dừng khi nạp lại code) được nhận ra ngay vì tiến trình giữ khoá không còn, nên chạy lại được liền; khoá ghi từ máy khác thì phải
đợi hết hạn. Mỗi bản checkout hoặc worktree của dự án cần một Redis DB riêng (ví dụ `REDIS_URL=redis://127.0.0.1:6379/1`), nếu không
worker của bản này bị worker của bản kia từ chối.

**Tác vụ (`/jobs`).** **Thử lại** tạo tác vụ mới; **Huỷ** dừng ngay tác vụ đang chờ, còn tác vụ đang chạy thì được yêu
cầu dừng (render dừng giữa chừng và xoá tệp dở); **Chi tiết** kèm lệnh `pnpm ai:run`. Worker tắt thì tác vụ vẫn nằm
trong Redis hoặc outbox và chạy tiếp khi worker lên lại. Việc phải chờ bên ngoài (lô OCR, hạn mức) được hẹn lại thay
vì giữ worker; trang hiện lý do và "sẽ thử lại tự động". Từng bước của sách PDF hiện ở thẻ "Trích xuất PDF", của mỗi
video sản xuất ở `/productions/:id`.

**Chẩn đoán.** Trang Cài đặt (`/settings`), `GET /api/health` và `pnpm diagnose` dùng chung một bộ kiểm tra. Cài đặt
có thêm **Chạy tác vụ thử** (web → Redis → worker → SQLite) và **Kiểm tra AI mẫu**. `pnpm doctor` là lệnh riêng của
pnpm, không phải chẩn đoán này.

**Render.**

- Bản nháp 720×1280 để duyệt nhanh, bản cuối 1080×1920. Worker render lần lượt, ghi tệp tạm rồi đổi tên, ffprobe xác
  nhận codec, kích thước, FPS, thời lượng. Lần render đầu của mỗi tiến trình worker phải bundle (vài chục giây).
- Đo trên máy dev, concurrency 1: bản nháp 480 frame (16 giây) mất 36,8 giây có hoạt cảnh so với 37,3 giây khi chưa có,
  MP4 2,3 MB so với 0,66 MB; bản nháp 720×1280 dài 5 phút mất 10 phút 31 giây, 32 MB. **Chưa đo** bản cuối 1080×1920
  dài 5 phút.
- Kiểm tra trước render chặn: HOOK không ở frame 0 hoặc dài quá 120 frame (4 giây), thiếu chữ, dài hơn mức dài nhất của khoảng
  (hoặc 300 giây); bản cuối cần kịch bản đã duyệt (hoặc đạt kiểm tra tự động khi sản xuất hàng loạt). Ngắn hơn mức ngắn nhất chỉ
  cảnh báo khi làm tay, nhưng chặn (và dùng lượt sửa AI) khi sản xuất hàng loạt.
- Độ dài mỗi video do AI đề xuất trong khoảng bạn đặt (Claude khi tạo kịch bản, NotebookLM khi viết bản thảo); huy hiệu trong trình
  biên tập hiện đề xuất, khoảng và lý do (rê chuột). Muốn đúng một độ dài thì đặt ngắn nhất = dài nhất.
- Đổi kịch bản, cảnh hay âm thanh làm các bản render trước thành **Lỗi thời**; MP4 cũ không bao giờ tự bị xoá. Render
  lại để có bản mới. Vùng an toàn là ước lượng chỉnh được, chỉ hiện trong trình biên tập, không vào MP4.
- Tự kiểm tra một tệp:
  `ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact <tệp.mp4>`

## 5. Hạn mức và ngân sách

| Hạng mục        | Mặc định                          | Cách đổi / ghi chú                                         |
| --------------- | --------------------------------- | ---------------------------------------------------------- |
| Chi phí OCR     | 3 USD mỗi sách, không tự nâng     | **Trần chi phí OCR** (0–100 USD, ≥ đã chi + giữ chỗ)       |
| PDF             | 500 MiB, 1.000 trang              | `MAX_PDF_SIZE_MB`, `MAX_PDF_PAGES`                         |
| NotebookLM      | Theo gói (ngắn hạn và tuần)       | Xem % đã dùng, giờ đặt lại ở Cài đặt; bản thảo được cache  |
| Drive           | 5.000 yêu cầu, 10 GiB mỗi 24 giờ  | 1 yêu cầu/giây; `DRIVE_*`; hết hạn mức thì archive chờ     |
| Sửa bằng AI     | Một lượt mỗi video sản xuất       | Nội dung/nguồn → NotebookLM; biên dịch/thời lượng → Claude |
| Thử lại tự động | Sản xuất 5, trích xuất 8, Drive 8 | Lần liên tiếp; sau đó dừng kèm lý do, sửa rồi **Thử lại**  |

## 6. Xử lý sự cố

| Dấu hiệu / mã                           | Nghĩa                                   | Làm gì                                                                   |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| "Không thể kết nối Redis…" (503)        | Web không tới được Redis                | `docker compose up -d` (không Docker: §1)                                |
| "Worker không chạy"                     | Worker chưa chạy                        | `pnpm worker:dev` hoặc `pnpm dev:all`; tác vụ đã xếp hàng tự chạy tiếp   |
| "Worker đã chạy rồi…"                   | Đã có worker trên Redis DB này          | Dùng tiếp worker đó, hoặc dừng nó (`kill <PID>`) rồi chạy lại            |
| Worker thoát ngay, mã 1                 | Redis chưa chạy hoặc `REDIS_URL` sai    | Xem log, bật Redis, kiểm tra `REDIS_URL`                                 |
| `Invalid environment configuration`     | `.env` có giá trị sai                   | Đọc tên biến và lý do trong thông báo, đối chiếu §2                      |
| `DATA_DIR resolves to /mnt/...`         | Dữ liệu nằm trên ổ Windows              | Đưa dự án và dữ liệu về filesystem Linux                                 |
| API báo "is not a function"             | Cache `pnpm dev` cũ sau cập nhật        | Dừng `pnpm dev`, xoá `.next/dev`, chạy lại                               |
| "Tác vụ không còn trong hàng đợi…"      | Dữ liệu Redis đã bị xoá                 | **Thử lại** tác vụ                                                       |
| Tác vụ "Chờ Claude CLI" mãi             | `cli-task` đang chờ bạn chạy lệnh       | `pnpm ai:run --job <id>`, hoặc `AI_MODE=cli-auto` / `mock`               |
| `AI_CLI_AUTH`, `AI_QUOTA_EXCEEDED`      | Chưa đăng nhập Claude / hết hạn mức     | `claude` rồi `/login` / đợi hạn mức; rồi **Thử lại**                     |
| `AI_CLI_MISSING`, `AI_CLI_TIMEOUT`      | Thiếu lệnh `claude` / quá thời gian     | Sửa `CLAUDE_CLI_COMMAND` / tăng `AI_TASK_TIMEOUT_SEC`                    |
| `AI_MODE_UNSUPPORTED`                   | Sản xuất hàng loạt ở `cli-task`         | `AI_MODE=cli-auto` (hoặc `mock` để thử)                                  |
| `SCRIPT_STUDIO_NOT_AVAILABLE`           | Chưa đặt `NOTEBOOKLM_PROFILE`           | Đặt profile (§3.4), khởi động lại worker                                 |
| `SCRIPT_GENERATION_IN_PROGRESS`         | Đang tạo kịch bản / viết lại cảnh       | Chờ, hoặc **Huỷ tạo kịch bản** / **Huỷ viết lại cảnh**                   |
| `TTS_REJECTED` (403)                    | Bản edge-tts đã cũ                      | `pip install -U edge-tts`, hoặc tải âm thanh lên                         |
| `TTS_FAILED` "không trả về âm thanh"    | edge-tts chập chờn, đã thử lại 4 lần    | Thử lại sau ít phút hoặc tải âm thanh lên                                |
| `TTS_DISABLED`                          | Đang `TTS_MODE=upload`                  | Tải âm thanh lên, hoặc đặt `TTS_MODE=edge-tts`                           |
| Render báo thiếu Chromium / thư viện    | Chromium của Remotion chưa sẵn sàng     | `pnpm exec remotion browser ensure`, rồi tài liệu Remotion               |
| Chữ tiếng Việt lỗi dấu                  | Thiếu tệp font                          | Kiểm tra `public/fonts` còn đủ Be Vietnam Pro                            |
| `PDF_TOOL_MISSING`                      | Chưa có Poppler                         | Cài Poppler (§3.2), **Thử lại**                                          |
| `PDF_ENCRYPTED`, `PDF_CORRUPT`          | PDF cần mật khẩu / bị hỏng              | Bỏ mật khẩu / xuất lại PDF rồi nhập lại; không thử lại được              |
| `PDF_TOO_MANY_PAGES`                    | Vượt `MAX_PDF_PAGES`                    | Tăng giới hạn nếu máy chịu được, khởi động lại, **Thử lại**              |
| `OCR_NOT_CONFIGURED`                    | Cần OCR mà chưa có `MISTRAL_API_KEY`    | Đặt khoá, khởi động lại worker hoặc **Thử lại**                          |
| `OCR_BUDGET_EXCEEDED`                   | Ước tính vượt trần chi phí              | Nâng **Trần chi phí OCR** rồi **Thử lại**                                |
| `MISTRAL_HTTP_401`, `_403`              | Mistral từ chối khoá                    | Sửa khoá, **Thử lại**; lô đang mở và giữ chỗ vẫn nguyên                  |
| "Còn trang lỗi" (`OCR_PAGES_FAILED`)    | Có trang OCR lỗi (quá cỡ, hết hạn…)     | **Thử lại** chỉ gửi lại các trang đó (tốn tiền cho chúng)                |
| `OCR_CANCELLED_REMOTELY`                | Lô bị huỷ ở phía Mistral                | **Thử lại** để gửi lại                                                   |
| "Chưa xác định chương"                  | Không thấy tiêu đề chương/đề xuất sai   | Cấu hình NotebookLM rồi **Thử lại**; lý do nêu chương sai                |
| `NOTEBOOKLM_PROFILE_MISSING`            | Profile chưa đăng nhập hoặc hết hạn     | `nlm login` lại (§3.4), rồi **Kiểm tra NotebookLM**                      |
| `NOTEBOOKLM_AUTH_REQUIRED`              | NotebookLM báo cần đăng nhập lại        | Như dòng trên                                                            |
| `NOTEBOOKLM_QUOTA`                      | Hết hạn mức NotebookLM                  | Xem giờ đặt lại ở Cài đặt → NotebookLM, rồi **Thử lại**                  |
| `NOTEBOOKLM_*_INVALID`, `DRAFT_INVALID` | Sai định dạng hoặc sai mạch kể          | Bản thảo: lượt sửa tự động; chương: **Phân tích lại**                    |
| `PRODUCTION_CORRECTION_EXHAUSTED`       | Đã dùng lượt sửa AI mà vẫn chưa đạt     | Xem lý do (thường quá dài/ngắn); sửa bài học / đợt mới với khoảng khác   |
| `UNDER_MIN`                             | Video ngắn hơn mức ngắn nhất            | Làm tay: chỉ cảnh báo. Hàng loạt: NotebookLM viết lại sâu hơn (một lượt) |
| `DRAFT_LENGTH_OUT_OF_RANGE`             | NotebookLM đề xuất độ dài ngoài khoảng  | Tự sửa bằng lượt sửa AI; lặp lại thì kiểm tra prompt/NotebookLM          |
| `DURATION_OVER_LIMIT`                   | Khoảng dài hơn `MAX_VIDEO_DURATION_SEC` | Chọn mức dài nhất thấp hơn, hoặc nâng biến này (≤ 300) và khởi động lại  |
| `DRIVE_RECONNECT_REQUIRED`              | Refresh token bị thu hồi hoặc hết hạn   | **Kết nối lại Google Drive**; archive dở chạy tiếp                       |
| `drive_error=<mã>` khi kết nối          | Từ chối quyền / phiên kết nối hết hạn   | **Kết nối Google Drive** lần nữa; kết nối cũ giữ nguyên                  |
| `DRIVE_STORAGE_FULL`                    | Drive hết dung lượng                    | Giải phóng dung lượng rồi **Thử lại lưu Drive**                          |
| `DRIVE_APP_DAILY_LIMIT`                 | Chạm giới hạn 24 giờ của ứng dụng       | Archive tự chờ, hoặc tăng `DRIVE_*` và khởi động lại                     |
| `ARCHIVE_DESTINATION_CHANGED`           | Đã kết nối tài khoản Google khác        | Tài khoản mới nhận archive mới; archive cũ giữ nguyên                    |

`MISTRAL_UPLOAD_SIZE_MISMATCH`: kích thước PDF OCR lưu tại Mistral khác tệp gửi; kiểm tra tệp/kết nối rồi **Thử lại**.
JSONL của Batch có thể được Mistral chuẩn hoá và tăng kích thước; ứng dụng chỉ đối chiếu byte của PDF OCR.

`BOOK_HAS_NO_CHAPTERS`: sách chưa có chương để phân tích. Với PDF, hoàn tất trích xuất và tạo chương trước; nút
**Phân tích tất cả chương** bị vô hiệu khi chưa có chương.

PDF trộn lớp chữ và OCR có thể sinh heading Markdown không phải chương. Nếu parser bỏ sót một dấu "Chương N" hoặc tạo hai
chương trùng số trong cùng một phần (thường là mục lục), ứng dụng dùng NotebookLM để kiểm tra cấu trúc từ dàn ý giới hạn theo
trang, gồm ứng viên giữa trang.
Chưa cấu hình NotebookLM hoặc đề xuất không khớp văn bản → **Chưa xác định chương**, không tạo chương từ cấu trúc mơ hồ.

## 7. Dữ liệu, sao lưu và khôi phục

```
data/                                   # không commit
  studio.db (+ -wal, -shm)              # SQLite, chế độ WAL
  books/<bookId>/original.*             # tệp gốc (.md, .txt, .pdf), chỉ đọc
  books/<bookId>/chapters/              # nội dung từng chương
  books/<bookId>/extractions/<id>/      # canonical.md, chunk OCR tạm
  ai-tasks/<jobId>/                     # prompt, input, schema, đầu ra thô của AI
  videos/<videoId>/audio/               # giọng đọc
  videos/<videoId>/renders/             # MP4, -script.json, -publish.txt, -manifest.json
  integrations/notebooklm-status.json   # hạn mức NotebookLM đọc gần nhất
  credentials/google-drive.json         # token Drive (0600), không mang ra ngoài máy
```

- **Sao lưu:** dừng `pnpm dev` và worker, rồi sao chép toàn bộ `data/` (gồm `studio.db-wal`, `studio.db-shm`), ví dụ
  `tar czf ~/backup-$(date +%F).tgz data`.
- **Khôi phục:** dừng các tiến trình, giải nén đè `data/`, chạy `pnpm exec prisma migrate deploy` (chỉ áp migration còn
  thiếu, không xoá dữ liệu), rồi khởi động lại.
- Hàng đợi Redis nằm trong volume Docker `redis-data` (AOF). `docker compose down -v` xoá volume này; worker đánh dấu
  tác vụ dở là lỗi ("Tác vụ không còn trong hàng đợi…") để bạn thử lại.
- **Worker chết giữa chừng:** khởi động lại là đủ. Worker giao job còn trong outbox, khớp lại trạng thái với Redis, cấp
  job mới cho lần trích xuất, video sản xuất và archive còn dở; mỗi bước đi tiếp từ checkpoint đã lưu.
- **Không bao giờ làm lại việc đã xong:** trang đã có chữ không đọc hay OCR lại; lô OCR mất phản hồi được đối soát theo
  khoá trước khi gửi lại; nguồn NotebookLM tải một lần mỗi phiên bản văn bản (dấu `[bvs:<id>]` trong tiêu đề); bản thảo
  hợp lệ lấy từ cache; render xong mà Drive lỗi thì chỉ tải lên lại; tải lên Drive tiếp tục từ byte Google đã nhận.

## 8. Giới hạn đã biết và giả định chưa kiểm chứng

**Giới hạn**

- Chưa hỗ trợ EPUB. Không có NotebookLM thì sách PDF không có tiêu đề chương dừng ở "Chưa xác định chương"; chưa có công
  cụ tách chương thủ công cho sách PDF.
- Phát hiện font tiếng Việt cũ (TCVN3/VNI) dựa trên tỉ lệ ký tự lạ; văn bản rất ngắn có thể bị bỏ sót hoặc gửi OCR thừa.
- Một lô OCR mở mỗi lần trích xuất; sách nghìn trang scan chạy tuần tự.
- Bài học trùng giữa các chương không tự gộp (chỉ trong cùng chương); hãy gộp tay.
- Phụ đề theo cụm từ, căn theo số âm tiết, không khớp từng từ. Chưa có nhạc nền. Hoạt cảnh chỉ có bối cảnh và hành động
  cố định. Video dài hơn 60 giây có thể không còn được tính là Shorts/Reels. Vùng an toàn là ước lượng.

**Giả định nhà cung cấp chưa kiểm chứng** (các tích hợp mới chỉ được kiểm thử với fake cục bộ có chèn lỗi):

- **Mistral:** model `mistral-ocr-4-1` có tồn tại (nguồn công khai chỉ nêu `mistral-ocr-4-0`/alias); đơn giá batch
  2 USD/1.000 trang; cách `/v1/ocr` tham chiếu tệp đã tải lên (`file_id`); dạng một dòng JSONL kết quả; cơ số chỉ số
  trang trong phản hồi; cơ số tham số `page` khi liệt kê job (đang dùng 0) và việc danh sách trả `metadata`; danh sách
  job nhất quán ngay sau khi tạo; lô `FAILED`/`TIMEOUT_EXCEEDED` không bị tính tiền.
- **NotebookLM:** `notebooklm-mcp-cli` dùng API không chính thức; các mẫu văn bản lỗi ngoài "No authentication found";
  chất lượng JSON trả về; câu hỏi bản thảo (khoảng 6.000 ký tự gồm quy tắc kể chuyện và góc kể) có được nhận nguyên vẹn không;
  bản thảo kể chuyện có đẩy lời dẫn vượt độ dài (`OVER_TARGET`) hay thiếu (`UNDER_MIN`) nhiều hơn trước không, và thoại ngắn có
  bị Claude đổi chữ làm hỏng kiểm tra trích dẫn (`SCENE_PLAN_UNSUPPORTED_CLAIM`) không.
- **Google Drive:** mã hoá của `sha256Checksum`/`md5Checksum` (đang so dạng hex, không phân biệt hoa thường); redirect
  loopback không có path được chấp nhận.

## 9. Nghiệm thu với tài khoản thật

Mục tiêu: từ một sách PDF, nhận danh mục bài học có nguồn, chọn bài và nhận video đúng mẫu kể chuyện trên máy và trên
Drive; không mất tiến độ khi khởi động lại, không chạy lại cả pipeline vì một lỗi tải lên. Ghi lại giả định nào ở §8
đúng, giả định nào sai.

**Chuẩn bị**

- [ ] Poppler, edge-tts, Claude Code CLI đã đăng nhập; `AI_MODE=cli-auto`; `pnpm diagnose` không báo lỗi.
- [ ] `MISTRAL_API_KEY` đã đặt; model có trong tài khoản; đơn giá batch đã đối chiếu bảng giá.
- [ ] `nlm login` xong, `NOTEBOOKLM_PROFILE` đã đặt, **Kiểm tra NotebookLM** đọc được hạn mức.
- [ ] OAuth client Google thật; Drive "Đã kết nối".

**OCR thật lần đầu**

- [ ] Nhập một PDF nhỏ có vài trang scan đại diện, đặt **Trần chi phí OCR** thấp (ví dụ 0,10 USD).
- [ ] Theo dõi thẻ trích xuất tới "Đã trích xuất".
- [ ] So chi phí thực trên bảng điều khiển Mistral với "đã chi" trong thẻ.
- [ ] Đọc thử các trang đã OCR. Gửi lô thành công **chưa** phải OCR thành công: chỉ tin khi trang có chữ.

**NotebookLM thật**

- [ ] Chương được xác định; **Phân tích tất cả chương** tạo bài học có trích đoạn và số trang khớp sách.
- [ ] Ghi lại văn bản lỗi thật nếu gặp (đăng nhập, hạn mức).
- [ ] Sản xuất một đợt từ sáu bài học trở lên: các video liền kề khác góc kể; hook mở bằng khoảnh khắc cụ thể (không phải câu
      hỏi chung chung); tab **Nguồn kịch bản** đánh dấu minh hoạ ở mọi nhịp có nhân vật hay thoại bịa. Ghi lại tỷ lệ
      `OVER_TARGET`, `UNDER_MIN` và `SCENE_PLAN_UNSUPPORTED_CLAIM`; nếu NotebookLM từ chối hay cắt câu hỏi bản thảo, chuyển
      `STORYTELLING_RULE` sang persona (xem `docs/architecture.md`, mục Prompt).

**Video và Drive**

- [ ] Chọn bài học → **Sản xuất video**: kiểm tra mạch kể (theo [requirements.md](requirements.md)), lời tiếng Việt,
      audio, và ffprobe trên MP4.
- [ ] Archive Drive hoàn tất: thư mục có MP4, `script.json`, `publish.txt`, `manifest.json`, checksum khớp bản local.
- [ ] Tiêu đề, caption, hashtag do Claude thật viết: tiếng Việt tự nhiên, tiêu đề ≤ 100 ký tự, dòng nguồn đúng sách và tác giả,
      hashtag không dấu, không số liệu hay trích dẫn ngoài nguồn.
- [ ] Dừng rồi chạy lại worker giữa một đợt sản xuất: tiến độ không mất, không có video hay tệp Drive trùng.

### Nhập tự động tối đa 15 PDF

1. Giữ `WORKER_CONCURRENCY=1`, `MAX_AI_CONCURRENCY=1`, `RENDER_CONCURRENCY=1`. Với tài khoản thật, dùng `AI_MODE=cli-auto`,
   NotebookLM đã đăng nhập, edge-tts hoạt động; kết nối Drive nếu muốn lưu từ xa. Mistral chỉ cần khi có trang phải OCR.
2. Sau khi cập nhật mã, chạy `pnpm db:migrate` rồi `pnpm db:generate`, khởi động lại web và worker. Không chạy hai worker
   chung Redis database. Các migration bổ sung giữ nguyên sách, video và checkpoint cũ.
3. Vào **Nhập sách → Nhập nhiều PDF tự động** (`/books/import/batch`), chọn 1–15 PDF, khoảng thời lượng và nhịp độ.
   Bấm tải lên. Trang chỉ chuyển sang tiến độ sau khi tệp hợp lệ đã lưu và đợt được xếp hàng; sau đó có thể đóng trang.
4. Xem lại tại `/book-imports`. Một sách làm xong mới chuyển sách sau. Lỗi từng sách có lý do và liên kết tới sách hoặc
   đợt video; sau khi xử lý nguyên nhân, bấm **Thử lại các sách lỗi**. Video đã hoàn tất không được tạo lại.

Hết quota Claude: worker không thất bại vì phải chờ nhiều giờ. Lịch chờ nằm trong SQLite và giữ qua restart. Có giờ
reset hoặc thông báo còn 30 phút / 1 giờ thì job được xếp chạy lại từ đúng mốc đó, không thức dậy kiểm tra mỗi phút.
Trong lúc chờ, bản thảo NotebookLM và checkpoint được giữ nguyên. Không có giờ reset thì thử lại tối đa một tác vụ thực mỗi
phút. Đây là cơ chế phản hồi từ CLI và chờ, **không phải** số phần trăm quota lấy từ tài khoản. Giới hạn tuần có thể
chặn lâu hơn 5 giờ. Không tự mua lượt dùng, đổi tài khoản, đổi API key hay bật trả phí vượt hạn mức.

Nghiệm thu tài khoản thật vẫn cần kiểm tra thông báo quota thực tế của bản Claude Code đang cài, giờ reset, và một đợt
nhỏ hai sách trước khi chạy 15 sách. Kiểm thử tự động chỉ dùng Claude/NotebookLM/Mistral/Google giả.

NotebookLM: mỗi phiên kiểm tra `usage_get` trước khi xử lý và đọc lại nếu một lời gọi chạm quota. Hạn mức ngắn hạn
và tuần cùng cạn thì chờ đến mốc reset muộn nhất, lưu lịch qua restart và không gọi lại trong lúc chờ. Không đọc được
giờ reset thì nghỉ 15 phút. Lỗi đăng nhập vẫn yêu cầu đăng nhập lại; số phần trăm không được báo là chưa biết, không
phải đã hết quota. Nút kiểm tra trong Cài đặt vẫn đọc được hạn mức khi tài khoản đã cạn. Lệnh kiểm tra trong terminal:
`uvx --from notebooklm-mcp-cli==0.15.8 nlm usage --profile <tên> --json`. Đây là API nội bộ mà CLI sử dụng, không phải
API quota công khai được Google hỗ trợ. Drive vẫn đọc dung lượng thật bằng `about.get`, cache tối đa một giờ và xử lý
rate limit riêng với dung lượng lưu trữ.

Khi kiểm thử ở worktree trong lúc checkout khác đang hoạt động, có thể đặt `E2E_PORT`, `E2E_DATA_DIR` và `E2E_REDIS_URL`
cho `pnpm test:e2e`; chúng chỉ điều khiển stack Playwright. Redis database đó bị xoá ở đầu mỗi lần E2E. Unit/integration
queue tests dùng `TEST_REDIS_URL` và queue có tên riêng.

## 10. Bản quyền và điều khoản

- Chỉ nhập nội dung sách bạn có quyền xử lý; đầu ra hướng tới tóm lược, diễn giải và ví dụ mới thay vì sao chép.
- Tài khoản Claude và Claude Code CLI không phải API để bán hay chia sẻ. Studio dành cho cá nhân; đọc điều khoản hiện
  hành của Anthropic trước khi tự động hoá thêm.
- edge-tts phụ thuộc dịch vụ của Microsoft Edge, không đảm bảo hoạt động lâu dài hay quyền dùng thương mại; luôn có
  phương án tải âm thanh lên.
- Kiểm tra giấy phép Remotion cho trường hợp sử dụng của bạn. Font Be Vietnam Pro theo giấy phép SIL OFL
  (`public/fonts/BeVietnamPro-OFL.txt`).
