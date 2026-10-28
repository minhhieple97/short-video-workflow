# Book Video Studio

Ứng dụng chạy cục bộ (Windows + WSL2, một người dùng, chỉ `127.0.0.1`) biến bài học rút ra từ sách thành **video dọc 9:16**
cho TikTok, YouTube Shorts và Facebook Reels: kịch bản, giọng đọc và phụ đề **tiếng Việt** (kể cả khi sách bằng tiếng Anh),
cảnh có hoạt cảnh hoạt hình, dài 30 giây tới 5 phút, render MP4 ngay trên máy.

- Sách `.md` / `.txt`: nhập, chia chương, AI rút bài học, bạn duyệt, dựng kịch bản và render từng video.
- Sách PDF: trích chữ (Poppler, OCR Mistral cho trang scan), NotebookLM lập danh mục bài học, bạn chọn bài học, Studio tự
  sản xuất hàng loạt (bản thảo NotebookLM → Claude biên tập cảnh → giọng đọc → render) và lưu lên Google Drive.
- **Không dùng Claude API hay API key**: AI chạy bằng dữ liệu mẫu (`mock`) hoặc Claude Code CLI đã đăng nhập của chính bạn.

## Tài liệu

| Tài liệu                                         | Dành cho                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`docs/requirements.md`](./docs/requirements.md) | Đặc tả sản phẩm: phạm vi, luồng sử dụng, quy tắc nghiệp vụ, video, nghiệm thu |
| [`docs/operations.md`](./docs/operations.md)     | Cài đặt và vận hành: công cụ, tài khoản, `.env`, xử lý sự cố, sao lưu         |
| [`docs/architecture.md`](./docs/architecture.md) | Thiết kế kỹ thuật: tiến trình, dữ liệu, tác vụ, pipeline, tích hợp            |
| [`AGENTS.md`](./AGENTS.md)                       | Quy tắc cho AI agent và người đóng góp mã: cấu trúc mã, lệnh, quy ước         |

## Cài đặt lần đầu

Cần WSL2 Ubuntu (dự án đặt trên filesystem Linux, không dùng `/mnt/c`), Node.js ≥ 24, pnpm (chỉ pnpm), Docker hoặc Redis
≥ 6.2, ffmpeg. Các công cụ tuỳ chọn (edge-tts, Claude Code CLI, Poppler, NotebookLM, Mistral, Google Drive) xem
[`docs/operations.md`](./docs/operations.md).

```bash
cp .env.example .env          # AI_MODE=mock để thử ngay mà không cần Claude
pnpm install                  # tự chạy `prisma generate`
docker compose up -d          # Redis tại 127.0.0.1:6379
pnpm db:migrate               # tạo data/studio.db
pnpm db:seed                  # sách mẫu + bài học nháp
pnpm diagnose                 # kiểm tra môi trường
```

## Chạy hằng ngày

Mỗi lệnh một terminal WSL trong thư mục dự án:

```bash
docker compose up -d          # 1) Redis (nếu chưa chạy)
pnpm worker:dev               # 2) worker: phân tích, kịch bản, giọng đọc, render, OCR, lưu Drive
pnpm dev                      # 3) web tại http://127.0.0.1:3000
```

Mở `http://127.0.0.1:3000` trên Windows. Web vẫn mở được khi Redis hoặc worker tắt (trang **Cài đặt** báo "suy giảm"); việc
nặng chờ trong hàng đợi và chạy tiếp khi worker lên lại. Bản production: `pnpm build && pnpm start` kèm `pnpm worker:start`.

## Làm một video

**Sách `.md` / `.txt` (từng video, có duyệt):**

1. **Sách → Nhập sách**: tải tệp hoặc dán văn bản, kiểm tra danh sách chương, **Xác nhận nhập**.
2. Tab **Chương** → **Phân tích tất cả chương**; tab **Bài học**: đối chiếu trích đoạn, sửa, **Duyệt**.
3. Tab **Video** → **Tạo video**: chọn bài học đã duyệt và thời lượng (mặc định 60 giây; 90 giây – 5 phút khi tích **Video dài**).
4. Trong video: **Tạo kịch bản** → chọn hook (≤ 4 giây) → chỉnh từng cảnh (lời dẫn, chữ, bố cục, hoạt cảnh) → **Duyệt kịch bản**.
5. Tab **Giọng đọc** (edge-tts hoặc tải âm thanh lên) → xem trước trong khung điện thoại → **Render** nháp rồi bản cuối.

**Sách PDF (hàng loạt, không cần duyệt):**

1. **Nhập sách → Sách PDF**; theo dõi thẻ **Trích xuất PDF** trên trang sách tới khi có chương.
2. **Phân tích tất cả chương**: NotebookLM lập danh mục bài học kèm trích đoạn và số trang.
3. **Sản xuất video**: chọn bài học và thời lượng → trang **Sản xuất** theo dõi từng video tới khi render xong và lưu lên Drive.

## Dành cho người phát triển

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # cổng chất lượng
pnpm test:e2e                                            # hai luồng E2E trên stack riêng (cần Redis)
```

Quy ước mã, cấu trúc thư mục và các lệnh khác: [`AGENTS.md`](./AGENTS.md).
