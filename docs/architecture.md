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
  giờ chạy AI, TTS, render. Redis/worker tắt thì trang vẫn mở và báo suy giảm (`/api/status`: không có khoá worker, tiến trình giữ khoá đã chết, hoặc heartbeat cũ hơn 15 giây); thao tác cần
  Redis ngay thì `PING` thử rồi trả `503 QUEUE_UNAVAILABLE`.
- **Worker:** mọi việc nặng và mọi lời gọi ra ngoài; concurrency mặc định 1; không tới được Redis thì thoát mã 1. **Chỉ một worker mỗi Redis DB:** ngay sau khi ping Redis, trước mọi bước bên dưới, worker giữ khoá
  `studio:worker:lock` (`SET NX` kèm TTL 30 giây, mỗi heartbeat gia hạn; gia hạn, nhả và thay khoá đều là script Lua so khớp giá trị nên
  worker đã mất khoá không đụng được khoá của worker mới); đã có worker khác thì ghi trạng thái của nó rồi thoát mã 1. Chủ khoá cùng máy
  mà tiến trình không còn thì bị thay ngay (`tsx watch` SIGKILL worker chậm rồi chạy bản mới tức thì), khoá ghi từ máy khác phải chờ hết
  hạn. Khởi động: giữ khoá → bật WAL →
  `sweepDueJobIntents` (giao outbox còn sót trước, để đối soát chỉ xét job đáng lẽ đã ở Redis) → `reconcileJobRecords` →
  `reconcileProductionItems`, `reconcileExtractions` (cấp job mới cho việc dở đã mất job; chỉ lúc khởi động để lỗi lặp không thành vòng)
  → `sweepRenderArchives` → mở BullMQ `Worker`. Định kỳ: heartbeat 5 giây, quét outbox 5 giây, quét archive 60 giây. SIGINT/SIGTERM:
  đóng trong tối đa 15 giây, nhả khoá sau khi job cuối kết thúc; job dở thành stalled và được đối soát lần sau.

## 2. Mô hình dữ liệu

Prisma 7 + SQLite (`prisma/schema.prisma`), migration chỉ cộng thêm. Sáu loại dữ liệu lưu riêng: tệp gốc (bất biến) → bản trích xuất →
catalogue (chương, bài học, nguồn) → bản thảo NotebookLM → kế hoạch cảnh Claude (đầu vào duy nhất của Remotion) → snapshot render (bất
biến, nguồn của manifest Drive).

- **Sách:** `Book` (tệp gốc + `sourceHash`; `md`/`txt`/`pdf`; xoá mềm, bị chặn khi có video) · `Chapter` (duy nhất `(bookId, order)`)
  · `Lesson` + `LessonSource` (duy nhất `(lessonId, chapterId, sourceLocator)`; locator `offset:<k>` hoặc `page:<n>;offset:<k>`).
- **Video:** `Video` (`scriptVersion` tăng mỗi lần kịch bản đổi; `approvedScriptVersion` do người duyệt; `autoReadyScriptVersion` do máy
  kiểm; khoảng `minDurationSec`–`maxDurationSec` người dùng cho phép, `targetDurationSec` + `durationReason` do AI đề xuất — trước khi có
  đề xuất, `targetDurationSec` = mức dài nhất và lý do null) · `VideoLesson` (snapshot bài học lúc chọn) · `VideoScene` (duy nhất `(videoId, order)`) · `MediaAsset` · `RenderRecord`
  (snapshot bất biến, `archiveIntentAt`; "lỗi thời" là suy ra `scriptVersion < Video.scriptVersion`, không lưu) ·
  `VideoPublishMetadata` (duy nhất `videoId`: tiêu đề, caption, hashtag để đăng; `origin` `AI`/`EDITED`; `sourceTextHash` =
  `scriptTextHash()` của chữ các cảnh hiện lúc viết hay lưu — khác hash hiện tại thì "Cần xem lại"; không dùng `scriptVersion` vì lồng
  tiếng cũng tăng nó).
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
GENERATE_PUBLISH_METADATA  videoId             viết lại tiêu đề, caption, hashtag (không khoá kịch bản)
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
- `CLAUDE_MODEL` tuỳ chọn đi qua `askClaude()` tới argument `--model`. Model được log cùng taskId và tham gia cache scene plan;
  model trống giữ khoá cache cũ. NotebookLM và checkpoint đã hoàn tất không bị thay đổi khi đổi model.
- `CLAUDE_EFFORT` tuỳ chọn (`low`/`medium`/`high`/`xhigh`/`max`) đi qua cùng runner tới `--effort`; giá trị trống không thêm flag.
  Effort tham gia cache scene plan khi được chỉ định; để trống giữ cả khoá cũ có/không có model. Log ghi `requestedEffort`;
  diagnostics/dry-run hiển thị cấu hình yêu cầu mà không gọi AI. Không sửa settings Claude toàn máy.
- Thư mục tác vụ: `input.json`, `prompt.md`, `schema.json` (JSON Schema draft-7 sinh từ chính schema Zod của đầu ra), `task.json`, rồi
  `output.json` hoặc `output.raw.txt`. Loại: `chapter-analysis`, `video-script`, `scene-regeneration`, `scene-plan`,
  `publish-metadata`.
