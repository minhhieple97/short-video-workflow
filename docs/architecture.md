# Kiến trúc Book Video Studio

Tài liệu thiết kế kỹ thuật duy nhất, mô tả **trạng thái hiện tại của mã**. Tài liệu liên quan:

- [requirements.md](requirements.md): phạm vi sản phẩm, luồng người dùng, quy tắc nghiệp vụ và video, nghiệm thu, hiện trạng.
- [operations.md](operations.md): cài đặt, `.env`, bảng mã lỗi, hạn mức, khôi phục, giới hạn và giả định nhà cung cấp chưa kiểm chứng.
- [AGENTS.md](../AGENTS.md): quy tắc kỹ thuật, sơ đồ mã `src/`, lệnh, quy ước. [README.md](../README.md): giới thiệu và chạy nhanh.

Mistral OCR, NotebookLM và Google Drive đã có trong mã và được kiểm thử với fake cục bộ, nhưng **chưa chạy với tài khoản thật**.

## 1. Tiến trình

```
Trình duyệt ──127.0.0.1:3000──► Next.js (UI + route mỏng) ──Prisma──► SQLite (WAL)
                                   │ outbox / queue.add (chỉ ID)          ▲
                                   ▼                                      │
                              Redis `studio-jobs` ──► Worker (concurrency 1) ──► DATA_DIR
                                                       ├─ tiến trình con: claude -p, edge-tts, ffmpeg/ffprobe,
                                                       │  Poppler, uvx notebooklm-mcp (stdio), Chromium (Remotion)
                                                       └─ HTTPS: Mistral, Google
Terminal người dùng: pnpm ai:run ──► claude -p ──► ai-tasks/<id>/output.json ──► requeue cùng JobRecord
```

- **Web** (`pnpm dev`/`start`): Zod → service → repository; việc dài chỉ được ghi thành tác vụ và trả `202 { jobId }`, UI hỏi lại mỗi
  2–3 giây. Không bao giờ chạy AI, TTS hay render. Redis/worker tắt thì trang vẫn mở và báo suy giảm (`/api/status`, heartbeat cũ hơn
  15 giây); thao tác cần Redis ngay thì `PING` thử rồi trả `503 QUEUE_UNAVAILABLE`.
- **Worker** (`pnpm worker:dev`/`start`): mọi việc nặng và mọi lời gọi ra ngoài; `WORKER_CONCURRENCY` và `RENDER_CONCURRENCY` mặc định 1.
  Không tới được Redis thì thoát mã 1. Khởi động (`src/worker/main.ts`): `PING` Redis, bật WAL → `sweepDueJobIntents` (giao outbox còn
  sót, để bước sau chỉ xét job đáng lẽ đã ở Redis) → `reconcileJobRecords` → `reconcileProductionItems`, `reconcileExtractions` (cấp job
  mới cho việc dở đã mất job; chỉ lúc khởi động để lỗi lặp không thành vòng) → `sweepRenderArchives` → mở BullMQ `Worker`; định kỳ:
  heartbeat 5 giây (TTL 30 giây), quét outbox 5 giây, quét archive 60 giây. SIGINT/SIGTERM: đóng, tối đa 15 giây; job dở thành stalled
  và được đối soát lần sau.
- **`pnpm ai:run`**: người dùng tự chạy tác vụ `cli-task` bằng Claude Code CLI của mình.

## 2. Mô hình dữ liệu

Prisma 7 + SQLite (`prisma/schema.prisma`), migration chỉ cộng thêm. Sáu loại dữ liệu lưu riêng: tệp gốc (bất biến) → bản trích xuất
(dẫn xuất) → catalogue (chương, bài học, nguồn) → bản thảo NotebookLM → kế hoạch cảnh Claude (đầu vào duy nhất của Remotion) → snapshot
render (bất biến, nguồn của manifest Drive).

- **Sách:** `Book` (tệp gốc + `sourceHash`, `sourceFormat` `md`/`txt`/`pdf`, xoá mềm, bị chặn khi có video) · `Chapter` (duy nhất
  `(bookId, order)`; nội dung ở tệp, `contentHash`, `analysisStatus`) · `Lesson` + `LessonSource` (duy nhất
  `(lessonId, chapterId, sourceLocator)`; locator `offset:<k>` hoặc `page:<n>;offset:<k>`).
- **Video:** `Video` (`scriptVersion` tăng mỗi lần kịch bản đổi; `approvedScriptVersion` do người duyệt; `autoReadyScriptVersion` do máy
  kiểm, không phải duyệt) · `VideoLesson` (duy nhất `(videoId, lessonId)`, `(videoId, position)`; `lessonSnapshotJson` chụp lúc chọn) ·
  `VideoScene` (duy nhất `(videoId, order)`; `contentHash`, `version`, `hidden`, `illustrationJson`) · `MediaAsset` · `RenderRecord`
  (`snapshotJson` + `snapshotHash` bất biến, `archiveIntentAt`; "lỗi thời" là suy ra `scriptVersion < Video.scriptVersion`, không lưu).
- **Tác vụ:** `JobRecord` (read model; duy nhất `bullmqJobId`) · `JobDispatch` (hàng outbox, duy nhất `jobRecordId`) · `AiRun` (chế độ,
  phiên bản prompt, hash đầu vào, đường dẫn đầu ra; không bí mật).
- **PDF:** `BookExtraction` (gắn `sourceHash`; trần/giữ chỗ/đã chi OCR bằng micro-USD nguyên; `canonicalPath`) · `ExtractionPage` (duy
  nhất `(extractionId, pageNumber)`; số trang PDF 1-based, không bao giờ là offset; `method` `TEXT`/`OCR`/`EMPTY`; `confidence` chỉ khi
  provider báo) · `OcrOperation` (duy nhất `requestKey`; ghi **trước** khi gửi; `chunkPlanJson`; `outputStoredAt` có trước `cleanedAt`).
- **NotebookLM:** `NotebookBinding` (duy nhất `(bookId, profile)`) · `NotebookSourceBinding` (duy nhất
  `(notebookBindingId, sourceKey, contentHash)`, bản cũ `supersededAt` nhưng giữ) · `ScriptDraftCache` (duy nhất `cacheKey`).
- **Sản xuất:** `ProductionBatch` (duy nhất `idempotencyKey`, `fingerprint`) · `ProductionItem` (duy nhất `(batchId, lessonId)`,
  `(batchId, position)`, `videoId`; một bài học = một item = một video; `lessonId` `Restrict`, `videoId` `SetNull`).
- **Lưu trữ:** `RenderArchive` (duy nhất `(renderId, provider, destinationKey)`) · `RenderArchiveFile` (duy nhất `(archiveId, kind)`;
  `remoteFileId` cấp trước, ghi một lần; path/bytes/sha256 cố định; checkpoint = token + số byte) · `ArchiveFolder` (duy nhất
  `(provider, destinationKey, path)`) · `OAuthAuthorization` (duy nhất `stateHash`) · `DriveUsageHour` · `DriveCapacity`.

Phần lớn trạng thái là `String`, tập giá trị khai báo trong `features/*/domain` (hoặc chú thích schema). Đường dẫn trong DB luôn tương
đối với `DATA_DIR`. Con trỏ lỏng không có quan hệ: `Video.latestRenderId`, `VideoScene.audioAssetId`, `RenderRecord.jobRecordId`.

```
JobRecord        QUEUED WAITING_FOR_CLI RUNNING COMPLETED FAILED CANCEL_REQUESTED CANCELLED
Chapter          NOT_ANALYZED QUEUED ANALYZING WAITING_FOR_CLI ANALYZED PARTIAL FAILED
Video            DRAFT NEEDS_REVIEW APPROVED
RenderRecord     QUEUED RENDERING COMPLETED FAILED CANCELLED
BookExtraction   xem §6.2
ExtractionPage   PENDING EXTRACTED NEEDS_OCR OCR_SUBMITTED FAILED
OcrOperation     PLANNED SUBMITTING SUBMITTED COMPLETED FAILED CANCELLED UNKNOWN_OUTCOME
ProductionItem   PENDING RUNNING WAITING COMPLETED FAILED CANCELLED   (+ checkpoint, §8.2)
ProductionBatch  QUEUED RUNNING COMPLETED PARTIAL FAILED CANCELLED    (suy ra từ item)
RenderArchive    PENDING RUNNING WAITING COMPLETED FAILED   · file: PENDING UPLOADING UPLOADED VERIFIED
Notebook*        PENDING CREATING|SUBMITTING UNKNOWN_OUTCOME READY (FAILED cho nguồn)
```

