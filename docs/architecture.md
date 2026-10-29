# Kiến trúc Book Video Studio

Tài liệu thiết kế kỹ thuật duy nhất, mô tả **trạng thái hiện tại của mã**. Tài liệu liên quan:

- [requirements.md](requirements.md): phạm vi sản phẩm, luồng người dùng, quy tắc nghiệp vụ và video, nghiệm thu, hiện trạng.
- [operations.md](operations.md): cài đặt, `.env`, bảng mã lỗi, hạn mức, khôi phục, giới hạn, giả định nhà cung cấp chưa kiểm chứng.
- [AGENTS.md](../AGENTS.md): quy tắc kỹ thuật, sơ đồ mã `src/`, lệnh, quy ước. [README.md](../README.md): giới thiệu, chạy nhanh.

Mistral OCR, NotebookLM và Google Drive đã có trong mã, được kiểm thử với fake cục bộ, nhưng **chưa chạy với tài khoản thật**.

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

- **Web:** Zod → service → repository; việc dài chỉ được ghi thành tác vụ, trả `202 { jobId }`, UI hỏi lại mỗi 2–3 giây. Không bao
  giờ chạy AI, TTS, render. Redis/worker tắt thì trang vẫn mở và báo suy giảm (`/api/status`, heartbeat cũ hơn 15 giây); thao tác cần
  Redis ngay thì `PING` thử rồi trả `503 QUEUE_UNAVAILABLE`.
- **Worker:** mọi việc nặng và mọi lời gọi ra ngoài; concurrency mặc định 1; không tới được Redis thì thoát mã 1. Khởi động: bật WAL →
  `sweepDueJobIntents` (giao outbox còn sót trước, để đối soát chỉ xét job đáng lẽ đã ở Redis) → `reconcileJobRecords` →
  `reconcileProductionItems`, `reconcileExtractions` (cấp job mới cho việc dở đã mất job; chỉ lúc khởi động để lỗi lặp không thành vòng)
  → `sweepRenderArchives` → mở BullMQ `Worker`. Định kỳ: heartbeat 5 giây, quét outbox 5 giây, quét archive 60 giây. SIGINT/SIGTERM:
  đóng trong tối đa 15 giây; job dở thành stalled và được đối soát lần sau.

## 2. Mô hình dữ liệu

Prisma 7 + SQLite (`prisma/schema.prisma`), migration chỉ cộng thêm. Sáu loại dữ liệu lưu riêng: tệp gốc (bất biến) → bản trích xuất →
catalogue (chương, bài học, nguồn) → bản thảo NotebookLM → kế hoạch cảnh Claude (đầu vào duy nhất của Remotion) → snapshot render (bất
biến, nguồn của manifest Drive).

- **Sách:** `Book` (tệp gốc + `sourceHash`; `md`/`txt`/`pdf`; xoá mềm, bị chặn khi có video) · `Chapter` (duy nhất `(bookId, order)`)
  · `Lesson` + `LessonSource` (duy nhất `(lessonId, chapterId, sourceLocator)`; locator `offset:<k>` hoặc `page:<n>;offset:<k>`).
- **Video:** `Video` (`scriptVersion` tăng mỗi lần kịch bản đổi; `approvedScriptVersion` do người duyệt; `autoReadyScriptVersion` do máy
  kiểm; khoảng `minDurationSec`–`maxDurationSec` người dùng cho phép, `targetDurationSec` + `durationReason` do AI đề xuất — trước khi có
  đề xuất, `targetDurationSec` = mức dài nhất và lý do null) · `VideoLesson` (snapshot bài học lúc chọn) · `VideoScene` (duy nhất `(videoId, order)`) · `MediaAsset` · `RenderRecord`
  (snapshot bất biến, `archiveIntentAt`; "lỗi thời" là suy ra `scriptVersion < Video.scriptVersion`, không lưu).
- **Tác vụ:** `JobRecord` (read model) · `JobDispatch` (hàng outbox, 1:1) · `AiRun` (chế độ, phiên bản prompt, hash đầu vào; không bí mật).
- **PDF:** `BookExtraction` (gắn `sourceHash`; chi phí OCR bằng micro-USD nguyên) · `ExtractionPage` (duy nhất
  `(extractionId, pageNumber)`; số trang PDF, không bao giờ là offset; `confidence` chỉ khi provider báo) · `OcrOperation` (duy nhất
  `requestKey`, ghi **trước** khi gửi; `outputStoredAt` có trước `cleanedAt`).
- **NotebookLM:** `NotebookBinding` (duy nhất `(bookId, profile)`) · `NotebookSourceBinding` (duy nhất
  `(notebookBindingId, sourceKey, contentHash)`) · `ScriptDraftCache` (duy nhất `cacheKey`).
- **Sản xuất:** `ProductionBatch` (duy nhất `idempotencyKey`; khoảng thời lượng chép sang từng video, cột `targetDurationSec` cũ chỉ còn
  ghi bằng mức dài nhất) · `ProductionItem` (duy nhất `(batchId, lessonId)`, `(batchId, position)`,
  `videoId`; một bài học = một item = một video; `lessonId` `Restrict`).
- **Lưu trữ:** `RenderArchive` (duy nhất `(renderId, provider, destinationKey)`) · `RenderArchiveFile` (duy nhất `(archiveId, kind)`; ID
  từ xa cấp trước, ghi một lần; checkpoint = token + số byte) · `ArchiveFolder` (duy nhất `(provider, destinationKey, path)`) ·
  `OAuthAuthorization` · `DriveUsageHour` · `DriveCapacity`.

Phần lớn trạng thái là `String` với tập giá trị trong `features/*/domain`; đường dẫn trong DB luôn tương đối với `DATA_DIR`.

```
JobRecord        QUEUED WAITING_FOR_CLI RUNNING COMPLETED FAILED CANCEL_REQUESTED CANCELLED
Chapter          NOT_ANALYZED QUEUED ANALYZING WAITING_FOR_CLI ANALYZED PARTIAL FAILED
Video            DRAFT NEEDS_REVIEW APPROVED
RenderRecord     QUEUED RENDERING COMPLETED FAILED CANCELLED
ExtractionPage   PENDING EXTRACTED NEEDS_OCR OCR_SUBMITTED FAILED          (BookExtraction: §6.2)
OcrOperation     PLANNED SUBMITTING SUBMITTED COMPLETED FAILED CANCELLED UNKNOWN_OUTCOME
ProductionItem   PENDING RUNNING WAITING COMPLETED FAILED CANCELLED        (checkpoint: §8.2)
ProductionBatch  QUEUED RUNNING COMPLETED PARTIAL FAILED CANCELLED         (suy ra từ item)
RenderArchive    PENDING RUNNING WAITING COMPLETED FAILED    file: PENDING UPLOADING UPLOADED VERIFIED
```

