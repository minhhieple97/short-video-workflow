# Book Video Studio — Đặc tả sản phẩm

Đặc tả duy nhất của sản phẩm, mô tả hành vi **hiện tại**. Xem thêm: [architecture.md](architecture.md) (tiến trình, dữ liệu,
tác vụ, pipeline, adapter, render, lưu trữ, kiểm thử) · [operations.md](operations.md) (cài đặt, tài khoản, cấu hình, hạn mức,
sự cố, khôi phục, nghiệm thu thật) · [README](../README.md) (bắt đầu nhanh) · [AGENTS.md](../AGENTS.md) (stack, mã, quy tắc kỹ
thuật).

## 1. Tầm nhìn và phạm vi

### 1.1. Mục tiêu

Làm **nhiều video giáo dục ngắn từ cùng một cuốn sách**, mỗi video truyền đạt một kiến thức áp dụng được chứ không kể lại sách.
Mỗi video là một nội dung độc lập cho bảng tin điện thoại: thu hút trong 4 giây đầu, có tình huống đời thường, sai lầm, bài học
trong sách, cách xử lý và một hành động cụ thể.

Nhập và phân tích sách một lần, dùng lại cho nhiều video, truy vết được nguồn từng bài học. Xuất MP4 **dọc 9:16** cho TikTok,
YouTube Shorts, Facebook Reels (dài 30 giây tới 5 phút, AI chọn độ dài theo nội dung trong khoảng người dùng cho phép), nội dung **tiếng Việt** kể cả khi sách bằng tiếng
Anh. Chạy cục bộ, **không Claude API key**, chi phí thấp, trên máy yếu.

### 1.2. Người dùng

Một người dùng cá nhân trên máy của mình; không đăng nhập, nhóm, phân quyền, thanh toán hay chia sẻ công khai; chỉ `127.0.0.1`.

### 1.3. Hai luồng sản xuất

Hai luồng dùng chung sách, chương, bài học, trình biên tập, mẫu video và render:

- **Thủ công** (thường với sách `.md`/`.txt`, dùng được cho mọi sách): người dùng duyệt bài học, tạo từng video, chọn hook, sửa
  và duyệt kịch bản, tạo giọng đọc, render.
- **Hàng loạt** (thường với sách PDF 300–700 trang, dùng được cho mọi sách có bài học kèm trích đoạn): trích văn bản + OCR,
  NotebookLM lập danh mục bài học, người dùng **chọn** bài cần làm; mỗi bài thành một video tự động tới khi lưu Google Drive.

### 1.4. Ngoài phạm vi

- EPUB, đọc hình ảnh trong sách; OCR ngoài trang PDF không có chữ dùng được; OCR tự host hay nhà cung cấp khác ngoài Mistral.
- Video ngang/16:9; dựng timeline kéo thả; AI sinh video, ảnh, 3D, stock footage; sinh hay chạy mã Remotion tuỳ ý.
- SaaS, nhiều người dùng, hosting/render trên đám mây; tự đăng video, theo dõi lượt xem, công cụ SEO ngoài bộ tiêu đề / caption /
  hashtag đề xuất (§5.13), kiếm tiền, thumbnail AI.
- Claude API/SDK/API key; lấy token hay cookie từ tài khoản Claude.
- Google Sheets; duyệt từng kịch bản trong luồng hàng loạt.

## 2. Nguyên tắc

1. **Sách ≠ Chương ≠ Bài học ≠ Video.** Một bài học có thể trích nhiều chương và dùng ở nhiều video.
2. **Nguồn bất biến.** Tệp gốc không bao giờ bị sửa; chương, văn bản trích xuất, chỉnh sửa là dữ liệu dẫn xuất.
3. **Tách nguồn và diễn giải.** Ý tác giả có trích đoạn; tình huống AI sáng tác luôn ghi là minh hoạ.
4. **Nội dung là dữ liệu.** Mẫu Remotion chỉ nhận JSON đã kiểm tra.
5. **Người dùng quyết định.** Thủ công: người dùng duyệt. Hàng loạt: người dùng chọn bài, kiểm tra tự động lo phần còn lại; không
   bước tự động nào được ghi là "đã duyệt".
6. **Cục bộ trước.** Dữ liệu, media nằm trên máy; chỉ Claude, edge-tts, Mistral, NotebookLM, Drive và thông báo Telegram tuỳ chọn cần Internet.
7. **Tiết kiệm.** Không phân tích lại khi nội dung và prompt không đổi; chỉ OCR trang cần; dùng lại kết quả hợp lệ; không thử lại
   vô hạn.
8. **Không làm lại việc đã xong.** Việc dài tiếp tục từ chỗ dừng; lỗi ở bước sau không chạy lại AI, giọng đọc hay render.
9. **Di động, hook trước, thời lượng theo âm thanh thật, nhẹ cho CPU** (chi tiết §6).
10. **Tích hợp thay được.** Mỗi dịch vụ ngoài nằm sau một ranh giới riêng; nghiệp vụ không phụ thuộc nhà cung cấp.

## 3. Luồng sử dụng

### 3.1. Thủ công

1. **Nhập sách** `.md`/`.txt` (tải lên hoặc dán), sửa danh sách chương, **Xác nhận nhập**.
2. **Phân tích** một hoặc tất cả chương → bài học nháp kèm trích đoạn.
3. **Duyệt bài học** (đối chiếu trích đoạn, sửa, gộp, lưu trữ, tạo thủ công).
4. **Tạo video** từ bài học đã duyệt (khuyên một bài) với một khoảng thời lượng.
5. **Tạo kịch bản**: Claude viết kịch bản, đề xuất độ dài trong khoảng và viết luôn tiêu đề, caption, hashtag để đăng (§5.13);
   chọn một trong 2–3 hook, sửa cảnh, **Duyệt kịch bản**.
6. **Giọng đọc**: edge-tts hoặc tải âm thanh lên cho từng cảnh.
7. **Xem trước** trong khung điện thoại, vùng an toàn, **Xem 4 giây đầu**.
8. **Render** nháp rồi bản cuối, tải MP4; bản cuối tự lưu Drive nếu đã kết nối.
9. **Đăng tải**: sửa, lưu, sao chép tiêu đề, caption, hashtag; **Tạo lại** khi kịch bản đã đổi. Người dùng tự đăng video.

Với `AI_MODE=cli-task`, bước dùng AI dừng ở **Chờ Claude CLI** tới khi người dùng chạy lệnh hiển thị trong terminal của mình;
với `cli-auto`, worker tự chạy Claude Code CLI của người dùng.

### 3.2. PDF hàng loạt

1. **Nhập sách → "Sách PDF"**: tải PDF; tệp gốc lưu nguyên byte, phần còn lại chạy nền.
2. **Trích xuất**: Đọc PDF → OCR trang cần thiết → Ghép văn bản → Tạo chương (§5.3).
3. **Phân tích tất cả chương**: NotebookLM lập danh mục bài học có trích đoạn nguyên văn và số trang; không cần duyệt.
4. **Sản xuất video**: chọn bài học (một, nhiều hoặc tất cả) và khoảng thời lượng.
5. Mỗi bài là **một video**: bản thảo và độ dài đề xuất (NotebookLM) → biên tập cảnh, kèm tiêu đề, caption, hashtag (Claude) →
   áp dụng kịch bản → lồng tiếng (edge-tts) → kiểm tra tự động → render bản cuối → lưu Drive (kèm `publish.txt`).
6. Theo dõi ở mục **Sản xuất**; video mở được trong trình biên tập như mọi video.

Chạy với `AI_MODE=cli-auto` (NotebookLM + Claude thật, cần profile NotebookLM đã đăng nhập) hoặc `mock` (dữ liệu mẫu). `cli-task`
không dùng được vì mỗi video sẽ phải chờ người dùng chạy lệnh.

## 4. Quy tắc nghiệp vụ

### 4.1. Khái niệm

**Sách** (`Book`, tệp gốc bất biến + SHA-256; sách PDF có `BookExtraction`) → **Chương** (`Chapter`) → **Bài học** (`Lesson`,
trích 1..N chương cùng sách qua `LessonSource`) → **Video** (`Video`, dùng bài học qua `VideoLesson` có snapshot, gồm
`VideoScene`) → **Bản render** (`RenderRecord`, nháp/cuối) → **Bản lưu Drive** (`RenderArchive`). Luồng hàng loạt thêm **đợt sản
xuất** (`ProductionBatch`) gồm các mục (`ProductionItem`): mỗi mục = một bài học = một video.

### 4.2. Sách và chương

- Một tệp nhập là một sách. Nhập lại `.md`/`.txt` trùng nội dung: cảnh báo, cho mở sách cũ hoặc chủ động tạo bản mới (mặc định
  không). PDF trùng nội dung bị từ chối.