- `askClaude()` là đường duy nhất tới Claude (dùng bởi `pnpm ai:run`, `AutomatedCliProvider`, `ClaudeScenePlanCompiler`): kiểm
  `claude auth status`; chạy `claude -p --output-format json --tools "" --strict-mcp-config --no-session-persistence --json-schema …` từ
  mảng đối số, prompt qua stdin; env bỏ `CLAUDECODE*`/`CLAUDE_CODE_*` (không lồng phiên) và `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`;
  timeout và huỷ → `SIGTERM`. Lỗi có mã ổn định (`AI_CLI_AUTH`, `AI_QUOTA_EXCEEDED`, `AI_CLI_TIMEOUT`, `INVALID_AI_OUTPUT`…).
- Prompt có phiên bản; đổi chữ là tăng phiên bản: `chapter-analysis-v1`, `video-script-v9` (v1.1, cùng khung kể với sản xuất, đề xuất độ
  dài, ngân sách chữ theo nhịp độ, kèm tiêu đề/caption/hashtag, quy tắc kể chuyện và góc kể); `scene-plan-v8` (biên dịch cảnh, kèm
  tiêu đề/caption/hashtag, quy tắc biên tập giữ sức hút của bản thảo);
  `publish-metadata-v1` (chỉ viết lại tiêu đề/caption/hashtag); ba prompt này dùng chung quy tắc `prompts/publish-rule.ts`, đổi chữ ở đó
  là tăng cả ba; `notebooklm-chapter-detection-v2`, `notebooklm-lesson-extraction-v2`, `notebooklm-script-draft-v6` (đề xuất độ dài,
  ngân sách chữ theo nhịp độ, quy tắc kể chuyện và góc kể),
  `notebooklm-chat-persona-v2` (vai trò của notebook); `draftVersion` của cache = phiên bản bản thảo + phiên bản vai trò. Danh sách độ dài được chọn và ngân sách lời của từng mức sinh từ `prompts/duration-choice.ts`.
  Chữ kể chuyện nằm ở `prompts/storytelling-rule.ts`: `STORYTELLING_RULE` và mô tả từng góc dùng chung cho kịch bản thủ công và bản
  thảo NotebookLM, `STORY_REWRITE_RULE` cho "Viết lại cảnh", `SCENE_EDIT_RULE` cho biên tập cảnh; đổi chữ ở đó là tăng phiên bản của
  mọi prompt dùng nó. Không tăng `chapter-analysis` và `lesson-extraction` khi đổi cách kể: tăng sẽ bắt phân tích lại mọi chương.
- **Góc kể** (`features/videos/domain/story-angle.ts`): sáu góc (`PEAK_FIRST`, `DIALOGUE`, `TWO_PATHS`, `MYTH_BUST`, `TWIST`,
  `ESCALATION`) kể cùng một khung sáu phần; khung và các kiểm tra thứ tự không đổi. `pickStoryAngle(seed, step)` =
  `STORY_ANGLES[(fnv1a(seed) + step) % 6]`, thuần và tất định, không lưu gì: kịch bản thủ công dùng `(video.id, video.scriptVersion)`
  (lưu kịch bản làm `scriptVersion` tăng nên tạo lại ra góc kế tiếp); sản xuất hàng loạt dùng `(item.batchId, item.position)`
  (`position` duy nhất trong đợt nên mục liền kề khác góc; thử lại và phục hồi dùng lại đúng góc). Góc là trường bắt buộc của
  `videoScriptInputSchema` và `WriteDraftRequest`, và nằm trong khoá cache bản thảo. Bước biên tập cảnh không nhận góc: bản thảo đã
  mang dáng kể, `SCENE_EDIT_RULE` bảo nó giữ chi tiết, thoại và cú đảo chiều.

**Kiểm soát nội dung:**

- Văn bản sách là dữ liệu không đáng tin, bọc trong khối dữ liệu (`prompts/untrusted-text.ts`); mỗi lần chỉ gửi một chương, một phần
  chương hoặc bài học đã chọn, không bao giờ cả sách. Bài học, lời dẫn, chữ trên màn hình luôn tiếng Việt; trích đoạn giữ ngôn ngữ gốc.
- Sai schema → `FAILED`, không lưu gì. Trích đoạn chỉ giữ khi tìm thấy thật trong văn bản chương (`locateExcerpt`, bỏ qua khoảng trắng).
- **Bộ chặn khẳng định không có căn cứ** (`findUnsupportedClaims`): con số hay câu trích dẫn trong kế hoạch cảnh mà không có trong bản
  thảo hoặc bài học (so sau chuẩn hoá NFC, chữ thường, khoảng trắng) làm kế hoạch bị từ chối (`SCENE_PLAN_UNSUPPORTED_CLAIM`) và không
  được lưu. Đây là lưới an toàn cơ học, không chứng minh được sự trung thực. Lõi dùng chung (`videos/domain/source-claims.ts`) cũng
  kiểm tiêu đề, caption, hashtag với nguồn là chữ kịch bản, snapshot bài học, tên sách và tác giả.
- **Tiêu đề, caption, hashtag:** trong schema của tác vụ `video-script`/`scene-plan`, `publish` là optional và kiểu lỏng, để một bộ sai
  không làm hỏng kịch bản; sau đó `acceptPublishMetadata()` chuẩn hoá hashtag (bỏ `#`, bỏ dấu, chữ thường, không trùng), kiểm giới hạn
  và bộ chặn trên. Không đạt thì bỏ bộ đó và ghi log (kịch bản vẫn lưu, bộ cũ nếu có giữ lại và hiện "Cần xem lại"); với
  `GENERATE_PUBLISH_METADATA` thì job `FAILED` (`PUBLISH_METADATA_UNSUPPORTED_CLAIM` / `INVALID_AI_OUTPUT`), không lưu gì. Bộ hợp lệ
  được ghi trong cùng giao dịch với kịch bản (`replaceScriptWithin`).