## 3. Vòng đời tác vụ

```
DIAGNOSTIC_PING        kind (ping | notebooklm)
ANALYZE_CHAPTER        chapterId, force        v1.1, hoặc NotebookLM cho chương sách PDF
GENERATE_VIDEO_SCRIPT  videoId, sceneId?       cả kịch bản hoặc viết lại một cảnh
GENERATE_SCENE_TTS     sceneId                 loại duy nhất BullMQ thử lại (2 lần, backoff 5 giây)
RENDER_VIDEO           renderId
EXTRACT_PDF            extractionId            hoãn khi chờ
RUN_PRODUCTION_ITEM    itemId                  hoãn khi chờ
ARCHIVE_RENDER         archiveId               hoãn khi chờ
```

Payload chỉ chứa ID và metadata nhỏ, kiểm bằng Zod (`jobs/schemas/job-payload.schema.ts`).

### 3.1 Outbox

- `recordJobIntent` ghi `JobRecord(QUEUED)` + `JobDispatch(dispatchedAt = null, availableAt)` trong một giao dịch;
  `createJobIntentWithin(tx, …)` ghi job **cùng giao dịch** với thay đổi làm nó cần thiết (nhập PDF, tạo/thử lại item, archive, trích xuất).
- `dispatchJobIntent`: `queue.add(..., { jobId: bullmqJobId })` rồi mới ghi `dispatchedAt`; chết giữa hai bước thì giao lại và BullMQ bỏ
  qua `jobId` trùng.
- Web v1.1 (`enqueueTrackedJob`) giao ngay; Redis từ chối thì xoá hàng, job `FAILED`, trả `503`. Job v1.2 chỉ ghi outbox và worker giao
  (`sweepDueJobIntents`, ≤ 5 giây). Ngoại lệ duy nhất gọi `queue.add` trực tiếp: `pnpm ai:run` requeue sau khi lưu `output.json`.

### 3.2 Dispatcher, hoãn, đối soát, huỷ

```
QUEUED ─► RUNNING ─┬─► COMPLETED | FAILED
                   ├─► WAITING_FOR_CLI ──(pnpm ai:run)──► QUEUED
                   ├─(deferred)──────────────────────────► QUEUED (bullmqJobId mới, availableAt)
                   └─► CANCEL_REQUESTED ──(AbortSignal)──► CANCELLED
QUEUED (trong outbox hoặc chờ trong BullMQ), WAITING_FOR_CLI ──huỷ──► CANCELLED
```

- `createJobDispatcher`: bỏ qua job đã huỷ, đánh `RUNNING`, chép tiến độ sang BullMQ và SQLite, thăm dò `CANCEL_REQUESTED` mỗi 2 giây để
  tạo `AbortSignal`; lỗi → `FAILED` với mã ổn định.
- **Hoãn:** processor chờ việc từ xa trả `deferred(retryAfterMs)` thay vì ngủ. `rescheduleRunningJob` (một giao dịch) đưa job về `QUEUED`
  với **`bullmqJobId` mới** (BullMQ nuốt `add` trùng id của job đã xong) và đặt `availableAt`. Lịch nằm trong SQLite nên sống qua restart
  và Redis bị xoá; job đã bị yêu cầu huỷ thì kết thúc huỷ thay vì đặt lịch.
- **Đối soát** (`reconcileJobRecords`): job chưa kết thúc, không còn hàng outbox chưa giao, mà mất khỏi Redis → `FAILED` (`JOB_LOST`).
  Archive, trích xuất và item sản xuất chỉ đổi khi **huỷ**; job mất thì được cấp job mới và việc tiếp tục từ checkpoint.
- **Thử lại** (`retryJob`) luôn tạo tác vụ mới từ thực thể, giữ lịch sử lần lỗi.

### 3.3 Idempotency, khoá, thử lại tự động

BullMQ giao ít nhất một lần nên mỗi processor bắt đầu từ trạng thái đã lưu (cache theo hash, checkpoint, khoá idempotency, ID cấp trước)
và chạy lại không nhân dữ liệu; phân tích chương cùng hash đầu vào + prompt thì bỏ qua trừ khi `force`.

`assertScriptNotGenerating()` chặn mọi thay đổi video từ người dùng: `409 VIDEO_IN_PRODUCTION` khi video thuộc item chưa kết thúc,
`409 SCRIPT_GENERATION_IN_PROGRESS` khi còn job tạo kịch bản/viết lại cảnh của nó. Worker ghi qua repository nên không bị khoá này chặn.

Lỗi tạm (`QUOTA`/`TRANSIENT`/`UNKNOWN_OUTCOME`) được hoãn theo `Retry-After`, nếu không thì 30 giây nhân đôi tới trần: trích xuất 30 phút,
tối đa 8 lần liên tiếp; sản xuất 10 phút, 5 lần; archive 30 phút, 8 lần. Bộ đếm về 0 khi có tiến triển; hết lượt thì dừng kèm lý do.
`AUTH`/`REJECTED` và lỗi AI v1.1 không bao giờ tự thử lại.

## 4. AI và Claude

- `AiProvider` theo `AI_MODE`: `mock` (tất định, không mạng); `cli-task` (mặc định: ghi tác vụ vào `ai-tasks/<taskId>/`, job
  `WAITING_FOR_CLI`, người dùng chạy `pnpm ai:run --job <id>`); `cli-auto` (tuỳ chọn: vẫn ghi đủ tệp nhưng worker gọi `askClaude()` ngay).
- Thư mục tác vụ: `input.json`, `prompt.md`, `schema.json` (JSON Schema draft-7 sinh từ chính schema Zod của đầu ra), `task.json`, rồi
  `output.json` hoặc `output.raw.txt`. Loại: `chapter-analysis`, `video-script`, `scene-regeneration`, `scene-plan`.
- `askClaude()` là đường duy nhất tới Claude (dùng bởi `pnpm ai:run`, `AutomatedCliProvider`, `ClaudeScenePlanCompiler`): kiểm
  `claude auth status`; chạy `claude -p --output-format json --tools "" --strict-mcp-config --no-session-persistence --json-schema …` từ
  mảng đối số, prompt qua stdin; env bỏ `CLAUDECODE*`/`CLAUDE_CODE_*` (không lồng phiên) và `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`;
  timeout và huỷ → `SIGTERM`. Lỗi có mã ổn định (`AI_CLI_AUTH`, `AI_QUOTA_EXCEEDED`, `AI_CLI_TIMEOUT`, `INVALID_AI_OUTPUT`…).