- Chương là kết quả phân chia có kiểm tra; thứ tự do người dùng quyết định (thủ công) hoặc theo trang (PDF). "Cả sách là một
  chương" không bao giờ hợp lệ với sách từ 20 trang. Bìa, lời nói đầu, mục lục, phụ lục không thành chương.

### 4.3. Bài học

- Trạng thái **Bản nháp** / **Đã duyệt** / **Đã lưu trữ**; nguồn gốc `AI` hoặc `MANUAL`. Bài học không bị xoá, chỉ lưu trữ (khôi
  phục được về bản nháp).
- Trích đoạn chỉ được giữ khi tìm thấy thật trong chương. Với PDF, số trang là trang nơi tìm thấy trích đoạn, không phải trang mô
  hình tự khai.
- Phân tích lại một chương chỉ thay bài nháp do AI tạo từ riêng chương đó (chuyển sang lưu trữ); bài đã duyệt và bài thủ công không
  bao giờ bị đụng tới.
- Gộp bài: bằng chứng chuyển sang bài đích, bài bị gộp được lưu trữ. NotebookLM tự gộp bài trùng tiêu đề trong cùng một chương.
- Bài học hiện "Đã dùng trong N video"; dùng lại được, chỉ cảnh báo.
- Mỗi bài học trong danh sách có **ô chọn** (ô ở tiêu đề chọn cả trang). Thanh phía trên danh sách **Duyệt**, **Từ chối** (lưu trữ,
  có xác nhận) hoặc **Trả về nháp** đúng các bài đã chọn trong một yêu cầu; số trên nút là số bài thật sự đổi được theo luật chuyển
  trạng thái (ví dụ bài đã lưu trữ không duyệt thẳng được), nút tắt khi không đổi được bài nào. Bài không đổi được vì trạng thái đã
  thay đổi sau khi trang hiện ra được đếm và báo, không làm hỏng cả yêu cầu. Chỉ các bài ở trang đang xem mới tính; bỏ chọn sau khi gửi.

### 4.4. Video, snapshot và duyệt

- Video dùng bài học của **đúng một** sách. Thủ công: 1–5 bài, khuyên một, cảnh báo khi vượt sức chứa của mức dài nhất. Hàng loạt:
  **đúng một bài mỗi video**.
- `VideoLesson` lưu **snapshot** bài học lúc chọn; sửa bài học sau đó không đổi video đã có.
- **Thủ công**: chỉ bài **Đã duyệt** mới tạo được video; bản cuối cần kịch bản đã duyệt; sửa kịch bản sau khi duyệt (lời dẫn, chữ,
  thứ tự, thêm/ẩn/xoá cảnh, đổi hoạt cảnh) đưa về **Kịch bản cần duyệt**.
- **Hàng loạt**: chọn bài **không phải** duyệt; trạng thái bài học giữ nguyên. Khi mọi cảnh có giọng đọc, kiểm tra tự động (§6.7)
  quyết định có render bản cuối không. Kết quả gắn với đúng phiên bản kịch bản đó, lưu tách khỏi trạng thái duyệt; mọi thay đổi sau
  đó (kể cả giọng đọc) làm nó hết hiệu lực, và bản cuối tiếp theo cần người dùng duyệt như luồng thủ công.
- Kịch bản, cảnh hay âm thanh đổi làm bản render trước **lỗi thời**; MP4 cũ không bao giờ bị tự xoá. Đổi âm thanh không đưa kịch
  bản đã duyệt về cần duyệt. Sửa chữ giữ giọng đọc; sửa lời dẫn gỡ giọng đọc cũ của cảnh.
- Khi AI đang viết kịch bản hay viết lại cảnh, hoặc mục sản xuất của video còn chạy, video bị **khoá** (không sửa, duyệt, tạo giọng,
  render, xoá) tới khi xong hoặc huỷ.
- Mỗi render dựng từ snapshot chụp lúc yêu cầu (cảnh, âm thanh, nguồn, mẫu); sửa video lúc chờ không trộn vào; hồ sơ Drive lấy từ
  snapshot này.

### 4.5. Xoá và bản quyền

- Xoá sách: xoá mềm, có xác nhận, bị chặn khi sách còn video. Xoá video: xoá kịch bản và liên kết bài học; MP4 và âm thanh vẫn trên
  đĩa. Không bao giờ âm thầm xoá media; ngắt kết nối Drive không xoá gì trên Drive.
- Sản phẩm tóm lược, diễn giải, đưa ví dụ mới, không tái hiện phần lớn nội dung gốc; trích đoạn chỉ là căn cứ ngắn (1–3 câu).
  Người dùng chịu trách nhiệm về quyền sử dụng tài liệu nguồn.

## 5. Yêu cầu chức năng

### 5.1. Thư viện sách

Tìm sách theo tên/tác giả không phân biệt dấu; thẻ sách có số chương/bài học/video, ngày nhập, nhãn trích xuất (PDF). Trang sách:
tab Chương / Bài học / Video (đổi tab ngay, giữ trong địa chỉ), nút **Sản xuất video** (khoá kèm lý do khi sách chưa có bài học),
sửa tên/tác giả, xoá có giải thích ảnh hưởng. Tổng quan: tác vụ đang chạy, sách và video gần đây.
Danh sách có thể dài được **phân trang từ server** (chỉ trang đang xem được đọc và gửi về): sách (12/trang), chương (50), bài học (25),
video (20), tác vụ và đợt sản xuất (25). Số trang nằm trong địa chỉ nên tải lại hay chia sẻ liên kết vẫn đúng trang; ba tab của
trang sách có số trang riêng (`chapterPage`, `lessonPage`, `videoPage`), đổi bộ lọc thì về trang 1, trang quá cuối thì hiện trang cuối.
Chưa phân trang: danh mục chọn bài để sản xuất, các đợt nhập sách, danh sách mục trong một đợt sản xuất.

### 5.2. Nhập `.md` / `.txt` và chương

- UTF-8 có hoặc không BOM; kiểm tra phần mở rộng, chữ ký, kích thước (mặc định tối đa 10 MiB).
- Markdown: heading phân tích bằng cây cú pháp, không coi mọi heading là chương. TXT: nhận "Chương 1", "CHƯƠNG IV", "Chapter
  One", "Phần 2"….
- Không tự bịa ranh giới: khi không chắc, cảnh báo và cho chia tay. Xem trước vị trí bắt đầu, số ký tự, đoạn đầu; đổi tên, tách,
  gộp, sắp xếp, bỏ chọn trước khi xác nhận. Chuẩn hoá khoảng trắng vừa đủ, không mất đoạn, không sửa nội dung.

### 5.3. Nhập PDF và trích xuất

- Tải qua tab riêng (mặc định tối đa 500 MiB, 1.000 trang); tiến độ là số byte thật, huỷ được, quá cỡ bị chặn ngay.
- PDF hỏng hoặc có mật khẩu báo lỗi trước khi gọi dịch vụ trả phí và không thử lại được.
- Đọc lớp chữ từng trang; chỉ trang không có chữ dùng được (scan, font tiếng Việt cũ TCVN3/VNI, lỗi mã hoá) mới đi OCR.
- Lớp chữ ghi đ/Đ thành ñ/ð (PDF in từ Word bằng một số máy in PDF) được sửa tại chỗ cho cả cuốn trước khi phân loại trang: chính
  xác, miễn phí và không gửi OCR. Sách đã nhập từ trước sửa bằng `pnpm text:repair`; không bao giờ sửa chữ khi chưa chắc cả cuốn bị lỗi.
- Chỉ ghép văn bản chuẩn khi mọi trang đã có chữ hoặc là trang trống hợp lệ; không trang nào thiếu âm thầm. Trang OCR lỗi (hay kết
  quả đã hết hạn lưu) → **Còn trang lỗi** kèm số trang; **Thử lại** chỉ gửi lại các trang đó.
- **Trần chi phí OCR** mỗi sách, mặc định 3 USD: hiện đã chi / đang giữ chỗ / trần; chỉnh được (0–100 USD, không thấp hơn khoản đã
  cam kết). Vượt trần, thiếu khoá, khoá bị từ chối → dừng kèm lý do; không tự nâng trần, không đổi nhà cung cấp.
- Chương do bộ nhận diện cục bộ tạo. Không thấy → NotebookLM chỉ nhận **dàn ý đầu trang**, không bao giờ cả sách; đề xuất chỉ được
  nhận khi câu mở đầu chương có thật trên trang bắt đầu và các chương theo thứ tự trang. Không được → **Chưa xác định chương**.