- Hoạt cảnh chỉ nhận giá trị từ danh sách cố định, sinh vào prompt từ `videos/domain/illustration.ts`.
- `ClaudeScenePlanCompiler` đặt tên tác vụ theo hash đầu vào nên hỏi lại cùng đầu vào không tốn thêm lượt Claude. Sản xuất hàng loạt chỉ
  chạy với `mock` hoặc `cli-auto`; `cli-task` bị từ chối vì không thể chờ người chạy `pnpm ai:run` từng video.

## 5. Luồng thủ công (v1.1)

- Nhập `.md/.txt`: tệp giữ tạm ở `imports/<id>/` để xem trước cách tách chương; xác nhận mới tạo sách; tệp gốc ghi nguyên byte rồi đặt
  chỉ đọc. Parser chương dùng chung cho sách PDF.
- `ANALYZE_CHAPTER` → `analyzeChapter` → Zod → kiểm trích đoạn → thay bài nháp AI cũ. `GENERATE_VIDEO_SCRIPT` tạo 2–3 phương án hook +
  các cảnh từ snapshot bài học, kèm tiêu đề/caption/hashtag. Sửa kịch bản đã duyệt → `NEEDS_REVIEW`.
- Tab **Đăng tải**: `PUT /api/videos/:id/publish-metadata` lưu bản sửa tay (`origin = EDITED`, hash hiện tại);
  `POST …/publish-metadata/generate` xếp `GENERATE_PUBLISH_METADATA`. Cả hai bị chặn bởi `assertScriptNotGenerating()`; lưu còn bị chặn khi
  job viết lại đang chạy (`PUBLISH_GENERATION_IN_PROGRESS`). Job này không khoá trình biên tập (`findActiveVideoJob` chỉ xét job kịch bản).
- Tạo video thủ công: `POST /api/videos` ghép 1–5 bài thành một video; `POST /api/videos/bulk` (`createVideosFromLessons`) tạo mỗi bài một video
  (tối đa 30) trong **một giao dịch** nên không để lại video dở. Cả hai dùng `loadLessonsForNewVideos` (bài `APPROVED`, cùng sách, snapshot).
- Hàng đợi giọng đọc: `enqueueTrackedJob` đã dùng lại job đang chạy của cùng cảnh, nên máy chủ không nhân việc; trạng thái hiện ra từ
  `getVoiceJobs(videoId)` (job `GENERATE_SCENE_TTS` mới nhất của mỗi cảnh, chỉ giữ cái chưa xong hoặc lỗi; `findLatestJobsForEntities`),
  truyền cho `VoicePanel`. Trang tự làm mới bằng `JobsAutoRefresh` khi còn cảnh trong hàng đợi, không bằng vòng lặp ở trình duyệt, nên đóng
  rồi mở lại trang vẫn đúng. `useVoiceRequest` giữ nút tắt cho tới khi trang vẽ lại với trạng thái hàng đợi mới.
- `runSceneTts`: khoá `sha256(engineVersion của provider, giọng, tốc độ, lời dẫn)`; trượt thì provider TTS (cổng `TtsProvider`, chọn bằng
  `TTS_MODE`; hiện chỉ có `edge-tts`, lời dẫn qua tệp, không qua dòng lệnh; lỗi là `IntegrationError` mã `TTS_*`, hết lần thử là `TRANSIENT` nên
  đường ống sản xuất hoãn và thử lại) →
  cắt lặng đầu/cuối (ffmpeg) → đo (ffprobe) → `videos/<videoId>/audio/<hash>.mp3`. Audio tải lên (nhận bằng chữ ký byte) chỉ được đo.
- **Mốc từng từ:**
  - `synthesize` trả `{ boundaries }`, tính theo mili giây của audio thô.
  - Adapter edge-tts chạy `edge-tts-words.py` bằng argv: API Python của edge-tts với `boundary="WordBoundary"`, vì CLI chỉ cho mốc
    câu.
  - Python lấy từ `EDGE_TTS_PYTHON`, nếu trống thì từ shebang của `EDGE_TTS_COMMAND`, cuối cùng `python3`
    (`edge-tts-python.ts`).
  - Script thoát mã 3 khi thiếu module, adapter báo `TTS_UNAVAILABLE`. Tệp mốc hỏng chỉ làm mất mốc, giọng vẫn giữ.
  - `runSceneTts` trừ phần lặng bị cắt (lặng đầu của audio thô − của audio đã cắt, đo ngưỡng 20 ms) rồi lưu vào
    `MediaAsset.wordBoundariesJson`; upload để null.
  - `EDGE_TTS_ENGINE_VERSION = "edge-tts-words-v1"`: khoá cache đổi, nên "tạo lại giọng" tạo mới; không gì tự lồng tiếng lại.
  - `alignWordTimings` (`domain/word-timing.ts`) ghép mốc với các từ của lời dẫn (bỏ dấu, NFC, nhìn trước 3 từ). Khớp dưới 90 % hoặc
    mốc chạy lùi thì quay về ước lượng và tắt `karaoke`.

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