- Prompt có phiên bản; đổi chữ là tăng phiên bản: `chapter-analysis-v1`, `video-script-v7` (v1.1, cùng khung kể với sản xuất, đề xuất độ dài, ngân sách chữ theo nhịp độ); `scene-plan-v6`
  (biên dịch cảnh); `notebooklm-chapter-detection-v2`, `notebooklm-lesson-extraction-v2`, `notebooklm-script-draft-v5` (đề xuất độ dài, ngân sách chữ theo nhịp độ),
  `notebooklm-chat-persona-v1` (vai trò của notebook); `draftVersion` của cache = phiên bản bản thảo + phiên bản vai trò. Danh sách độ dài được chọn và ngân sách lời của từng mức sinh từ `prompts/duration-choice.ts`.

**Kiểm soát nội dung:**

- Văn bản sách là dữ liệu không đáng tin, bọc trong khối dữ liệu (`prompts/untrusted-text.ts`); mỗi lần chỉ gửi một chương, một phần
  chương hoặc bài học đã chọn, không bao giờ cả sách. Bài học, lời dẫn, chữ trên màn hình luôn tiếng Việt; trích đoạn giữ ngôn ngữ gốc.
- Sai schema → `FAILED`, không lưu gì. Trích đoạn chỉ giữ khi tìm thấy thật trong văn bản chương (`locateExcerpt`, bỏ qua khoảng trắng).
- **Bộ chặn khẳng định không có căn cứ** (`findUnsupportedClaims`): con số hay câu trích dẫn trong kế hoạch cảnh mà không có trong bản
  thảo hoặc bài học (so sau chuẩn hoá NFC, chữ thường, khoảng trắng) làm kế hoạch bị từ chối (`SCENE_PLAN_UNSUPPORTED_CLAIM`) và không
  được lưu. Đây là lưới an toàn cơ học, không chứng minh được sự trung thực.
- Hoạt cảnh chỉ nhận giá trị từ danh sách cố định, sinh vào prompt từ `videos/domain/illustration.ts`.
- `ClaudeScenePlanCompiler` đặt tên tác vụ theo hash đầu vào nên hỏi lại cùng đầu vào không tốn thêm lượt Claude. Sản xuất hàng loạt chỉ
  chạy với `mock` hoặc `cli-auto`; `cli-task` bị từ chối vì không thể chờ người chạy `pnpm ai:run` từng video.

## 5. Luồng thủ công (v1.1)

- Nhập `.md/.txt`: tệp giữ tạm ở `imports/<id>/` để xem trước cách tách chương; xác nhận mới tạo sách; tệp gốc ghi nguyên byte rồi đặt
  chỉ đọc. Parser chương dùng chung cho sách PDF.
- `ANALYZE_CHAPTER` → `analyzeChapter` → Zod → kiểm trích đoạn → thay bài nháp AI cũ. `GENERATE_VIDEO_SCRIPT` tạo 2–3 phương án hook +
  các cảnh từ snapshot bài học. Sửa kịch bản đã duyệt → `NEEDS_REVIEW`.
- `runSceneTts`: khoá `sha256(engineVersion của provider, giọng, tốc độ, lời dẫn)`; trượt thì provider TTS (cổng `TtsProvider`, chọn bằng
  `TTS_MODE`; hiện chỉ có `edge-tts`, lời dẫn qua tệp, không qua dòng lệnh; lỗi là `IntegrationError` mã `TTS_*`, hết lần thử là `TRANSIENT` nên
  đường ống sản xuất hoãn và thử lại) →
  cắt lặng đầu/cuối (ffmpeg) → đo (ffprobe) → `videos/<videoId>/audio/<hash>.mp3`. Audio tải lên (nhận bằng chữ ký byte) chỉ được đo.

## 6. Trích xuất PDF

### 6.1 Nhập

`POST /api/books/import/pdf` nhận PDF thô làm thân request và stream ra đĩa đồng thời băm SHA-256 (sách 500 MiB không nằm trong RAM);
chữ ký `%PDF-` kiểm trên byte thật; vượt `MAX_PDF_SIZE_MB` thì dừng; huỷ/lỗi xoá tệp dở. Thành công: đổi tên sang
`books/<bookId>/original.pdf` (chỉ đọc), tạo `Book` + `BookExtraction(QUEUED)` + job `EXTRACT_PDF` trong **một giao dịch**, trả `202`;
trùng hash với sách có sẵn → `409`.

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

Poppler (`server/pdf/poppler.ts`) chạy từ mảng đối số với đường dẫn tuyệt đối, env tối thiểu, timeout; lỗi được phân loại mà không chép
thông điệp của công cụ. `pdftotext` chạy một lần cho cả sách rồi tách theo form feed; `pdfimages -list` đếm hình mỗi trang.

`classifyPage` (thuần, NFC): không chữ cái, không hình → `EMPTY` (trang trống hợp lệ, khác `FAILED`); < 20 chữ cái mà có hình → OCR
(scan); > 2 % ký tự chỉ có trong font TCVN3/VNI → OCR (font cũ); > 5 % ký tự thay thế/vùng riêng → OCR (lỗi mã hoá); còn lại `TEXT`. Lý do
OCR lưu bằng tiếng Việt trên từng trang vì OCR tốn tiền. Chạy lại không đặt lại trang đã gửi OCR, đã có kết quả hay đã lỗi.

### 6.4 OCR: chunk, ngân sách, lô

- **Chunk:** trang cần OCR (không cần liên tiếp) được gom tới `limits.maxPages` của provider thành PDF riêng **kèm danh sách số trang gốc
  theo thứ tự** (lưu ở `chunkPlanJson`); chunk vượt `limits.maxBytes` bị chia đôi tới khi vừa, một trang đơn vẫn vượt → trang `FAILED`.
- **Ngân sách** (`planOcrOperation`, một giao dịch): `requestKey` lặp → trả operation cũ; chỉ **một** lô mở mỗi lần trích xuất; chặn khi
  `đã chi + đang giữ + ước tính > trần`; không đổi provider/model giữa chừng. Khoá lô `<extractionId>-ocr-<n>` (n = số lô đã có) nên chạy
  lại sau sự cố dùng lại khoá. Trần chép vào lần trích xuất lúc tạo; chỉ người dùng đổi được, không dưới khoản đã chi/giữ.
- **Gán kết quả** (`reconcileOcrResults`): mỗi trang đã gửi nhận đúng một kết quả qua `pageNumbers[i]`. Chunk thiếu, trả hai lần, sai chỉ
  số hay sai số trang làm **cả chunk** thất bại thay vì đoán rồi gán nhầm trang. Không bao giờ ghi đè trang có lớp chữ.
- **Dừng chờ người dùng:** thiếu `MISTRAL_API_KEY`, vượt trần, khoá bị từ chối, lô bị huỷ phía provider → giữ ở `OCR_PENDING` kèm lý do,
  lô mở và giữ chỗ còn nguyên. `retryExtraction` đưa trang OCR lỗi về `NEEDS_OCR` và ghi job mới cùng giao dịch.