- Không có phần trăm giả: OCR theo hàng đợi lô của Mistral (có thể vài giờ), worker tự kiểm tra lại. Tiến độ là số trang theo
  trạng thái (có chữ sẵn, đã OCR, trống, đang OCR, chờ gửi, lỗi, chưa đọc).

### 5.4. Phân tích chương và danh mục bài học

- Phân tích một hoặc tất cả chương, **tuần tự**; chỉ chạy lại khi nội dung chương hay phiên bản prompt đổi, trừ khi người dùng
  chọn phân tích lại (có xác nhận).
- **Phân tích tất cả chương** chỉ bấm được khi còn chương cần phân tích (nhãn nói còn bao nhiêu, báo trước chương sẽ chạy lại vì
  đổi chế độ AI/prompt); chưa có chương, đang chạy hay đang chờ Claude CLI → khoá kèm lý do. Tiến độ là số chương theo trạng thái
  và chương đang chạy; trang tự cập nhật, rời trang không dừng phân tích.
- Mỗi dòng chương có **ô chọn**; ô ở tiêu đề chọn hoặc bỏ chọn tất cả chương còn cần phân tích. Khi có chương được chọn, nút đổi
  thành **Phân tích N chương đã chọn** và chỉ xếp hàng đúng các chương đó (theo thứ tự sách), kể cả khi worker đang chạy lượt trước;
  không chọn gì thì nút vẫn phân tích mọi chương còn cần. Chương đang trong hàng đợi hoặc đã phân tích đúng nội dung và prompt thì
  khoá ô chọn kèm lý do (chạy lại bằng **Phân tích lại** ở cuối dòng). Chọn xong và gửi yêu cầu thì bỏ chọn.
- Trạng thái chương: Chưa phân tích, Đang chờ, Đang phân tích, Chờ chạy Claude CLI, Đã phân tích, **Phân tích chưa hết**, Lỗi.
- Sách văn bản (và sách PDF khi chưa cấu hình NotebookLM): AI theo `AI_MODE`, 1–3 bài mỗi chương. Sách PDF có NotebookLM: chương
  chia thành phần ≤ 40.000 ký tự ở ranh giới đoạn, mỗi phần một câu hỏi, **không giới hạn** số bài; phần chưa đọc hết làm chương
  thành **Phân tích chưa hết**, không bao giờ "Đã phân tích".
- Bài học gồm tiêu đề, tóm tắt, nguyên tắc, tình huống minh hoạ, sai lầm, cách làm tốt hơn, một hành động, trích đoạn.

### 5.5. Tạo video và trình biên tập

- Tạo video thủ công: chọn bài đã duyệt, tiêu đề, mô tả, khoảng thời lượng (§6.2); hiện mức tải nội dung, quá tải thì khuyên bỏ
  bớt bài, tách video hoặc nới khoảng. Video tạo được khi chưa có kịch bản. Khoảng đổi được trong cài đặt video.
- **Hook**: 2–3 phương án theo ba kiểu — câu hỏi đánh trúng vấn đề, sai lầm thường gặp, tương phản trước/sau — có lời dẫn, chữ,
  bố cục, hoạt cảnh; chọn rồi sửa được.
- **Cảnh**: sửa lời dẫn, chữ, bố cục, hoạt cảnh; ẩn, xoá, thêm theo loại, sắp xếp; **Viết lại cảnh này** chỉ đổi đúng cảnh đó.
- Tổng thời lượng so với khoảng (hiện cả độ dài AI đề xuất và lý do), cảnh báo khi ngắn hơn mức ngắn nhất, sát hoặc vượt mức dài
  nhất; khi vượt chỉ hướng dẫn rút gọn. **Duyệt kịch bản** bị chặn khi chưa
  có cảnh hoặc hook không hợp lệ.
- Video của đợt sản xuất: hiện trạng thái mục, bước tiếp theo, lượt sửa AI; tab **Nguồn kịch bản** hiện bản thảo theo nhịp, trích
  đoạn kèm số trang, đánh dấu minh hoạ.

### 5.6. Giọng đọc

- Mỗi cảnh: edge-tts (giọng cấu hình được, tốc độ theo nhịp độ của video, xem §6.2) hoặc tải MP3/WAV; tạo mọi cảnh còn thiếu; nghe; thay. Không dùng TTS trả phí.
- Đo bằng ffprobe; độ dài cảnh = âm thanh thật + khoảng đệm. Chỉ tạo lại khi lời dẫn, giọng hoặc tốc độ đổi.
- edge-tts: cắt khoảng lặng đầu/cuối, tự thử lại vài lần khi dịch vụ không trả âm thanh. Âm thanh tải lên giữ nguyên, chỉ đo.
- edge-tts cho biết **lúc đọc từng từ**: lưu cùng giọng, đã trừ phần lặng bị cắt, để phụ đề sáng đúng từ đang đọc.
  - Âm thanh tải lên và giọng tạo trước khi có tính năng này không có mốc này; phụ đề của chúng ước lượng theo âm tiết.
  - Muốn có karaoke cho video cũ thì tạo lại giọng.
- edge-tts không chính thức nên luồng thủ công luôn cho tải âm thanh lên. Luồng hàng loạt luôn dùng edge-tts, từng cảnh, chạy lại
  thì tiếp từ cảnh chưa có giọng.

### 5.7. Xem trước và render

- Remotion Player trong khung điện thoại 9:16 (phát, dừng, tua, âm thanh), cùng composition và props với render; lớp vùng an toàn
  TikTok / Shorts / Reels; **Xem 4 giây đầu**.
- Render nháp và bản cuối (§6.7), mỗi lần một bản; lịch sử ghi chất lượng, phiên bản kịch bản, trạng thái, nhãn lỗi thời, trạng
  thái Drive của bản cuối (kèm nút lưu/thử lại chỉ upload); tải đúng tệp.

### 5.8. Sản xuất hàng loạt

- Danh mục: bài học chưa lưu trữ theo thứ tự chương, kèm trích đoạn và số trang; bài thiếu trích đoạn không chọn được. Một đợt
  tối đa 100 bài, cùng một khoảng thời lượng; mỗi video có độ dài riêng do NotebookLM đề xuất.
- Tạo đợt là tạo ngay mọi video và snapshot, tất cả hoặc không gì. Gửi trùng (bấm hai lần, gửi lại) trả về đợt cũ.
- Mỗi video tiến theo checkpoint; khởi động lại hay thử lại tiếp từ bước cuối đã xong. Bản thảo hợp lệ được cache: NotebookLM xong
  mà Claude lỗi thì chỉ chạy lại Claude.
- **Một lượt sửa AI mỗi video**, gửi tới bước sửa được vấn đề: nội dung/nguồn (bản thảo sai mạch kể, độ dài đề xuất ngoài khoảng,
  bài thiếu trích đoạn, video ngắn hơn mức ngắn nhất — chỉ NotebookLM kể thêm được từ nguồn) → bản thảo ở NotebookLM; diễn đạt/
  cấu trúc/thời lượng (dài hơn mức dài nhất, hook quá 4 giây, thiếu chữ, sai cấu trúc, số liệu hay trích dẫn ngoài nguồn) → biên
  tập cảnh ở Claude. Không nới khoảng, không tăng hay giảm tốc đọc. Hết lượt hoặc lỗi AI không sửa được → video **Lỗi**
  kèm lý do.
- Việc phải chờ (render đang chạy, dịch vụ tạm lỗi, hạn mức) đưa video về **Đang chờ** và hẹn lại, không giữ worker; thử lại tự
  động có giới hạn.
- Trạng thái video: Chờ chạy, Đang chạy, Đang chờ, Hoàn tất, Lỗi, Đã huỷ. Trạng thái đợt suy ra từ video: Đang xếp hàng, Đang chạy,
  Hoàn tất, Xong một phần, Lỗi, Đã huỷ.
- Trang tiến độ: từng video với bước tiếp theo, lý do chờ/lỗi, lượt sửa AI, render, Drive. **Huỷ** (có xác nhận; chặn mọi bước sau,
  thắng mọi kết quả về muộn) và **Thử lại** (tiếp từ checkpoint, không tạo video mới) cho từng video hoặc cả đợt.

### 5.9. Lưu Google Drive

- Mọi bản render **cuối** hoàn tất (cả hai luồng) được lưu tự động khi đã kết nối; chưa kết nối thì chờ tới khi kết nối. Bản nháp
  không lưu.
- Mỗi bản lưu, dựng từ snapshot render, gồm MP4, `script.json` (cảnh, bài học và trích đoạn nguồn), `publish.txt` (tiêu đề,
  caption, hashtag — chỉ khi bản render có bộ này, §5.13) và `manifest.json` (thông số, phiên bản, âm thanh, kích thước và SHA-256
  các tệp) trong `Book Video Studio/books/<sách>/videos/<video>/renders/<render>/`. Cảnh là tình huống sáng tác cho video (không
  lấy từ sách) được đánh dấu minh hoạ trong `script.json` và `manifest.json`.