Trước khi phân loại, `repairTextLayer` (`domain/text-layer-repair.ts`, thuần) xét **cả cuốn**: một số máy in PDF vẽ đúng glyph đ/Đ
nhưng ghi mã `ñ` (U+00F1) / `ð` (U+00F0) vào lớp chữ. Khi ≥ 20 ký tự `ñðÑÐ` chiếm ≥ 20 % tổng `ñðÑÐđĐ`, mọi `ñ→đ`, `ð→Đ`, `Ñ→Đ`,
`Ð→Đ` (một ký tự đổi một ký tự, nên mọi offset vẫn đúng); dưới ngưỡng thì giữ nguyên (tên Tây Ban Nha trong sách tiếng Việt). Trang
OCR không đi qua bước này. `text-layer-repair.service.ts` làm cùng việc cho sách đã nhập: sửa trang đã lưu, `canonical.md`, tên và
file chương (kèm `contentHash`), `LessonSource.sourceExcerpt`, và ghi lại các lần phân tích chương đã xong dưới hash mới
(`analysis-hash-changes.ts`) để chương không bị coi là cần phân tích lại. File được ghi trước, cơ sở dữ liệu sau trong một giao
dịch, nên chạy lại sau sự cố sẽ hoàn tất; không chạy khi còn chương đang phân tích; sao lưu cơ sở dữ liệu (`VACUUM INTO`) và các
file cũ vào `data/backups/before-text-repair-*` trước khi ghi.

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
- Một tiến trình MCP cho một lần chạy job: mở ở lời gọi đầu, kiểm tra `usage_get` trước khi xử lý, đóng trong `finally`; lúc đóng đọc `usage_get` và ghi
  `data/integrations/notebooklm-status.json` (phần trăm — vắng là "không rõ", không phải 0 —, giờ đặt lại, gói; không cookie).
- Lời gọi công cụ chờ tối đa `NOTEBOOKLM_CALL_TIMEOUT_SEC` (mặc định 360 giây; một câu hỏi về một phần chương mất 100–170 giây trên tài
  khoản thật, đôi khi hơn 180), bắt tay và `tools/list` chờ 60 giây. Quá hạn → `MCP_TIMEOUT` (`TRANSIENT`) với lỗi nêu tên lời gọi và số
  giây, và `details: { call, timeoutMs }`; riêng công cụ thay đổi dữ liệu thì là `UNKNOWN_OUTCOME`.

### 7.2 Notebook và nguồn

- Một notebook mỗi `(bookId, profile)`, tiêu đề `Book Video Studio · <sách> [bvs:<bindingId>]`. Mỗi phần văn bản (`sourceKey`) ở mỗi
  phiên bản (`contentHash`) là một nguồn văn bản mang dấu `[bvs:<id>]`; văn bản đổi → dòng mới, bản cũ `supersededAt` nhưng giữ ID từ xa
  để còn truy nguồn bài học cũ.
- Tạo mất phản hồi → `UNKNOWN_OUTCOME`; lần sau **tìm dấu** trong `notebook_list`/`notebook_get` trước rồi mới tạo lại.
- Trước câu hỏi đầu tiên (`openBookNotebook`, lối vào của mọi nguồn), notebook được đặt "Configure chat" qua `chat_configure`: vai trò
  tuỳ chỉnh `notebooklm-chat-persona-v2` (phân tích sách + biên kịch video dọc, kể bằng khoảnh khắc cụ thể khi viết bản thảo, bám
  nguồn, câu hỏi đòi định dạng nào trả đúng định dạng đó) và câu trả lời `longer`. Phiên bản đã áp lưu ở `NotebookBinding.chatPersonaVersion` — chỉ ghi khi NotebookLM xác nhận; notebook
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

Mỗi phần được hỏi (`notebook-part-answers.service.ts`) ghi thêm `AiRun(mode=notebooklm-part)`: thời gian hỏi hoặc lý do lỗi, và câu trả lời
trong `ai-tasks/<job>/notebooklm-part-<n>-<hash>.json`. `inputHash` = sha256(phiên bản prompt, tên sách, tên chương, số phần, trang, hash
văn bản phần). Lần chạy sau (tự thử lại sau lỗi tạm thời, hay job mới do **Thử lại**) không hỏi lại phần có câu trả lời đầy đủ hoàn tất sau
`Chapter.analyzedAt`; vì mỗi lần phân tích xong đặt `analyzedAt`, **Phân tích lại** một chương đã xong hỏi lại mọi phần. Câu trả lời
`complete: false`, hỏng schema hay mất file thì hỏi lại.

### 7.4 Bản thảo và cache

- `writeDraft` đọc mọi phần của mọi chương bài học trích dẫn (cùng khoá với lúc lập danh mục nên không tải lại). Prompt ép mạch kể HOOK →
  tình huống → sai lầm → bài học → giải quyết → hành động; sai định dạng hay sai thứ tự → `DRAFT_INVALID`. Bản thảo kèm
  `targetDurationSec` (một mức trong khoảng của video) và `durationReason`; ngoài khoảng → `DRAFT_LENGTH_OUT_OF_RANGE`.
- `ScriptDraftCache.cacheKey` = sha256(provider, `draftVersion`, bài học + `contentHash`, khoảng thời lượng, nhịp độ, góc kể, **tập**
  remote ID nguồn, ghi chú sửa). Cùng bài học kể theo góc khác là bản thảo khác.
  Bước bản thảo hỏi cache trước; trượt thì gọi NotebookLM rồi lưu ngay.

## 8. Pipeline sản xuất

### 8.1 Yêu cầu