```
PLANNED → SUBMITTING → SUBMITTED → COMPLETED | FAILED | CANCELLED
              └─(mất phản hồi)─► UNKNOWN_OUTCOME ─findOperation(requestKey)─► SUBMITTED | PLANNED
```

Ý định (trang → `OCR_SUBMITTED`) được ghi **trước** khi gọi provider; `UNKNOWN_OUTCOME` giữ khoản giữ chỗ và được đối soát trước, không
bao giờ gửi lại mù. `collectOcrOperation` không chờ: `pending` → hoãn (60 giây đầu, sau đó theo provider); `completed` → lưu chữ →
`outputStoredAt` → chốt tiền → rồi mới `cleanup` phía provider; `expired` (provider không còn output) → lô coi như đã tính tiền, trang
`FAILED` để gửi lại.

### 6.5 Adapter Mistral

`MistralBatchOcrProvider` (client REST có kiểu, phản hồi qua Zod, khoá API chỉ trong đối tượng client): `start` tìm job theo
`metadata.request_key` trước mọi upload; nếu chưa có thì upload các chunk (tham chiếu bằng `file_id`, không cần URL công khai) + một JSONL
rồi tạo job — mất phản hồi lúc tạo job thì **giữ** tệp đã upload vì job có thể đang đọc chúng. `poll` không chờ; dòng JSONL hỏng được báo
theo số dòng, không trích nội dung. `cleanup` xoá tệp yêu cầu **cuối cùng** vì chỉ nó biết id các PDF. 5xx/timeout của lệnh ghi →
`UNKNOWN_OUTCOME`, của lệnh đọc → `TRANSIENT`. Giả định chưa kiểm chứng (model, đơn giá, dạng JSONL…): [operations.md](operations.md).

### 6.6 Tài liệu chuẩn và chương

- `assembleExtractionDocument` ghép văn bản các trang (cách nhau `\n\n`, trang trống không chiếm chỗ) thành
  `extractions/<id>/canonical.md` kèm `pageOffsets` `[start, end)` đơn vị UTF-16, cùng đơn vị với offset chương, để `pageAtOffset` đổi
  offset về trang PDF. Thiếu hay lỗi trang nào → `EXTRACTION_INCOMPLETE`, không ghi gì. Offset không lưu mà tính lại từ các trang.
- Chương: **cùng parser cục bộ** với sách Markdown chạy trên `canonical.md`. Không thấy ranh giới, hoặc chương tìm được không khớp
  dấu "Chương N" của sách → `DETECTING_CHAPTERS`. Không khớp là: có dấu mà không chương nào mang số đó (heading OCR che mất, dấu
  không có dòng trống phía trước), hoặc hai chương trong cùng một phần trùng số (mục lục bị tách thành chương). Dòng chỉ nhắc tới
  một chương đã có, hay đánh số lại từ 1 ở mỗi phần, không tính. Không bao giờ lấy cả sách làm một chương.
- **Xác định chương bằng NotebookLM:** NotebookLM nhận "dàn ý theo trang" (mỗi trang `[Trang N]` + 160 ký tự đầu), tối đa 3 ứng viên dấu
  chương mỗi trang và 200 ứng viên cả sách (dấu chương + một dòng sau, mỗi dòng ≤ 120 ký tự), cùng các dòng giống mục lục; trả
  `[{title, startPage, endPage, startAnchor}]`. `verifyProposedChapters` chỉ chấp nhận khi **mọi** chương đạt: anchor (≥ 4 ký tự)
  có thật ở trang bắt đầu hoặc trang kế; không bắt đầu ở trang mục lục; thứ tự tăng; trong phạm vi sách; không chương nào phủ ≥ 90 % sách
  từ 20 trang. Phần đầu sách trước chương đầu không thuộc chương nào. Không đạt → `NEEDS_CHAPTERS`, không tạo gì.

## 7. NotebookLM

### 7.1 Tiến trình và phiên

- Chỉ dùng khi `AI_MODE=cli-auto` và có `NOTEBOOKLM_PROFILE`; phân tích chương bằng NotebookLM chỉ cho sách PDF. Web không bao giờ khởi
  động máy chủ MCP.
- Worker chạy `uvx --from notebooklm-mcp-cli==0.15.8 notebooklm-mcp` qua `McpStdioClient` tối giản (JSON-RPC 2.0 theo dòng, không SDK);
  stderr không vào lỗi hay log. Env là danh sách cho phép; cookie và khoá của ứng dụng không bao giờ được truyền.
- `NotebookLmSession.open` kiểm đủ công cụ, chuyển profile **chỉ cho tiến trình này** (`make_default: false`) rồi đọc lại profile đang
  dùng. Mỗi lời gọi được xét theo phong bì `{status: "success" | "error"}`, **không** theo `isError` (máy chủ báo lỗi với `isError: false`);
  văn bản lỗi chỉ dùng để phân loại, không bao giờ được hiện ra. Công cụ thay đổi dữ liệu quá hạn hay trả lời hỏng → `UNKNOWN_OUTCOME`.
- Một tiến trình MCP cho một lần chạy job: mở ở lời gọi đầu, đóng trong `finally`; lúc đóng đọc `usage_get` và ghi
  `data/integrations/notebooklm-status.json` (phần trăm — vắng là "không rõ", không phải 0 —, giờ đặt lại, gói; không cookie).

### 7.2 Notebook và nguồn

- Một notebook mỗi `(bookId, profile)`, tiêu đề `Book Video Studio · <sách> [bvs:<bindingId>]`. Mỗi phần văn bản (`sourceKey`) ở mỗi
  phiên bản (`contentHash`) là một nguồn văn bản mang dấu `[bvs:<id>]`; văn bản đổi → dòng mới, bản cũ `supersededAt` nhưng giữ ID từ xa
  để còn truy nguồn bài học cũ.
- Tạo mất phản hồi → `UNKNOWN_OUTCOME`; lần sau **tìm dấu** trong `notebook_list`/`notebook_get` trước rồi mới tạo lại.
- Trước câu hỏi đầu tiên (`openBookNotebook`, lối vào của mọi nguồn), notebook được đặt "Configure chat" qua `chat_configure`: vai trò
  tuỳ chỉnh `notebooklm-chat-persona-v1` (phân tích sách + biên kịch video dọc, bám nguồn, câu hỏi đòi định dạng nào trả đúng định dạng
  đó) và câu trả lời `longer`. Phiên bản đã áp lưu ở `NotebookBinding.chatPersonaVersion` — chỉ ghi khi NotebookLM xác nhận; notebook
  cũ hơn phiên bản hiện hành được áp lại ở lần dùng sau. Đặt lại cùng cấu hình vô hại nên mất phản hồi là `TRANSIENT`, không
  `UNKNOWN_OUTCOME`.
- Câu hỏi luôn truyền **`source_ids` tường minh** (chỉ phiên bản hiện hành) trong hội thoại mới, vì NotebookLM mặc định dùng mọi nguồn.
  Câu trả lời phải là JSON đúng schema; sai thì từ chối, không vá.

