# Sổ tay vận hành luồng v1.2 (PDF → OCR → NotebookLM → Claude → Remotion → Drive)

Tài liệu cho người chạy Book Video Studio trên máy của mình. Luồng v1.1 (`.md/.txt`, duyệt bài học, render thủ công)
không đổi và không cần gì ở đây. Kiến trúc chi tiết nằm ở [`architecture.md`](./architecture.md) §11; danh sách biến
môi trường đầy đủ ở [`README.md`](../README.md).

## 1. Cài đặt một lần

| Thành phần        | Cần làm                                                                                                                                                                                                                                                                                                                                                  | Kiểm tra                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Poppler (đọc PDF) | `sudo apt-get install -y poppler-utils` (hoặc đặt `POPPLER_BIN_DIR` tới thư mục chứa `pdfinfo`, `pdftotext`, `pdfimages`, `pdfseparate`, `pdfunite`)                                                                                                                                                                                                     | Cài đặt → thẻ "Poppler (PDF)" là "Ổn"                                           |
| Mistral OCR       | Đặt `MISTRAL_API_KEY`. Xác nhận model `MISTRAL_OCR_MODEL` (mặc định `mistral-ocr-4-1`) có trong tài khoản và đơn giá batch `MISTRAL_OCR_USD_PER_1000_PAGES` khớp bảng giá. Chỉ cần khi sách có trang scan hoặc font tiếng Việt cũ                                                                                                                        | Thẻ "Mistral OCR"; lần OCR đầu tiên (xem §6)                                    |
| NotebookLM        | Cài [uv](https://docs.astral.sh/uv/). Đăng nhập một lần trong terminal của bạn: `uvx --from notebooklm-mcp-cli nlm login --profile <tên>`, đặt `NOTEBOOKLM_PROFILE=<tên>` và `AI_MODE=cli-auto`. Worker chỉ dùng profile này cho tiến trình của nó                                                                                                       | Cài đặt → Tích hợp → NotebookLM → "Kiểm tra NotebookLM" (worker phải đang chạy) |
| Claude (biên tập) | Claude Code CLI đã đăng nhập (`claude`), `AI_MODE=cli-auto`                                                                                                                                                                                                                                                                                              | Thẻ "Claude Code CLI"                                                           |
| Google Drive      | Tạo OAuth client loại **Desktop app** trong Google Cloud project của bạn, bật Google Drive API, thêm tài khoản của bạn vào test users nếu màn hình đồng ý ở trạng thái Testing. Đặt `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, khởi động lại, rồi Cài đặt → Google Drive → "Kết nối". Ở chế độ Testing, Google cho refresh token sống 7 ngày | Thẻ Google Drive "Đã kết nối"                                                   |
| giọng đọc         | edge-tts (`pip install edge-tts`) — sản xuất hàng loạt luôn dùng edge-tts                                                                                                                                                                                                                                                                                | Thẻ "edge-tts"                                                                  |

Chạy như bình thường: Redis, `pnpm worker:dev`, `pnpm dev`. Mọi việc nặng chạy trong worker; nếu worker tắt, các việc nằm
trong outbox và chạy tiếp khi worker lên lại.

## 2. Luồng người dùng và nơi theo dõi

1. **Nhập sách → tab "Sách PDF"**: tệp được gửi thẳng (thanh tiến độ là số byte thật), xong chuyển sang trang sách.
2. **Trang sách → thẻ "Trích xuất PDF"**: bốn bước (đọc PDF → OCR trang cần thiết → ghép văn bản → tạo chương), số trang
   theo trạng thái, chi phí OCR, lý do dừng, nút "Thử lại" và "Trần chi phí OCR". Không có phần trăm: thời gian OCR phụ
   thuộc hàng đợi lô của Mistral (có thể vài giờ); worker tự kiểm tra lại, không cần mở trang.
3. **"Phân tích tất cả chương"**: với sách PDF và NotebookLM đã cấu hình, mỗi chương được NotebookLM đọc theo phần và tạo
   bài học kèm trích đoạn đã đối chiếu + số trang. Không cần duyệt bài học.
4. **"Sản xuất video"**: chọn bài học (chọn không phải duyệt) + preset → trang `/productions/:id` theo dõi từng video:
   bản thảo NotebookLM → Claude biên tập cảnh → áp dụng → lồng tiếng → kiểm tra tự động → render → lưu Drive.
5. **Tác vụ**: mọi job, lý do lỗi, nút thử lại/huỷ. **Cài đặt**: trạng thái tích hợp, hạn mức Drive và NotebookLM.

## 3. Đổi nhà cung cấp

Mỗi tích hợp nằm sau một port trong `src/server/`; nghiệp vụ sách, bài học, sản xuất và Remotion không biết nhà cung cấp.

- **OCR khác (ví dụ thay Mistral):** viết một lớp hiện thực `OcrProvider` (`src/server/ocr/ocr-provider.ts`): `limits`
  (trang và byte mỗi chunk), `estimateCostUsd`, `start` (idempotent theo `requestKey`; có thể xong ngay hoặc trả
  operation chờ), `poll` (không bao giờ chờ; `pending`/`completed`/`failed`/`cancelled`/`expired`), `findOperation` (đối
  soát sau mất phản hồi), `cancel`, `cleanup` (chỉ gọi sau khi output đã lưu). Chạy bộ contract dùng chung
  (`tests/helpers/contracts/ocr-provider-contract.ts`) với adapter mới, rồi chọn nó trong `createOcrProvider()`
  (`src/server/ocr/index.ts`). Lần trích xuất đang mở một lô của provider cũ sẽ dừng với `OCR_PROVIDER_CHANGED` thay vì
  tự đổi; các trang đã có chữ không bị đọc lại.
- **Script studio khác (thay NotebookLM):** hiện thực `ScriptStudioProvider` (`ensureSource`, `detectChapters`,
  `extractLessons`, `writeDraft`, `draftVersion`), qua bộ contract
  (`tests/helpers/contracts/script-studio-provider-contract.ts`), rồi chọn nó trong `createPipelineDeps` và các nơi tạo
  `NotebookLmScriptStudio` (bộ xác định chương, phân tích chương). Đổi `draftVersion` khi prompt đổi để cache bản thảo
  không dùng lại bản cũ.
- **Nơi lưu trữ khác (thay Drive):** hiện thực `VideoArchiveProvider` + bộ contract của nó; pipeline sản xuất không đổi.

## 4. Hạn mức và ngân sách

| Hạng mục             | Mặc định                                                              | Cách đổi / ghi chú                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chi phí OCR mỗi sách | $3 (`OCR_COST_CEILING_USD`), chép vào lần trích xuất lúc nhập         | Thẻ trích xuất → "Trần chi phí OCR" (0–100 USD, không thấp hơn khoản đã chi/giữ chỗ). Ứng dụng không bao giờ tự nâng trần. Một lô mở mỗi lần trích xuất |
| PDF                  | 500 MiB, 1.000 trang                                                  | `MAX_PDF_SIZE_MB`, `MAX_PDF_PAGES`                                                                                                                      |
| NotebookLM           | Theo gói của tài khoản (cửa sổ ngắn hạn + tuần)                       | Cài đặt → NotebookLM hiện phần trăm đã dùng và giờ đặt lại sau mỗi lần worker dùng. Bản thảo hợp lệ được cache nên cùng yêu cầu không tốn quota lần hai |
| Drive                | 1 yêu cầu/giây, 5.000 yêu cầu và 10 GiB gửi mỗi 24 giờ (của ứng dụng) | `DRIVE_*`; kiểm tra dung lượng Drive trước khi upload; hết hạn mức thì archive chờ                                                                      |
| Sửa bằng AI          | Một lượt sửa cho mỗi video                                            | Lỗi nội dung/nguồn về NotebookLM, lỗi biên dịch/thời lượng về Claude; hết lượt thì video lỗi kèm lý do                                                  |
| Thử lại tự động      | Sản xuất 5 lần, trích xuất 8 lần, lưu Drive 8 lần liên tiếp           | Sau đó dừng với lý do; bấm "Thử lại" khi đã khắc phục                                                                                                   |

## 5. Lỗi thường gặp

| Mã / dấu hiệu                                 | Nghĩa                                                                         | Làm gì                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PDF_TOOL_MISSING`                            | Chưa có Poppler                                                               | Cài Poppler (§1), bấm "Thử lại"                                                                       |
| `PDF_ENCRYPTED`, `PDF_CORRUPT`                | PDF cần mật khẩu / hỏng                                                       | Không thử lại được (tệp gốc bất biến): bỏ mật khẩu hoặc xuất lại PDF rồi nhập lại                     |
| `PDF_TOO_MANY_PAGES`                          | Vượt `MAX_PDF_PAGES`                                                          | Tăng giới hạn (nếu máy chịu được), khởi động lại, "Thử lại"                                           |
| `OCR_NOT_CONFIGURED`                          | Có trang cần OCR nhưng chưa có `MISTRAL_API_KEY`                              | Đặt khoá, khởi động lại worker (lần chạy dở được cấp job mới khi worker khởi động) hoặc bấm "Thử lại" |
| `OCR_BUDGET_EXCEEDED`                         | Ước tính vượt trần chi phí                                                    | Nâng trần trong thẻ trích xuất rồi "Thử lại"                                                          |
| `MISTRAL_HTTP_401/403`                        | Mistral từ chối khoá                                                          | Sửa khoá, "Thử lại"; lô đang mở và khoản giữ chỗ vẫn nguyên                                           |
| "Còn trang lỗi" (`OCR_PAGES_FAILED`)          | Một số trang OCR lỗi (gồm `OCR_PAGE_TOO_LARGE`, `OCR_OUTPUT_EXPIRED`)         | "Thử lại" chỉ gửi lại các trang đó (tốn tiền cho chúng)                                               |
| `OCR_CANCELLED_REMOTELY`                      | Lô bị huỷ ở phía Mistral                                                      | "Thử lại" để gửi lại                                                                                  |
| "Chưa xác định chương"                        | Không tìm thấy tiêu đề chương; hoặc NotebookLM đề xuất không khớp văn bản     | Cấu hình/đăng nhập NotebookLM rồi "Thử lại"; nếu đề xuất bị từ chối, lý do nêu chương nào sai         |
| `NOTEBOOKLM_PROFILE_MISSING`, "Cần đăng nhập" | Profile chưa đăng nhập hoặc hết hạn                                           | `uvx --from notebooklm-mcp-cli nlm login --profile <tên>`, rồi "Kiểm tra NotebookLM"                  |
| `NOTEBOOKLM_*_INVALID`, `DRAFT_INVALID`       | NotebookLM trả lời sai định dạng/sai mạch kể                                  | Bản thảo: dùng lượt sửa tự động; chương: "Phân tích lại"                                              |
| `SCRIPT_STUDIO_NOT_AVAILABLE`                 | Sản xuất ở `cli-auto` mà chưa đặt `NOTEBOOKLM_PROFILE`                        | Đặt profile (hoặc dùng `AI_MODE=mock` để thử)                                                         |
| `PRODUCTION_CORRECTION_EXHAUSTED`             | Đã dùng lượt sửa AI mà video vẫn chưa đạt                                     | Xem lý do (thường là vượt thời lượng); sửa bài học hoặc chọn preset dài hơn trong một đợt mới         |
| `DRIVE_RECONNECT_REQUIRED`                    | Google không nhận refresh token (thu hồi, đổi mật khẩu, hết 7 ngày ở Testing) | Cài đặt → Google Drive → "Kết nối lại"; archive dở chạy tiếp                                          |
| Drive đầy / `ARCHIVE_DESTINATION_CHANGED`     | Hết dung lượng / đã kết nối tài khoản khác                                    | Giải phóng dung lượng rồi thử lại / tài khoản mới nhận archive mới, archive cũ giữ nguyên             |

## 6. Khôi phục

- **Worker chết giữa chừng:** khởi động lại là đủ. Worker giao các job còn trong outbox, khớp lại trạng thái job với
  Redis, cấp job mới cho lần trích xuất / video sản xuất / archive còn dở, rồi mỗi bước bắt đầu từ checkpoint đã lưu.
- **Không bao giờ làm lại khi đã xong:** trang đã có chữ không đọc/OCR lại; lô OCR mất phản hồi được đối soát theo khoá
  trước khi gửi lại; nguồn NotebookLM tải một lần mỗi phiên bản văn bản (đối soát theo dấu `[bvs:<id>]` trong tiêu đề);
  bản thảo hợp lệ lấy từ cache; render xong mà Drive lỗi thì chỉ upload lại; upload Drive tiếp tục từ byte Google đã nhận.
- **Một lần OCR thật đầu tiên (G07, cần tài khoản):** nhập một PDF nhỏ có vài trang scan, đặt trần thấp (ví dụ $0.10),
  theo dõi thẻ trích xuất tới "Đã trích xuất", so chi phí thực trên bảng Mistral với "đã chi" trong thẻ, đọc thử các
  trang OCR. Một lần submit thành công **chưa** phải OCR thành công: chỉ tin khi trang có chữ.
- **Dữ liệu trên đĩa (dưới `DATA_DIR`):** `books/<bookId>/original.pdf` (bất biến), `books/<bookId>/extractions/<id>/`
  (`canonical.md`, chunk OCR tạm), `books/<bookId>/chapters/`, `ai-tasks/<job>/` (đầu ra thô của AI),
  `integrations/notebooklm-status.json`, `credentials/google-drive.json` (0600, không sao lưu ra ngoài máy),
  `videos/`. Sao lưu `studio.db` + `DATA_DIR` khi worker và web đã dừng.

## 7. Giới hạn đã biết và giả định chưa kiểm chứng

- **Chưa chạy với tài khoản thật (G07, G08):** Mistral (model `mistral-ocr-4-1`, đơn giá batch, cách tham chiếu `file_id`
  trong yêu cầu OCR, dạng dòng JSONL kết quả, cơ số trang khi liệt kê job), NotebookLM (`notebooklm-mcp-cli` dùng API
  không chính thức; các mẫu lỗi ngoài "No authentication found"; chất lượng JSON trả về), Google Drive (mã hoá checksum,
  redirect loopback không có path). Toàn bộ được kiểm thử với fake cục bộ có chèn lỗi.
- Phát hiện font tiếng Việt cũ (TCVN3/VNI) dựa trên tỉ lệ ký tự lạ; văn bản rất ngắn có thể bị bỏ sót hoặc gửi OCR thừa.
- Không có NotebookLM thì sách PDF không có tiêu đề chương dừng ở "Chưa xác định chương"; chưa có công cụ tách chương
  thủ công cho sách PDF.
- Chỉ một lô OCR mở mỗi lần trích xuất; sách nghìn trang scan chạy tuần tự.
- Bài học trùng giữa các chương khác nhau không tự gộp (chỉ gộp trong cùng một chương); dùng chức năng gộp bài học hiện có.
- Ứng dụng chỉ chạy trên `127.0.0.1`, không có đăng nhập.