- Lưu Drive là việc riêng: lỗi Drive không xoá MP4, không chạy lại AI, giọng đọc hay render. **Đã lưu Drive** chỉ khi mọi tệp đã
  xác minh (kích thước + checksum); upload tiếp tục được, mất phản hồi không tạo tệp trùng. Drive đầy, mất quyền, đổi tài khoản →
  **Lưu Drive lỗi** kèm lý do; thử lại từ lịch sử render hoặc trang Tác vụ.

### 5.10. Tác vụ

- Tên, sách/video, trạng thái, tiến độ, thời điểm, lỗi rút gọn; **Thử lại**; **Huỷ** (đang chờ: ngay; đang chạy: yêu cầu dừng,
  render dừng và xoá tệp dở); **Chi tiết** (kèm lệnh Claude khi chờ CLI).
- Trạng thái `QUEUED`, `WAITING_FOR_CLI` (chỉ tác vụ AI), `RUNNING`, `COMPLETED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`.
- Làm mới 2–3 giây một lần. Tải lại trang hay khởi động lại web không mất tác vụ; worker tắt thì tác vụ chờ, giao diện cảnh báo.

### 5.11. Cài đặt và chẩn đoán

- Trạng thái mọi thành phần (Redis, worker, SQLite, ffmpeg, edge-tts, Claude CLI, Chromium, tài nguyên WSL, Poppler, Mistral,
  NotebookLM, Drive), chế độ AI; **Chạy tác vụ thử**, **Kiểm tra AI mẫu**.
- Kết nối / kết nối lại / ngắt Google Drive, mức dùng 24 giờ và dung lượng; đăng nhập và hạn mức NotebookLM.
- Không bao giờ hiện token, cookie, khoá API hay thông tin đăng nhập.

### 5.12. Giao diện chung

Tiếng Việt; tối ưu 1280–1920 px, dùng được ở màn hình hẹp; sáng / tối / theo hệ thống. Trạng thái Đang tải / Trống / Lỗi / Thành
công thật, không nút giả; xác nhận thao tác phá huỷ. Ngôn ngữ thị giác: [AGENTS.md](../AGENTS.md) §15.

### 5.13. Tiêu đề, caption và hashtag

- Mỗi video có **một bộ** tiêu đề, caption, hashtag dùng chung cho TikTok, Facebook Reels, YouTube Shorts, để người dùng tự đăng.
  Viết để người đang lướt dừng lại xem và để nền tảng hiểu video nói về gì; Studio không đăng video.
- Claude viết bộ này cùng kịch bản (thủ công) hoặc cùng kế hoạch cảnh (hàng loạt), không tốn thêm lần gọi AI. Bộ vi phạm quy tắc
  (§7.2) bị bỏ riêng, kịch bản vẫn được lưu.
- Tab **Đăng tải** của trình biên tập: sửa, **Lưu**, sao chép từng ô hoặc **Sao chép caption + hashtag**; **Tạo lại** (tác vụ AI
  riêng, hỏi xác nhận khi bản hiện tại đã sửa tay) viết lại từ kịch bản hiện tại. Không cần duyệt kịch bản, chỉ cần có kịch bản;
  khoá trong lúc kịch bản đang được tạo hay video đang sản xuất tự động.
- Tiêu đề một dòng, tối đa 100 ký tự, từ khoá chính ở đầu. Caption tối đa 2.200 ký tự: dòng đầu là câu móc ngắn, vài dòng giá trị,
  dòng nguồn "Sách: <tên> – <tác giả>", một lời mời hành động; không chứa hashtag. 3–8 hashtag, lưu không dấu, chữ thường, không
  trùng.
- Chữ kịch bản đổi sau khi viết bộ này (sửa, ẩn, thêm, xoá, đổi thứ tự cảnh) → nhãn **Cần xem lại**; đổi giọng đọc hay hoạt cảnh
  thì không. Lưu bản sửa tay là xác nhận bộ khớp kịch bản hiện tại.
- Yêu cầu render bản cuối chụp bộ hiện tại (không **Cần xem lại**) vào snapshot; bản lưu Drive kèm `publish.txt` (§5.9). Sửa bộ
  sau đó không đổi bản lưu đã có.

## 6. Video

### 6.1. Định dạng

Profile `SHORT_VERTICAL`, dọc 9:16 (không 16:9). Bản cuối 1080×1920, bản nháp 720×1280 (cùng composition và nội dung), 30 FPS, MP4
H.264 + AAC. Font Be Vietnam Pro đóng gói sẵn; dấu tiếng Việt đúng ở xem trước và MP4.

### 6.2. Thời lượng

- Độ dài là một trong các mức **30 / 45 / 60 / 90 / 120 / 180 / 240 / 300 giây**. Người dùng đặt **khoảng** cho mỗi video hoặc
  mỗi đợt (ngắn nhất – dài nhất), mặc định **30 giây – 5 phút**; mức dài nhất không vượt trần cấu hình của máy (tối đa 300 giây).
- **AI đề xuất độ dài** hợp với nội dung, trong khoảng đó, kèm một câu lý do, rồi viết lời dẫn khớp độ dài đó: luồng thủ công →
  Claude khi tạo kịch bản; luồng hàng loạt → NotebookLM khi viết bản thảo (vì nó đọc nguồn). Bài nhiều chi tiết, ví dụ, bước làm thì
  dài hơn; ý đơn giản thì ngắn; không kéo dài cho đủ. Đề xuất ngoài khoảng bị từ chối. Đổi khoảng giữ đề xuất nếu còn nằm trong
  khoảng, không thì kéo về đầu gần nhất.
- Giới hạn cứng là **mức dài nhất**: bản cuối dài hơn thì chặn. Dài hơn đề xuất nhưng vẫn trong khoảng thì vẫn đạt. Ngắn hơn mức
  ngắn nhất: luồng thủ công chỉ cảnh báo; luồng hàng loạt chặn và dùng lượt sửa AI. Không bao giờ tự nới khoảng, cắt lời hay đổi nhịp
  độ.
- Video dài kể sâu hơn, **không thêm bài học**; tối đa 30 cảnh sau hook (khoảng 8–15 giây mỗi cảnh). Quá 60 giây có thể không còn
  được tính là Shorts/Reels; người dùng tự cân nhắc khi đăng.
- Lập kế hoạch theo nhịp độ của video (xem dưới): khoảng 4 âm tiết/giây ở nhịp Chuẩn; thời lượng thật = âm thanh đo được + khoảng đệm;
  mỗi cảnh hiện ít nhất 2 giây.
- **Nhịp độ đọc** do người dùng chọn cho từng video (lúc tạo hoặc trong cài đặt) và cho cả lô sản xuất; mặc định `DEFAULT_PACE`. Có ba mức:
  **Chuẩn** (giọng +0%, nghỉ 300 ms, 4 âm tiết/giây), **Nhanh** (+15%, 200 ms, 4,6) và **Rất nhanh** (+30%, 120 ms, 5,2). Một lựa chọn quyết
  định cùng lúc tốc độ giọng, khoảng nghỉ giữa các cảnh, số chữ AI được viết cho một độ dài (nhịp nhanh hơn thì cùng thời lượng chứa thêm
  khoảng 15–30% lời dẫn) và tốc độ chạy hình của cảnh. Hệ thống không bao giờ tự đổi nhịp độ, kể cả khi video ngắn hay dài hơn khoảng.
  Đổi nhịp độ không tự đổi giọng đã tạo: tab Giọng đọc báo số cảnh có giọng ở nhịp khác và cho tạo lại tất cả (cảnh đúng tốc độ dùng lại
  giọng cũ; âm thanh tải lên không bị thay).

### 6.3. Hook

- Cảnh đầu luôn là `HOOK`, bắt đầu ở frame 0, tối đa **4 giây (120 frame)** theo âm thanh thật, cho mọi luồng.
- Không logo, lời chào, bìa sách, intro hay khoảng lặng trước hook; tên sách không hiện trên hook. Chữ hook đọc được khi tắt tiếng;
  lời đọc có tiếng ngay (im lặng đầu > 0,5 giây bị cảnh báo).
- Hook gợi một vấn đề, một sai lầm quen thuộc hoặc một tương phản; không clickbait sai lệch; lời hứa của hook được giải quyết trong
  video.

### 6.4. Khung kể

Mỗi video: **một ý chính, một tình huống cụ thể, một cách xử lý, một hành động** làm được ngay.