### 7.3 Danh mục bài học theo phần

`runNotebookChapterAnalysis` lấy văn bản chương từ tài liệu chuẩn (không đọc lại PDF), cắt thành phần ≤ 40.000 ký tự ở ranh giới đoạn.
Mỗi phần là nguồn `chapter:<id>:part:<n>` có `[Trang N]` đầu mỗi trang và một câu hỏi riêng (liệt kê **mọi** bài học, trích nguyên văn,
đánh dấu tình huống tự nghĩ). Bài trùng tiêu đề giữa các phần được gộp. Trang lưu cho trích đoạn là trang **nơi tìm thấy** nó, không phải
trang mô hình khai. Phần trả `complete: false` → chương `PARTIAL`; sai định dạng → `FAILED`, không lưu gì. Mỗi lần chạy thay bài nháp AI
cũ của chương và ghi `AiRun(mode=notebooklm)`.

### 7.4 Bản thảo và cache

- `writeDraft` đọc mọi phần của mọi chương bài học trích dẫn (cùng khoá với lúc lập danh mục nên không tải lại). Prompt ép mạch kể HOOK →
  tình huống → sai lầm → bài học → giải quyết → hành động; sai định dạng hay sai thứ tự → `DRAFT_INVALID`. Bản thảo kèm
  `targetDurationSec` (một mức trong khoảng của video) và `durationReason`; ngoài khoảng → `DRAFT_LENGTH_OUT_OF_RANGE`.
- `ScriptDraftCache.cacheKey` = sha256(provider, `draftVersion`, bài học + `contentHash`, khoảng thời lượng, **tập** remote ID nguồn, ghi
  chú sửa).
  Bước bản thảo hỏi cache trước; trượt thì gọi NotebookLM rồi lưu ngay.

## 8. Pipeline sản xuất

### 8.1 Yêu cầu

`requestProduction` (`POST /api/productions`): bài học cùng sách, không `ARCHIVED`, có ít nhất một trích đoạn. Một **nested create** ghi
batch + mỗi bài một item + một `Video` (snapshot bài học dựng như luồng thủ công) + job `RUN_PRODUCTION_ITEM` — đủ cả hoặc không gì. Chọn
không phải duyệt: không đòi `APPROVED`, không đổi trạng thái bài học. Cùng `idempotencyKey` + cùng `fingerprint` (sách, bài học theo thứ
tự, khoảng thời lượng) → trả batch cũ; cùng khoá khác nội dung → `409`; gửi đua → một batch (bên thua bắt `P2002`).

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
- Một job đi nhiều bước liên tiếp và **không bao giờ chờ**: render đang chạy (kiểm lại sau 15 giây) hay lỗi tạm → `deferred`. Mọi bước ghi
  bằng CAS trên `(itemId, claimToken, checkpoint)`.
- `createPipelineDeps`: `cli-auto` + profile → NotebookLM + Claude; `mock` → hai bản mock; thiếu profile → `SCRIPT_STUDIO_NOT_AVAILABLE`.

### 8.3 Các bước

- **Độ dài:** bước bản thảo lấy khoảng từ **video** (không từ đợt) và kiểm đề xuất của bản thảo (kể cả bản lấy từ cache); hợp lệ thì
  `saveDraftArtifact` ghi artifact và `Video.targetDurationSec` + `durationReason` trong cùng một giao dịch có điều kiện. Bước biên dịch
  dùng độ dài của bản thảo, cùng khoảng của video.
- **Bản thảo → biên dịch:** hai artifact không bao giờ trộn (`server/scene-plan/handoff.ts`), mỗi cái có `schemaVersion` và `fingerprint`;
  fingerprint kế hoạch gồm **fingerprint bản thảo**, phiên bản prompt và độ dài, nên đổi bất kỳ thứ gì thì kế hoạch cũ không được dùng lại.
  Bản thảo không bao giờ ghi vào `output.json` của tác vụ Claude.
- **Áp dụng** (`applyScenePlan`): câu lệnh đầu của giao dịch là `UPDATE` có điều kiện (lấy khoá ghi trước khi đọc, tránh nâng cấp khoá
  của SQLite WAL; chỉ một người thắng), rồi ghi cảnh qua `replaceScriptWithin`, **cùng đường ghi** với luồng thủ công. Áp lại cùng kế hoạch
  → `ALREADY_APPLIED`, giữ nguyên cảnh và audio.
- **Lồng tiếng:** từng cảnh, đúng thứ tự, qua `runSceneTts` (có cache; không gọi song song dịch vụ trực tuyến). Dừng sớm giữ audio đã tạo;
  chỉ chuyển `VOICED` khi mọi cảnh có audio.
- **Readiness** (`assessReadiness`) thay cho duyệt tay: mọi quy tắc chặn của preflight FINAL (§9.3) trên audio thật, cộng
  `UNDER_MIN` (với người chỉ là cảnh báo), `AUDIO_NOT_READY` và `SOURCE_MISSING`; báo mọi vấn đề một lượt. Đạt → ghi `autoReadyScriptVersion = scriptVersion` bằng CAS. Không giả
  duyệt: `Video.status` vẫn `NEEDS_REVIEW`; sửa sau đó tăng `scriptVersion` nên readiness tự hết hiệu lực.
- **Render** (`queueFinalRender`): chụp snapshot, dùng lại render FINAL đã xong cùng `scriptVersion` hoặc đang chạy; nếu không thì
  preflight rồi tạo `RenderRecord` + job qua outbox (không qua `requestRender` của web vì nó bị khoá `VIDEO_IN_PRODUCTION`).

### 8.4 Một lượt sửa AI, lỗi, huỷ, thử lại

- `planCorrection`: `SOURCE_MISSING`, `DRAFT_INVALID`, `DRAFT_LENGTH_OUT_OF_RANGE`, `UNDER_MIN` → script studio (lùi về `NONE`; chỉ
  nó kể thêm được từ nguồn); dài hơn mức dài nhất, hook, cảnh trống, đầu ra sai, khẳng định không căn cứ → compiler (lùi về `DRAFTED`);
  có cả hai thì chọn bước sớm hơn. Mã khác không sửa được và không tiêu lượt. Ghi chú (≤ 600 ký tự, lời của hệ thống; mã không có
  hướng dẫn riêng thì dùng chính thông điệp lỗi) không bao giờ cho nới khoảng hay đổi tốc độ đọc; code không đổi khoảng hay nhịp độ. Tiêu
  lượt là một `UPDATE` có điều kiện: đúng một lời gọi thắng, còn lại → item `FAILED`.
- Lỗi tạm → hoãn (§3.3); `AUTH`, `REJECTED` không sửa được, `AppError` → `FAILED` kèm mã; lỗi bất ngờ → `FAILED` để item không bao giờ
  "đang chạy" mà không có job.