## 3. Vòng đời tác vụ

| Loại                    | Payload ngoài `jobRecordId`  | Ghi chú                                   |
| ----------------------- | ---------------------------- | ----------------------------------------- |
| `DIAGNOSTIC_PING`       | `kind` (`ping`/`notebooklm`) | `notebooklm` mở phiên, đọc hạn mức        |
| `ANALYZE_CHAPTER`       | `chapterId`, `force`         | v1.1, hoặc NotebookLM cho chương sách PDF |
| `GENERATE_VIDEO_SCRIPT` | `videoId`, `sceneId?`        | cả kịch bản hoặc viết lại một cảnh        |
| `GENERATE_SCENE_TTS`    | `sceneId`                    | BullMQ thử 2 lần, backoff 5 giây          |
| `RENDER_VIDEO`          | `renderId`                   | `runRender`                               |
| `EXTRACT_PDF`           | `extractionId`               | `runExtraction`, hoãn khi chờ             |
| `RUN_PRODUCTION_ITEM`   | `itemId`                     | `runProductionPipeline`, hoãn khi chờ     |
| `ARCHIVE_RENDER`        | `archiveId`                  | `runRenderArchive`, hoãn khi chờ          |

Payload chỉ chứa ID và metadata nhỏ (Zod: `jobs/schemas/job-payload.schema.ts`). Ngoài TTS, không loại nào được BullMQ thử lại.

### 3.1 Outbox

- `recordJobIntent` ghi `JobRecord(QUEUED)` + `JobDispatch(dispatchedAt = null, availableAt)` trong một giao dịch;
  `createJobIntentWithin(tx, …)` ghi job **cùng giao dịch** với thay đổi làm nó cần thiết (nhập PDF, tạo/thử lại item, tạo/thử lại
  archive, thử lại trích xuất).
- `dispatchJobIntent`: `queue.add(type, payload, { jobId: bullmqJobId })` rồi mới ghi `dispatchedAt`. Chết giữa hai bước → giao lại;
  BullMQ bỏ qua `jobId` trùng.
- Web v1.1 (`enqueueTrackedJob`): dùng lại job đang mở của cùng `(jobType, entity)`, ghi outbox, giao ngay; Redis từ chối thì xoá hàng,
  job `FAILED`, trả `503`. Job v1.2 chỉ ghi outbox, worker giao trong ≤ 5 giây.
- `sweepDueJobIntents` giao hàng chưa giao đã tới hạn; hàng của job không còn `QUEUED` bị xoá; payload hỏng → `FAILED`
  (`DISPATCH_FAILED`); Redis lỗi → ghi `lastError`, thử lượt sau.
- Ngoại lệ duy nhất gọi `queue.add` trực tiếp: `pnpm ai:run` requeue sau khi lưu `output.json`.

### 3.2 Dispatcher, hoãn, đối soát, huỷ

```
QUEUED ─► RUNNING ─┬─► COMPLETED | FAILED
                   ├─► WAITING_FOR_CLI ──(pnpm ai:run)──► QUEUED
                   ├─(deferred)──────────────────────────► QUEUED (bullmqJobId mới, availableAt)
                   └─► CANCEL_REQUESTED ──(AbortSignal)──► CANCELLED
QUEUED (còn trong outbox hoặc chờ trong BullMQ), WAITING_FOR_CLI ──huỷ──► CANCELLED
```

- `createJobDispatcher`: bỏ qua job đã huỷ, đánh `RUNNING`, chép tiến độ sang BullMQ và SQLite, thăm dò `CANCEL_REQUESTED` mỗi 2 giây để
  tạo `AbortSignal`. Lỗi → `FAILED` với mã ổn định (`AppError.code`, `INVALID_PAYLOAD`, `PROCESSOR_ERROR`).
- **Hoãn:** processor chờ việc từ xa trả `deferred(retryAfterMs)` thay vì ngủ. `rescheduleRunningJob` (một giao dịch) đưa job về `QUEUED`
  với **`bullmqJobId` mới** (BullMQ nuốt `add` trùng id của job đã xong) và đặt `availableAt`. Lịch nằm trong SQLite nên sống qua restart
  và Redis bị xoá. Job đã bị yêu cầu huỷ thì kết thúc huỷ thay vì đặt lịch.
- **Đối soát** (`reconcileJobRecords`): job chưa kết thúc, không còn hàng outbox chưa giao, mà mất khỏi Redis → `FAILED` (`JOB_LOST`) hoặc
  `CANCELLED` nếu đang chờ huỷ; BullMQ báo `completed`/`failed` → chép lại.
- `releaseJobEntity`: job huỷ/mất trả chương về trạng thái trước và đánh render đang chạy `FAILED`/`CANCELLED`. Archive, trích xuất và
  item sản xuất chỉ đổi khi **huỷ**; job mất thì sweep/reconcile cấp job mới và việc tiếp tục từ checkpoint.
- **Thử lại** (`retryJob`, chỉ `FAILED`/`CANCELLED`) luôn tạo tác vụ mới từ thực thể theo đường riêng của từng loại, giữ lịch sử lần lỗi.

### 3.3 Idempotency, khoá, thử lại tự động

BullMQ giao ít nhất một lần, nên mỗi processor bắt đầu từ trạng thái đã lưu: phân tích chương bỏ qua khi cùng hash đầu vào + prompt đã
xong (trừ `force`) và thay bài nháp AI cũ thay vì nhân; tác vụ CLI dùng lại `output.json`; TTS cache theo hash; render `COMPLETED` là
no-op; trích xuất, sản xuất và archive đi từ checkpoint; mọi đối tượng từ xa có khoá idempotency, dấu tiêu đề hoặc ID cấp trước.

`assertScriptNotGenerating()` được mọi service người dùng gọi để đổi video: `409 VIDEO_IN_PRODUCTION` khi video thuộc item chưa kết
thúc; `409 SCRIPT_GENERATION_IN_PROGRESS` khi còn job tạo kịch bản/viết lại cảnh của video (yêu cầu trùng đích nhận lại job đang chạy).
Worker ghi qua repository nên không bị khoá này chặn.

Lỗi tạm (`QUOTA`/`TRANSIENT`/`UNKNOWN_OUTCOME`) được hoãn theo `Retry-After`, nếu không thì 30 giây nhân đôi tới trần: trích xuất 30 phút,
tối đa 8 lần liên tiếp; sản xuất 10 phút, 5 lần; archive 30 phút, 8 lần. Bộ đếm về 0 khi có tiến triển; hết lượt thì dừng kèm lý do.
`AUTH`/`REJECTED` và mọi lỗi AI v1.1 không bao giờ tự thử lại.

## 4. AI và Claude

- `AiProvider` theo `AI_MODE`: `mock` (`MockAiProvider`, tất định, không mạng); `cli-task` (mặc định; `LocalCliTaskProvider` ghi tác vụ
  vào `ai-tasks/<taskId>/`, job `WAITING_FOR_CLI`, người dùng chạy `pnpm ai:run --job <id>`); `cli-auto` (tuỳ chọn;
  `AutomatedCliProvider` vẫn ghi đủ tệp nhưng worker gọi `askClaude()` ngay).
- Thư mục tác vụ: `input.json`, `prompt.md`, `schema.json` (JSON Schema draft-7 sinh từ chính schema Zod của đầu ra), `task.json`, rồi
  `output.json` (đã qua Zod) hoặc `output.raw.txt`. Loại: `chapter-analysis`, `video-script`, `scene-regeneration`, `scene-plan`.