`requestProduction` (`POST /api/productions`; ở giao diện là nút **Tạo N video** của thanh thao tác tab Bài học, trang `/books/:id/produce` giữ
nguyên): bài học cùng sách, không `ARCHIVED`, có ít nhất một trích đoạn. Một **nested create** ghi
batch + mỗi bài một item + một `Video` (snapshot bài học dựng như luồng thủ công) + job `RUN_PRODUCTION_ITEM` — đủ cả hoặc không gì. Chọn
không phải duyệt trước: không đòi `APPROVED`, và chính giao dịch này đổi các bài `DRAFT` được chọn thành `APPROVED` (`updateMany` có
`status = DRAFT`, nên bài đã duyệt giữ nguyên và bài `ARCHIVED` không bao giờ được đưa lại, kể cả khi bị lưu trữ giữa lúc kiểm tra và lúc
ghi). `createProduction` dùng chung nên đợt nhập nhiều PDF (`produceAllLessons`) cũng duyệt như vậy. Cùng `idempotencyKey` + cùng `fingerprint` (sách, bài học theo thứ
tự, khoảng thời lượng) → trả batch cũ; cùng khoá khác nội dung → `409`; gửi đua → một batch (bên thua bắt `P2002`).

Server **cố ý** cho sản xuất lại cùng bài dưới khoá mới. Việc ngăn làm một bài hai lần khi bản đầu còn chạy là của giao diện
(`productionBlock`, `getActiveProductionsByLesson`: mục `PENDING/RUNNING/WAITING`): danh sách bài học gắn nhãn **Đang sản xuất** và không
tính bài đó vào nút. `productionUnavailableReason` hỏi đúng `createScriptStudioProvider` mà worker dùng, nên hộp thoại báo thiếu
`cli-auto`/`NOTEBOOKLM_PROFILE` trước khi tạo đợt, không đợi từng video lỗi.

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
  của SQLite WAL; chỉ một người thắng), rồi ghi cảnh qua `replaceScriptWithin`, **cùng đường ghi** với luồng thủ công, kèm tiêu đề/caption/
  hashtag của kế hoạch nếu đạt quy tắc. Áp lại cùng kế hoạch → `ALREADY_APPLIED`, giữ nguyên cảnh và audio. Kế hoạch lưu trước khi có
  `publish` vẫn qua fingerprint (trường optional, không default).
- **Lồng tiếng:** từng cảnh, đúng thứ tự, qua `runSceneTts` (có cache; không gọi song song dịch vụ trực tuyến). Dừng sớm giữ audio đã tạo;
  chỉ chuyển `VOICED` khi mọi cảnh có audio.
- **Readiness** (`assessReadiness`) thay cho duyệt tay: mọi quy tắc chặn của preflight FINAL (§9.3) trên audio thật, cộng
  `UNDER_MIN` (với người chỉ là cảnh báo), `AUDIO_NOT_READY` và `SOURCE_MISSING`; báo mọi vấn đề một lượt. Đạt → `markAutoApproved` ghi **một
  câu lệnh CAS** (`where scriptVersion = đã kiểm`): `autoReadyScriptVersion = scriptVersion`, `status = APPROVED`, `approvedScriptVersion =
scriptVersion`. Không đạt thì không ghi gì. Từ đó video theo luật của luồng thủ công: sửa kịch bản → `bumpScript` → `NEEDS_REVIEW` (và
  `autoReady` tự hết hiệu lực vì `scriptVersion` đổi); đổi giọng chỉ `bumpContentVersion`, vẫn `APPROVED`. `autoReady` vẫn có trong snapshot
  render và preflight, nên bản render FINAL đi qua cả hai cách.
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
  nội dung từng shot trong `<Sequence playbackRate>`. Shot giữ độ dài thật nên điểm cắt vẫn nằm đúng chữ; phụ đề, thanh tiến độ và âm thanh
  nằm ngoài nên giữ thời gian thật. Snapshot lưu `video.pace` (tuỳ chọn, bản cũ đọc là Chuẩn). Cổng `TtsProvider` (`server/tts/`) nhận `speedPercent`, adapter tự đổi sang
  tham số của dịch vụ.
- Độ dài cảnh = `ceil((durationMs + paddingMs của nhịp độ) / 1000 × 30)` theo audio thật, tối thiểu 2 giây; trước khi có audio ước lượng
  theo âm tiết/giây của nhịp độ (4 ở Chuẩn). Không bao giờ cắt lời hay tự tăng tốc để vừa khoảng.
- **Phụ đề** (`domain/caption-pages.ts`):
  - Thời gian từng từ ước lượng theo âm tiết, có thêm nghỉ sau dấu câu (`domain/word-timing.ts`), trong phần có lời của clip.
    `CompositionSource.scenes[].audio` mang `durationMs` và `leadingSilenceMs`; `toCompositionSource` ghép chúng từ `snapshot.audio`.
  - Chia trang ≤ 2 dòng × 22 ký tự, ≤ 8 từ.
  - Ngắt sau dấu kết câu, sau dấu phẩy khi trang đã đủ dài, và ở khoảng ngừng ≥ 300 ms.
  - `karaoke` chỉ bật khi thời gian lấy từ chính giọng đọc.
- **Shot** (`domain/scene-shots.ts`):
  - Mỗi cảnh, tức một clip giọng, chia thành shot tại đầu các trang phụ đề khi shot đang chạy đã khoảng 2,5 giây. Mỗi shot dài 54–150
    frame; đoạn dài hơn chia đều.
  - Cỡ cảnh xen kẽ WIDE/MEDIUM. Hook mở MEDIUM.
  - Cảnh tiếp ở cùng bối cảnh mở bằng cỡ khác shot cuối của cảnh trước. Màn chữ (`BIG_TAKEAWAY`, `ACTION_CHECKLIST`) là một shot.