- Huỷ → `CANCELLED`, dừng job và render đang xếp; bước đang chạy làm xong nhưng không bước nào sau đó bắt đầu. Thử lại đưa item về
  `PENDING` từ checkpoint cũ (lượt sửa AI vẫn đã dùng) với job mới cùng giao dịch. Trạng thái batch tính lại từ item.

## 9. Render

### 9.1 Props, thời lượng, phụ đề

- `toCompositionProps()` là nơi duy nhất biến video thành props cho composition `ShortVideo`; Player và render dùng chung nó và
  `shortVideoPropsSchema` nên bản xem trước là bản sẽ render. `src/remotion/**` là React thuần (không `process.env`, DB, mạng); font Be Vietnam Pro đóng gói cục bộ.
- **Nhịp độ** (`domain/pace.ts`, `Video.pace`/`ProductionBatch.pace`): bảng `STANDARD`/`FAST`/`FASTER` là nơi duy nhất nói tốc độ giọng, khoảng
  nghỉ, âm tiết/giây và hệ số hoạt cảnh. `runSceneTts` lấy tốc độ và khoảng nghỉ từ video của cảnh; khoá cache chứa tốc độ nên về nhịp cũ thì
  dùng lại giọng cũ (frame được tính lại theo khoảng nghỉ hiện tại). Prompt, ước lượng thời lượng và khoá cache bản nháp đều nhận nhịp độ.
  Giọng đã tạo ở tốc độ khác nhịp độ hiện tại là "lệch nhịp": `toVideoDetail` đếm `staleVoiceSceneCount`, preflight cảnh báo
  `VOICE_PACE_MISMATCH`, tab Giọng đọc cho tạo lại (`scope: "all"`). Trong composition, `paceFactor` (từ `toCompositionProps`) bọc **riêng**
  `SceneRenderer` trong `<Sequence playbackRate>`; phụ đề, nhãn sách và âm thanh nằm ngoài nên giữ thời gian thật; render ở ×1 không bọc gì
  cả. Snapshot lưu `video.pace` (tuỳ chọn, bản cũ đọc là Chuẩn). Cổng `TtsProvider` (`server/tts/`) nhận `speedPercent`, adapter tự đổi sang
  tham số của dịch vụ.
- Độ dài cảnh = `ceil((durationMs + paddingMs của nhịp độ) / 1000 × 30)` theo audio thật, tối thiểu 2 giây; trước khi có audio ước lượng
  theo âm tiết/giây của nhịp độ (4 ở Chuẩn). Không bao giờ cắt lời hay tự tăng tốc để vừa khoảng. Phụ đề tách theo dấu câu, ≤ 9 từ mỗi cụm, thời gian chia theo âm tiết.
- Audio được phục vụ cho Chromium bởi asset server tạm ở `127.0.0.1:<cổng ngẫu nhiên>`, chỉ đúng các tệp snapshot nêu.
- `RENDER_TEMPLATE_VERSION` (`composition-props.ts`) ghi vào mọi snapshot; tăng khi thay đổi Remotion làm cùng props trông khác.
  Vùng an toàn chỉ là lớp phủ trong editor, không vào MP4.

### 9.2 Snapshot và `runRender`

- `captureRenderSnapshot` chụp lúc **yêu cầu** render: cảnh, audio theo đường dẫn lưu (tên theo hash nội dung nên byte không đổi), nguồn
  bài học, kích thước/chất lượng, `scriptVersion`, cổng duyệt (`status`, `autoReady`), template. Lưu kèm `snapshotHash` (sha256 JSON khoá
  sắp xếp), **không bao giờ ghi đè**; khi đọc phải đúng schema và hash. ESLint cấm `render-runner.ts` đọc video sống.
- **Pha render** (trọn hoặc không gì): preflight trên snapshot → `renderMedia` → ffprobe kiểm H.264/AAC, kích thước, FPS, thời lượng →
  `COMPLETED`, cùng câu lệnh đặt `archiveIntentAt` cho FINAL. Lỗi/huỷ trong pha này xoá tệp dở. **Pha sau** chỉ báo tiến độ; lỗi ở đó
  không bao giờ xoá MP4 hay lật trạng thái. Render đã `COMPLETED` chạy lại là no-op.
- Bundle một lần mỗi tiến trình worker; mỗi render mở **một** Chromium (`openBrowser`) dùng chung cho `selectComposition` và
  `renderMedia`, đóng trong `finally`; cảnh báo/lỗi của trang (cắt ngắn) vào log worker. Bản nháp dùng `scale = 720/1080` trên cùng
  composition 1080×1920; ghi `*.part.mp4` rồi đổi tên. MP4 cũ không bao giờ bị xoá tự động.
- Font chưa tải được thì render bị huỷ (`cancelRender`) thay vì ra MP4 với font dự phòng. Ký hiệu ngoài font đóng gói (✓, ✗…) được vẽ
  bằng SVG để xem trước và MP4 giống nhau.
- Tốc độ render bị chặn bởi bước chụp khung hình: đo 600 frame bản nháp, preset x264 `veryfast` hay bỏ bóng mờ của thẻ chữ đều không
  nhanh hơn đáng kể (tối đa 1,2 %), nên giữ preset `medium` và giao diện hiện tại.
- Player (trình biên tập): phần đọc thời gian theo frame nằm ở component anh em của `<Player>` để Player không render lại 30 lần/giây;
  cảnh kế tiếp được mount sớm 1 giây (`defaultPremountInSeconds`) để lời đọc không vào trễ; nút xem hook truyền sự kiện click cho
  `play()` để trình duyệt không chặn âm thanh.

### 9.3 Preflight

```
chặn mọi bản   NO_SCENES, HOOK_MISSING (cảnh đầu phải là HOOK hiển thị), EMPTY_TEXT, OVER_MAX (> 300 giây)
chặn FINAL     HOOK_TOO_LONG (> 120 frame), OVER_TARGET (> mức dài nhất của khoảng), SCRIPT_NOT_APPROVED (không APPROVED và
               không autoReady)
cảnh báo       HOOK_SILENCE (> 500 ms lặng đầu), LONG_TEXT, MISSING_AUDIO, UNDER_MIN (< mức ngắn nhất; readiness coi là chặn)
```

### 9.4 Hoạt cảnh SVG

`src/remotion/illustration/`: 7 bối cảnh × 8 hành động của một nhân vật (danh sách ở `videos/domain/illustration.ts`). Mọi chuyển động là
hàm của frame; không `filter`/blur (chậm trong Chromium headless), không ảnh, không ngẫu nhiên (có test kiểm). Ngoại hình nhân vật chọn
theo tiêu đề video. `illustrationJson` null = mặc định theo loại cảnh; hash cảnh chỉ tính hoạt cảnh khi có lựa chọn nên dữ liệu cũ giữ hash.