- `askClaude()` là đường duy nhất tới Claude (dùng bởi `pnpm ai:run`, `AutomatedCliProvider`, `ClaudeScenePlanCompiler`): kiểm
  `claude auth status`; chạy `claude -p --output-format json --tools "" --strict-mcp-config --no-session-persistence --json-schema …` từ
  mảng đối số, prompt qua stdin; env bỏ `CLAUDECODE*`/`CLAUDE_CODE_*` (không lồng phiên) và `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`;
  timeout và huỷ → `SIGTERM`. Lỗi có mã ổn định (`AI_CLI_AUTH`, `AI_QUOTA_EXCEEDED`, `AI_CLI_TIMEOUT`, `INVALID_AI_OUTPUT`…).

Prompt có phiên bản; đổi chữ là tăng phiên bản:

```
chapter-analysis-v1               phân tích chương v1.1 (Claude)
video-script-v4                   kịch bản và viết lại cảnh v1.1 (Claude)
scene-plan-v4                     biên dịch kế hoạch cảnh khi sản xuất (Claude)
notebooklm-chapter-detection-v1   xác định chương sách PDF
notebooklm-lesson-extraction-v2   danh mục bài học sách PDF
notebooklm-script-draft-v3        bản thảo khi sản xuất; cũng là draftVersion của cache
```

**Kiểm soát nội dung:**

- Văn bản sách là dữ liệu không đáng tin, bọc trong khối dữ liệu (`prompts/untrusted-text.ts`); mỗi lần chỉ gửi một chương, một phần
  chương hoặc bài học đã chọn, không bao giờ cả sách.
- Bài học, lời dẫn, chữ trên màn hình luôn tiếng Việt; trích đoạn giữ nguyên ngôn ngữ gốc để còn đối chiếu với sách.
- Sai schema → `FAILED`, không lưu gì. Trích đoạn chỉ giữ khi tìm thấy thật trong văn bản chương (`verifyExcerpts`, `locateExcerpt`, không
  phân biệt khoảng trắng).
- **Bộ chặn khẳng định không có căn cứ** (`findUnsupportedClaims`): con số hay câu trích dẫn trong kế hoạch cảnh mà không có trong bản
  thảo hoặc bài học (so sau chuẩn hoá NFC, chữ thường, khoảng trắng, dấu thập phân) làm kế hoạch bị từ chối
  (`SCENE_PLAN_UNSUPPORTED_CLAIM`) và không được lưu. Đây là lưới an toàn cơ học, không chứng minh được sự trung thực.
- Hoạt cảnh chỉ nhận giá trị từ danh sách cố định, sinh vào prompt từ `videos/domain/illustration.ts`.
- `ClaudeScenePlanCompiler` đặt tên tác vụ theo hash đầu vào (`scene-plan-<sha256 24 ký tự>` của bản thảo, bài học, độ dài, ghi chú sửa,
  prompt) nên hỏi lại cùng đầu vào không tốn thêm lượt Claude; lỗi CLI quy về `IntegrationError` (`AUTH`, `QUOTA`, `REJECTED` cho đầu ra
  sai/thiếu CLI, `TRANSIENT`).
- Sản xuất hàng loạt chỉ chạy với `mock` hoặc `cli-auto`; `cli-task` bị từ chối (`AI_MODE_UNSUPPORTED`) vì không thể chờ người chạy
  `pnpm ai:run` cho từng video.

## 5. Luồng thủ công (v1.1)

- Nhập `.md/.txt`: tệp giữ tạm ở `imports/<id>/` để xem trước cách tách chương; xác nhận mới tạo sách. Tệp gốc ghi nguyên byte + SHA-256
  rồi đặt chỉ đọc. Parser chương dùng chung cho sách PDF.
- `ANALYZE_CHAPTER` → `AiProvider.analyzeChapter` → Zod → kiểm trích đoạn → thay bài nháp AI cũ; ghi `AiRun` và `output.json`.
  `GENERATE_VIDEO_SCRIPT` tạo 2–3 phương án hook + các cảnh từ snapshot bài học. Sửa kịch bản đã duyệt → `NEEDS_REVIEW`.
- `runSceneTts`: khoá `sha256(TTS_ENGINE_VERSION, giọng, tốc độ, lời dẫn)`, trúng thì chỉ gắn lại audio; nếu không, `edge-tts` (lời dẫn qua
  tệp, không qua dòng lệnh) → cắt lặng đầu/cuối bằng ffmpeg → đo bằng ffprobe → `videos/<videoId>/audio/<hash>.mp3` + `MediaAsset` (kèm
  `leadingSilenceMs`). Audio tải lên (MP3/WAV nhận bằng chữ ký byte, ≤ 120 giây mỗi cảnh) chỉ được đo, không bị sửa.

## 6. Trích xuất PDF

### 6.1 Nhập

`POST /api/books/import/pdf` nhận PDF thô làm thân request, ghi từng chunk ra `imports/<id>/` đồng thời băm SHA-256 (sách 500 MiB không
nằm trong RAM); chữ ký `%PDF-` kiểm trên byte thật; vượt `MAX_PDF_SIZE_MB` thì dừng; huỷ/lỗi xoá tệp dở. Thành công: đổi tên sang
`books/<bookId>/original.pdf` (chỉ đọc), tạo `Book` + `BookExtraction(QUEUED)` + job `EXTRACT_PDF` trong **một giao dịch**, trả `202`.
Trùng hash với sách có sẵn → `409 DUPLICATE_BOOK`.

### 6.2 Trạng thái

```
QUEUED → INSPECTING → EXTRACTING ─┬─(không trang nào cần OCR)──────────────► ASSEMBLING
                                  └─► OCR_PENDING ─┬─(mọi trang có kết quả)─► ASSEMBLING
                                                   └─(còn trang OCR lỗi)────► PARTIAL
ASSEMBLING ─┬─(parser cục bộ thấy chương)──────────────────────────────────► COMPLETED
            └─► DETECTING_CHAPTERS ─┬─(đề xuất NotebookLM qua kiểm tra)─────► COMPLETED
                                    └─(không có NotebookLM / bị từ chối)────► NEEDS_CHAPTERS
PDF mật khẩu / hỏng / quá MAX_PDF_PAGES / thiếu Poppler ─► FAILED (trước mọi dịch vụ trả phí); huỷ job ─► CANCELLED
```

`runExtraction` đi hết những bước làm được mà không phải chờ; mỗi bước đọc trạng thái đã lưu nên chạy lại không bao giờ đọc, gửi hay trả
tiền cho một trang hai lần. Chuyển trạng thái là `UPDATE` có điều kiện; tạo chương và chuyển `COMPLETED` nằm trong một giao dịch.

### 6.3 Lớp chữ và phân loại trang

Poppler (`server/pdf/poppler.ts`: `pdfinfo`, `pdftotext`, `pdfimages`, `pdfseparate`, `pdfunite`) chạy từ mảng đối số, chỉ với đường dẫn
tuyệt đối, env tối thiểu, timeout và huỷ được; lỗi được phân loại (`PDF_ENCRYPTED`, `PDF_CORRUPT`, `PDF_TOOL_MISSING`, `PDF_TOOL_TIMEOUT`)
mà không chép thông điệp của Poppler. `pdftotext` chạy một lần cho cả sách rồi tách trang theo form feed; `pdfimages -list` đếm hình.

`classifyPage` (thuần, chữ chuẩn hoá NFC): không chữ cái, không hình → `EMPTY` (trang trống hợp lệ, khác `FAILED`); < 20 chữ cái mà có
hình → OCR (scan); > 2 % ký tự chỉ có trong font TCVN3/VNI → OCR (font cũ); > 5 % ký tự thay thế/vùng riêng → OCR (lỗi mã hoá); còn lại
`TEXT`. Lý do OCR lưu bằng tiếng Việt trên từng trang vì OCR tốn tiền. Chạy lại không đặt lại trang đã gửi OCR, đã có kết quả hay đã lỗi.

### 6.4 OCR: chunk, ngân sách, lô

- **Chunk** (`buildOcrChunks`): trang cần OCR (không cần liên tiếp) được gom tới `limits.maxPages` của provider và dựng thành PDF riêng
  **kèm danh sách số trang gốc theo thứ tự**. Chunk vượt `limits.maxBytes` bị chia đôi tới khi vừa; một trang đơn vẫn vượt →
  `OCR_PAGE_TOO_LARGE`. Bản đồ lưu ở `OcrOperation.chunkPlanJson`; tệp chunk tạm dựng lại được từ bản đồ, xoá khi lô xong.