**Một khung cho cả hai luồng, có kiểm tra:** Hook (`HOOK`) → Tình huống đời thường (`SITUATION`) → Sai lầm (`COMMON_MISTAKE`) →
Bài học trong sách và điều rút ra (`KEY_TAKEAWAY`) → Quay lại xử lý đúng tình huống mở đầu (`BETTER_APPROACH`) → Hành động cụ thể
(`ACTION_STEP`). Đúng thứ tự, mỗi phần ít nhất một cảnh, không loại cảnh khác; tên sách và bài học chỉ xuất hiện từ phần bài học.

- **Hàng loạt:** bản thảo hay kế hoạch cảnh sai mạch kể bị từ chối và đi vào lượt sửa AI.
- **Thủ công:** kịch bản Claude viết sai khung bị từ chối, không lưu gì (bấm tạo lại). Sau đó người dùng thêm, ẩn, sắp xếp tự do,
  có thêm loại **Tổng kết**; khung chỉ ràng buộc kịch bản do AI viết. Video nhiều bài học kể thành một câu chuyện theo cùng khung;
  hai bài học chỉ hợp lý khi chúng bổ trợ nhau.

**Kể cho cuốn hút, không chỉ đủ ý.** Khung chỉ quyết định thứ tự; cách kể do prompt quyết định, cho cả hai luồng:

- Hook mở giữa một khoảnh khắc cụ thể (một hành động, một câu thoại, một chi tiết lạ) và để lửng điều chưa giải thích, không mở
  bằng khuôn câu hỏi chung chung ("Có phải bạn…", "Bạn có biết…", "Tại sao bạn luôn…").
- Tình huống được dựng thành cảnh: nhân vật có tên (hoặc "bạn"), nơi chốn, vật nhìn thấy được; sai lầm có cái giá; có một cú
  "tưởng là A, hoá ra là B" trước bài học; thoại ngắn trong ngoặc kép, chỉ của nhân vật tự nghĩ ra; câu ngắn để đọc thành tiếng.
- Bài học là điều vừa nhìn ra chứ không phải bài giảng; cách giải quyết chiếu lại đúng khoảnh khắc mở đầu với kết quả khác; hành
  động đủ cụ thể để hình dung (làm gì, lúc nào, ở đâu).

**Góc kể tự động.** Mỗi video được giao một trong sáu góc kể, đều nằm trong khung trên: Bắt đầu từ đỉnh điểm, Cuộc đối thoại, Hai
lối rẽ, Phá một niềm tin, Cú đảo chiều, Leo thang từng bước. Người dùng không chọn và không thấy góc; hệ thống xoay góc để các
video không cùng một dáng, và không lưu gì thêm:

- **Thủ công:** theo video và số phiên bản kịch bản, nên **Tạo lại kịch bản** ra góc kế tiếp.
- **Hàng loạt:** theo đợt và vị trí của mục trong đợt, nên sáu video liên tiếp của một đợt có sáu góc khác nhau; thử lại hay
  phục hồi sau sự cố giữ nguyên góc. Cùng một bài học sản xuất lại ở đợt khác thường ra góc khác, tức một bản thảo mới (một lượt
  NotebookLM).

### 6.5. Bố cục và hoạt cảnh

- Năm bố cục dọc: Câu hỏi lớn, Chia đôi sai lầm / giải pháp, Thẻ tình huống, Chữ lớn ghi nhớ, Danh sách hành động.
  - Ba bố cục đầu là **sân khấu hoạt hình**: bối cảnh, nhân vật, đồ vật; chữ của cảnh là tiêu đề chữ động phía trên; cảnh sai lầm và
    cách làm có dấu ✗ / ✓.
  - Hai bố cục sau là **màn chữ động** toàn màn hình: nền màu, chữ lớn bật lên từng từ, một biểu tượng, nhân vật chính ở góc.
- Khung dọc chia dải, từ trên xuống:
  - thanh tiến độ theo các phần của câu chuyện, kèm nhãn phần (không có trên hook);
  - tiêu đề;
  - vùng hình;
  - phụ đề, phía trên vùng giao diện của nền tảng;
  - đồ trang trí của bối cảnh (bàn, quầy, bụi cây), lấp phần dưới.
  - Nhãn "Từ sách" chỉ hiện từ phần bài học.
- **Nhân vật** vẽ bằng Open Peeps (nét vẽ tay, CC0), cùng một nhân vật cho cả video, chọn theo tiêu đề video.
  - Mỗi hành động có dáng, khuôn mặt biểu cảm và dấu hiệu riêng: bóng nghĩ, bóng thoại, bóng đèn, mồ hôi, pháo giấy.
  - Nhân vật thở và nhún nhẹ theo frame.
- **Đồ vật** lấy từ Microsoft Fluent Emoji Flat (MIT), danh mục cố định ở `videos/domain/props.ts`. Nguồn và giấy phép ghi trong
  `THIRD_PARTY_NOTICES.md`.
- 7 bối cảnh, vẽ phẳng màu pastel, có chuyển động nhẹ (mây trôi, đèn đung đưa, sao lấp lánh, xe buýt chạy qua): Ở nhà, Văn phòng,
  Đường phố, Công viên, Quán cà phê, Lớp học, Phòng ban đêm.
- 8 hành động: Suy nghĩ, Lo lắng, Làm việc, Trò chuyện, Đi bộ, Lướt điện thoại, Nảy ra ý tưởng, Vui mừng.
- **Nhiều shot trong một cảnh, chung một giọng đọc:**
  - Hình được cắt tại đầu các trang phụ đề, mỗi shot khoảng 2,5–5 giây, xen kẽ cảnh rộng và cảnh trung.
  - Mỗi shot có camera đẩy chậm; đổi cỡ cảnh là cắt, không zoom.
  - Cảnh sau ở cùng bối cảnh mở bằng cỡ khác shot cuối của cảnh trước.
  - Đổi bối cảnh thì lau ngang; vào hoặc ra màn chữ thì trượt.
  - Chuyển cảnh không làm lệch giọng hay phụ đề và không đổi độ dài video.
- **Claude chọn** bối cảnh + hành động cho hook và từng cảnh, chỉ từ hai danh sách trên, khớp lời dẫn; giá trị lạ bị từ chối.
  - Thiếu thì dùng mặc định theo loại cảnh:

    | Loại cảnh    | Bối cảnh    | Hành động       |
    | ------------ | ----------- | --------------- |
    | Hook         | Đường phố   | Suy nghĩ        |
    | Tình huống   | Ở nhà       | Lướt điện thoại |
    | Sai lầm      | Văn phòng   | Lo lắng         |
    | Điều cần nhớ | Lớp học     | Nảy ra ý tưởng  |
    | Cách xử lý   | Công viên   | Đi bộ           |
    | Hành động    | Ở nhà       | Vui mừng        |
    | Tổng kết     | Quán cà phê | Trò chuyện      |

- **Người dùng đổi** hoạt cảnh từng cảnh trong trình biên tập hoặc "Về mặc định"; đổi hoạt cảnh giữ giọng đọc.
- Chuyển động chỉ phụ thuộc frame, nên xem trước và MP4 giống hệt.
  - Không filter/blur, ảnh, ngẫu nhiên, 3D, GPU hay tài sản mạng.
  - Không chớp nháy hay zoom nhanh.
  - Hoạt cảnh là bộ cố định, không vẽ riêng cho từng câu chuyện.

### 6.6. Chữ, phụ đề, vùng an toàn

- Chữ trên màn hình là từ khoá, tối đa 120 ký tự (trên 60 bị cảnh báo có thể tràn); mọi cảnh hiển thị phải có chữ.
- **Phụ đề theo trang:**
  - Mỗi trang tối đa 2 dòng ngắn, khoảng 22 ký tự mỗi dòng, và 8 từ.
  - Ngắt sau dấu kết câu, sau dấu phẩy khi trang đã dài, và ở chỗ ngừng của giọng.
  - Chữ đậm, viền đen, đặt ở 1/3 dưới.
  - Khi giọng có mốc từng từ khớp lời dẫn (edge-tts), phụ đề theo đúng giọng và **từ đang đọc sáng màu** (karaoke).
  - Không có mốc (âm thanh tải lên, giọng cũ) hoặc mốc không khớp lời: thời gian ước lượng theo âm tiết, không sáng từng từ.
- Vùng an toàn TikTok / YouTube Shorts / Facebook Reels là **mặc định ước lượng, chỉnh được**, không phải thông số chính thức; nội
  dung đặt trong vùng chặt nhất của cả ba nên một bản render dùng cho mọi nền tảng. Lớp vùng an toàn chỉ có trong trình biên tập,
  **không bao giờ** vào MP4.

### 6.7. Kiểm tra trước render