- **Lớp hình** (`src/remotion/layers/visual-track.tsx`):
  - Dùng `TransitionSeries`; giọng và phụ đề nằm ở một `Series` riêng (`caption-layer.tsx`).
  - Hình của cảnh _i_ kéo dài thêm đúng độ dài chuyển cảnh sau nó (`d_i = f_i + t_i`, `timeline/scene-transitions.ts`). Nhờ vậy hình
    nào cũng bắt đầu đúng khung giọng của nó, và tổng vẫn là Σf.
  - Cùng bối cảnh thì cắt thẳng; đổi bối cảnh thì `wipe`; vào hoặc ra màn chữ thì `slide`; chữ sang chữ thì `fade`. Chỉ dùng các kiểu
    chuyển cảnh CSS, không dùng loại WebGL.
- Audio được phục vụ cho Chromium bởi asset server tạm ở `127.0.0.1:<cổng ngẫu nhiên>`, chỉ đúng các tệp snapshot nêu.
- `RENDER_TEMPLATE_VERSION` (`composition-props.ts`) ghi vào mọi snapshot; tăng khi thay đổi Remotion làm cùng props trông khác.
  Vùng an toàn chỉ là lớp phủ trong editor, không vào MP4.

### 9.2 Snapshot và `runRender`

- `captureRenderSnapshot` chụp lúc **yêu cầu** render: cảnh, audio theo đường dẫn lưu (tên theo hash nội dung nên byte không đổi), nguồn
  bài học, kích thước/chất lượng, `scriptVersion`, cổng duyệt (`status`, `autoReady`), template, và tiêu đề/caption/hashtag khi bộ hiện
  tại không "Cần xem lại" (`publish`, optional không default nên snapshot cũ giữ hash). Lưu kèm `snapshotHash` (sha256 JSON khoá sắp
  xếp), **không bao giờ ghi đè**; khi đọc phải đúng schema và hash. ESLint cấm `render-runner.ts` đọc video sống.
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

- **Sân khấu** (`src/remotion/stage/`):
  - Gồm 7 bối cảnh phẳng (`sets/sets.tsx`: lớp sau, lớp trước che phần dưới của nhân vật bán thân, mặt đất cho nhân vật cả người) và
    camera (`camera.tsx`: điểm nhìn + zoom, tâm ở y 950 giữa dải hình).
  - Mỗi hành động có dáng, mặt và dấu hiệu riêng (`cast.ts`). Nhân vật luôn thuộc họ trang phục áo sáng nên đổi dáng không thành người
    khác. Ngoại hình (tóc, kính) chọn theo tiêu đề video.
- **Màn chữ** (`text/text-scene.tsx`): chữ lớn đo bằng font thật (`@remotion/layout-utils`, đo một lần mỗi chữ), số và trích dẫn được
  nhấn, danh sách "1) 2) 3)" tách dòng.
- **Hình bên thứ ba** vào mã qua script sinh dữ liệu, chỉ còn path phẳng; nguồn ghi ở `THIRD_PARTY_NOTICES.md`.
  - Open Peeps: `pnpm peeps:generate` đọc `react-peeps`, ra `peeps/peeps-art.generated.ts`.
  - Fluent Emoji Flat: `pnpm props:generate --source <assets>`, ra `props/prop-art.generated.ts`, phủ đủ `PROP_IDS`.
- Mọi chuyển động là hàm của frame. Không `filter`/blur (chậm trong Chromium headless), không ảnh, không ngẫu nhiên, không gói Remotion
  dùng mạng hay WebGL: `render-rules.test.ts` và ESLint kiểm.
- `illustrationJson` null = mặc định theo loại cảnh; hash cảnh chỉ tính hoạt cảnh khi có lựa chọn nên dữ liệu cũ giữ hash.

## 10. Lưu trữ lên Google Drive

### 10.1 Luồng

```
render FINAL COMPLETED + archiveIntentAt ─► requestRenderArchive | sweepRenderArchives (khởi động + mỗi phút)
  ─► RenderArchive + 3–4 RenderArchiveFile + job ARCHIVE_RENDER (một giao dịch, tài khoản đang kết nối)
  ─► dựng script/publish/manifest ─► prepareDestination ─► upload MP4 → script → publish → manifest ─► verify ─► COMPLETED khi mọi tệp VERIFIED
```

- Archive tách khỏi render; `destinationKey` = `permissionId` của tài khoản. Chưa kết nối Drive → không làm gì, ý định vẫn nằm trên
  render. Processor **chỉ upload**.
- `script.json` và `manifest.json` (thông số render, `snapshotHash`, tên + byte + SHA-256 của MP4 và script) dựng **chỉ từ snapshot**,
  không có đường dẫn local, JSON khoá sắp xếp nên dựng lại ra cùng byte. Cảnh minh hoạ: snapshot ghi `illustrative` cho từng cảnh lúc
  chụp (nhịp bản thảo có `illustrative` của item sản xuất, ánh xạ sang loại cảnh bằng `SCENE_TYPE_FOR_BEAT`; video làm tay không có
  bản thảo nên là các cảnh `HOOK`, `SITUATION`, `COMMON_MISTAKE`, `BETTER_APPROACH`, nơi truyện bịa của kịch bản chạy qua; chỉ snapshot
  mới chụp theo quy tắc này, snapshot đã lưu bất biến); `script.json` ghi cờ theo cảnh, `manifest.json` liệt kê
  `illustrativeScenes`. Snapshot cũ không có cờ thì hai tệp giữ đúng byte như trước để archive dở không báo tệp đổi.