- **Ngân sách** (`planOcrOperation`, một giao dịch): `requestKey` lặp lại → trả operation cũ; chỉ **một** lô mở mỗi lần trích xuất; chặn
  khi `đã chi + đang giữ + ước tính > trần`; không đổi provider/model giữa chừng (`OCR_PROVIDER_CHANGED`). Khoá lô
  `<extractionId>-ocr-<n>` (n = số lô đã có) nên bước chạy lại sau sự cố dùng lại khoá. Trần được chép vào lần trích xuất lúc tạo; chỉ
  `setOcrCostCeiling` (người dùng) đổi được, không dưới khoản đã chi/giữ. `settleOcrOperation` tính số provider báo (không báo thì giữ
  khoản ước tính) hoặc nhả hết khi lỗi/huỷ; gọi lại không đổi gì.
- **Vòng đời lô:**

```
PLANNED → SUBMITTING → SUBMITTED → COMPLETED | FAILED | CANCELLED
              └─(mất phản hồi)─► UNKNOWN_OUTCOME ─findOperation(requestKey)─► SUBMITTED | PLANNED
```

`submitOcrOperation` ghi ý định (trang → `OCR_SUBMITTED`) **trước** khi gọi provider; `UNKNOWN_OUTCOME` giữ khoản giữ chỗ và được đối
soát trước, không bao giờ gửi lại mù. `AUTH`/`QUOTA`/`TRANSIENT` = chưa nhận, về `PLANNED`; `REJECTED` = trang `FAILED`, nhả giữ chỗ.
`collectOcrOperation` không chờ: `pending` → hoãn (60 giây đầu, sau đó theo provider); `completed` → lưu chữ → `outputStoredAt` → chốt
tiền → rồi mới `cleanup` phía provider; `expired` (provider không còn output) → lô coi như đã tính tiền, trang `FAILED` để gửi lại.

- **Gán kết quả** (`reconcileOcrResults`): mỗi trang đã gửi nhận đúng một kết quả qua `pageNumbers[i]` của chunk. Chunk thiếu, trả hai lần,
  sai/trùng chỉ số hay sai số trang làm **cả chunk** thất bại thay vì đoán rồi gán nhầm trang. Chỉ ghi vào trang đang chờ OCR nên không
  bao giờ đè trang có lớp chữ; `confidence` chỉ nhận số 0..1 provider báo.
- **Dừng chờ người dùng:** thiếu `MISTRAL_API_KEY`, vượt trần, khoá bị từ chối, lô bị huỷ phía provider, đổi model → giữ ở `OCR_PENDING`
  kèm lý do, lô mở và giữ chỗ còn nguyên. `retryExtraction` xoá lý do, đưa trang OCR lỗi về `NEEDS_OCR` và ghi job mới cùng giao dịch;
  PDF có mật khẩu/hỏng không thử lại được vì tệp gốc không đổi.

### 6.5 Adapter Mistral

`MistralBatchOcrProvider` trên client REST có kiểu (mọi phản hồi qua Zod; khoá API chỉ trong đối tượng client; signal đã huỷ thì không gửi):

- `start`: tìm job theo `metadata.request_key` trước mọi upload (tối đa 5 × 100 job mới nhất); thấy thì dùng lại. Nếu chưa: upload từng
  chunk (`purpose: ocr`, stream từ đĩa, tham chiếu bằng `file_id` nên không cần URL công khai), một JSONL (`custom_id` = `chunkId`), rồi
  tạo job. Tạo job mất phản hồi → **giữ** tệp đã upload (job có thể đang đọc chúng); lỗi chắc chắn → xoá.
- `poll` không chờ; kết quả trả theo chunk (khớp `custom_id`); chỉ số trang chỉ nhận khi liên tục `0..n-1` hoặc `1..n`; dòng JSONL hỏng →
  lỗi kèm số dòng, không trích nội dung (đó là văn bản sách); 404 → `expired`.
- `cleanup` xoá tệp yêu cầu **cuối cùng** vì chỉ nó cho biết id các PDF, nên dọn dở vẫn gọi lại được.
- HTTP 401/403 → `AUTH`, 429 → `QUOTA`, 5xx/timeout của lệnh ghi → `UNKNOWN_OUTCOME`, của lệnh đọc → `TRANSIENT`.

Model id, đơn giá, dạng tham chiếu tệp, dòng JSONL và cơ số trang chưa kiểm chứng: xem [operations.md](operations.md).

### 6.6 Tài liệu chuẩn và chương

- `assembleExtractionDocument` ghép văn bản các trang theo thứ tự (cách nhau `\n\n`, trang trống không chiếm chỗ) thành
  `extractions/<id>/canonical.md` kèm `pageOffsets` `[start, end)` đơn vị UTF-16 — cùng đơn vị với offset chương — để `pageAtOffset`
  đổi offset về trang PDF. Thiếu hay lỗi trang nào → `EXTRACTION_INCOMPLETE`, không ghi gì. Offset không lưu mà tính lại từ các trang.
- Chương: **cùng parser cục bộ** với sách Markdown chạy trên `canonical.md`. Không thấy ranh giới → `DETECTING_CHAPTERS`; không bao giờ lấy
  cả sách làm một chương.
- **Xác định chương bằng NotebookLM:** NotebookLM nhận một "dàn ý theo trang" (`buildChapterOutline`: mỗi trang `[Trang N]` + 160 ký tự
  đầu) cùng các dòng giống mục lục làm gợi ý, trả `[{title, startPage, endPage, startAnchor}]`. `verifyProposedChapters` chỉ chấp nhận khi
  **mọi** chương qua kiểm tra thuần: anchor (≥ 4 ký tự) có thật ở trang bắt đầu hoặc trang kế, chương bắt đầu ở đầu dòng của anchor;
  không bắt đầu ở trang mục lục (≥ 3 tiêu đề chương); thứ tự tăng; trong phạm vi sách; không chương nào phủ ≥ 90 % sách từ 20 trang trở
  lên. Phần đầu sách trước chương đầu không thuộc chương nào. Không đạt → `NEEDS_CHAPTERS` (`CHAPTER_DETECTION_REJECTED`), không tạo gì.

## 7. NotebookLM

### 7.1 Tiến trình và phiên

- Chỉ dùng khi `AI_MODE=cli-auto` và có `NOTEBOOKLM_PROFILE`; phân tích chương bằng NotebookLM chỉ cho sách PDF. Web không bao giờ khởi
  động máy chủ MCP.