| Kiểm tra                                            | Nháp     | Cuối     | Tự động (hàng loạt) |
| --------------------------------------------------- | -------- | -------- | ------------------- |
| Có cảnh hiển thị; cảnh đầu là HOOK; mọi cảnh có chữ | Chặn     | Chặn     | Chặn                |
| Tổng ≤ 300 giây                                     | Chặn     | Chặn     | Chặn                |
| HOOK ≤ 4 giây; tổng ≤ mức dài nhất của khoảng       | Cảnh báo | Chặn     | Chặn                |
| Tổng ≥ mức ngắn nhất của khoảng                     | Cảnh báo | Cảnh báo | Chặn                |
| Kịch bản đã duyệt hoặc đã qua kiểm tra tự động      | Cảnh báo | Chặn     | —                   |
| Mọi cảnh hiển thị có giọng đọc                      | Cảnh báo | Cảnh báo | Chặn                |
| Mọi bài học còn trích đoạn nguồn                    | —        | —        | Chặn                |

Render ghi tệp tạm rồi mới thành bản chính thức; ffprobe xác nhận codec, kích thước, FPS, thời lượng. Render lỗi hay bị huỷ không
bao giờ để lại MP4 hỏng được ghi là thành công; render đã hoàn tất thì không lỗi nào sau đó được xoá MP4 hay đổi trạng thái của nó.

## 7. AI và nội dung

### 7.1. Nhà cung cấp

- `mock`: dữ liệu mẫu tất định, không mạng, không tốn hạn mức (demo, kiểm thử, chạy thử luồng hàng loạt).
- `cli-task` (mặc định): Studio tạo tác vụ, **người dùng** chạy lệnh trong terminal để gọi Claude Code CLI đã đăng nhập của mình.
- `cli-auto` (tuỳ chọn, tắt trong cấu hình mẫu): worker tự chạy Claude Code CLI của người dùng; chỉ dùng cá nhân trên `127.0.0.1`;
  bắt buộc cho NotebookLM và luồng hàng loạt thật.

Trong luồng hàng loạt, Claude biên tập bản thảo NotebookLM thành kế hoạch cảnh (lời dẫn, chia cảnh, bố cục, chữ, hoạt cảnh); hai
kết quả lưu riêng, có phiên bản riêng, để truy vết Claude đã sửa gì. Claude chỉ sinh JSON: không công cụ, không MCP server từ cấu
hình người dùng, môi trường đã làm sạch. Mỗi lúc một lần gọi AI; hết hạn mức, chưa đăng nhập, quá thời gian → lỗi có mã rõ ràng,
không thử lại vô hạn.

### 7.2. Quy tắc nội dung

- **Không bịa** trích dẫn, câu nói nguyên văn, nghiên cứu, số liệu hay số trang. Trích đoạn là câu có thật, chép nguyên văn; không
  tìm thấy trong chương thì bị loại; không chắc thì để trống.
- Tình huống AI sáng tác là **minh hoạ**, không bao giờ trình bày như chuyện trong sách hay lời tác giả: trường tình huống của bài
  học luôn mang nhãn minh hoạ; nhịp bản thảo do AI tự nghĩ ra được đánh dấu và hiện ở tab Nguồn kịch bản; Claude phải giữ nó là
  minh hoạ khi biên tập; hồ sơ lưu Drive ghi rõ cảnh nào là minh hoạ (§5.9).
- Nhân vật, nơi chốn và câu thoại AI tự nghĩ ra (§6.4) cũng là minh hoạ: không gắn cho tác giả hay cuốn sách, không nói là chuyện
  có thật, không kể ngôi "tôi" như trải nghiệm của người làm video. Bản thảo đánh dấu minh hoạ mọi nhịp có chi tiết bịa, không
  chỉ nhịp tình huống. Video làm tay không có bản thảo, nên các cảnh Hook, Tình huống, Sai lầm và Cách xử lý đều được đánh dấu
  minh hoạ; bài học và hành động là của sách.
- Claude được sửa lời cho dễ nghe, đúng thời lượng nhưng **không thêm** trích dẫn, số liệu, tên nghiên cứu hay khẳng định ngoài bản
  thảo và bài học; câu thoại đã có trong bản thảo thì giữ nguyên chữ. Một kiểm tra cơ học chặn số và trích dẫn không có trong
  nguồn (so khớp theo chữ, bỏ qua hoa thường, khoảng trắng và dấu câu) — lưới an toàn, không phải bằng chứng trung thực.
- Không clickbait sai lệch, không sao chép dài. Độ tin cậy OCR và "trích đoạn khớp nguồn" là hai bằng chứng riêng.
- Tiêu đề, caption, hashtag (§5.13) chỉ dùng ý có trong kịch bản, bài học và tên sách; video phải trả lời được điều tiêu đề hứa.
  Kiểm tra cơ học như trên chặn số và trích dẫn không có trong kịch bản, bài học, tên sách và tác giả.

### 7.3. Ngôn ngữ

Sách có thể bằng tiếng Việt hoặc tiếng Anh (OCR giữ đúng ngôn ngữ). Bài học, bản thảo, lời dẫn, chữ, phụ đề **luôn tiếng Việt** tự
nhiên, có dấu: dịch ý, không chèn câu tiếng Anh trừ tên riêng, tên sách. Hashtag viết không dấu (§5.13). Trích đoạn nguồn giữ **nguyên văn ngôn ngữ gốc** để đối
chiếu được. Mã, định danh, tên tệp bằng tiếng Anh.

### 7.4. Văn bản sách là dữ liệu không đáng tin

- Văn bản sách được bọc như dữ liệu trong mọi prompt; câu lệnh trong sách ("bỏ qua mọi hướng dẫn…") không điều khiển AI hay worker.
- **Không bao giờ gửi cả cuốn sách** cho AI. Mỗi lần chỉ: một chương (phân tích thủ công), một phần chương có giới hạn (NotebookLM),
  dàn ý đầu trang (xác định chương), nguồn các chương mà bài học trích (bản thảo), hoặc snapshot bài học đã chọn (kịch bản, tiêu
  đề và caption).
- Đầu ra AI luôn qua kiểm tra schema; sai → tác vụ lỗi, không lưu gì. NotebookLM chỉ được trả JSON.
- Không gọi AI khi tải trang. Prompt có phiên bản, đổi nội dung là đổi phiên bản ([AGENTS.md](../AGENTS.md) §9). Bản thảo NotebookLM
  hợp lệ được cache theo bài học, khoảng thời lượng, nguồn, phiên bản prompt, nên cùng yêu cầu không tốn hạn mức lần hai.

## 8. Tích hợp bên ngoài

Chỉ các dịch vụ dưới đây được phép, mỗi dịch vụ sau một ranh giới riêng, thay được mà không sửa nghiệp vụ
([architecture.md](architecture.md)); cài đặt và hạn mức ở [operations.md](operations.md). Kiểm thử không bao giờ gọi dịch vụ thật.

- **Claude Code CLI** (tài khoản của người dùng): phân tích, kịch bản, biên tập cảnh. Người dùng đã có gói Claude Code nên không cần
  API key; gói đó không phải API để bán hay chia sẻ, nên Studio chỉ phục vụ chính người dùng và không nhận mật khẩu/token/cookie
  Claude.
- **edge-tts**: giọng tiếng Việt miễn phí nhưng không chính thức, có thể chập chờn; luồng thủ công luôn cho tải âm thanh lên.
- **Mistral OCR Batch** (khoá của người dùng): chỉ trang PDF cần OCR; batch rẻ hơn nhưng bất đồng bộ. Model ghim cố định; trần chi
  phí không tự nâng, không tự đổi nhà cung cấp; tệp phía Mistral bị xoá sau khi kết quả đã lưu.
- **NotebookLM** (MCP stdio, tiến trình con của worker, chỉ khi `cli-auto`): qua công cụ không chính thức `notebooklm-mcp-cli` với
  profile đã đăng nhập của người dùng và hạn mức gói của họ. Một notebook mỗi sách, một nguồn mỗi phần chương; mỗi câu hỏi chỉ rõ
  nguồn được dùng. Notebook của mỗi sách được cấu hình trò chuyện (vai trò phân tích sách + biên kịch video, câu trả lời dài hơn)
  trước câu hỏi đầu tiên; vai trò không bao giờ thắng định dạng JSON và độ dài mà từng câu hỏi yêu cầu.
- **Google Drive** (OAuth `drive.file`): quyền tối thiểu, ứng dụng chỉ thấy tệp nó tạo. Token chỉ ở máy cục bộ, không trong cơ sở
  dữ liệu, giao diện hay log. Ngắt kết nối thu hồi quyền, không xoá gì trên Drive. Ứng dụng tự giới hạn nhịp và lượng gửi mỗi 24
  giờ, kiểm tra dung lượng trước khi upload.