- Link Drive của video: `archiveVideoUrl` (`/file/d/<id>/view`) khi tệp `VIDEO` ở trạng thái `VERIFIED` (ID được cấp trước khi upload nên ID
  một mình không chứng minh gì), `archiveFolderUrl` chỉ khi cả archive `COMPLETED`. `getVideoDriveLinks(videoIds)` trả cho mỗi video bản render
  FINAL hoàn tất mới nhất cùng archive mới nhất của nó và cờ `outdated` (`scriptVersion` cũ hơn video), cho đầu trang video và cột Drive của
  danh sách; trang Render dùng `getVideoArchives` cho thẻ `DriveCard` và lịch sử.
- Link Drive theo sách: `GET /api/books/:id/drive-links` → `getBookDriveLinks` (mọi video của sách, cũ nhất trước, cùng `VideoDriveDto`). Trang
  tiến độ nhập nhiều PDF (`BookDriveLinks`) chỉ gọi nó khi người dùng mở danh sách và gọi lại khi `refreshKey` (số video xong và số video lên
  Drive) đổi, nên DTO được hỏi mỗi 3 giây giữ nhẹ: chỉ có số đếm `videosOnDrive` (một truy vấn `renderId IN (…)` có `status = COMPLETED`) và
  `driveConnected` (`currentArchiveDestination`), không có danh sách video.
- `publish.txt` (tiêu đề, rồi caption + hashtag sẵn để dán; `formatPublishText`) chỉ có khi snapshot có `publish`: archive tạo hàng
  `PUBLISH` lúc được yêu cầu, `manifest.json` thêm `files.publish`. Archive chạy theo **chính các hàng tệp của nó**, nên archive tạo
  trước khi có `publish.txt` vẫn chạy tiếp với ba tệp; `prepareDestination` cấp ID cho mọi loại, ID thừa không dùng. Cây Drive:
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
  giờ (mặc định 5.000 yêu cầu, 750 GiB), giãn tối đa 1 giây giữa hai yêu cầu. Dung lượng ≠ quota API: `storageQuotaExceeded` là `REJECTED`.
  `DriveCapacityGuard` (cache dung lượng theo giờ) từ chối upload mới không vừa trước khi gửi byte nào.
  `DriveStorageSnapshot` lưu riêng số liệu nguyên bản từ `about.get` theo tài khoản, không cộng byte upload ước tính.
  Settings đọc snapshot local; nút “Đọc lại từ Google” gọi `POST /api/integrations/drive/capacity/refresh`, tính vào ledger API,
  rồi cập nhật snapshot. Tổng Google (`usage`), riêng Drive (`usageInDrive`) và thùng rác (`usageInDriveTrash`) được tách rõ.

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
  videos/<videoId>/           audio/<contentHash>.<mp3|wav>, renders/<renderId>-<draft|final>.mp4, -script.json, -publish.txt, -manifest.json
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

### Điều phối nhiều sách

Khi đánh dấu outbox đã gửi, so cả mã job của lần gửi đó: worker có thể hoãn sang mã job mới trước khi enqueue cũ nhận
xong phản hồi. Một xác nhận cũ không được đánh dấu lịch hoãn mới là đã gửi.

`features/book-imports` lưu `BookImportBatch` và tối đa 15 `BookImportItem`. API tạo manifest có idempotency key; mỗi
PDF dùng request body stream riêng, đi qua kiểm tra signature, hash và dung lượng của PDF importer. Sách và extraction
`STAGED` được gắn vào item trong cùng giao dịch; chưa có job OCR khi đang tải file hoặc chờ sách trước.

`worker/lifecycle/book-import-sweeper.ts` kiểm tra mỗi 10 giây, không chồng lượt chạy. Nó chỉ điều phối: kích hoạt một
extraction kèm job/outbox trong giao dịch, xếp một chương mỗi lần, rồi chụp toàn bộ danh mục thành các production nhóm
tối đa 100 bài học. Production giữ khoá cố định theo item/nhóm để replay không thêm video. AI, TTS và render vẫn chạy
trong processor hiện có. Đợt `RUNNING` được ưu tiên trước đợt `QUEUED`; mỗi thời điểm chỉ một sách của các đợt tự động
được xử lý. Không có tiến trình thứ ba hoặc queue thứ hai.