## 10. Lưu trữ lên Google Drive

### 10.1 Luồng

```
render FINAL COMPLETED + archiveIntentAt ─► requestRenderArchive | sweepRenderArchives (khởi động + mỗi phút)
  ─► RenderArchive + 3 RenderArchiveFile + job ARCHIVE_RENDER (một giao dịch, tài khoản đang kết nối)
  ─► dựng script/manifest ─► prepareDestination ─► upload MP4 → script → manifest ─► verify ─► COMPLETED khi cả ba VERIFIED
```

- Archive tách khỏi render; `destinationKey` = `permissionId` của tài khoản. Chưa kết nối Drive → không làm gì, ý định vẫn nằm trên
  render. Processor **chỉ upload**.
- `script.json` và `manifest.json` (thông số render, `snapshotHash`, tên + byte + SHA-256 của MP4 và script) dựng **chỉ từ snapshot**,
  không có đường dẫn local, JSON khoá sắp xếp nên dựng lại ra cùng byte. Cảnh minh hoạ: snapshot ghi `illustrative` cho từng cảnh lúc
  chụp (nhịp bản thảo có `illustrative` của item sản xuất, ánh xạ sang loại cảnh bằng `SCENE_TYPE_FOR_BEAT`; video làm tay thì là
  cảnh `SITUATION`, vì nó lấy từ tình huống minh hoạ của bài học); `script.json` ghi cờ theo cảnh, `manifest.json` liệt kê
  `illustrativeScenes`. Snapshot cũ không có cờ thì hai tệp giữ đúng byte như trước để archive dở không báo tệp đổi. Cây Drive:
  `Book Video Studio/books/<bookId>/videos/<videoId>/renders/<renderId>/`.
- Lỗi chờ được → `WAITING` + hoãn; quyền, Drive đầy, tệp local đổi → `FAILED`. Thử lại dùng lại thư mục, ID tệp, checkpoint và tệp đã xác
  minh. Ứng dụng không bao giờ xoá gì trên Drive.

### 10.2 OAuth và credential

- OAuth client **Desktop app** của người dùng, chỉ quyền `drive.file`, PKCE `S256`, redirect loopback `http://127.0.0.1:<cổng>` không path.
  `OAuthAuthorization` lưu **hash** của state, hạn 10 phút; callback tiêu state bằng `UPDATE` có điều kiện trước mọi việc (hai callback đua
  → một tới Google), đòi `drive.file` trong scope và có refresh token, rồi mới ghi credential.
- Token chỉ ở `data/credentials/google-drive.json` (`0600`), không trong SQLite hay DTO. `DriveAccessToken` làm mới khi còn < 1 phút (đồng
  thời chỉ một yêu cầu); `invalid_grant` → `NEEDS_RECONNECT`. Ghi lại credential chỉ khi vẫn cùng lần đăng nhập (`connectedAt`), nên làm
  mới muộn không hồi sinh kết nối đã ngắt. Ngắt kết nối thu hồi token và không xoá gì trên Drive.

### 10.3 Thư mục, upload, xác minh, hạn mức

- **ID cấp trước:** một `files.generateIds` cho thư mục thiếu + 3 tệp; ID được **ghi vào bảng trước** (bên thua cuộc đua nhận ID bên thắng)
  rồi mới tạo thư mục với chính ID đó; Drive trả `409` cho lần tạo lặp nên mất phản hồi không sinh bản thứ hai. Không bao giờ tìm kiếm
  Drive. Thư mục bị xoá → `404` → bỏ ràng buộc từ đó trở xuống và dựng lại.
- **Upload có thể tiếp tục:** phiên `uploadType=resumable` vào ID tệp đã cấp, chunk 8 MiB bằng một buffer dùng lại. Tiến độ chỉ là số byte
  Google xác nhận (`Range` của `308`). Session URI coi như credential, chỉ nằm trong checkpoint. Có checkpoint thì hỏi trạng thái trước:
  `308` → gửi tiếp, `200/201` → xong, `404` → phiên mới cùng ID tệp; mở phiên bị `409` → tệp đã có.
- **Xác minh:** kích thước và checksum Drive so với tệp local; Drive chưa có checksum → lỗi tạm, không tin chỉ kích thước.
- **Hạn mức:** `DriveRequestMeter` ghi sổ theo giờ **chỉ những gì ứng dụng gửi** và từ chối (`QUOTA`, kèm thời gian chờ) khi vượt cửa sổ 24
  giờ (mặc định 5.000 yêu cầu, 10 GiB), giãn tối đa 1 giây giữa hai yêu cầu. Dung lượng ≠ quota API: `storageQuotaExceeded` là `REJECTED`.
  `DriveCapacityGuard` (cache dung lượng theo giờ) từ chối upload mới không vừa trước khi gửi byte nào. UI chỉ đọc bảng local.

Mã hoá checksum của Drive và redirect loopback không path chưa kiểm chứng: xem [operations.md](operations.md).

## 11. Port, DTO và đổi nhà cung cấp

Bốn port trong `src/server/`; service nhận port qua tham số, factory chọn implementation; không plugin framework, DI container hay DSL.

- **`OcrProvider`** (`ocr/`): `limits`, `estimateCostUsd`, `start` (idempotent theo `requestKey`; xong ngay hoặc operation chờ), `poll`
  (không chờ), `findOperation`, `cancel`, `cleanup` (chỉ sau khi đã lưu output) → `MistralBatchOcrProvider`.
- **`ScriptStudioProvider`** (`script-studio/`): `ensureSource`, `detectChapters`, `extractLessons`, `writeDraft`, `draftVersion` →
  `NotebookLmScriptStudio`.
- **`ScenePlanCompiler`** (`scene-plan/`): `compile(draft, lesson, độ dài đề xuất, khoảng, revisionNote)` → `ScenePlan` → `ClaudeScenePlanCompiler`.
- **`VideoArchiveProvider`** (`archive/`): `prepareDestination` (ID cấp trước), `upload` (theo checkpoint), `verify` →
  `GoogleDriveArchiveProvider`.

DTO của port không mang khái niệm nhà cung cấp; `operationRef`, `SourceRef.remoteId`, checkpoint token là chuỗi mờ, không chứa
credential. Signal đã huỷ phải làm lời gọi thất bại trước khi gây tác dụng từ xa. Lỗi là `IntegrationError`:

```
AUTH             sai hoặc hết đăng nhập                 → dừng, chờ người dùng
QUOTA            hết hạn mức, có thể kèm retryAfterMs   → hoãn
TRANSIENT        lỗi tạm, chưa có tác dụng từ xa         → hoãn rồi gửi lại
REJECTED         bị từ chối, gửi lại vẫn lỗi            → dừng (hoặc lượt sửa AI nếu sửa được)
UNKNOWN_OUTCOME  có thể đã thực hiện                    → đối soát trước khi gửi lại
```