- **Telegram** (tuỳ chọn, bot token của người dùng): chỉ gửi thông báo một chiều tới một chat/channel hoặc group bật Topics; không lệnh điều khiển, webhook,
  upload MP4 hay thay đổi quyền chia sẻ Drive. Token không đi vào SQLite, DTO hoặc log.

Không thêm dịch vụ đám mây khác, không Anthropic API, không gộp OCR/NotebookLM/Drive/Telegram vào giao diện AI chung.

### 8.1. Model Claude và thông báo Telegram

- `CLAUDE_MODEL` chọn model cho mọi lần gọi Claude của ứng dụng, ví dụ `claude-sonnet-5-5` hoặc `claude-opus-5-5`; để trống giữ
  mặc định CLI. Không sửa settings toàn máy. Đổi cấu hình cần khởi động lại web/worker; không tự chạy lại artifact đã xong.
- `CLAUDE_EFFORT` chọn effort cho mọi lần gọi Claude: `low`, `medium`, `high`, `xhigh`, `max`; để trống dùng settings/mặc định CLI.
  Giá trị sai bị từ chối khi đọc cấu hình. Thay effort tách cache Claude scene plan cho lần gọi mới, không đổi cache NotebookLM.
- Khi bật Telegram, video FINAL chỉ báo sẵn sàng sau khi archive được xác minh, kèm link đúng MP4 trên Drive. Chưa kết nối Drive
  thì báo video đã render local, cần kết nối; lỗi archive nói rõ MP4 vẫn có và lỗi ở bước lưu Drive.
- Báo lỗi cuối hoặc trạng thái cần người dùng xử lý, gồm PDF/OCR/chia chương, phân tích chưa hết, bản thảo, cảnh, TTS, readiness,
  render và archive. Tin có bước, mã lỗi, nguyên nhân đã lọc, scene/trang nếu có và ID tác vụ. Không gửi token, prompt hay văn bản sách.
- Một lỗi gốc chỉ có một thông báo; không báo lại lỗi bọc của job/batch cha hoặc người dùng chủ động huỷ. Retry thủ công thất bại
  tiếp là một sự kiện mới. Một đợt quota của provider chỉ báo chờ một lần; chỉ báo tiếp tục sau lần gọi thành công.
- Tin lưu cùng giao dịch với trạng thái nghiệp vụ; worker gửi riêng. Telegram lỗi không chạy lại video. Mất phản hồi được thử gửi
  lại có giới hạn, có thể trùng tin với cùng mã sự kiện. Mặc định tắt, không gửi lại lịch sử khi bật; thời gian trong tin theo Asia/Saigon.
- `TELEGRAM_MODE=forum` gom mỗi sách vào một topic, gắn theo `bookId` và group; sách trùng tên vẫn tách riêng. Tin quota chung và
  lỗi trước khi có sách vào topic **Hệ thống**. `chat` là mặc định tương thích cấu hình cũ; tin đã xếp hàng giữ chế độ và group lúc tạo.
- Worker tự tạo topic khi có tin đầu tiên, lưu ID để dùng lại sau retry/restart. Không tự đổi tên topic khi đổi tên sách, không gửi ra
  ngoài topic nếu topic đóng/xoá. Mất phản hồi tạo topic phải đối soát/gắn ID bằng CLI, không tự tạo lại một topic có thể đã tồn tại.

## 9. Yêu cầu phi chức năng

- **Triển khai:** Windows + WSL2 Ubuntu; mã, dữ liệu, media trên filesystem Linux (không `/mnt/c`); trình duyệt Windows mở
  `127.0.0.1`. Một web process, một worker process, Redis cục bộ.
- **Mạng:** một người dùng, không đăng nhập, chỉ `127.0.0.1`; nếu mở ra LAN/Internet phải có xác thực, CSRF, giới hạn tần suất trước.
- **Tài nguyên:** RAM host 48 GB, CPU/GPU chưa rõ: một việc nền, một render, một lần gọi AI mỗi lúc; không cần GPU hay Docker
  Desktop; bản nháp nhẹ, xem trước thu nhỏ. Chỉ tăng sau khi đo trên máy thật; không tự sửa `.wslconfig` hay thiết lập máy.
- **Phản hồi:** việc dài (AI, giọng đọc, render, trích xuất, sản xuất, lưu Drive) luôn chạy nền; yêu cầu trả về ngay.
- **Bền vững:** khởi động lại web, worker, Redis không mất dữ liệu hay tác vụ; web vẫn mở khi Redis/worker tắt, worker dừng rõ ràng
  khi không có Redis; thử lại không nhân bài học, âm thanh, video, render hay tệp Drive.
- **Đúng đắn và bảo mật:** dữ liệu ở mọi biên (HTTP, tệp tải lên, đầu ra AI, tác vụ, props video) được kiểm tra schema; không lộ
  thông tin đăng nhập; không ghép lệnh shell từ dữ liệu; đường dẫn không thoát khỏi thư mục dữ liệu; log không chứa văn bản sách hay
  bí mật.
- **Chi phí:** không bắt buộc API trả phí; chi phí duy nhất có thể có là OCR Mistral cho trang scan, trong trần đã đặt.
- **Hiệu năng:** không cam kết thời gian render, OCR hay AI khi chưa đo trên máy thật.
- **Giấy phép:** người dùng tự kiểm tra giấy phép Remotion; font Be Vietnam Pro theo SIL OFL.

## 10. Kịch bản nghiệm thu

### 10.1. E2E-01 — Một sách, nhiều video (thủ công)

1. Nhập sách mẫu `.md` ≥ 3 chương, đổi tên một chương, xác nhận; phân tích bằng AI mẫu; duyệt 3 bài học.
2. Video A từ bài 1 (khoảng 30–60 giây; AI đề xuất độ dài), chọn hook; tab **Đăng tải** có tiêu đề, caption, hashtag viết cùng
   kịch bản, sửa và lưu được, hashtag được chuẩn hoá. Video B từ bài 2 + 3 (khoảng 30–90 giây); sửa một cảnh, các cảnh khác không
   đổi.
3. Sửa bài 1 → snapshot của video A không đổi.
4. Tải âm thanh cho hook; chữ hook có ngay ở frame 0 trong xem trước.
5. Duyệt kịch bản, render nháp và bản cuối; ffprobe: H.264 + AAC, 720×1280 / 1080×1920, 30 FPS, không vượt mức dài nhất.
6. Tải lại trang, khởi động lại web → mọi dữ liệu còn nguyên.

### 10.2. E2E-02 — PDF tới Drive, không bước duyệt (hàng loạt)

Tải PDF ở "Sách PDF" → trích xuất, có chương → **Phân tích tất cả chương** → chọn một bài **vẫn là bản nháp** → **Sản xuất 1
video** → video hoàn tất, **Đã lưu Drive** kèm liên kết thư mục và `publish.txt` → MP4 1080×1920 H.264 + AAC; bài học vẫn
**Bản nháp**.

### 10.3. Trường hợp biên và lỗi

- Tệp nhị phân ở tab văn bản → từ chối. Tên tệp `../../secret.md` → không thoát khỏi thư mục dữ liệu.
- TXT không có dấu hiệu chương → chia tay; Markdown có mục lục và heading phụ → không tạo chương ma. Nhập trùng → cảnh báo / từ
  chối (PDF).
- PDF hỏng, có mật khẩu, vượt giới hạn → lỗi trước mọi dịch vụ trả phí. Trang OCR lỗi → "Còn trang lỗi", thử lại chỉ các trang đó.
- Mất phản hồi khi gửi lô OCR → đối soát, không gửi lô trả phí thứ hai. Vượt trần → dừng kèm lý do, trần không tự nâng.
- Không tìm thấy chương → "Chưa xác định chương", không lấy cả sách.
- AI trả JSON sai → tác vụ lỗi, không lưu gì. Claude CLI thiếu, chưa đăng nhập, hết hạn mức → lỗi có mã, không thử lại vô hạn. Sách
  chứa "ignore previous instructions" → chỉ là văn bản.
- Redis tắt → web vẫn mở, báo lỗi khi xếp việc. Worker tắt → tác vụ chờ, chạy tiếp khi worker bật.
- edge-tts lỗi → tải âm thanh lên được. Âm thanh đổi → độ dài cảnh cập nhật, render cũ lỗi thời.
- Âm thanh 65 giây với khoảng tới 60 giây → chặn bản cuối, không tự nới khoảng. Đề xuất 60 giây, âm thanh thật 68 giây, khoảng tới
  90 giây → đạt. AI đề xuất độ dài ngoài khoảng → từ chối (thủ công) hoặc lượt sửa AI (hàng loạt). Thiếu HOOK hoặc HOOK > 4 giây → lỗi kiểm tra.