`ProviderCooldown` giữ lịch chờ dùng chung của Claude, NotebookLM, Mistral, edge-tts và Drive. Quota không tăng bộ đếm
lỗi tạm thời; job hoãn bằng outbox với `availableAt` từ mốc reset, không chạy lại trước mốc đó. CLI báo
`resetsAt`/`resets_at`/`reset_at`, khoảng tương đối hoặc giờ kèm múi giờ thì dùng thông tin đó; khi không có giờ reset,
một tác vụ thực đang chờ là lần thử tiếp theo sau ít nhất một phút. Scheduler chung chỉ lấy job đến hạn, không có vòng
poll quota riêng cho job đang chờ 30 phút hay 1 giờ. Không gọi `/usage` như một prompt và không truy cập
credential Claude. NotebookLM đọc `usage_get` khi mở phiên và sau lỗi quota: chỉ các cửa sổ cạn hạn mức mới chặn;
nhiều cửa sổ cùng cạn thì dùng mốc reset muộn nhất. Trạng thái không rõ không bị hiểu là hết hạn mức; lỗi đọc usage
tạm thời không chặn việc xử lý, nhưng lỗi đăng nhập hoặc quota của chính usage vẫn được phân loại. Kiểm tra trong Cài
đặt bỏ qua bước chặn để vẫn hiển thị quota đã cạn. NotebookLM không báo giờ reset thì nghỉ 15 phút; Mistral nghỉ 5 phút;
mọi `Retry-After` được tôn trọng.
Outage cũng mở khoảng nghỉ dùng chung; chỉ lỗi tạm thời thực tế tăng bộ đếm retry. `UNKNOWN_OUTCOME` vẫn qua đối soát
của adapter hiện có. Job phân tích chương có bộ đếm lỗi tạm thời riêng để quota dài không làm hết lượt retry.
Job bị giữ lại bởi khoảng nghỉ do lỗi tạm thời của tác vụ khác được ghi lý do "<Dịch vụ> vừa lỗi ở một tác vụ khác; tạm nghỉ rồi tự thử
lại." (mã lỗi gốc giữ nguyên) thay vì lặp lại lỗi của tác vụ kia, vì nó chưa lỗi; khoảng nghỉ do quota giữ nguyên lời của quota. Worker
ghi một dòng log khi khoảng nghỉ bắt đầu và một dòng khi job phân tích chương bị hoãn vì lỗi tạm thời.

## 14. Thông báo Telegram

`NotificationProvider` và adapter Telegram ở `server/notifications/`; nghiệp vụ thông báo ở feature `notifications`.
Các repository ghi `NotificationDelivery` cùng transaction với sự kiện mới; `eventKey` duy nhất chặn phát lại cùng sự kiện.
Archive hoàn tất chỉ ghi tin sẵn sàng khi MP4 đã `VERIFIED`; link lấy từ `remoteFileId` của đúng render, tiêu đề ưu tiên snapshot.
Lỗi production/extraction/archive có nguồn riêng; job/batch cha không phát lại lỗi con.

Worker có sweeper 5 giây, một tin mỗi lượt, timeout HTTP 10 giây và lease 60 giây. Trạng thái `PENDING → SENDING → SENT/FAILED`;
lease hết hạn được lấy lại sau restart. Tối đa 8 lần gửi cho lỗi tạm/không rõ kết quả, backoff 30 giây tới 30 phút;
429 chặn cả channel tới `retry_after` và không tiêu lượt lỗi tạm. Token chỉ đọc từ config, không lưu trong outbox.
Telegram không có khoá idempotency cho gửi tin: theo lựa chọn người dùng, kết quả mơ hồ được gửi lại, có thể trùng cùng mã sự kiện.
`ProviderCooldown.kind/episodeId` gộp chờ quota qua restart; hết giờ chưa phải phục hồi, phải có lần gọi thành công.
Diagnostics chỉ đọc SQLite, không gửi tin. CLI gửi test hoặc xếp lại một tin `FAILED`; không chạy lại video.

`TELEGRAM_MODE=forum` bật định tuyến topic. Outbox lưu `bookId`/`bookTitle`, `useTopics` và ID thread đã gửi; không phân tích ngược
chuỗi thông báo để tìm sách. Chế độ được chụp khi ghi sự kiện, tin cũ mặc định vẫn gửi vào chat/channel như trước.
`NotificationTopic` có khoá duy nhất `(chatId, scopeKey)` với `book:<bookId>` hoặc `system`, trạng thái
`PENDING → CREATING → READY`; một lease 60 giây chặn hai caller cùng tạo. Topic READY được dùng lại kể cả đổi tên sách/restart.
Tạo topic bị từ chối có thể thử lại sau khi sửa quyền; 429 hoãn theo lịch chung. Timeout, phản hồi 5xx/malformed hoặc crash trong
lúc tạo thành `UNKNOWN` vì Bot API không có khoá idempotency hay API tìm topic theo mã sách. Không lặp lại POST khi kết quả chưa rõ.
CLI `--bind-topic <bookId|system> --thread <id>` gắn topic đã kiểm tra và mở lại các tin bị lỗi topic; không gọi AI/render hoặc tạo
topic từ tên trùng. Topic đóng/xoá trả lỗi rõ, không tự tạo mới hoặc gửi tin ra luồng chung. Không cần webhook/getUpdates.

## 15. Các quyết định chính

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
- **Tiêu đề/caption/hashtag viết cùng kịch bản, kiểm sau, lỗi thời theo hash chữ** — không tốn thêm lượt AI; bộ sai không làm hỏng kịch
  bản; lồng tiếng hay đổi hoạt cảnh không làm caption "Cần xem lại".
- **Asset server cục bộ khi render** — Chromium cần URL; chỉ phục vụ đúng tệp của snapshot, không lộ `data/`.
- **Hoạt cảnh SVG theo frame** — preview và render giống hệt; nhẹ cho CPU yếu.
- **Lưu trữ tách khỏi render, ID cấp trước, không tìm kiếm Drive** — lỗi Drive không đụng MP4; thử lại nhắm đúng đối tượng mà không đoán
  theo tên.
- **Token Google trong tệp `0600`, không trong SQLite** — bản sao DB, chẩn đoán và DTO không chứa token.
- **Sổ quota Drive cục bộ** — UI không gọi Google.
- **Trạng thái kiểu `String`** — thêm giá trị không cần migration SQLite.