- Worker chạy `uvx --from notebooklm-mcp-cli==0.15.8 notebooklm-mcp` qua `McpStdioClient` tối giản (JSON-RPC 2.0 theo dòng, không SDK):
  giao thức `2025-06-18` (nhận `2025-03-26`), `tools/list` đọc mọi trang, chỉ trả lời `ping` của máy chủ, thông điệp > 32 MiB thì dừng
  tiến trình, quá hạn/huỷ gửi `notifications/cancelled`. stderr giữ trong bộ đệm có giới hạn, không vào lỗi hay log. Env là danh sách cho
  phép (`PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `XDG_*`, `DBUS_SESSION_BUS_ADDRESS`, `UV_CACHE_DIR`); `NOTEBOOKLM_COOKIES` và khoá của
  ứng dụng không bao giờ được truyền.
- `NotebookLmSession.open` kiểm đủ công cụ, chuyển profile **chỉ cho tiến trình này** (`make_default: false`) rồi đọc lại profile đang
  dùng. Mỗi lời gọi được xét theo phong bì `{status: "success" | "error"}`, **không** theo `isError` (máy chủ báo lỗi với
  `isError: false`). Văn bản lỗi chỉ dùng để phân loại (`AUTH`, `QUOTA`, timeout, lỗi công cụ), không bao giờ được hiện ra. Công cụ thay
  đổi dữ liệu (`notebook_create`, `source_add`, `source_delete`, `profile`) quá hạn hay trả lời hỏng → `UNKNOWN_OUTCOME`.
- Một tiến trình MCP cho một lần chạy job: `NotebookLmScriptStudio` mở phiên ở lời gọi đầu, đóng trong `finally`; lúc đóng đọc `usage_get`
  và ghi `data/integrations/notebooklm-status.json` (phần trăm — vắng là "không rõ", không phải 0 —, giờ đặt lại, gói; không cookie).

### 7.2 Notebook và nguồn

- Một notebook mỗi `(bookId, profile)`, tạo **một lần** với tiêu đề `Book Video Studio · <sách> [bvs:<bindingId>]`. Mỗi phần văn bản
  (`sourceKey`) ở mỗi phiên bản (`contentHash`) là một nguồn văn bản có dấu `[bvs:<id>]`; văn bản đổi → dòng mới, bản cũ `supersededAt`
  nhưng giữ ID từ xa để còn truy nguồn bài học cũ.
- Tạo mất phản hồi → `UNKNOWN_OUTCOME`; lần sau **tìm dấu** trong `notebook_list`/`notebook_get` trước rồi mới tạo lại, nên không sinh bản
  thứ hai. ID từ xa ghi một lần.
- Câu hỏi luôn truyền **`source_ids` tường minh** (chỉ phiên bản hiện hành) trong hội thoại mới, vì NotebookLM mặc định dùng mọi nguồn của
  notebook. `SourceRef.remoteId` = `<notebookId>#<sourceId>`, mờ với bên gọi. Câu trả lời phải là JSON đúng schema; sai thì từ chối, không vá.

### 7.3 Danh mục bài học theo phần

`runNotebookChapterAnalysis` lấy văn bản chương từ tài liệu chuẩn (PDF gốc không được đọc lại), cắt thành phần ≤ 40.000 ký tự ở ranh giới
đoạn (`chapterPartDocuments`). Mỗi phần là nguồn `chapter:<id>:part:<n>` có `[Trang N]` đầu mỗi trang và một câu hỏi riêng (liệt kê
**mọi** bài học, trích nguyên văn, đánh dấu tình huống tự nghĩ). Bài trùng tiêu đề giữa các phần được gộp (`mergeLessonCandidates`).
Trang lưu cho trích đoạn là trang **nơi tìm thấy** nó (`page:<n>;offset:<k>`), không phải trang mô hình khai. Phần trả `complete: false` →
chương `PARTIAL`; sai định dạng → `FAILED`, không lưu gì. Mỗi lần chạy thay bài nháp AI cũ của chương và ghi `AiRun(mode=notebooklm)`.

### 7.4 Bản thảo và cache

- `writeDraft` đọc mọi phần của mọi chương bài học trích dẫn (`resolveLessonSources`, cùng khoá với lúc lập danh mục nên không tải lại).
  Prompt ép mạch kể HOOK → tình huống → sai lầm → bài học → giải quyết → hành động, hook < 4 giây, ngân sách số từ theo preset, trích đoạn
  tách khỏi lời dẫn, tình huống tự nghĩ đánh dấu `illustrative`. Sai định dạng hay sai thứ tự → `DRAFT_INVALID` (`REJECTED`).
- `ScriptDraftCache.cacheKey` = sha256(provider, `draftVersion`, bài học + `contentHash`, preset, **tập** remote ID nguồn, ghi chú sửa).
  Bước bản thảo hỏi cache trước; trượt thì gọi NotebookLM rồi lưu ngay; bản lưu không còn hợp lệ bị bỏ qua.

## 8. Pipeline sản xuất

### 8.1 Yêu cầu

`requestProduction` (`POST /api/productions`): mọi bài học cùng sách, không `ARCHIVED`, có ít nhất một trích đoạn. Một **nested create**
ghi batch + mỗi bài một item + một `Video` (kèm snapshot `VideoLesson` từ `buildLessonSnapshot`, dùng chung với luồng thủ công) + job
`RUN_PRODUCTION_ITEM` qua outbox — đủ cả hoặc không gì. Chọn không phải duyệt: không đòi `APPROVED`, không đổi trạng thái bài học. Cùng
`idempotencyKey` + cùng `fingerprint` (sách, bài học theo thứ tự, preset) → trả batch cũ; cùng khoá khác nội dung → `409`; gửi đua → một
batch (bên thua bắt `P2002`).

### 8.2 Checkpoint, trạng thái, lease

```
checkpoint: NONE ─draft─► DRAFTED ─compile─► COMPILED ─apply─► APPLIED ─voice─► VOICED ─readiness─► READY ─render─► RENDERED
             ▲              ▲                                                     │
             └──────────────┴── một lượt sửa AI lùi về NONE (nội dung/nguồn) hoặc DRAFTED (biên dịch/độ dài)

status:     PENDING ─claim─► RUNNING ─┬─► COMPLETED
               ▲                      ├─(deferred)─► WAITING ─► RUNNING (cùng job quay lại)
               └────── retry ─────────┴─► FAILED | CANCELLED
```

- `status` tách khỏi `checkpoint` (bước cuối đã xong) nên khởi động lại tiếp tục sau bước đã làm.
- `claimProductionItem`: lease nguyên tử 10 phút bằng một `UPDATE … WHERE`; chỉ người giữ gia hạn/nhả; lease hết thì nhận lại được; item đã
  kết thúc không bao giờ được trao lại. Gặp item còn bị giữ (worker trước chết) → hoãn tới lúc lease hết.
- Một job đi nhiều bước liên tiếp và **không bao giờ chờ**: render đang chạy (kiểm lại sau 15 giây) hay lỗi tạm → `deferred`, item
  `WAITING`. Mọi bước ghi bằng CAS trên `(itemId, claimToken, checkpoint)`.
- `createPipelineDeps`: `cli-auto` + profile → `NotebookLmScriptStudio` + `ClaudeScenePlanCompiler`; `mock` → hai bản mock; `cli-auto` thiếu
  profile → `SCRIPT_STUDIO_NOT_AVAILABLE`.

### 8.3 Các bước

- **Bản thảo** (`NONE`): nguồn → cache → `writeDraft` → artifact `script-draft-v1` trên item. **Biên dịch** (`DRAFTED`):
  `ScenePlanCompiler.compile` → artifact `scene-plan-v1`. Hai artifact không bao giờ trộn (`server/scene-plan/handoff.ts`), mỗi cái có
  `schemaVersion` và `fingerprint`: bản thảo = nội dung + `contentHash` bài học + độ dài; kế hoạch = nội dung + **fingerprint bản thảo** +
  phiên bản prompt + độ dài. Đọc lại luôn kiểm fingerprint. Bản thảo không bao giờ ghi vào `output.json` của tác vụ Claude.
- **Áp dụng** (`COMPILED`, `applyScenePlan`): giao dịch mà câu lệnh đầu là `UPDATE` có điều kiện (đúng người giữ, ở `COMPILED`) — lấy khoá
  ghi trước khi đọc (tránh nâng cấp khoá của SQLite WAL) và chỉ một người thắng — rồi ghi cảnh qua `replaceScriptWithin`, **cùng đường
  ghi** với luồng thủ công, và lưu `appliedPlanFingerprint`. Áp lại cùng kế hoạch → `ALREADY_APPLIED`, giữ nguyên cảnh và audio.
- **Lồng tiếng** (`APPLIED`): từng cảnh, đúng thứ tự, qua `runSceneTts` (có cache; edge-tts là dịch vụ trực tuyến nên không gọi song
  song). Dừng sớm giữ audio đã tạo; chỉ chuyển `VOICED` khi mọi cảnh có audio, nên lần sau tiếp tục từ cảnh đầu còn thiếu.
- **Readiness** (`VOICED`, `assessReadiness`) thay cho duyệt tay: mọi quy tắc chặn của preflight FINAL (§9.3) trên audio thật, cộng
  `AUDIO_NOT_READY` và `SOURCE_MISSING`; báo mọi vấn đề một lượt. Đạt → ghi `autoReadyScriptVersion = scriptVersion` bằng CAS (kịch bản
  đổi trong lúc kiểm → `SCRIPT_CHANGED`). Không giả duyệt: `Video.status` vẫn `NEEDS_REVIEW`; sửa sau đó tăng `scriptVersion` nên
  readiness tự hết hiệu lực.
- **Render** (`READY`, `queueFinalRender`): chụp snapshot, dùng lại render FINAL đã xong cùng `scriptVersion` hoặc đang chạy; nếu không thì
  preflight rồi tạo `RenderRecord` + job qua outbox (không qua `requestRender` của web vì nó bị khoá `VIDEO_IN_PRODUCTION`).

### 8.4 Một lượt sửa AI mỗi video

`planCorrection` gửi vấn đề tới đúng bước sửa được: `SOURCE_MISSING`, `DRAFT_INVALID` → script studio (lùi về `NONE`); `OVER_TARGET`,
`OVER_MAX`, `HOOK_TOO_LONG`, `HOOK_MISSING`, `NO_SCENES`, `EMPTY_TEXT`, `INVALID_AI_OUTPUT`, `SCENE_PLAN_UNSUPPORTED_CLAIM` → compiler
(lùi về `DRAFTED`); có cả hai thì chọn bước sớm hơn. Mã khác (`AUDIO_NOT_READY`, `SCRIPT_CHANGED`…) không sửa được và không tiêu lượt.
Ghi chú (≤ 600 ký tự, lời của hệ thống) luôn dặn rút gọn thay vì tăng preset hay đọc nhanh; code không bao giờ đổi `targetDurationSec` hay
tốc độ TTS. Tiêu lượt là một `UPDATE` có điều kiện (`aiCorrectionTarget` còn trống): đúng một lời gọi thắng, còn lại → item `FAILED`
(`PRODUCTION_CORRECTION_EXHAUSTED`).

### 8.5 Lỗi, huỷ, thử lại

Lỗi tạm → hoãn (§3.3); `REJECTED` sửa được → lượt sửa; `AUTH`, `REJECTED` khác, `AppError` → `FAILED` kèm mã; lỗi bất ngờ →
`PRODUCTION_STEP_ERROR` để item không bao giờ "đang chạy" mà không có job. Huỷ (theo đợt hoặc `itemId`, hay huỷ job) → `CANCELLED`, dừng
job và render đang xếp; bước đang chạy làm xong nhưng không bước nào sau đó bắt đầu. Thử lại đưa item về `PENDING` từ checkpoint cũ (lượt
sửa AI vẫn đã dùng) với job mới cùng giao dịch. Trạng thái batch tính lại từ item (`deriveBatchStatus`).

## 9. Render

### 9.1 Props, thời lượng, phụ đề

- `toCompositionProps()` là nơi duy nhất biến video thành props cho composition `ShortVideo`; Player trong trình duyệt và render trong
  worker dùng chung nó và `shortVideoPropsSchema`. `src/remotion/**` là React thuần: không `process.env`, DB hay mạng; 5 bố cục; font Be
  Vietnam Pro đóng gói trong `public/fonts`.
- Độ dài cảnh = `ceil((durationMs + SCENE_AUDIO_PADDING_MS) / 1000 × 30)` theo audio thật; tối thiểu 2 giây mỗi cảnh; trước khi có audio,
  ước lượng 4 âm tiết/giây. Không bao giờ cắt lời hay tăng tốc để vừa preset.
- Phụ đề (`buildCaptionCues`): tách theo dấu câu, mỗi cụm ≤ 9 từ, thời gian chia theo số âm tiết.
- Audio được phục vụ cho Chromium bởi asset server tạm ở `127.0.0.1:<cổng ngẫu nhiên>`, chỉ đúng các tệp snapshot nêu.
- `RENDER_TEMPLATE_VERSION` (hiện `short-video-template-v2`) ghi vào mọi snapshot; tăng khi thay đổi Remotion làm cùng props trông khác.
- Vùng an toàn chỉ là lớp phủ trong editor, không vào MP4.

### 9.2 Snapshot và `runRender`

- `captureRenderSnapshot` chụp lúc **yêu cầu** render: cảnh (lời dẫn, chữ, bố cục, thời lượng, ẩn/hiện, hoạt cảnh), audio theo đường dẫn lưu
  (tên theo hash nội dung nên byte không đổi) kèm độ lặng đầu, nguồn bài học, kích thước/chất lượng, `scriptVersion`, cổng duyệt
  (`status`, `autoReady`), template. Lưu `snapshotJson` + `snapshotHash` (sha256 JSON khoá sắp xếp), **không bao giờ ghi đè**. Khi đọc phải
  đúng schema và hash (`RENDER_SNAPSHOT_CORRUPT`); audio đã mất → `RENDER_AUDIO_MISSING`. ESLint cấm `render-runner.ts` đọc video sống.
- **Pha render** (`produceRender`, trọn hoặc không gì): preflight trên snapshot → `renderMedia` → ffprobe kiểm H.264/AAC, kích thước, FPS,
  thời lượng → `COMPLETED`, cùng câu lệnh đặt `archiveIntentAt` cho FINAL. Lỗi/huỷ trong pha này xoá tệp dở. **Pha sau** chỉ báo tiến độ;
  lỗi ở đó không bao giờ xoá MP4 hay lật trạng thái. Render đã `COMPLETED` chạy lại là no-op.
- `renderShortVideo`: bundle một lần mỗi tiến trình worker; H.264 + AAC (track im lặng khi không có lời), `yuv420p`, BT.709,
  `concurrency = RENDER_CONCURRENCY`; bản nháp dùng `scale = 720/1080` trên cùng composition 1080×1920; ghi `*.part.mp4` rồi đổi tên.
  MP4 cũ không bao giờ bị xoá tự động.

### 9.3 Preflight

```
chặn mọi bản        NO_SCENES, HOOK_MISSING (cảnh đầu phải là HOOK hiển thị), EMPTY_TEXT, OVER_MAX (> 300 giây)
chặn FINAL          HOOK_TOO_LONG (> 120 frame), OVER_TARGET, SCRIPT_NOT_APPROVED (không APPROVED và không autoReady)
cảnh báo            HOOK_SILENCE (> 500 ms lặng đầu), LONG_TEXT, MISSING_AUDIO
```

### 9.4 Hoạt cảnh SVG

`src/remotion/illustration/`: 7 bối cảnh × 8 hành động của một nhân vật (danh sách ở `videos/domain/illustration.ts`). Mọi chuyển động là
hàm của frame nên preview, nháp và bản cuối giống hệt; không `filter`/blur (chậm khi rasterise trong Chromium headless), không ảnh, không
ngẫu nhiên (có test kiểm). Một nhân vật mỗi video, ngoại hình chọn theo tiêu đề nên render lại vẫn như cũ. `illustrationJson` null = mặc
định theo loại cảnh; hash cảnh chỉ tính hoạt cảnh khi có lựa chọn nên cảnh và snapshot cũ giữ hash. Đổi hoạt cảnh làm render cũ lỗi thời
nhưng giữ giọng đọc.

## 10. Lưu trữ lên Google Drive

### 10.1 Luồng

```
render FINAL COMPLETED + archiveIntentAt ─► requestRenderArchive | sweepRenderArchives (khởi động + mỗi phút)
  ─► RenderArchive + 3 RenderArchiveFile + job ARCHIVE_RENDER (một giao dịch, tài khoản đang kết nối)
  ─► dựng script/manifest ─► prepareDestination ─► upload MP4 → script → manifest ─► verify ─► COMPLETED khi cả ba VERIFIED
```

- Archive tách khỏi render: lỗi lưu trữ không đổi render hay MP4; lưu lại không cần render lại. `destinationKey` = `permissionId` của tài
  khoản. Chưa kết nối Drive → không làm gì, ý định vẫn nằm trên render. Processor **chỉ upload**, không render, lồng tiếng hay gọi AI.
- `script.json` và `manifest.json` (thông số render, phiên bản template/snapshot, `snapshotHash`, tên + byte + SHA-256 của MP4 và script,
  audio theo `contentHash`) dựng **chỉ từ snapshot**, không chứa đường dẫn local, là JSON khoá sắp xếp nên dựng lại ra cùng byte. Tệp
  local cố định (path, bytes, sha256) khi giao cho archive; đổi nội dung sau khi bắt đầu upload → `ARCHIVE_LOCAL_FILE_CHANGED`.
- Cây Drive: `Book Video Studio/books/<bookId>/videos/<videoId>/renders/<renderId>/` với
  `video_s<scriptVersion>_<renderId>_<w>x<h>.mp4`, `script.json`, `manifest.json`.
- Lỗi chờ được → `WAITING` + hoãn; quyền, Drive đầy, tệp đổi → `FAILED` ngay; kết nối đổi tài khoản → `ARCHIVE_DESTINATION_CHANGED`; huỷ
  → `FAILED`, không đè archive đã xong. Thử lại (`POST /api/renders/:id/archive`) dùng lại thư mục, ID tệp, checkpoint và tệp đã xác minh;
  thư mục render bị xoá trên Drive → dựng lại; bản sao không khớp → tệp chưa xác minh nhận ID mới. Ứng dụng không bao giờ xoá gì trên Drive.

### 10.2 OAuth và credential

- OAuth client **Desktop app** của người dùng, chỉ quyền `drive.file`, PKCE `S256`; `OAuthAuthorization` lưu **hash** của state, verifier,
  redirect URI, hạn 10 phút. Redirect loopback `http://127.0.0.1:<cổng>` không path; Google trả về trang gốc và trang này chuyển tiếp tới
  `/api/integrations/drive/callback`.
- Callback **tiêu state trước mọi việc** bằng `UPDATE` có điều kiện ở đầu giao dịch (hai callback đua → chỉ một tới Google), đổi mã với
  verifier, đòi `drive.file` trong scope trả về và có refresh token, đọc `about.get` (`permissionId`, email). Chỉ ghi credential khi mọi
  bước thành công.
- Token chỉ ở `data/credentials/google-drive.json` (`0600`, ghi nguyên tử), không trong SQLite; DTO chỉ có trạng thái, email, thời điểm.
- `DriveAccessToken`: làm mới khi còn < 1 phút (đồng thời chỉ một yêu cầu), `invalidate()` sau 401; `invalid_grant` → `NEEDS_RECONNECT`
  và các lần sau báo `DRIVE_RECONNECT_REQUIRED` không hỏi Google. Ghi lại credential chỉ khi vẫn cùng lần đăng nhập (`connectedAt`), nên
  một lần làm mới muộn không hồi sinh kết nối đã ngắt. Ngắt kết nối thu hồi refresh token, xoá credential local kể cả khi không tới được
  Google, không xoá gì trên Drive.
- `sendGoogleRequest` chỉ giữ mã lý do ngắn của Google, không chép body hay URL vào lỗi.

### 10.3 Thư mục, upload, xác minh, hạn mức

- **ID cấp trước:** một `files.generateIds` cho thư mục thiếu + 3 tệp; ID được **ghi vào bảng trước** (ghi một lần; bên thua cuộc đua nhận
  ID bên thắng) rồi mới tạo thư mục với chính ID đó; Drive trả `409` cho lần tạo lặp nên mất phản hồi không sinh bản thứ hai. Không bao
  giờ tìm kiếm Drive. Thư mục bị xoá → `404` → bỏ ràng buộc từ đó trở xuống và dựng lại.
- **Upload có thể tiếp tục** (`DriveResumableUpload`): phiên `uploadType=resumable` vào ID tệp đã cấp, chunk bội 256 KiB (mặc định 8 MiB)
  bằng một buffer dùng lại. Tiến độ chỉ là số byte Google xác nhận (`Range` của `308`); 3 chunk không tiến → `DRIVE_UPLOAD_STALLED`.
  Session URI coi như credential: chỉ nằm trong checkpoint, xoá khi tệp xong. Có checkpoint thì hỏi trạng thái trước: `308` → gửi tiếp,
  `200/201` → xong, `404` → phiên mới cùng ID tệp; mở phiên bị `409` → tệp đã có. `fetch` dùng `redirect: "manual"` để `308` không bị
  hiểu là chuyển hướng.
- **Xác minh:** `files.get` (`size`, `md5Checksum`, `sha256Checksum`, `trashed`) so với tệp local băm một lượt; chưa có checksum →
  `DRIVE_CHECKSUM_PENDING` (tạm) chứ không tin chỉ kích thước.
- **Hạn mức:** `DriveRequestMeter` ghi sổ theo giờ (`DriveUsageHour`) **chỉ những gì ứng dụng gửi** và từ chối (`QUOTA`,
  `DRIVE_APP_DAILY_LIMIT`, kèm thời gian chờ) khi vượt cửa sổ 24 giờ trượt (mặc định 5.000 yêu cầu, 10 GiB); giãn tối đa 1 giây giữa hai
  yêu cầu. Dung lượng ≠ quota API: `storageQuotaExceeded` là `REJECTED`, các lý do rate-limit và 429 là `QUOTA`. `DriveCapacityGuard`
  (cache `DriveCapacity`, làm mới tối đa mỗi giờ) từ chối upload **mới** không vừa trước khi gửi byte nào. UI chỉ đọc bảng local.

Mã hoá checksum của Drive và redirect loopback không path chưa kiểm chứng: xem [operations.md](operations.md).

## 11. Port, DTO và đổi nhà cung cấp

Bốn port trong `src/server/`; service nhận port qua tham số, factory chọn implementation; không plugin framework, DI container hay workflow DSL.

- **`OcrProvider`** (`ocr/`): `limits`, `estimateCostUsd`, `start` (idempotent theo `requestKey`; xong ngay hoặc operation chờ), `poll` (không
  chờ: `pending`/`completed`/`failed`/`cancelled`/`expired`), `findOperation`, `cancel`, `cleanup` (chỉ sau khi đã lưu output). Thật:
  `MistralBatchOcrProvider` qua `createOcrProvider()`.
- **`ScriptStudioProvider`** (`script-studio/`): `ensureSource`, `detectChapters`, `extractLessons`, `writeDraft`, `draftVersion`. Thật:
  `NotebookLmScriptStudio`; mock: `MockScriptStudioProvider`.
- **`ScenePlanCompiler`** (`scene-plan/`): `compile(draft, lesson, preset, revisionNote)` → `ScenePlan` (Zod, gồm thứ tự mạch kể). Thật:
  `ClaudeScenePlanCompiler` qua `createScenePlanCompiler()`; mock: `MockScenePlanCompiler`.
- **`VideoArchiveProvider`** (`archive/`): `prepareDestination` (ID cấp trước), `upload` (theo checkpoint, không tạo bản thứ hai), `verify`.
  Thật: `GoogleDriveArchiveProvider` qua `createDriveArchiveProvider()`.

DTO của port không mang khái niệm nhà cung cấp; `operationRef`, `SourceRef.remoteId`, checkpoint token là chuỗi mờ, lưu được, không chứa
credential. Mọi lời gọi nhận `signal`; signal đã huỷ phải làm lời gọi thất bại trước khi gây tác dụng từ xa. Lỗi là `IntegrationError`
(`server/integrations/`):

```
AUTH             sai hoặc hết đăng nhập                 → dừng, chờ người dùng
QUOTA            hết hạn mức, có thể kèm retryAfterMs   → hoãn
TRANSIENT        lỗi tạm, chưa có tác dụng từ xa         → hoãn rồi gửi lại
REJECTED         bị từ chối, gửi lại vẫn lỗi            → dừng (hoặc lượt sửa AI nếu sửa được)
UNKNOWN_OUTCOME  có thể đã thực hiện                    → đối soát trước khi gửi lại
```

Mỗi port có một bộ contract dùng chung (`tests/helpers/contracts/`) chạy với fake (`tests/helpers/fakes/`) và với adapter thật trên fake
HTTP/MCP. **Đổi nhà cung cấp:**

- _OCR:_ hiện thực `OcrProvider`, chạy bộ contract với nó, chọn trong `createOcrProvider()`. Lần trích xuất đang mở lô của provider cũ dừng
  với `OCR_PROVIDER_CHANGED` thay vì tự đổi; trang đã có chữ không bị đọc lại.
- _Script studio:_ hiện thực `ScriptStudioProvider` + contract, chọn trong `createPipelineDeps` và nơi tạo `NotebookLmScriptStudio` (bộ xác
  định chương, phân tích chương). Đổi `draftVersion` khi prompt đổi để cache không trả bản cũ.
- _Compiler / nơi lưu trữ:_ hiện thực `ScenePlanCompiler` / `VideoArchiveProvider` + contract; Remotion và pipeline sản xuất không đổi.

## 12. Lưu trữ cục bộ và bảo mật

```
DATA_DIR/                     mặc định ./data; bị từ chối nếu nằm dưới /mnt/
  studio.db                   theo DATABASE_URL mặc định
  imports/<id>/               tệp đang tải hoặc xem trước (tạm)
  books/<bookId>/             original.<md|txt|pdf> (chỉ đọc), chapters/<chapterId>.md,
                              extractions/<id>/canonical.md, extractions/<id>/ocr/<requestKey>/ (tạm)
  ai-tasks/<taskId>/          tệp tác vụ AI và đầu ra thô
  videos/<videoId>/           audio/<contentHash>.<mp3|wav>, renders/<renderId>-<draft|final>.mp4, -script.json, -manifest.json
  integrations/               notebooklm-status.json
  credentials/                google-drive.json (0600, thư mục 0700)
  diagnostics/
```

- Mọi đường dẫn đi qua `server/storage/safe-path.ts`: chặn `..`, đường dẫn tuyệt đối và symlink thoát khỏi `DATA_DIR`. Thư mục đặt theo
  ID, không theo tên sách; DB chỉ lưu đường dẫn tương đối. Ghi tạm rồi đổi tên; tệp gốc của sách ở chế độ chỉ đọc.
- Upload kiểm đuôi, chữ ký byte và kích thước. Tiến trình con chỉ chạy bằng mảng đối số; env được làm sạch (Claude) hoặc theo danh sách
  cho phép (MCP, Poppler).
- Khoá Mistral chỉ trong đối tượng client; token Google chỉ trong tệp credential; session URI chỉ trong checkpoint; cookie NotebookLM
  không bao giờ được truyền. Thông điệp của nhà cung cấp và công cụ (có thể chứa đường dẫn, cookie, văn bản sách) không vào lỗi hay log;
  log là JSON chỉ có ID và hash. Chỉ lắng nghe `127.0.0.1`, không xác thực. Quy tắc đầy đủ: [AGENTS.md §10](../AGENTS.md).

## 13. Kiểm thử

- **Unit** (`tests/unit`): domain thuần (parser, phân loại trang, chunk, tài liệu chuẩn, xác định chương, preflight, readiness, mạch kể,
  sửa AI…), Zod, safe-path, prompt, client Mistral/Google, hoạt cảnh; **contract** của từng port (`tests/unit/integrations/`).
- **Integration** (`tests/integration`): service + repository trên SQLite tạm với migration thật (`setupTestEnvironment`), processor, outbox
  với BullMQ thật (Redis DB 13), Poppler thật, các tình huống lỗi và tranh chấp.
- **E2E** (Playwright, `tests/e2e`): E2E-01 `smoke.spec.ts` (luồng thủ công tới ffprobe MP4) và E2E-02 `pdf-production.spec.ts` (PDF →
  chương → danh mục → chọn bài → sản xuất → Drive giả, không bước duyệt). Stack riêng (`start-stack.ts`): DB và `DATA_DIR` tạm, Redis DB
  14 (xoá mỗi lần), worker, `next start` cổng 3100, fake Google đã kết nối sẵn, fake edge-tts; dùng lại Chromium của Remotion.
- **Không test nào chạm tài khoản thật:** `OFFLINE_INTEGRATIONS_ENV` (`AI_MODE=mock`, xoá khoá Mistral/Google và profile NotebookLM,
  Mistral trỏ tới cổng không ai nghe) đè `.env` của máy dev; test cần tích hợp tự dựng fake (Mistral, Google, máy chủ MCP, Claude CLI,
  edge-tts sinh MP3 thật, PDF dựng tay ở `pdf-fixtures.ts`).
- Bộ cần Redis hoặc Poppler tự báo skipped khi thiếu (`TEST_POPPLER_BIN_DIR` khi Poppler ngoài PATH); `server-only` được alias sang stub.

## 14. Các quyết định chính

- **Hai tiến trình, một queue, concurrency 1** — render, TTS, AI chiếm CPU/RAM hàng phút; tách khỏi web để UI luôn phản hồi; một người dùng
  trên máy yếu với quota AI hạn chế.
- **SQLite + WAL** — một người dùng, cục bộ; sao lưu chỉ là sao chép một thư mục.
- **BullMQ thực thi, `JobRecord` là read model, đối soát khi khởi động** — UI đọc nhanh từ SQLite; Redis bị xoá hay worker chết vẫn được sửa lại.
- **Outbox `JobDispatch`** — job ghi cùng giao dịch với thay đổi nghiệp vụ; chết giữa SQLite và Redis không làm mất job.
- **Hoãn qua outbox, không ngủ trong worker** — lô OCR chạy hàng giờ; worker concurrency 1 không được bị giữ; lịch sống qua restart.
- **Claude chỉ qua CLI của người dùng, `cli-task` mặc định** — không API key; mỗi lần gọi do người dùng chủ động trừ khi họ bật `cli-auto`.
- **Mỗi tích hợp một port, ngoài `AiProvider`** — đổi nhà cung cấp không đụng nghiệp vụ; chi tiết Batch, MCP, OAuth nằm kín trong adapter.
- **`UNKNOWN_OUTCOME` + đối soát theo khoá, dấu tiêu đề, ID cấp trước** — mất phản hồi không dẫn tới trả tiền hai lần hay tạo bản trùng.
- **Lớp chữ trước, OCR chỉ trang cần, lỗi PDF báo trước dịch vụ trả phí** — OCR tốn tiền.
- **Trần OCR chép vào lần trích xuất, một lô mở, micro-USD** — đổi cấu hình không âm thầm nâng chi tiêu; đối soát đơn giản; so trần không
  lệch số thực.
- **Offset UTF-16 + bản đồ trang tính lại** — cùng đơn vị với `text.slice`, không có hai nguồn sự thật.
- **Không nhận "cả sách là một chương"; đề xuất chương phải khớp anchor** — sách dài thành một chương cho bài học vô nghĩa; mô hình có thể
  bịa ranh giới.
- **NotebookLM đọc theo phần với `source_ids` tường minh; trang lấy nơi tìm thấy** — chương dài cần chia; không lẫn nguồn cũ; không tin số
  trang mô hình khai.
- **Chọn bài học ≠ duyệt; readiness do máy kiểm sau khi có audio** — sản xuất hàng loạt không có người duyệt; thời lượng thật chỉ biết sau TTS.
- **Một lượt sửa AI, không nâng preset hay đọc nhanh** — giới hạn chi phí và vòng lặp; video không vừa thì thất bại rõ ràng.
- **Hai artifact tách có fingerprint, cache bản thảo** — Claude lỗi không tốn lại NotebookLM; nháp không lẫn kết quả cuối.
- **Snapshot render bất biến** — sửa video trong lúc render chờ không trộn vào; manifest Drive đúng với MP4.
- **Render hai pha, ý định lưu trữ ghi cùng `COMPLETED`** — lỗi báo tiến độ không xoá được MP4; lưu trữ sống qua mọi sự cố hàng đợi.
- **Một composition và một hàm props cho Player và render** — bản xem trước là bản sẽ render.
- **Asset server cục bộ khi render** — Chromium cần URL; chỉ phục vụ đúng tệp của snapshot, không lộ `data/`.
- **Hoạt cảnh SVG theo frame, không filter/ảnh/ngẫu nhiên** — preview và render giống hệt; nhẹ cho CPU yếu.
- **Lưu trữ tách khỏi render, ID cấp trước, không tìm kiếm Drive** — lỗi Drive không đụng MP4; thử lại nhắm đúng đối tượng mà không đoán
  theo tên.
- **Token Google trong tệp `0600`, không trong SQLite** — bản sao DB, chẩn đoán và DTO không chứa token.
- **Sổ quota Drive và cache dung lượng cục bộ** — worker không chờ quota; UI không gọi Google; chỉ đếm việc của ứng dụng.
- **Trạng thái kiểu `String`** — thêm giá trị không cần migration SQLite.