- Chữ dài có thể tràn vùng an toàn → cảnh báo. Render lỗi giữa chừng → không MP4 hỏng nào được ghi thành công.
- Gửi đợt hai lần, thử lại mục → không thêm video. Worker chết giữa bước, hay NotebookLM xong mà Claude lỗi → chỉ chạy lại bước lỗi.
  Kết quả AI vẫn sai sau lượt sửa → video "Lỗi" kèm lý do. Huỷ → không bước nào chạy tiếp.
- Render xong mà Drive lỗi hay mất phản hồi khi upload → chỉ upload lại, không tệp trùng. Drive đầy, mất quyền → lỗi kèm lý do, MP4
  vẫn trên máy. Sửa video sau render → bản lưu Drive cũ không đổi.
- Caption AI có số liệu hay trích dẫn không có trong nguồn → bỏ bộ đó, kịch bản vẫn lưu; với **Tạo lại** → tác vụ lỗi, bộ cũ giữ
  nguyên. Sửa cảnh sau khi viết caption → **Cần xem lại**; bản cuối render lúc đó không kèm `publish.txt`.

### 10.4. Nghiệm thu với tài khoản thật

Chưa thực hiện: OCR với Mistral thật (đầu ra và chi phí trên bộ trang đại diện), rồi một video mẫu từ NotebookLM thật tới Google
Drive thật (mạch kể, âm thanh, ffprobe, checksum Drive). Danh sách kiểm tra: [operations.md](operations.md).

### 10.5. Nhập nhiều sách và sản xuất tự động

- Một đợt nhận 1–15 PDF, mỗi PDF là một sách. Tải lần lượt từng tệp, giữ nguyên giới hạn dung lượng và trần chi phí OCR
  của từng sách. Tải đủ tệp trước khi bắt đầu xử lý; tệp không hợp lệ được báo lỗi riêng, sách hợp lệ vẫn được làm tiếp.
- Người dùng chọn khoảng thời lượng và nhịp độ cho cả đợt. Luồng tự động mới tạo **một video cho mỗi bài học**
  tìm được trong mỗi sách, theo quyết định của chủ dự án. Luồng chọn bài học hiện có vẫn dùng được riêng.
- Xử lý một sách tại một thời điểm, kể cả giữa nhiều đợt. OCR → phân tích lần lượt từng chương bằng NotebookLM →
  bản thảo NotebookLM → cảnh JSON Claude Code → giọng đọc → Remotion. Không thêm bước duyệt kịch bản.
- UI nhập sách thống nhất tại `/books/import`: chọn PDF, TXT/Markdown hoặc dán văn bản. PDF nhận 1–15 tệp và có
  hai lựa chọn **Chỉ nhập sách** (mặc định) / **Tự động làm video**; chỉ chế độ tự động hiện thời lượng và nhịp độ,
  giống nhau khi chọn một hay nhiều PDF. TXT/Markdown vẫn kiểm tra chương và dùng luồng thủ công. Nút hành động là
  icon có tooltip và nhãn truy cập; tiến trình, lỗi, tải lại vẫn thể hiện bằng chữ. URL nhập nhiều PDF cũ được chuyển hướng.
- Có thể chạy hàng giờ và đóng trình duyệt sau khi tải đủ tệp. Lịch chờ, tiến độ, các bản đã tạo được giữ qua restart.
- Quota là trạng thái chờ, không tiêu lượt retry lỗi tạm thời. Lịch chờ dùng chung theo provider; chỉ một worker, không
  gọi provider cho mỗi video đang chờ. Claude có thể bị giới hạn theo phiên hoặc tuần; dùng giờ reset thực được báo,
  không giả định luôn được mở lại sau 5 giờ.
- Khi Claude báo giờ reset hoặc còn bao lâu nữa reset, đặt lịch job chạy lại từ mốc đó, không đánh thức job mỗi phút
  hay gọi Claude trong lúc chờ. Ví dụ còn 30 phút hoặc 1 giờ thì job chờ đủ khoảng đó rồi tiếp tục từ checkpoint.
  Nếu không biết giờ reset, tối đa một tác vụ Claude đang chờ được thử mỗi phút. Không gửi prompt chỉ để thăm dò quota,
  không đọc token/cookie để gọi API quota riêng.
- NotebookLM dùng `usage_get` của MCP để đọc hạn mức khi mở phiên và khi gặp lỗi quota. Chờ tới mốc reset muộn nhất
  của các cửa sổ đã cạn (ngắn hạn/tuần), không gọi lại trong lúc chờ. Không biết giờ reset thì nghỉ 15 phút; không suy
  hạn mức từ tên gói và không coi số phần trăm chưa biết là đã hết. Cài đặt vẫn hiển thị được hạn mức đã cạn.
- Drive kiểm tra dung lượng thật bằng API chính thức với cache tối đa một giờ. Trần upload nội bộ mặc định
  750 GiB/24 giờ, độc lập với dung lượng gói Google và quota API; giữ giãn nhịp gọi và xử lý rate limit.
- Lỗi tạm thời retry hữu hạn với khoảng nghỉ tăng dần. Lỗi đăng nhập, quyền, đầu vào sai hoặc hết ngân sách cần người
  xử lý. Mất phản hồi OCR/Drive vẫn phải đối soát checkpoint trước khi gửi lại.
- Một sách lỗi không ngăn sách sau. Trang tiến độ báo sách lỗi và liên kết tới video/Drive. Thử lại sách lỗi tiếp tục
  bước chưa xong, không nhân đôi sách, bài học đã hoàn tất hoặc video. Huỷ giữ nguyên dữ liệu và media đã có.
- Drive giữ luồng lưu trữ riêng. Khi có kết nối, đợi upload của sách hiện tại kết thúc trước khi chuyển sách tiếp;
  khi chưa kết nối, video giữ trên máy và archive intent hiện có vẫn chờ kết nối.

## 11. Thứ tự ưu tiên khi đánh đổi

1. Đúng đắn của dữ liệu Sách–Chương–Bài học–Video và nguồn gốc bài học.
2. Pipeline video dọc chạy trọn từ sách tới MP4.
3. Hook 4 giây, lời dẫn và phụ đề tiếng Việt, đọc rõ trên điện thoại.
4. Tác vụ đáng tin, không mất dữ liệu, không trả tiền hai lần cho một việc; render nhẹ trên WSL.
5. Giao diện đơn giản; xem trước dọc và kiểm tra thời lượng.
6. Hoạt hình và hiệu ứng nâng cao.

Thiếu thời gian thì ưu tiên lát cắt chạy thật bằng AI mẫu + âm thanh tải lên hơn tính năng trang trí. Không đánh đổi trần chi phí hay
độ trung thực của nguồn để lấy tốc độ.

## 12. Hiện trạng triển khai

| Năng lực                                                                | Trạng thái                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Luồng thủ công từ `.md`/`.txt` tới render nháp/cuối                     | Đã triển khai; E2E-01 chạy với AI mẫu                                 |
| Claude Code CLI (`cli-task`, `cli-auto`); edge-tts và tải âm thanh      | Đã triển khai                                                         |
| Video tới 5 phút, AI đề xuất độ dài trong khoảng; hook 4 giây mọi luồng | Đã triển khai (NotebookLM đề xuất: chỉ kiểm thử với NotebookLM giả)   |
| Một khung kể cho cả hai luồng; hoạt cảnh SVG do Claude chọn             | Đã triển khai                                                         |
| Nhập PDF, lớp chữ (Poppler), ghép văn bản, tạo chương                   | Đã triển khai; kiểm thử với Poppler thật                              |
| OCR Mistral Batch và trần chi phí                                       | Có trong mã; **chỉ kiểm thử với Mistral giả**                         |
| NotebookLM: xác định chương, danh mục, bản thảo                         | Có trong mã; **chỉ kiểm thử với NotebookLM giả**                      |
| Claude biên tập cảnh; kịch bản tiếng Việt từ sách tiếng Anh             | Có trong mã; chưa chạy với NotebookLM thật                            |
| Sản xuất hàng loạt (checkpoint, sửa AI, kiểm tra tự động, huỷ/thử lại)  | Đã triển khai; E2E-02 chạy với AI mẫu và Drive giả                    |
| Lưu Google Drive                                                        | Có trong mã; **chỉ kiểm thử với Google giả**                          |
| Tiêu đề, caption, hashtag (cùng kịch bản, Tạo lại, `publish.txt`)       | Đã triển khai; E2E chạy với AI mẫu; **chưa đánh giá với Claude thật** |
| Nghiệm thu với tài khoản Mistral, NotebookLM, Google thật               | **Chưa thực hiện**                                                    |
| Nhạc nền; EPUB; tách chương thủ công cho PDF                            | Chưa có                                                               |