Mỗi port có một bộ contract dùng chung (`tests/helpers/contracts/`) chạy với fake và với adapter thật trên fake HTTP/MCP. **Đổi nhà cung
cấp:** hiện thực port, cho qua bộ contract, chọn nó trong factory. Riêng OCR: lần trích xuất đang mở lô của provider cũ dừng với
`OCR_PROVIDER_CHANGED` thay vì tự đổi, và trang đã có chữ không bị đọc lại. Riêng script studio: chọn trong `createPipelineDeps` và các nơi
tạo `NotebookLmScriptStudio` (xác định chương, phân tích chương), và đổi `draftVersion` khi prompt đổi để cache không trả bản cũ.

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
```

- Mọi đường dẫn đi qua `server/storage/safe-path.ts`: chặn `..`, đường dẫn tuyệt đối và symlink thoát khỏi `DATA_DIR`. Thư mục đặt theo
  ID, không theo tên sách. Ghi tạm rồi đổi tên; tệp gốc của sách ở chế độ chỉ đọc.
- Upload kiểm đuôi, chữ ký byte và kích thước. Tiến trình con chỉ chạy bằng mảng đối số với env đã làm sạch hoặc danh sách cho phép.
- Khoá Mistral chỉ trong đối tượng client, token Google chỉ trong tệp credential, session URI chỉ trong checkpoint. Thông điệp của nhà cung
  cấp và công cụ không vào lỗi hay log; log là JSON chỉ có ID và hash. Chỉ lắng nghe `127.0.0.1`. Quy tắc: [AGENTS.md §10](../AGENTS.md).

## 13. Kiểm thử

- **Unit** (`tests/unit`): domain thuần, Zod, safe-path, prompt, client Mistral/Google, hoạt cảnh; **contract** của từng port.
- **Integration** (`tests/integration`): service + repository trên SQLite tạm với migration thật, processor, outbox với BullMQ thật (Redis
  DB 13), Poppler thật, tình huống lỗi và tranh chấp.
- **E2E** (Playwright): `smoke.spec.ts` (luồng thủ công) và `pdf-production.spec.ts` (PDF → chương → chọn bài → sản xuất → Drive giả, không
  bước duyệt) trên stack riêng (`start-stack.ts`): DB và `DATA_DIR` tạm, Redis DB 14, worker, `next start` cổng 3100, fake Google, fake
  edge-tts.
- **Không test nào chạm tài khoản thật:** `OFFLINE_INTEGRATIONS_ENV` (`AI_MODE=mock`, xoá mọi khoá và profile) đè `.env` của máy dev; test
  cần tích hợp tự dựng fake (Mistral, Google, máy chủ MCP, Claude CLI, edge-tts sinh MP3 thật, PDF dựng tay). Bộ cần Redis hoặc Poppler tự
  báo skipped khi thiếu.

## 14. Các quyết định chính

- **Hai tiến trình, một queue, concurrency 1** — render, TTS, AI chiếm CPU/RAM hàng phút; UI phải luôn phản hồi; một người dùng, máy yếu.
- **SQLite + WAL** — một người dùng, cục bộ; sao lưu chỉ là sao chép một thư mục.
- **BullMQ thực thi, `JobRecord` là read model, đối soát khi khởi động** — UI đọc nhanh; Redis bị xoá hay worker chết vẫn được sửa lại.
- **Outbox `JobDispatch`** — job ghi cùng giao dịch với thay đổi nghiệp vụ; chết giữa SQLite và Redis không làm mất job.
- **Hoãn qua outbox, không ngủ trong worker** — lô OCR chạy hàng giờ; worker concurrency 1 không được bị giữ; lịch sống qua restart.
- **Claude chỉ qua CLI của người dùng, `cli-task` mặc định** — không API key; mỗi lần gọi do người dùng chủ động trừ khi họ bật `cli-auto`.
- **Mỗi tích hợp một port, ngoài `AiProvider`** — đổi nhà cung cấp không đụng nghiệp vụ; chi tiết Batch, MCP, OAuth nằm kín trong adapter.
- **`UNKNOWN_OUTCOME` + đối soát theo khoá, dấu tiêu đề, ID cấp trước** — mất phản hồi không dẫn tới trả tiền hai lần hay bản trùng.
- **Lớp chữ trước, OCR chỉ trang cần; trần chép vào lần trích xuất; một lô mở; micro-USD** — OCR tốn tiền; đổi cấu hình không âm thầm nâng
  chi tiêu; so trần không lệch số thực.
- **Offset UTF-16 + bản đồ trang tính lại** — cùng đơn vị với `text.slice`, không có hai nguồn sự thật.
- **Đề xuất chương phải khớp anchor, không nhận "cả sách là một chương"** — mô hình có thể bịa ranh giới; một chương khổng lồ cho bài học
  vô nghĩa.
- **NotebookLM đọc theo phần với `source_ids` tường minh; trang lấy nơi tìm thấy** — chương dài cần chia; không lẫn nguồn cũ; không tin số
  trang mô hình khai.
- **Chọn bài học ≠ duyệt; readiness do máy kiểm sau khi có audio** — sản xuất hàng loạt không có người duyệt; thời lượng thật chỉ biết sau TTS.
- **Một lượt sửa AI, không nới khoảng hay đổi nhịp độ** — giới hạn chi phí và vòng lặp; video không vừa thì thất bại rõ ràng.
- **Khoảng do người, độ dài do AI** — AI viết lời thấy nội dung nên chọn được độ dài hợp; người giữ giới hạn. Trần là giới hạn cứng,
  đề xuất chỉ là mục tiêu viết, nên dài hơn đề xuất mà còn trong khoảng không tốn lượt sửa.
- **Hai artifact tách có fingerprint, cache bản thảo** — Claude lỗi không tốn lại NotebookLM; nháp không lẫn kết quả cuối.
- **Snapshot render bất biến; render hai pha** — sửa video lúc render chờ không trộn vào; lỗi báo tiến độ không xoá được MP4 đã xong.
- **Asset server cục bộ khi render** — Chromium cần URL; chỉ phục vụ đúng tệp của snapshot, không lộ `data/`.
- **Hoạt cảnh SVG theo frame** — preview và render giống hệt; nhẹ cho CPU yếu.
- **Lưu trữ tách khỏi render, ID cấp trước, không tìm kiếm Drive** — lỗi Drive không đụng MP4; thử lại nhắm đúng đối tượng mà không đoán
  theo tên.
- **Token Google trong tệp `0600`, không trong SQLite** — bản sao DB, chẩn đoán và DTO không chứa token.
- **Sổ quota Drive cục bộ** — UI không gọi Google.
- **Trạng thái kiểu `String`** — thêm giá trị không cần migration SQLite.
