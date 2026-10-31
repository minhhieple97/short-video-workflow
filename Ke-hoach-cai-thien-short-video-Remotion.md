# Kế hoạch triển khai chi tiết: Claude Code + Remotion + Edge TTS

**Cập nhật:** 30/10/2026.  
**Trạng thái:** kế hoạch thực hiện; các task chưa được coi là đã triển khai chỉ vì đã có tài liệu.  
**Mục tiêu:** 15–20 video/ngày, mỗi video 60–120 giây; nội dung và giọng đọc tiếng Việt cho TikTok, YouTube Shorts và Facebook Reels.

## 1. Cách đọc và thực hiện kế hoạch

Tài liệu chia công việc theo đầu ra có thể kiểm tra riêng. Mỗi task trả lời sáu câu hỏi: làm gì, vì sao cần, phạm vi tới đâu, tạo ra gì, khi nào được coi là xong và cần task nào trước đó.

Đọc phần mục tiêu/quy tắc và roadmap trước, sau đó chọn các task đã đủ điều kiện bắt đầu. Các thông số và hợp đồng dùng chung ở phụ lục giúp tránh lặp lại chi tiết kỹ thuật trong từng task.

### 1.1. Cấu trúc một task

| Trường | Cách dùng |
| --- | --- |
| Mã task | `P3-04` là task 04 của Phase 3; đây là mã thứ tự, không phải mức độ khẩn cấp. |
| Vì sao cần | Nêu vấn đề hoặc chi phí đang tồn tại, hậu quả nếu bỏ qua và lợi ích của task. |
| Phạm vi | Các việc cụ thể cần làm; task không tự mở rộng thành việc viết lại cả hệ thống. |
| Đầu ra | Code, dữ liệu, hình/clip hoặc quyết định có thể xem được. Một cuộc thảo luận chưa thay thế đầu ra này. |
| Hoàn thành khi | Tiêu chí quan sát/kiểm tra được; khi đánh dấu xong phải kèm bằng chứng phù hợp. |
| Phụ thuộc | Các task cần hoàn thành hoặc được ghi nhận không áp dụng với lý do trước khi bắt đầu. |
| Quy mô | `S`: một thay đổi/đầu ra hẹp. `M`: một thay đổi có phối hợp vài thành phần. Không phải cam kết số giờ. |
| Điều kiện | Một số task chỉ làm khi kết quả đo cho thấy cần; không thêm việc tối ưu chỉ để lấp checklist. |

Nếu đọc repository cho thấy một task M còn quá rộng, chia thành task con `P3-04.a`, `P3-04.b` với cùng cấu trúc lý do/đầu ra/nghiệm thu; cập nhật phụ thuộc và giữ mã gốc để truy vết.

### 1.2. Trạng thái và bằng chứng

Mỗi task chuyển qua `Chưa làm → Đang làm → Cần sửa hoặc Hoàn thành`. Có thể dùng `Không áp dụng` cho task có điều kiện, nhưng phải ghi điều kiện nào không xảy ra và bằng chứng quyết định bỏ qua. Task bị chặn phải ghi cụ thể dữ liệu, công cụ hoặc dependency còn thiếu; không đánh dấu xong bằng một giả định.

- Task hình: khung hình/clip và ghi chú lỗi đã sửa.
- Task audio/timing: audio thực, mốc thời gian và kiểm tra điểm nối hoặc đầu–giữa–cuối.
- Task dữ liệu: ví dụ input/output, kiểm tra tương thích hoặc test đúng rủi ro.
- Task hiệu năng: cấu hình, đầu vào, số đo và cách tính.
- Task vận hành: lô chạy, lỗi/retry, thời gian người dùng thao tác và kết quả resume/rollback.

Gate của mỗi phase là kiểm tra đầu ra, không phải một vòng xin lại sự đồng ý cho toàn bộ kế hoạch. Người dùng đã chấp thuận hướng làm; các lựa chọn triển khai thông thường được xử lý chủ động trong phạm vi đó. Chỉ đưa ra quyết định còn thiếu khi nó thực sự ảnh hưởng hướng thiết kế hoặc bị giới hạn quyền truy cập.

## 2. Những quyết định giữ nguyên trong toàn bộ backlog

| Nội dung | Quyết định đã chốt |
| --- | --- |
| Nội dung video | Bài học từ sách, tình huống gần gũi và hành động cụ thể; phân biệt nguồn sách với ví dụ tự viết. |
| Phong cách | Cảnh nhân vật kết hợp chữ động, hình nhất quán, chuyển động có lý do. |
| Môi trường | Windows + WSL, RAM 48 GB; tối ưu cho CPU/ổ đĩa thực tế sau đo. |
| Giọng đọc | Giữ Edge TTS và voice tiếng Việt hiện tại trong toàn bộ MVP/pilot. |
| ElevenLabs | Không cần key/SDK, không dùng cho voice/SFX/alignment và không fallback trả phí. |
| `what-if-animation` | Học storyboard, cue theo lời và kiểm tra hình; không chạy nguyên skill/pipeline upstream. |
| SFX/nhạc | Pack local có nguồn rõ, là phần tùy chọn khi chưa có asset phù hợp. |
| Asset | Cho phép ảnh local qua Remotion `<Img>` và SVG được duyệt; không tạo hình mới cho mọi shot. |
| TTS và hình | Một audio segment có thể phủ nhiều shot; thay hình không tạo lại giọng. |
| Phụ đề | Theo cụm để đọc rõ; highlight từng token khi timing được kiểm tra. |
| Animation | Dựa trên frame; code thư viện được kiểm tra, video mới chủ yếu là dữ liệu. |
| Render | Audio/font/ảnh đã sẵn sàng local; không gọi TTS hoặc API ngoài trong composition. |
| Bộ đầu tiên | 1–2 nhân vật, 4–6 pose, 3–4 biểu cảm, khoảng 4 bối cảnh, khoảng 20 props, 5–6 template. |
| Độ dài và xuất file | 60–120 giây; khởi đầu với final 1080×1920, 30 fps, H.264/AAC. |
| Kiểm tra | Đúng rủi ro của thay đổi, giữ gate bắt buộc của repo; không chạy toàn bộ E2E cho mọi chỉnh màu. |
| Mở rộng | Dựa trên nhu cầu pilot và số đo, không xây trước rig đa năng, 3D hoặc hạ tầng cloud. |

Edge TTS dùng dịch vụ online ở bước chuẩn bị audio; render đọc file đã có.[R23] Thiếu timing tốt thì chuyển sang caption theo cụm. Thiếu SFX tùy chọn thì bỏ track đó. Thiếu audio bắt buộc thì báo lỗi và resume, không xuất bản cuối mất lời và không tự mua/gọi dịch vụ khác.

Thông tin “100 ms/khung”, đường dẫn code và phiên bản trong kế hoạch trước cần được Phase 0 xác minh. Tài liệu này không phải bằng chứng rằng repository đã sửa hoặc máy đã đạt sản lượng mục tiêu.

## 3. Vì sao triển khai theo thứ tự này?

1. **Làm rõ hệ thống đang có trước:** tránh làm hỏng luồng sản xuất và biết phần nào có thể tận dụng.
2. **Chứng minh bằng hình/clip nhỏ:** sửa một mẫu 15–20 giây rẻ hơn sửa cả thư viện sau khi đã xây nhiều bối cảnh.
3. **Đóng gói thành thư viện:** biến mẫu tốt thành thành phần dùng lại để mỗi video không cần thiết kế từ đầu.
4. **Tách audio khỏi shot:** tăng nhịp hình mà không tăng tương ứng số request TTS và điểm nối giọng.
5. **Chuẩn hóa timing và caption:** mọi thay đổi lời, trim hoặc tốc độ có cách cập nhật nhất quán, có fallback khi metadata chưa tốt.
6. **Đo rồi mới tối ưu:** chọn đúng bottleneck và cấu hình trên máy thật, thay vì suy từ số node hoặc RAM.
7. **Pilot rồi xác nhận lô sản xuất:** đo cả phút sửa tay, retry và render lại, không chỉ thời gian xuất một MP4.

Các phase là nhóm công việc. Những task độc lập có thể làm song song theo dependency; không cần chờ hoàn tất toàn bộ mỹ thuật mới đọc code audio hoặc chuẩn bị benchmark. Render, benchmark và các tác vụ nặng trên cùng máy vẫn nên xếp lịch để không tranh tài nguyên hoặc làm sai phép đo.

## 4. Roadmap và các mốc bàn giao

| Phase | Task | Vì sao/đầu ra của nhóm | Điều kiện mở việc |
| --- | --- | --- | --- |
| 0. Xác minh hiện trạng và chuẩn bị | **6 task** · [P0-01](#p0-01) → [P0-06](#p0-06) | Bản đồ hệ thống, môi trường thử, fixture, baseline | Bắt đầu ngay bằng P0-01 |
| 1. Chứng minh hướng hình bằng mẫu nhỏ | **8 task** · [P1-01](#p1-01) → [P1-08](#p1-08) | Styleframe, clip mẫu, quy tắc thiết kế | Sau bộ mẫu/quy tắc tương ứng ở Phase 0 |
| 2. Đóng gói thư viện hình và template | **10 task** · [P2-01](#p2-01) → [P2-10](#p2-10) | Asset manifest, cast/props/bối cảnh, template catalog | Sau P1-08 |
| 3. Tách nội dung, audio, shot và dữ liệu lưu | **10 task** · [P3-01](#p3-01) → [P3-10](#p3-10) | Hợp đồng, adapter cũ, compiler, composition, snapshot/editor | P3-01 mở sớm sau P0-01/P0-06; tích hợp chờ thư viện |
| 4. Hoàn thiện caption và âm thanh với Edge TTS | **10 task** · [P4-01](#p4-01) → [P4-10](#p4-10) | Edge runtime, timing, caption, retry/resume, mix mẫu | Mở từng nhánh khi dữ liệu, font và audio phụ thuộc đã có |
| 5. Đo hiệu năng và chốt cấu hình | **7 task** · [P5-01](#p5-01) → [P5-07](#p5-07) | Benchmark, profile/concurrency, ngân sách pilot | P5-01 mở sau baseline; đo bản tích hợp chờ P4-10 |
| 6. Pilot, xác nhận công suất và vận hành | **8 task** · [P6-01](#p6-01) → [P6-08](#p6-08) | Video pilot, báo cáo lô, runbook, bản nội bộ và backlog | Chuẩn bị nội dung sớm; pilot sau P4-10/P5-07 |

**Mốc 1:** hiểu baseline và có môi trường thử an toàn.  
**Mốc 2:** có một mẫu video ngắn đủ tốt để làm chuẩn.  
**Mốc 3:** mẫu đó chạy trên thư viện/timeline dùng lại được.  
**Mốc 4:** video đầy đủ dùng Edge TTS và caption/audio có xử lý lỗi.  
**Mốc 5:** có cấu hình render và số đo phù hợp máy.  
**Mốc 6:** có bằng chứng vận hành ở lô thực tế cùng quy trình khôi phục.

Tất cả task dưới đây bắt đầu ở trạng thái chưa thực hiện. Checkbox dùng để theo dõi việc triển khai sau này.

**Tổng phạm vi:** 59 task; 57 task nền tảng và 2 task xử lý có điều kiện. Số task dùng để phân rã công việc, không đồng nghĩa 59 phiên làm việc hoặc 59 lần xin duyệt.

## 5. Phase 0 — Xác minh hiện trạng và chuẩn bị

**Mục tiêu:** Có môi trường thử riêng, luồng Edge hiện tại chạy được, bộ mẫu và baseline đủ để đánh giá thay đổi.

**Lý do có phase này:** Bước này biến những giả định của plan thành thông tin có thể dùng khi sửa code. Việc xác minh sớm tránh làm lại chức năng đã có hoặc thử trên dữ liệu đang sản xuất.

**Mốc bàn giao:** P0-05 và P0-06 hoàn thành; baseline có input/cấu hình rõ, môi trường thử đã được kiểm tra và quy tắc triển khai được ghi lại.

### P0-01

**Lập bản đồ luồng tạo video đang chạy**

**Nhóm:** chuẩn bị · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** Không có task trước; bắt đầu tại đây.

**Vì sao cần:** Các quyết định về cache, timeline và TTS phải bám vào cách hệ thống hiện tại hoạt động. Nếu sửa theo đường dẫn hoặc giả định trong một bản plan cũ, agent có thể tạo thêm luồng song song, bỏ sót chỗ đang dùng chung hoặc làm thay đổi video cũ mà không biết.

**Phạm vi:**

- Đọc hướng dẫn repository và lần theo một video từ nguồn/script đến TTS, scene plan, composition, queue và file xuất.
- Ghi module thực sự chịu trách nhiệm cho dữ liệu, cache, timing, renderer, archive và trạng thái UI.
- Phân biệt điều đã kiểm tra bằng code/log với điều còn giả định; không sửa kiến trúc ở task này.

**Đầu ra:**

- Bản đồ module và dữ liệu đầu vào/đầu ra của từng bước.
- Danh sách điểm chưa xác minh và đường dẫn code cần đọc tiếp.

**Hoàn thành khi:**

- [ ] Có thể chỉ ra nơi tạo giọng, tính thời lượng, chia cảnh và xác định cache key trong repository thật.
- [ ] Một video hiện có được đối chiếu xuyên suốt luồng, không còn dựa vào số dòng từ bản kế hoạch trước.

### P0-02

**Chuẩn bị môi trường phát triển tách khỏi luồng đang sản xuất**

**Nhóm:** chuẩn bị · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-01](#p0-01)

**Vì sao cần:** Máy đang có worker và dữ liệu video đang sử dụng; đổi port hoặc Redis DB chưa bảo đảm các file và database được tách biệt. Một môi trường rõ ràng giúp thử template, migration và retry mà không làm thay đổi những video đang làm dở.

**Phạm vi:**

- Tạo hoặc dùng worktree phù hợp, cài dependency theo lockfile; tận dụng pnpm store thay vì hardlink thủ công toàn node_modules.
- Kiểm tra riêng database/schema test, queue, data directory, output, cache, port và worker tự chạy.
- Xác định cách chạy thử và dừng tiến trình do tác vụ này tạo; giữ nguyên các tiến trình sản xuất không thuộc phạm vi.

**Đầu ra:**

- Cấu hình môi trường thử và lệnh chạy đã xác minh, không đưa giá trị bí mật vào báo cáo.

**Hoàn thành khi:**

- [ ] Một thao tác thử tạo file/job chỉ tác động đích test đã chỉ định.
- [ ] Chỉ ra được database, queue và thư mục output mà mỗi tiến trình dùng; không còn chỗ dùng chung ngoài chủ đích.

### P0-03

**Xác nhận luồng Edge TTS hiện tại và thông số giọng**

**Nhóm:** chuẩn bị · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-01](#p0-01), [P0-02](#p0-02)

**Vì sao cần:** Giọng Edge TTS đang dùng là phần cần tiếp tục khai thác, nên phải biết chính xác interpreter, phiên bản, voice và hậu xử lý audio hiện có. Làm rõ trước giúp clip mẫu dùng đúng giọng quen thuộc và tránh vô tình thêm yêu cầu ElevenLabs khi tham khảo repo khác.

**Phạm vi:**

- Ghi phiên bản edge-tts, Python interpreter, voice, rate và các bước trim/padding đang dùng; giữ cấu hình giọng hiện tại làm mặc định.
- Tạo hoặc dùng một audio mẫu tiếng Việt qua adapter hiện có; kiểm tra file và duration, ghi nhận khả năng trả metadata.
- Kiểm tra cấu hình luồng Edge TTS có yêu cầu nhầm key của provider khác không; chỉ sửa lỗi trực tiếp chặn chạy mẫu, để việc cố định runtime và chẩn đoán đầy đủ cho P4-01.

**Đầu ra:**

- Một audio Edge TTS hợp lệ và bản ghi cấu hình/metadata tương ứng.

**Hoàn thành khi:**

- [ ] Luồng hiện có tạo được giọng trong môi trường không có ELEVENLABS_API_KEY.
- [ ] Biết timing hiện có thuộc audio thô hay audio sau xử lý; trường hợp chưa có timing được ghi rõ thay vì đoán.

### P0-04

**Chọn và cố định bộ video mẫu để đối chiếu**

**Nhóm:** chuẩn bị · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-01](#p0-01), [P0-03](#p0-03)

**Vì sao cần:** Nếu mỗi lần thử dùng một script hoặc audio khác, khó biết thay đổi đến từ thiết kế hay từ nội dung đầu vào. Một bộ mẫu cố định làm việc so hình, đo tốc độ và kiểm tra hồi quy có căn cứ, đồng thời hạn chế render đi render lại các trường hợp không cần thiết.

**Phạm vi:**

- Chọn input đại diện cho video 60 giây và 120 giây từ dữ liệu có sẵn; nếu phải chuẩn bị mẫu mới, ghi rõ đó là fixture minh họa.
- Chọn đoạn 10–15 giây có khả năng kiểm tra cảnh nhiều thành phần/transition và một câu tiếng Việt dài cho kiểm tra chữ.
- Cố định script, audio, asset và cấu hình liên quan bằng ID/hash; chỉ tạo các biến thể thật sự cần cho phép so sánh.

**Đầu ra:**

- Bộ fixture có input và manifest để dùng lại ở các phase sau.

**Hoàn thành khi:**

- [ ] Cùng một fixture có thể chạy lại mà không gọi AI/TTS chỉ để tái tạo đầu vào đã có.
- [ ] Bộ mẫu bao phủ thời lượng ngắn/dài, chữ tiếng Việt và một tình huống hình nặng mà không phải tạo hàng chục video test.

### P0-05

**Ghi baseline hình ảnh và thời gian của renderer hiện tại**

**Nhóm:** chuẩn bị · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-02](#p0-02), [P0-04](#p0-04)

**Vì sao cần:** Con số 100 ms/khung chưa cho biết nó đo cả job hay một phần xử lý. Baseline đúng định nghĩa sẽ giúp đánh giá bản mới có đẹp hơn với mức chi phí chấp nhận được hay không, thay vì dựa vào cảm giác máy nhanh hoặc chậm.

**Phạm vi:**

- Đọc cách metric hiện tại được tính; phân biệt wall time, render frame, encode, bundle và thời gian ngoài render.
- Dùng bộ fixture để lưu stills đại diện, file/audio mẫu và số đo cần thiết; tận dụng số đo cũ nếu input/cấu hình và định nghĩa metric còn khớp.
- Ghi fps, resolution, codec, concurrency, version, tình trạng cache và các lỗi hình thấy được; không chạy một ma trận benchmark lớn tại đây.

**Đầu ra:**

- Báo cáo baseline có hình, cấu hình và định nghĩa từng số đo.

**Hoàn thành khi:**

- [ ] Có cơ sở tính wall ms/frame hoặc ghi rõ chưa đủ dữ liệu để tính; số suy luận không bị trình bày như đo thực.
- [ ] Có input và cấu hình đủ để lặp lại phép so ở Phase 5, kèm danh sách vấn đề hình ảnh cần cải thiện.

### P0-06

**Chốt quy tắc triển khai, phiên bản và cách tham khảo tài nguyên**

**Nhóm:** chuẩn bị · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-01](#p0-01), [P0-02](#p0-02), [P0-03](#p0-03)

**Vì sao cần:** Khi agent làm nhiều task, quy tắc không nhất quán có thể khiến mỗi module chọn một cách xử lý asset hoặc timing khác nhau. Ghi rõ quyết định đã chấp thuận giúp giữ hướng Edge TTS, tránh kéo toàn bộ skill what-if-animation và chi phí của nó vào sản phẩm.

**Phạm vi:**

- Đối chiếu phiên bản thực tế với tài liệu Remotion, giữ các package cùng exact version và chỉ bổ sung package cần cho task đã chọn.
- Ghi chính sách asset local, animation theo frame, Edge TTS duy nhất, SFX local tùy chọn và cách dùng skill Remotion chính thức; what-if-animation chỉ là tài liệu tham khảo.
- Chốt cách version schema/template/asset và vị trí đặt adapter tương thích theo kiến trúc hiện có; gắn các task vào module thật từ P0-01.

**Đầu ra:**

- Bản quyết định triển khai ngắn và bảng task/module dự kiến, cập nhật vào tài liệu dự án phù hợp.

**Hoàn thành khi:**

- [ ] Các task có cùng quy tắc về provider, asset, timing và version; không có yêu cầu key/SDK ElevenLabs mới.
- [ ] Mọi thay đổi cấu hình/version được giải thích bằng nhu cầu cụ thể; chưa nâng stack hoặc dựng hệ thống mới theo thói quen.

## 6. Phase 1 — Chứng minh hướng hình bằng mẫu nhỏ

**Mục tiêu:** Có 6–8 styleframe và clip 15–20 giây với audio Edge TTS để dùng làm chuẩn cho toàn thư viện.

**Lý do có phase này:** Vấn đề chính là chất lượng nhìn và cách kể. Một mẫu hoàn chỉnh cho phép thấy tác dụng của bố cục, hành động và chữ trước khi tốn công đóng gói hàng loạt template.

**Mốc bàn giao:** P1-08 hoàn thành; có đối chiếu baseline và mẫu không còn lỗi rõ về hình, chữ, hành động hoặc điểm nối giọng. Không cần chờ karaoke của Phase 4.

### P1-01

**Chọn đoạn kể mẫu và xác định thông tin cần thể hiện bằng hình**

**Nhóm:** hình ảnh · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-04](#p0-04)

**Vì sao cần:** Nếu bắt đầu bằng việc thêm animation vào lời đọc bất kỳ, rất khó biết hình mới có giải quyết vấn đề nội dung hay chỉ làm khung hình bận hơn. Một đoạn mẫu có tình huống, thay đổi và hành động rõ sẽ cho phép kiểm chứng cách kể bằng hình trước khi xây thư viện.

**Phạm vi:**

- Chọn một đoạn 15–20 giây từ kịch bản thật trong bộ fixture; ghi rõ phần nào là diễn giải từ sách và phần nào là tình huống minh họa.
- Viết bảng lời đọc → thông tin hình cần bổ sung → hành động hoặc trạng thái người xem cần nhận ra.
- Chọn các khoảnh khắc đại diện cho hook, tình huống, đồ vật, đối chiếu, kết luận và hành động; không thêm lời chỉ để dùng một hiệu ứng.

**Đầu ra:**

- Kịch bản mẫu có ID ổn định và bảng ý đồ hình theo từng khoảnh khắc.

**Hoàn thành khi:**

- [ ] Mỗi khoảnh khắc có một thông tin hoặc hành động cụ thể để hình thể hiện; không còn mô tả chung như 'nhân vật đứng và chữ xuất hiện'.
- [ ] Đã xác định audio mẫu sẽ lấy từ cache Edge TTS hoặc được tạo bằng adapter hiện có; không phụ thuộc timing từng từ của Phase 4.

### P1-02

**Chọn một hệ hình và bộ token thiết kế tối thiểu**

**Nhóm:** hình ảnh · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-01](#p1-01), [P0-06](#p0-06)

**Vì sao cần:** Một thư viện trộn nhân vật nét vẽ, props màu phẳng và chữ nhiều kiểu sẽ thiếu nhất quán dù từng thành phần đều đẹp. Chốt một hệ hình nhỏ giúp các task sau cùng tối ưu một hướng, giảm việc phải vẽ lại hoặc thay asset khi mở rộng.

**Phạm vi:**

- Chọn một hướng hình phù hợp nội dung phát triển bản thân; sử dụng các tài nguyên được chấp nhận trong plan và các asset hiện có phù hợp.
- Định nghĩa bảng màu nhỏ, màu nhấn, font chính hỗ trợ tiếng Việt, các weight dùng thật và quy tắc nét/đổ bóng.
- Ghi ví dụ được dùng và ví dụ không phù hợp; chọn phương án khởi đầu bằng đánh giá mẫu cụ thể, không thêm vòng xin lại quyền triển khai.

**Đầu ra:**

- Bảng hướng hình và bộ token màu/chữ/nét cho bản mẫu.

**Hoàn thành khi:**

- [ ] Một mẫu nhân vật, một đồ vật và một dòng chữ khi đặt cạnh nhau cùng tuân theo hướng hình đã chọn.
- [ ] Mỗi font và asset được chọn có nguồn nhận diện được; không có bước bắt buộc tạo ảnh bằng API trả phí.

### P1-03

**Thiết kế bố cục dọc và vùng dành cho chữ**

**Nhóm:** hình ảnh · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-01](#p1-01), [P1-02](#p1-02)

**Vì sao cần:** Caption che tay hoặc đồ vật sẽ làm mất chính hành động mà video muốn giải thích. Chốt bố cục bằng câu tiếng Việt thật từ đầu giúp phát hiện lỗi khoảng trống, chữ quá dài và các lớp tranh nhau sự chú ý trước khi chúng lan vào mọi template.

**Phạm vi:**

- Thiết kế ba bố cục nền tảng: kể chuyện, đối chiếu và kết luận; xác định tiêu điểm chính của từng bố cục.
- Đặt vùng headline/caption và vùng tránh UI theo profile có thể điều chỉnh; không coi một tọa độ cố định là chuẩn chung cho mọi nền tảng.
- Thử câu ngắn và câu tiếng Việt dài với font/weight thật; quy định lúc nào nhãn sách, progress hoặc bubble được xuất hiện.

**Đầu ra:**

- Ba bố cục mẫu cùng vùng chữ và các trạng thái hiển thị lớp phụ.

**Hoàn thành khi:**

- [ ] Các câu mẫu không tràn khung hoặc đè lên mặt, tay và đồ vật cần nhìn.
- [ ] Ở kích thước điện thoại, mỗi bố cục có một tiêu điểm chính và đọc được caption; các lớp phụ không cùng xuất hiện theo mặc định.

### P1-04

**Chuẩn bị bộ nhân vật và đồ vật đủ cho clip mẫu**

**Nhóm:** hình ảnh · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-01](#p1-01), [P1-02](#p1-02)

**Vì sao cần:** Thiết kế sơ sài của hình gốc sẽ vẫn lộ rõ khi thêm chuyển động, nên clip thử cần dùng hình đủ chất lượng để đánh giá. Chỉ chuẩn bị tài sản của tình huống mẫu giúp kiểm chứng hướng hình với ít công sức, trước khi đầu tư toàn bộ cast và bối cảnh.

**Phạm vi:**

- Chuẩn bị một nhân vật chính, một đến hai pose cần thiết, một bối cảnh và các đồ vật của đoạn mẫu; thêm nhân vật phụ chỉ khi câu chuyện cần.
- Dùng asset local đồng nhất phong cách, có kích thước đủ cho framing dự kiến; kiểm tra nền trong suốt và mép cắt.
- Gán ID ổn định và ghi nguồn asset; không xây skeleton toàn thân, không tạo rig đi/chạy để hoàn thành mẫu.

**Đầu ra:**

- Bộ asset mẫu và danh sách ID/nguồn dùng trong clip.

**Hoàn thành khi:**

- [ ] Nhân vật và đồ vật đủ để thể hiện mọi hành động đã xác định ở P1-01 mà không cần hình thay thế tạm gây hiểu sai.
- [ ] Asset nhìn ổn ở cỡ cảnh rộng và cận đã chọn; không thiếu lớp, không có nền không mong muốn.

### P1-05

**Dựng 6–8 styleframe hoàn chỉnh với chữ thật**

**Nhóm:** hình ảnh · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-03](#p1-03), [P1-04](#p1-04)

**Vì sao cần:** Wireframe đẹp hoặc một trang moodboard chưa chứng minh hình có hoạt động trong khung video thực tế. Các styleframe hoàn chỉnh buộc nhân vật, đồ vật, headline và caption cùng giải quyết một tình huống cụ thể, giúp phát hiện xung đột trước khi lập trình motion.

**Phạm vi:**

- Dựng các khung đại diện: hook, tình huống, cận vật, hệ quả, đối chiếu, bài học, hành động và trường hợp chữ dài; gộp khung khi vẫn bao phủ đủ trường hợp.
- Dùng asset của P1-04, bố cục của P1-03 và nội dung thật; mỗi khung chỉ có một trọng tâm.
- Xuất ảnh ở độ phân giải cuối và một contact sheet để xem tính nhất quán của cả đoạn.

**Đầu ra:**

- 6–8 styleframe và contact sheet có nhãn khoảnh khắc tương ứng.

**Hoàn thành khi:**

- [ ] Mọi trường hợp đã chọn đều có khung hoàn chỉnh; không còn lorem ipsum hoặc placeholder hình không đại diện cho bản cuối.
- [ ] Hình thể hiện được quan hệ hoặc thay đổi cần kể, không chỉ chép nguyên lời đọc thành chữ bên cạnh một nhân vật đứng yên.

### P1-06

**Kiểm tra styleframe ở cỡ điện thoại và sửa lỗi nhìn thấy**

**Nhóm:** hình ảnh · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-05](#p1-05)

**Vì sao cần:** Một khung đẹp khi phóng to trên màn hình máy tính có thể khó đọc hoặc mất tiêu điểm trên điện thoại. Kiểm tra trước animation giúp sửa trực tiếp các lỗi kích thước chữ, khoảng cách và che nội dung mà không phải render lại video dài.

**Phạm vi:**

- Xem từng khung ở cỡ điện thoại và độ phân giải đầy đủ; đánh dấu lỗi chữ, tương phản, crop, tiêu điểm và vùng UI dự kiến.
- Sửa những khung có lỗi; render lại các khung bị ảnh hưởng và cập nhật contact sheet.
- Ghi lý do cho các lựa chọn còn mang tính thẩm mỹ để người dùng có thể nhận xét trên hình cụ thể; không biến gate này thành yêu cầu xin lại toàn bộ kế hoạch.

**Đầu ra:**

- Bộ styleframe đã sửa và danh sách lỗi trước/sau ngắn.

**Hoàn thành khi:**

- [ ] Không còn lỗi overflow, chữ thiếu dấu, mép cắt lỗi hoặc lớp chữ che nội dung cần hiểu trong bộ mẫu.
- [ ] Mỗi khung có thể xác định ngay đối tượng/chữ chính; những điểm chưa chắc được ghi rõ thay vì đánh dấu đạt chung chung.

### P1-07

**Làm clip mẫu 15–20 giây với Edge TTS hiện có**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-06](#p1-06), [P0-02](#p0-02), [P0-03](#p0-03), [P0-05](#p0-05)

**Vì sao cần:** Ảnh tĩnh không thể cho biết chuyển động có dễ hiểu, điểm cắt có tự nhiên hoặc lời đọc có bị ngắt vụn hay không. Một clip ngắn dùng giọng thật kiểm chứng những điểm này với chi phí thấp hơn việc xây cả hệ thống rồi render video dài.

**Phạm vi:**

- Dùng audio Edge TTS đã chọn, đặt các styleframe lên timeline và caption theo cụm; không chờ API word timing mới của Phase 4.
- Thêm chuyển động theo frame ở những hành động có ý nghĩa: dịch vật, đổi pose, nhấn một chi tiết; dùng hard cut hoặc một transition nhẹ phù hợp.
- Giữ lời đọc liền mạch qua điểm cắt hình; dùng cùng script/voice khi đối chiếu với mẫu trước.
- Render đoạn mẫu có tiếng; dùng SFX local nếu đã có asset phù hợp, nếu chưa có thì hoàn thành mẫu với voice.

**Đầu ra:**

- Clip mẫu 15–20 giây và dữ liệu dựng mẫu có thể chạy lại.

**Hoàn thành khi:**

- [ ] Clip có hook, tình huống, thay đổi hành động và kết luận; toàn bộ voice là Edge TTS và không cần cấu hình ElevenLabs.
- [ ] Không có đoạn im lặng phát sinh chỉ vì đổi shot, không có frame thiếu asset hoặc cut che mất thông tin chính.
- [ ] Ghi thời gian render mẫu và điều kiện đo; không dùng số này để cam kết tốc độ toàn video.

### P1-08

**Đánh giá clip mẫu và chốt bộ mẫu làm chuẩn**

**Nhóm:** hình ảnh · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-07](#p1-07), [P0-05](#p0-05)

**Vì sao cần:** Nếu không ghi lại bản đạt và lý do lựa chọn, các task mở rộng sau dễ quay về việc thêm hiệu ứng theo cảm tính hoặc làm nhân vật mỗi cảnh một kiểu. Một bộ mẫu chuẩn giúp mọi thay đổi tiếp theo được so với mục tiêu hình ảnh cụ thể, đồng thời tách đánh giá mỹ thuật khỏi cam kết về lượt xem.

**Phạm vi:**

- Xem clip có tiếng để kiểm tra giọng, nhịp và điểm cắt; xem tắt tiếng để kiểm tra hành động chính có đọc được bằng hình không.
- Đối chiếu với baseline theo tiêu điểm, chữ, tính nhất quán và mức hình bổ sung ý; ghi vấn đề cần sửa và chỉnh đúng đoạn bị ảnh hưởng.
- Chọn một phiên bản làm chuẩn, lưu token/asset/script/audio và ghi các quy tắc giữ lại cho thư viện; cung cấp bộ mẫu để người dùng có thể review.

**Đầu ra:**

- Bộ chuẩn gồm clip, styleframe, token và ghi chú quyết định thiết kế.

**Hoàn thành khi:**

- [ ] Bản được chọn không còn lỗi đọc chữ, thiếu asset, audio ghép vụn hoặc hành động khó hiểu đã được phát hiện trong review.
- [ ] Có đối chiếu cụ thể với baseline và quy tắc thiết kế đủ rõ để Phase 2 tái sử dụng; không tuyên bố đã tăng retention khi chưa có số liệu xuất bản.

## 7. Phase 2 — Đóng gói thư viện hình và template

**Mục tiêu:** Biến mẫu tốt thành bộ asset nhỏ và 5–6 template có danh mục, ID và giới hạn rõ để tái sử dụng.

**Lý do có phase này:** Sản lượng 15–20 video/ngày cần giảm số quyết định và số lần tạo hình cho từng video. Thư viện được kiểm tra giúp agent chọn đúng tài sản và giúp người dùng sửa nhanh.

**Mốc bàn giao:** P2-10 hoàn thành; gallery bao phủ thư viện, các asset/pose/template được công bố có đầu ra thật và cảnh đại diện sẵn sàng cho tích hợp/benchmark.

### P2-01

**Định nghĩa manifest và ID ổn định cho bộ asset**

**Nhóm:** code/dữ liệu · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P1-08](#p1-08), [P0-01](#p0-01), [P0-06](#p0-06)

**Vì sao cần:** Các file hình rời rạc khiến agent dễ chọn nhầm style, thiếu asset hoặc làm ngoại hình thay đổi khi sửa tiêu đề. Manifest tạo một danh mục cụ thể để renderer và bước lập shot cùng tham chiếu, đồng thời giữ được thông tin cần cho cache và tái tạo video.

**Phạm vi:**

- Định nghĩa metadata tối thiểu: asset ID, đường dẫn local, hash, kích thước, loại/style pack, nguồn/license và anchor khi có tương tác.
- Gán characterId/appearanceId ổn định; mô tả các pose/biểu cảm đã hỗ trợ, không tự sinh tích mọi tổ hợp.
- Ghi quy tắc version asset pack và cách phát hiện ID trùng/thiếu; tích hợp theo cơ chế registry hiện có nếu đã có.

**Đầu ra:**

- Hợp đồng manifest và registry ban đầu lấy từ bộ mẫu chuẩn.

**Hoàn thành khi:**

- [ ] Mỗi asset của bộ mẫu có đúng một ID và metadata bắt buộc; đường dẫn tồn tại và không trỏ tới tài nguyên Internet.
- [ ] Đổi tiêu đề video không đổi appearance của nhân vật; ID thiếu được báo rõ thay vì thay âm thầm bằng hình chung.

### P2-02

**Chuẩn hóa cách nạp asset và font local trong composition**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-01](#p2-01), [P0-02](#p0-02)

**Vì sao cần:** Ảnh chưa tải xong hoặc font thay thế có thể làm preview và bản xuất khác nhau, kể cả khi file nguồn đẹp. Một đường nạp chung giúp mọi template dùng đúng tài sản và font đã chọn, tránh phải sửa lỗi tải/đo chữ riêng ở từng cảnh.

**Phạm vi:**

- Cho các component dùng asset ID từ manifest và Remotion Img hoặc cách nhúng SVG đã được kiểm tra; tải file từ nguồn local của bundle.
- Nạp đúng font và weight trước khi đo/vẽ chữ; tái sử dụng cơ chế font gate hiện có nếu phù hợp.
- Kiểm tra asset thiếu, font thiếu và cache bundle khi asset thay đổi; cập nhật bundle hoặc nội dung public trong bundle theo luồng đã chọn.

**Đầu ra:**

- Cách nạp asset/font dùng chung và một composition mẫu xác minh tải local.

**Hoàn thành khi:**

- [ ] Mẫu render có đủ ảnh và đúng font khi không truy cập Internet trong bước render; không phát sinh TTS từ composition.
- [ ] Thay một asset local được phản ánh ở bản render tiếp theo; asset/font bị thiếu cho lỗi hoặc cảnh báo có thể truy ra nguồn.

### P2-03

**Mở rộng cast nhỏ với pose và biểu cảm dùng nhiều**

**Nhóm:** hình ảnh · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-01](#p2-01), [P2-02](#p2-02)

**Vì sao cần:** Một pose đứng duy nhất làm nhiều tình huống trông giống nhau, nhưng rig toàn thân sẽ tăng khối lượng phát triển trước khi có nhu cầu rõ. Một nhóm pose có mục đích kể chuyện tạo đủ thay đổi nhìn thấy được mà vẫn giữ nhân vật nhất quán và dễ duyệt.

**Phạm vi:**

- Chuẩn bị 1–2 nhân vật, 4–6 pose tổng thể dùng nhiều và 3–4 biểu cảm; chỉ liệt kê những tổ hợp thực sự đã dựng và kiểm tra.
- Đặt anchor cần thiết cho đầu, mặt hoặc tay cầm đồ ở các pose có tương tác; giữ tỷ lệ và ngoại hình theo bộ chuẩn.
- Xuất asset/nhóm lớp phù hợp với cách nạp chung; chưa thêm FK, walk cycle hoặc lip-sync đa dáng miệng.

**Đầu ra:**

- Cast sheet và manifest các pose/biểu cảm hỗ trợ.

**Hoàn thành khi:**

- [ ] Xem cast sheet cho thấy cùng nhân vật giữ màu, tỷ lệ và nhận diện giữa các pose; mọi tổ hợp được khai báo đều có hình thật.
- [ ] Một prop mẫu gắn đúng vị trí ở pose hỗ trợ cầm đồ; pose không hỗ trợ tương tác được mô tả rõ.

### P2-04

**Chuẩn bị khoảng bốn bối cảnh có vùng đặt nhân vật và vật**

**Nhóm:** hình ảnh · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-01](#p2-01), [P2-02](#p2-02)

**Vì sao cần:** Vẽ lại bối cảnh cho mỗi video làm tăng thời gian sản xuất và dễ phá tính nhất quán. Các bối cảnh ít nhưng có vùng đặt đồ rõ giúp kể nhiều tình huống bằng thay đổi trạng thái, đồng thời tránh đồ vật trôi hoặc nhân vật đứng sai mặt phẳng.

**Phạm vi:**

- Chọn khoảng bốn bối cảnh theo tần suất tình huống: bàn làm việc, phòng ngủ, không gian công cộng đơn giản và nền trừu tượng; hiệu chỉnh theo script mẫu.
- Ghi vùng đặt nhân vật, mặt bàn/sàn và vùng caption cần tránh; tách lớp chỉ khi phục vụ tương tác hoặc framing đã có.
- Chuẩn bị asset ở kích thước phù hợp; rasterize chi tiết tĩnh khi có lợi và giữ lựa chọn vector nếu đơn giản hơn.

**Đầu ra:**

- Bộ bối cảnh và sơ đồ vùng/anchor dùng lại.

**Hoàn thành khi:**

- [ ] Mỗi bối cảnh có một hình thử với nhân vật và vật; các đối tượng không lơ lửng, lọt khỏi vùng nhìn hoặc bị caption che.
- [ ] Crop rộng/cận dự kiến không lộ mép trống ngoài ý muốn; không cần lật ngang tự động để tạo biến thể.

### P2-05

**Chọn và chuẩn hóa khoảng hai mươi props thiết yếu**

**Nhóm:** hình ảnh · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-01](#p2-01), [P2-02](#p2-02)

**Vì sao cần:** Xây đủ hàng chục hoặc hàng trăm đồ vật trước khi có script sẽ tốn công nhưng không bảo đảm giảm thời gian làm video thực. Một bộ props theo tình huống phổ biến giúp agent có lựa chọn phù hợp ngay và hạn chế nhu cầu tạo hình mới trong mỗi lượt sản xuất.

**Phạm vi:**

- Chọn khoảng hai mươi props phục vụ script thật, ưu tiên sách, điện thoại, đồng hồ, lịch, giấy ghi chú và đồ dùng thường gặp.
- Chuẩn hóa kích thước tương đối, màu/nét, nền trong suốt và điểm gắn; giữ nguồn/license trong manifest.
- Kiểm tra các trạng thái thiết yếu như sách đóng/mở hoặc điện thoại ở trên bàn/trong tay; không viết importer cho toàn bộ thư viện bên ngoài.

**Đầu ra:**

- Prop sheet, các trạng thái đã hỗ trợ và manifest tương ứng.

**Hoàn thành khi:**

- [ ] Các props được chọn nhận diện được ở cỡ điện thoại và không lệch phong cách của bộ chuẩn.
- [ ] Không còn đường dẫn bên ngoài hoặc thành phần không cần thiết chưa được xử lý; mỗi trạng thái được khai báo có asset thực.

### P2-06

**Làm template kể chuyện và cận cảnh đồ vật**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-03](#p2-03), [P2-04](#p2-04), [P2-05](#p2-05)

**Vì sao cần:** Đây là hai cách trình bày trực tiếp tình huống và chi tiết gây ra hành vi, nên cần có trước để video bớt phụ thuộc vào thẻ chữ. Dùng chung cách đặt nhân vật/prop giúp đổi nội dung bằng dữ liệu thay vì tạo một component mới cho từng shot.

**Phạm vi:**

- Tạo template story và object-focus từ bộ mẫu, dùng asset ID, pose và các anchor đã có.
- Cho phép các preset framing và hành động nhỏ đã kiểm tra; mọi motion theo frame, không dùng vòng camera đổi cỡ bắt buộc.
- Dựng ví dụ một người phân tâm và ví dụ chuyển tiêu điểm từ điện thoại sang sách bằng props hiện có.

**Đầu ra:**

- Hai template story/object-focus và các ví dụ dữ liệu tương ứng.

**Hoàn thành khi:**

- [ ] Thay người/vật phù hợp bằng dữ liệu vẫn giữ đúng anchor, framing và vùng caption.
- [ ] Ở mỗi ví dụ, người xem nhìn thấy hành động hoặc chi tiết cần hiểu; không cần rig mới hoặc mã sinh riêng cho shot.

### P2-07

**Làm template trước–sau và so sánh hai lựa chọn**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-03](#p2-03), [P2-04](#p2-04), [P2-05](#p2-05)

**Vì sao cần:** Bài học thường cần cho thấy điều gì thay đổi giữa cách làm cũ và cách làm mới. Nếu hai vế dùng bố cục hoặc nhân vật không nhất quán, người xem khó nhận ra nguyên nhân khác biệt và video phải giải thích thêm bằng lời.

**Phạm vi:**

- Tạo template before-after giữ cùng không gian và đối tượng, thay đúng trạng thái hoặc vị trí liên quan đến bài học.
- Tạo template comparison với hai vế và chữ ngắn có cấu trúc; không tách nội dung bằng chuỗi delimiter trong renderer.
- Dùng màu nhấn và sự xuất hiện từng vế để dẫn mắt; không tự đảo trái/phải hoặc lật bối cảnh giữa hai trạng thái.

**Đầu ra:**

- Hai template before-after/comparison và ví dụ thể hiện cùng một bài học.

**Hoàn thành khi:**

- [ ] Hai trạng thái cho thấy rõ điều thay đổi, còn nhân vật/bối cảnh giữ những yếu tố cần liên tục.
- [ ] Cả hai vế đều đọc được ở cỡ điện thoại; dữ liệu thiếu vế bắt buộc được phát hiện thay vì render nửa phép so sánh.

### P2-08

**Làm template bài học và một hành động thực hành**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-02](#p2-02), [P2-05](#p2-05)

**Vì sao cần:** Nếu đoạn kết chỉ lặp lại các khẩu hiệu chung, video thiếu một điều cụ thể để người xem nhớ hoặc thử làm. Hai template này dành không gian cho câu kết luận và bước hành động, đồng thời tránh thêm nhiều lớp chữ để cố làm cảnh sinh động.

**Phạm vi:**

- Tạo takeaway cho một câu kết luận ngắn, hỗ trợ từ khóa và tối đa một thành phần hình phụ phù hợp.
- Tạo action cho một bước thực hành rõ hoặc một danh sách ngắn có cấu trúc; thời điểm hiện từng mục nhận từ dữ liệu.
- Thử câu tiếng Việt dài, tên sách và số có nguồn; dùng cùng font, spacing và vùng caption của bộ chuẩn.

**Đầu ra:**

- Hai template takeaway/action và ví dụ câu ngắn, câu dài.

**Hoàn thành khi:**

- [ ] Mọi ví dụ đều đọc được, không có headline và caption lặp nguyên câu thành hai lớp cạnh tranh nhau.
- [ ] Action nêu được việc có thể làm; thay nội dung không đòi sửa component hoặc tạo lại voice của ví dụ.

### P2-09

**Công bố danh mục template và các tổ hợp được hỗ trợ**

**Nhóm:** code/dữ liệu · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-06](#p2-06), [P2-07](#p2-07), [P2-08](#p2-08)

**Vì sao cần:** Schema chỉ kiểm tra một enum tồn tại vẫn có thể cho phép pose không cầm được vật hoặc template thiếu dữ liệu quan trọng. Danh mục có điều kiện sử dụng giúp bước lập shot chọn đúng tổ hợp và báo lỗi có ý nghĩa thay vì âm thầm đưa nhiều cảnh về mặc định.

**Phạm vi:**

- Đăng ký 5–6 template đang có, mô tả mục đích, field bắt buộc, giới hạn nội dung và các preset phù hợp.
- Khai báo tương thích pose/prop/anchor và các trường hợp camera không được dùng; giữ danh mục gọn, có thể dùng từ compiler và UI.
- Phân loại lỗi bắt buộc sửa và lỗi trang trí được fallback; đưa ID và lý do vào cảnh báo.

**Đầu ra:**

- Template catalog có version, các quy tắc tương thích và mẫu lỗi/cảnh báo.

**Hoàn thành khi:**

- [ ] Mỗi template được đăng ký có ví dụ render; mọi enum/ID được công bố đều có implementation hoặc asset tương ứng.
- [ ] Các ví dụ thiếu asset, thiếu vế so sánh hoặc gắn prop sai pose tạo thông báo cụ thể; không biến tất cả lỗi thành cùng một cảnh mặc định.

### P2-10

**Kiểm tra gallery thư viện và chuẩn bị cảnh đại diện cho benchmark**

**Nhóm:** hình ảnh · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-09](#p2-09), [P0-02](#p0-02), [P0-03](#p0-03)

**Vì sao cần:** Các template có thể đẹp khi xem riêng nhưng lệch tỷ lệ, font hoặc sắc độ khi ghép vào cùng một video. Gallery và cảnh đại diện phát hiện những khác biệt này trước khi thư viện được dùng hàng loạt, đồng thời cung cấp input ổn định cho việc đo hiệu năng sau đó.

**Phạm vi:**

- Render một contact sheet bao phủ mọi template, pose/bối cảnh tiêu biểu và trường hợp chữ dài; sửa lỗi nhất quán nhìn thấy.
- Chuẩn bị một cảnh nhẹ và một cảnh nhiều thành phần từ đúng thư viện, ghi đầy đủ input và version để Phase 5 dùng lại.
- Kiểm tra một đoạn kết hợp vài template bằng audio Edge TTS đã có, dùng cơ chế timeline hiện tại đủ cho kiểm tra; không chờ toàn bộ Phase 3/4 hoàn thành.

**Đầu ra:**

- Gallery đã kiểm tra và ghi chú lỗi đã sửa.
- Input cảnh nhẹ/cảnh nhiều thành phần có thể tái sử dụng trong benchmark.

**Hoàn thành khi:**

- [ ] Không có template bị thiếu ảnh, font khác bộ chuẩn, chữ tràn hoặc vật gắn sai anchor trong bộ kiểm tra.
- [ ] Các input đại diện dựng lại được từ dữ liệu/manifest đã lưu; không cần tải tài nguyên ngoài khi render.
- [ ] Có danh mục thư viện sẵn sàng cho Phase 3 và Phase 5; mọi nhu cầu mở rộng chưa cần thiết được ghi backlog thay vì làm ngay.

## 8. Phase 3 — Tách nội dung, audio, shot và dữ liệu lưu

**Mục tiêu:** Một đoạn lời chạy qua nhiều shot; sửa hình giữ audio; dữ liệu cũ và snapshot có đường sử dụng rõ.

**Lý do có phase này:** Nếu mỗi cảnh luôn đi cùng một file TTS, việc làm hình sinh động sẽ kéo theo giọng ngắt vụn và nhiều request. Mô hình tách lớp cho phép tăng chất lượng biên tập với chi phí tạo giọng ít thay đổi.

**Mốc bàn giao:** P3-10 hoàn thành; một video đi hết luồng với Edge TTS và caption theo cụm, kiểm chứng thay hình/đổi lời đúng phạm vi cache.

### P3-01

**Chốt hợp đồng dữ liệu cho ý kể, audio, shot và nguồn**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-01](#p0-01), [P0-06](#p0-06)

**Vì sao cần:** Nếu một cảnh vẫn đồng thời đại diện cho câu văn, file giọng và hình, mỗi lần tăng số shot sẽ kéo theo thay đổi TTS và khoảng nghỉ. Hợp đồng tách bốn đơn vị giúp thay hình độc lập với lời đọc, đồng thời giữ nguồn sách gắn với nội dung qua mọi cách dựng.

**Phạm vi:**

- Định nghĩa NarrativeBeat, AudioSegment, VisualShot và CaptionSegment với ID ổn định và quan hệ tham chiếu rõ.
- Định nghĩa SourceClaim cho nguyên văn, diễn giải và tình huống minh họa; dùng trường có cấu trúc cho màn chữ punch/list/versus.
- Chốt đơn vị millisecond ở dữ liệu chuẩn, phạm vi thời gian của từng field và timing tùy chọn; không phụ thuộc schema của what-if-animation.

**Đầu ra:**

- Bảng hợp đồng dữ liệu và các schema/type tương ứng trong module hiện có.
- Một ví dụ dữ liệu thể hiện một đoạn audio phủ ba shot.

**Hoàn thành khi:**

- [ ] Có thể biểu diễn ba shot dùng chung một AudioSegment mà không nhân bản lời đọc hoặc audio asset.
- [ ] Mọi ID tham chiếu trong ví dụ đều xác định được đích; quote và diễn giải có trường nguồn bắt buộc phù hợp.
- [ ] Dữ liệu không có word timing vẫn hợp lệ cho phụ đề theo cụm.

### P3-02

**Viết lớp đọc dữ liệu cũ sang hợp đồng mới**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-01](#p3-01)

**Vì sao cần:** Đổi schema trực tiếp có thể làm video đang làm mất hình, mất audio hoặc bị tạo lại ngoài ý muốn. Một lớp chuyển đổi tại điểm đọc cho phép triển khai dần mà không bắt buộc viết lại toàn bộ dữ liệu đã lưu.

**Phạm vi:**

- Chọn các fixture dữ liệu cũ thực tế và xác định những field cần chuyển đổi sang hợp đồng mới.
- Viết adapter cho scene/audio cũ và chuỗi màn chữ cũ; chỉ parse delimiter ở lớp này.
- Giữ bản ghi gốc và fingerprint cũ khi chưa có thao tác chỉnh sửa; chỉ thêm migration khi cấu trúc lưu trữ thực sự cần.

**Đầu ra:**

- Adapter dữ liệu cũ và fixture hồi quy đại diện.

**Hoàn thành khi:**

- [ ] Video cũ mở được, giữ đúng thứ tự lời và tham chiếu audio/asset hiện có.
- [ ] Đọc một bản ghi cũ không tự ghi lại, đổi hash hoặc xếp hàng tạo giọng mới.
- [ ] Field không chuyển được có cảnh báo rõ thay vì bị thay bằng dữ liệu mặc định không dấu vết.

### P3-03

**Kiểm tra nguồn ở tầng nội dung trước khi chia shot**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-01](#p3-01), [P0-01](#p0-01)

**Vì sao cần:** Kiểm tra quote bằng dấu ngoặc trong từng cảnh sẽ bỏ sót hoặc chặn nhầm khi cùng một câu đi qua nhiều shot. Kiểm tra nội dung trước khi dựng hình giữ được tính đúng của bài học mà không hạn chế nhịp biên tập.

**Phạm vi:**

- Gắn claim với đoạn nguồn đã nhập; phân biệt câu nguyên văn, diễn giải và ví dụ tự sáng tác.
- Kiểm tra quote trên toàn claim và rà các phát biểu ở lời đọc, headline, bubble, nhãn hoặc con số; phần chưa xác minh phải được đánh dấu cần xem.
- Giữ claim ID khi nội dung được trình bày qua nhiều shot/caption; không suy ra độ đúng của diễn giải chỉ từ việc có source ID.

**Đầu ra:**

- Luồng kiểm tra nguồn độc lập với shot và các thông báo lỗi/cảnh báo có vị trí.

**Hoàn thành khi:**

- [ ] Một quote đúng trải qua hai shot vẫn được nhận diện là một claim và giữ nguồn.
- [ ] Quote thiếu nguồn hoặc khác đoạn được trích không được báo là đã xác minh.
- [ ] Tình huống minh họa không bị hiển thị như lời nguyên văn của tác giả.

### P3-04

**Sửa prompt để lập đoạn lời đọc và shot độc lập**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-01](#p3-01), [P3-03](#p3-03)

**Vì sao cần:** Nếu prompt vẫn bắt một câu bằng một cảnh, dữ liệu mới sẽ tiếp tục tái tạo giới hạn cũ dù schema đã đổi. Prompt cần giao cho Claude hai việc riêng: viết đoạn kể có ngữ điệu và chọn những hình thực sự bổ sung thông tin.

**Phạm vi:**

- Sửa prompt để script có một bài học, tình huống, thay đổi và hành động cuối; chia beat/audio segment theo ý, thử đoạn 10–25 giây và hook ngắn khi phù hợp.
- Lập shot dự kiến theo thông tin hoặc hệ quả; cho phép lời chạy qua cut. Prompt nhận catalog truyền vào; task này kiểm tra bằng catalog fixture nhỏ, catalog thật được nối ở P3-07.
- Version đúng prompt bị thay đổi, cập nhật mock/fixture và giữ nguyên luồng nguồn hoặc prompt không liên quan.
- Phân biệt lỗi trang trí có thể fallback với lỗi làm sai nghĩa; trả cảnh báo có shot ID, không âm thầm biến toàn bộ đầu ra về default.

**Đầu ra:**

- Prompt đã chỉnh cùng một mẫu script/shot plan và các trường hợp đầu ra không hợp lệ.

**Hoàn thành khi:**

- [ ] Mẫu đầu ra có một audio segment dùng cho nhiều shot và không tự thêm khoảng nghỉ vì đổi hình.
- [ ] Trên catalog fixture, shot sai asset/action hoặc nhấn chữ không tồn tại được phát hiện; chưa coi đây là bằng chứng đã tích hợp catalog production.
- [ ] Các prompt không thuộc phạm vi sửa giữ nguyên version và hành vi cache.

### P3-05

**Tạo và cache Edge TTS theo audio segment**

**Nhóm:** audio/caption · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-03](#p0-03), [P3-01](#p3-01), [P3-04](#p3-04)

**Vì sao cần:** Cache theo toàn cảnh dễ khiến một chỉnh sửa màu hoặc camera gọi lại TTS không cần thiết. Cache theo lời và cấu hình giọng giảm request, giữ ngữ điệu đã duyệt và chỉ tạo lại phần thực sự thay đổi.

**Phạm vi:**

- Nối AudioSegment với adapter Edge TTS đang hoạt động; đọc duration thực của file đầu ra.
- Tạo cache key từ lời đã chuẩn hóa và cấu hình ảnh hưởng audio như voice, rate, phiên bản engine; tách asset audio khỏi visual plan.
- Tái dùng audio thành công khi chỉ thay template/asset/pose; làm mới segment và timeline phụ thuộc khi lời hoặc cấu hình giọng thay đổi.

**Đầu ra:**

- Luồng tạo audio theo segment và quy tắc invalidation cache có ví dụ.

**Hoàn thành khi:**

- [ ] Thay màu/camera/pose không làm tăng số request TTS của video mẫu.
- [ ] Sửa một segment chỉ tạo lại audio tương ứng, các segment không đổi giữ nguyên asset.
- [ ] Duration video được tính từ audio đã tạo, không chỉ từ số chữ ước lượng.

### P3-06

**Biên dịch cue và shot thành timeline thống nhất**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-01](#p3-01), [P3-05](#p3-05)

**Vì sao cần:** Khi audio và hình đã tách, cần một nơi duy nhất quyết định thời điểm xuất hiện để tránh lệch giữa preview, caption và render. Cue có ID còn giúp chọn đúng lần xuất hiện của những từ được lặp trong lời kể.

**Phạm vi:**

- Viết compiler tạo start/end toàn cục từ duration audio segment và cue; hỗ trợ mốc theo segment/cụm khi chưa có word timing.
- Dùng token ID hoặc index có phạm vi segment cho cue theo từ; không tìm bằng lần xuất hiện đầu tiên của chuỗi chữ.
- Chuyển mốc millisecond sang frame bằng một quy tắc chung, ưu tiên làm tròn mốc tuyệt đối và kiểm tra thứ tự/range.
- Trả một timeline đã resolve cho preview/render; không duy trì hai bản thời gian có thể chỉnh độc lập.

**Đầu ra:**

- Compiler timeline cùng fixture có từ lặp, audio segment dài và thiếu word timing.

**Hoàn thành khi:**

- [ ] Hai cue trỏ tới hai lần xuất hiện của cùng từ được đặt ở hai thời điểm đúng của fixture.
- [ ] Không có shot âm thời gian, vượt audio đã chốt hoặc mất đoạn do cộng sai số làm tròn.
- [ ] Cùng input cho cùng timeline; thiếu word timing có đường theo cụm hoặc mốc segment rõ ràng.

### P3-07

**Nối các track audio, hình và chuyển cảnh vào composition**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-06](#p3-06), [P2-10](#p2-10)

**Vì sao cần:** Nếu tốc độ chuyển động hoặc overlap của transition làm đổi cả timeline lời đọc, video có thể trôi caption dù tổng thời lượng nhìn có vẻ đúng. Tách track và dùng một đồng hồ chính giúp tăng nhịp hình mà giữ audio liên tục.

**Phạm vi:**

- Nối prompt/validator với catalog thật từ P2-09 qua P2-10; kiểm tra template, asset, pose và action trước khi đưa vào composition.
- Render audio/caption theo timeline chính; render shot từ timeline đã resolve bằng composition chung cho preview và export.
- Giữ motion speed trong phép tính frame cục bộ; không dùng playbackRate của parent chỉ để tăng tốc hoạt động của nhân vật.
- Triển khai hard cut và một chuyển cảnh nhẹ đã chọn; tính overlap, giữ trạng thái cuối cảnh cũ và hiện thông tin mới đúng lúc.

**Đầu ra:**

- Composition tích hợp ba track và đoạn mẫu có hard cut lẫn transition.

**Hoàn thành khi:**

- [ ] Lời đọc chạy liền qua ít nhất ba shot, không bị thêm im lặng ở điểm đổi hình.
- [ ] Bật/tắt chuyển cảnh hoặc đổi tốc độ motion không làm đổi duration/audio cue ngoài ý muốn.
- [ ] Preview và file render khớp tại các mốc được chọn; input sai ID/action bị phát hiện khi dùng catalog thật, không chỉ catalog fixture.

### P3-08

**Lưu snapshot, phiên bản và cache đủ để khôi phục bản đã duyệt**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-02](#p3-02), [P3-05](#p3-05), [P3-06](#p3-06), [P2-01](#p2-01)

**Vì sao cần:** Một MP4 không đủ để tái tạo video nếu timing, font hoặc asset đã thay đổi sau đó. Lưu đúng dữ liệu quyết định đầu ra giúp phục hồi, đối chiếu lỗi và tránh render lại một bản khác mà không nhận ra.

**Phạm vi:**

- Checkpoint 1: lưu snapshot bất biến theo schema/template version, gồm props đã resolve, audio hash, timing hoặc tham chiếu bất biến và manifest font/asset.
- Checkpoint 2: xác định ranh giới và invalidation cho nội dung, TTS, timing, visual plan, render; tận dụng cache hiện có, chỉ sửa phần cần thiết để đạt hành vi yêu cầu.
- Kiểm tra serializer/hash với fixture cũ; ghi rõ đọc tương thích dữ liệu cũ khác với tái tạo đúng pixel bằng renderer cũ.

**Đầu ra:**

- Snapshot/archive đã cập nhật và bảng invalidation cache.

**Hoàn thành khi:**

- [ ] Khôi phục fixture dùng lại đúng audio, timing và các version đã lưu, không lấy ngầm asset mới nhất.
- [ ] Đổi font làm tính lại layout liên quan; đổi visual không làm mới TTS.
- [ ] Dữ liệu cũ không bị đổi fingerprint chỉ do đọc hoặc bổ sung default không chủ ý.

### P3-09

**Chỉnh editor để sửa hình và lời theo đúng phạm vi**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-02](#p3-02), [P3-07](#p3-07), [P3-08](#p3-08)

**Vì sao cần:** Người vận hành cần biết một thao tác sẽ chỉ đổi hình hay sẽ tạo lại giọng, nếu không chi phí sửa tay và chờ TTS vẫn cao. Editor gọn theo mô hình mới giúp sửa đúng phần bị lỗi mà không cần một công cụ dựng phim đa năng.

**Phạm vi:**

- Checkpoint 1: mở và hiển thị dữ liệu cũ/mới, nhóm beat/audio segment cùng các shot liên quan; giữ thứ tự câu chuyện.
- Checkpoint 2: sửa template, asset, pose, emphasis hoặc cut cần thiết; sửa lời là thao tác riêng với trạng thái audio tương ứng.
- Checkpoint 3: điều hướng từ lỗi nguồn/cue/fallback tới đúng đoạn cần sửa; tái dùng component/state hiện có, không thêm editor rig hoặc curve editor.

**Đầu ra:**

- Luồng editor tối thiểu để sửa shot hoặc lời và xem ảnh hưởng.

**Hoàn thành khi:**

- [ ] Từ một cảnh báo có thể mở đúng đoạn lời/shot cần sửa.
- [ ] Thay hình giữ trạng thái audio đã tạo; sửa lời cho thấy segment cần tạo lại.
- [ ] Có thể mở và chỉnh video cũ qua adapter mà không mất thứ tự hoặc tham chiếu asset.

### P3-10

**Chứng minh luồng đầy đủ bằng video dùng phụ đề theo cụm**

**Nhóm:** code/dữ liệu · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-03](#p3-03), [P3-07](#p3-07), [P3-08](#p3-08), [P3-09](#p3-09)

**Vì sao cần:** Các module có thể đúng riêng lẻ nhưng vẫn lệch nhau khi ghép từ script tới file cuối. Một luồng mẫu hoàn chỉnh trước karaoke giúp xác nhận kiến trúc mới đã có giá trị mà không bị chặn bởi độ chính xác word timing.

**Phạm vi:**

- Chạy script mẫu qua prompt với catalog thật, Edge TTS hiện có, shot compiler, template, caption theo cụm và render final.
- Thử một lần sửa hình và một lần sửa lời để đối chiếu cache, duration và số request TTS.
- Mở một video cũ và khôi phục một snapshot mẫu; lưu stills/clip và kết quả kiểm tra các mốc audio/hình.

**Đầu ra:**

- Video mẫu tích hợp và báo cáo kiểm tra ngắn có bằng chứng cache/timeline.

**Hoàn thành khi:**

- [ ] Một đoạn giọng chạy qua nhiều shot, phụ đề theo cụm đủ lời và file cuối có duration đúng theo audio đã chốt.
- [ ] Sửa hình không gọi lại TTS; sửa lời chỉ làm mới phần bị ảnh hưởng.
- [ ] Luồng hoạt động với timing chưa có hoặc chỉ là ước lượng, không cần ElevenLabs hay mô hình alignment local.

## 9. Phase 4 — Hoàn thiện caption và âm thanh với Edge TTS

**Mục tiêu:** Caption tiếng Việt đọc rõ, timing đúng hệ quy chiếu, retry/fallback đầy đủ và SFX local thực sự tùy chọn.

**Lý do có phase này:** Chữ sai timing hoặc giọng bị đứt làm video mất chất lượng ngay cả khi hình đẹp. Chuẩn hóa tại adapter và dùng fallback theo cụm giúp pipeline ổn định trong giới hạn chi phí đã chọn.

**Mốc bàn giao:** P4-10 hoàn thành; luồng thực chạy không có ElevenLabs, các nhánh thiếu timing/audio lỗi/SFX thiếu có hành vi đúng và bằng chứng kiểm tra.

### P4-01

**Cố định môi trường Edge TTS và cấu hình audio tối thiểu**

**Nhóm:** audio/caption · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-03](#p0-03), [P0-06](#p0-06)

**Vì sao cần:** Interpreter hoặc phiên bản thư viện khác nhau có thể khiến cùng lệnh tạo giọng hoạt động trên terminal nhưng lỗi trong worker. Cố định môi trường giảm việc dò lỗi lặp lại và giữ luồng sản xuất độc lập với cấu hình ElevenLabs.

**Phạm vi:**

- Pin phiên bản Edge TTS đã chạy thử và chỉ rõ Python interpreter, ưu tiên virtualenv dự án hoặc cấu hình đang hoạt động đã xác minh.
- Giữ voice hiện tại; kiểm tra các biến bắt buộc của luồng Edge TTS và chẩn đoán thiếu module/interpreter sai.
- Bảo đảm startup/config validation của luồng này không yêu cầu ElevenLabs key/SDK; không thêm framework nhiều provider.

**Đầu ra:**

- Cấu hình Edge TTS tái lập được và hướng dẫn chẩn đoán ngắn.

**Hoàn thành khi:**

- [ ] Terminal và worker tạo giọng bằng cùng interpreter/version đã ghi nhận.
- [ ] Thiếu module hoặc interpreter sai cho lỗi rõ, không rơi vào thử lại ngầm bằng một Python khác.
- [ ] Khởi động luồng Edge TTS được khi không có ELEVENLABS_API_KEY.

### P4-02

**Thu boundary và chuẩn hóa metadata của Edge TTS**

**Nhóm:** audio/caption · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P4-01](#p4-01), [P3-01](#p3-01)

**Vì sao cần:** File audio đơn thuần không cho biết lúc nào một từ được đọc, còn metadata provider có đơn vị và cấu trúc riêng. Chuẩn hóa tại adapter giúp caption và shot dùng một hợp đồng rõ mà không bị gắn vào ElevenLabs hoặc schema của repo tham khảo.

**Phạm vi:**

- Yêu cầu WordBoundary theo API của phiên bản đã pin; thu metadata cùng audio trong một lần tạo giọng khi được hỗ trợ.
- Xác minh đơn vị offset/duration rồi chuyển về millisecond; gắn ID token ổn định trong segment và lưu raw metadata để đối chiếu.
- Phân biệt tạo audio thành công nhưng thiếu boundary với tạo audio thất bại; xuất timingSource và trạng thái chất lượng ban đầu đúng sự thật.

**Đầu ra:**

- Adapter trả audio artifact cùng boundary chuẩn hóa hoặc giá trị thiếu timing rõ ràng.

**Hoàn thành khi:**

- [ ] Fixture metadata được chuyển đúng đơn vị và giữ thứ tự token, Unicode và dấu tiếng Việt.
- [ ] Audio tốt nhưng metadata hỏng/thiếu vẫn được giữ với cảnh báo, không bị bỏ hoặc phải tạo lại vô điều kiện.
- [ ] Parse JSON thành công không tự gắn nhãn timing đã được xác minh.

### P4-03

**Đồng bộ timing với audio sau trim, padding và thay tốc độ**

**Nhóm:** audio/caption · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P4-02](#p4-02), [P3-05](#p3-05)

**Vì sao cần:** Nếu caption dùng timestamp của audio thô còn renderer phát file đã cắt im lặng, toàn bộ chữ có thể lệch dù metadata provider đúng. Ghi và áp một phép biến đổi thống nhất ngăn việc bù offset tùy ý hoặc xử lý tốc độ hai lần.

**Phạm vi:**

- Ghi lượng trim thực tế, padding và rate hậu xử lý, theo đúng thứ tự các bước đang dùng.
- Chuyển boundary sang thời gian của file audio cuối cùng của segment; lưu raw và final timing ở các field có nghĩa rõ.
- Đối chiếu duration file cuối, loại/đánh dấu mốc bị cắt và kiểm tra đầu–giữa–cuối; renderer chỉ cộng offset segment toàn cục.

**Đầu ra:**

- Hàm biến đổi timing và metadata đủ truy vết từ audio thô tới audio cuối.

**Hoàn thành khi:**

- [ ] Fixture trim/pad/rate cho vị trí token đúng theo cùng phép biến đổi của audio, không nằm ngoài range hợp lệ.
- [ ] Rate đã được áp trực tiếp trong TTS không bị chia thêm như một bước time-stretch hậu xử lý.
- [ ] Một mẫu audio thật được nghe ở đầu/giữa/cuối; sai lệch còn lại được ghi nhận, không cam kết ±1 frame khi chưa đo.

### P4-04

**Đánh giá độ khớp token và chọn fallback theo cụm**

**Nhóm:** audio/caption · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P4-03](#p4-03), [P3-06](#p3-06)

**Vì sao cần:** Các số, tên riêng và từ lặp có thể làm token của TTS khác văn bản hiển thị; ép chúng thành karaoke dễ tạo cảm giác chữ chạy sai. Đường fallback giữ video dùng được với Edge TTS mà không phải mua dịch vụ căn khớp khác.

**Phạm vi:**

- Đối chiếu văn bản và token bằng Unicode NFC, giữ dấu, xử lý dấu câu và ghi nhận trường hợp phát âm khác cách viết.
- Dùng token ID/vị trí cho cue từ lặp; tạo cảnh báo coverage hoặc sai thứ tự và chọn chế độ word highlight hay phrase caption theo kết quả mẫu.
- Với audio cũ/upload hoặc timing thiếu, tạo timing cụm ước lượng có nhãn rõ; không suy ra verified chỉ từ một tỷ lệ khớp token.

**Đầu ra:**

- Quy tắc chất lượng timing và bộ fixture tiếng Việt có số, tên, từ lặp, thiếu boundary.

**Hoàn thành khi:**

- [ ] Mẫu timing thấp chất lượng chuyển về phụ đề theo cụm và hiển thị cảnh báo đúng segment.
- [ ] Một từ lặp không kéo cue về lần xuất hiện đầu tiên ngoài ý muốn.
- [ ] Không yêu cầu Whisper local, ElevenLabs hoặc API alignment trả phí để hoàn tất fallback.

### P4-05

**Chia trang và ngắt dòng caption theo font thật**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-01](#p3-01), [P1-08](#p1-08), [P0-06](#p0-06), [P2-02](#p2-02)

**Vì sao cần:** Giới hạn số ký tự không bảo đảm chữ vừa khung vì mỗi ký tự và weight có độ rộng khác nhau. Chia theo cụm nghĩa rồi đo font thật giúp caption tiếng Việt dễ đọc, đồng thời tránh dấu hoặc dòng chữ bị cắt.

**Phạm vi:**

- Tận dụng Caption/helper của Remotion phù hợp phiên bản đã cài; bổ sung ngắt theo cụm nghĩa, dấu câu, khoảng nghỉ và page break chủ động.
- Dùng lại font loader/gate của P2-02, load đúng font/weight trước khi đo trong browser; tính theo chiều rộng safe area và tối đa hai dòng của style đã chọn.
- Giữ token/khoảng trắng theo đúng thứ tự và quy định xử lý chuỗi quá dài; không chấp nhận kích thước đo giả trong môi trường không có document.

**Đầu ra:**

- Bộ chia trang/ngắt dòng và contact sheet caption với các câu tiếng Việt khó.

**Hoàn thành khi:**

- [ ] Câu dài, số và tên riêng trong fixture không overflow, mất dấu, mất token hoặc lặp token.
- [ ] Kết quả đo dùng đúng font/weight đã load; không dựa vào faux bold hoặc font fallback không phát hiện.
- [ ] Các cụm caption được xem ở cỡ điện thoại và không bị chia vụn chỉ để đạt một con số ký tự.

### P4-06

**Render caption theo cụm và highlight token ổn định**

**Nhóm:** code/dữ liệu · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P4-04](#p4-04), [P4-05](#p4-05), [P3-07](#p3-07)

**Vì sao cần:** Ngay cả timing đúng vẫn có thể gây khó đọc nếu mỗi từ nhảy kích thước hoặc caption lặp nguyên headline. Một lớp hiển thị thống nhất giữ bố cục ổn định và chỉ dùng highlight khi dữ liệu đủ tốt.

**Phạm vi:**

- Render trang caption từ dữ liệu đã resolve, với hai chế độ phrase và word highlight dùng cùng style.
- Đổi màu hoặc nhấn nhẹ token đang đọc; tránh thay layout và tự cắt hình khi caption sang trang.
- Áp quy tắc tránh trùng headline/hook, safe area và ưu tiên tiêu điểm của template; không làm nhân vật mấp máy theo giọng kể mặc định.

**Đầu ra:**

- Caption layer tích hợp và clip đối chiếu phrase/word highlight.

**Hoàn thành khi:**

- [ ] Chuyển chế độ caption không làm thay timeline giọng hoặc shot.
- [ ] Một mẫu timing tốt highlight đúng các mốc được kiểm tra; mẫu thiếu timing hiển thị phrase thay vì karaoke giả.
- [ ] Không nhảy dòng vì highlight, không chồng caption lên nội dung quan trọng hoặc lặp nguyên câu hook hai lần.

### P4-07

**Hoàn thiện retry và tiếp tục audio segment bị lỗi**

**Nhóm:** audio/caption · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-05](#p3-05), [P4-01](#p4-01)

**Vì sao cần:** Với sản lượng hằng ngày, một lỗi TTS tạm thời không nên buộc tạo lại toàn video hoặc làm hỏng cache đang tốt. Xử lý lỗi theo segment giữ công việc đã hoàn tất và bảo đảm sự cố không âm thầm chuyển sang provider trả phí.

**Phạm vi:**

- Tận dụng hàng đợi/retry hiện có; phân biệt lỗi cấu hình với lỗi tạm thời, đặt số lần thử và backoff có giới hạn.
- Chỉ ghi asset/cache thành công sau khi kiểm tra file audio hoàn chỉnh; lưu trạng thái segment để resume và tránh request trùng khi đã có job hợp lệ.
- Khi hết retry, báo segment cần xử lý; không render final thiếu lời và không gọi provider trả phí ở bất kỳ nhánh fallback nào.

**Đầu ra:**

- Luồng lỗi/resume theo segment và thông báo đủ để người vận hành xử lý.

**Hoàn thành khi:**

- [ ] Mô phỏng một segment lỗi không làm tạo lại các segment đã thành công.
- [ ] File audio dở dang không được lưu như cache hợp lệ hoặc đưa vào final.
- [ ] Kiểm tra nhánh lỗi cho thấy không có lời gọi ElevenLabs hoặc yêu cầu key phát sinh.

### P4-08

**Chuẩn bị manifest SFX local và lựa chọn âm thanh tối thiểu**

**Nhóm:** audio/caption · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-06](#p0-06), [P1-08](#p1-08)

**Vì sao cần:** Chạy nguyên bước tạo SFX của repo tham khảo sẽ đưa ElevenLabs trở lại dù giọng đã chuyển sang Edge TTS. Một pack nhỏ lưu local cho phép nhấn hành động mà không thêm dịch vụ hoặc request vào mỗi video.

**Phạm vi:**

- Chọn một số SFX cho hành động thường gặp như lật trang hoặc đặt vật; ghi nguồn/license từng file và tải trước khi render.
- Tạo manifest sfxId, đường dẫn local, hash và đặc điểm cần cho việc đặt clip; nhạc nền cũng là asset tùy chọn.
- Quy định thiếu asset tùy chọn thì bỏ track và ghi nhận; không tự dùng audio kèm repo theo suy đoán license, không gọi API tạo SFX.

**Đầu ra:**

- Manifest SFX/nhạc local đã kiểm tra, hoặc manifest rỗng có chủ đích khi chưa chọn được asset phù hợp.

**Hoàn thành khi:**

- [ ] Mọi file được đưa vào pack có nguồn và license được ghi lại, đọc được từ local.
- [ ] Video chỉ có giọng vẫn hoàn thành khi pack rỗng hoặc không chọn SFX.
- [ ] Không có dependency ElevenLabs, bước tạo SFX online hoặc kiểm tra credits trong luồng này.

### P4-09

**Đặt SFX theo hành động và kiểm tra bản mix**

**Nhóm:** audio/caption · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P4-08](#p4-08), [P3-07](#p3-07), [P4-03](#p4-03)

**Vì sao cần:** SFX gắn vào mọi cut hoặc nhạc quá lớn có thể làm giọng khó nghe và khiến video dồn dập. Đặt âm thanh theo một số sự kiện có nghĩa và nghe file đầu ra giúp tăng cảm giác hoàn thiện mà không tăng nhiều độ phức tạp hình.

**Phạm vi:**

- Cho sound event tham chiếu shot/cue và sfxId trong manifest; dùng audio đã chuẩn bị và timeline đã resolve.
- Giữ giọng là lớp chính, đặt âm lượng/fade của nhạc và SFX theo mẫu nghe; không suy loudness từ một giá trị volume đơn lẻ.
- Nghe bản xuất trên loa điện thoại hoặc cấu hình nghe gần thực tế, kiểm tra điểm nối lời và các chỗ có SFX; nếu pack trống chỉ kiểm tra voice.

**Đầu ra:**

- Track âm thanh tích hợp và một bản mix mẫu có ghi nhận các điểm đã nghe.

**Hoàn thành khi:**

- [ ] SFX được chọn xuất hiện tại hành động dự định, không bị dịch khi caption đổi trang.
- [ ] Các từ tại điểm có nhạc/SFX vẫn nghe rõ; điểm nối không bị cắt phụ âm hoặc có khoảng nghỉ do cut hình.
- [ ] Bỏ toàn bộ track tùy chọn vẫn giữ nguyên lời đọc, timing và khả năng xuất video.

### P4-10

**Nghiệm thu pipeline Edge TTS hoàn chỉnh không có ElevenLabs**

**Nhóm:** audio/caption · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-10](#p3-10), [P3-08](#p3-08), [P4-06](#p4-06), [P4-07](#p4-07), [P4-09](#p4-09)

**Vì sao cần:** Một ghi chú không dùng ElevenLabs chưa bảo đảm config validation, retry hoặc helper nhập từ repo khác đã thực sự bỏ phụ thuộc. Một lần nghiệm thu toàn luồng và các nhánh lỗi quan trọng chứng minh người dùng có thể sản xuất với cấu hình hiện tại.

**Phạm vi:**

- Chạy một video thực từ script đến final trong môi trường không có ELEVENLABS_API_KEY, dùng Edge TTS, snapshot và template của dự án.
- Kiểm tra bằng fixture/mô phỏng các nhánh thiếu boundary, audio cũ, lỗi một segment và thiếu SFX; tái dùng bằng chứng trước khi code không đổi, không gọi dịch vụ thật ở mọi unit test.
- Ghi bằng chứng về caption, audio/timeline, số request khi sửa hình và cách resume; đối chiếu snapshot có lưu timing cuối cùng.

**Đầu ra:**

- Video nghiệm thu và checklist kết quả của các nhánh Edge TTS/phrase fallback/resume.

**Hoàn thành khi:**

- [ ] Final có lời đầy đủ, caption đọc được và các mốc được kiểm tra không lệch rõ; không có yêu cầu key hoặc lời gọi provider trả phí.
- [ ] Thiếu timing tốt vẫn tạo được caption theo cụm; hết retry audio báo lỗi rõ và không xuất final thiếu lời.
- [ ] Đổi hình không tạo lại TTS, snapshot giữ timing của file audio cuối đã sử dụng và track SFX thực sự tùy chọn.

## 10. Phase 5 — Đo hiệu năng và chốt cấu hình

**Mục tiêu:** Có cấu hình render ổn định trên máy thật và ngân sách thời gian đủ minh bạch để đưa vào pilot.

**Lý do có phase này:** Tối ưu chỉ có ích khi giảm thời gian của công việc đang chậm. Các phép đo cùng input chỉ ra tác động của concurrency, độ phân giải và cảnh nặng, thay vì suy từ số node hoặc dung lượng RAM.

**Mốc bàn giao:** P5-07 hoàn thành; số đo/ước lượng được tách rõ, profile đã chọn, task tối ưu có kết luận hoàn thành hoặc không áp dụng có căn cứ.

### P5-01

**Chuẩn hóa phép đo và lệnh benchmark**

**Nhóm:** hiệu năng · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-04](#p0-04), [P0-05](#p0-05)

**Vì sao cần:** Con số ms/frame không cho biết khả năng sản xuất nếu chưa rõ nó đo từng frame, một luồng hay toàn bộ job. Một phép đo thống nhất giúp so sánh trước/sau đúng cách và tránh tính thời gian render nhanh hơn thực tế do chia concurrency hai lần.

**Phạm vi:**

- Bọc lệnh benchmark/renderer hiện có bằng các fixture đã chọn; giữ input, version và cấu hình của mỗi lần chạy trong báo cáo.
- Ghi wall time toàn job, số frame, fps, resolved concurrency, retry và kích thước output; ghi peak RAM và các thời gian thành phần nếu môi trường cung cấp được.
- Định nghĩa effective wall ms/frame = wall time của render job / tổng frame; ghi riêng thời gian TTS và thao tác người dùng, không cộng encode hai lần khi job đã bao gồm encode.

**Đầu ra:**

- Một lệnh benchmark có thể chạy lại với cùng fixture.
- Mẫu báo cáo số liệu và định nghĩa từng metric.

**Hoàn thành khi:**

- [ ] Một lần chạy thử tạo được báo cáo có input, cấu hình, đơn vị và tổng số frame đối chiếu được với duration × fps.
- [ ] Báo cáo phân biệt số liệu đã đo với trường chưa đo được; không gắn giá trị 0 cho metric chưa có.
- [ ] Tài liệu phép tính không chia effective wall ms/frame cho concurrency thêm lần nữa.

### P5-02

**Tách profile duyệt hình, clip ngắn và render cuối**

**Nhóm:** hiệu năng · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P2-10](#p2-10), [P3-10](#p3-10)

**Vì sao cần:** Render lại cả video chỉ để kiểm tra một đoạn chữ hoặc một chuyển động làm tăng thời gian sửa mỗi ngày. Các profile có mục đích rõ giúp chọn lượng công việc nhỏ nhất đủ để đánh giá thay đổi mà vẫn giữ bản cuối đúng cấu hình.

**Phạm vi:**

- Khai báo profile stills ở độ phân giải final, clip motion 10–20 giây, draft 720×1280 khi cần và final 1080×1920, 30 fps, H.264/AAC.
- Cho phép chọn đoạn hoặc shot cần render; giữ cùng composition, input và font giữa các profile.
- Chỉ thay độ phân giải/cấu hình xuất, không đổi fps hoặc nội dung ngầm để làm draft có vẻ nhanh hơn.

**Đầu ra:**

- Các profile render có tên và lệnh sử dụng theo quy ước repo.
- Ví dụ still, clip ngắn và final từ cùng một input.

**Hoàn thành khi:**

- [ ] Có thể kiểm tra một sửa đổi cục bộ bằng still hoặc clip ngắn mà không render toàn video.
- [ ] Thời điểm hình, lời đọc và caption giữa preview/draft/final thống nhất; khác biệt xuất hình được ghi rõ.
- [ ] Không bắt buộc render draft toàn bộ trước mọi bản final.

### P5-03

**Chọn concurrency nội bộ bằng phép đo có kiểm soát**

**Nhóm:** hiệu năng · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P5-01](#p5-01), [P5-02](#p5-02), [P4-10](#p4-10)

**Vì sao cần:** Nhiều luồng có thể tranh CPU, RAM và I/O trên máy yếu, nên mức concurrency lớn nhất không chắc hoàn thành sớm nhất. Chọn bằng dữ liệu giúp giữ máy ổn định và tránh suy công suất từ dung lượng RAM 48 GB.

**Phạm vi:**

- Chạy một render job tại một thời điểm, thử concurrency 1, 2 và 4 trên cùng fixture đại diện ở 30 fps với cùng codec/chất lượng.
- Tách lần khởi động đầu khỏi lần đã chuẩn bị bundle/cache; lặp đủ để xác định khác biệt có thực, không chạy ma trận mọi tổ hợp.
- Chọn mức ổn định dựa trên wall time, lỗi và bộ nhớ nếu đo được; chỉ thử mức cao hơn khi kết quả hiện có cho thấy cần thiết.

**Đầu ra:**

- Bảng so sánh 1/2/4 và cấu hình concurrency được chọn.

**Hoàn thành khi:**

- [ ] Mỗi kết quả dùng cùng input và điều kiện được ghi lại, có số liệu wall time để đối chiếu.
- [ ] Cấu hình chọn có lý do dựa trên dữ liệu; chưa tăng số render job chạy đồng thời.
- [ ] Các lỗi hoặc lần chạy không hợp lệ được ghi nhận, không loại bỏ âm thầm để làm đẹp kết quả.

### P5-04

**Chốt độ phân giải và chất lượng encode theo mẫu thực**

**Nhóm:** hiệu năng · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P5-03](#p5-03)

**Vì sao cần:** Bản draft thấp hơn chỉ có giá trị khi tiết kiệm thời gian mà vẫn đủ để xem lỗi cần kiểm tra. So sánh riêng độ phân giải và chất lượng xuất tránh kết luận sai rằng resolution không ảnh hưởng, đồng thời tránh đổi tốc độ lấy video chữ bị nhòe.

**Phạm vi:**

- So 720×1280 và 1080×1920 trên một input có chữ tiếng Việt và chuyển động đại diện, giữ fps, codec, chất lượng và concurrency cố định.
- Xem vùng chữ, mép nhân vật và chuyển động ở file xuất; chỉ thử thêm preset encode khi số liệu cho thấy encode là phần đáng tối ưu.
- Chọn profile final và quyết định có cần draft toàn video hay chủ yếu dùng stills/clip ngắn.

**Đầu ra:**

- Hai mẫu xuất và quyết định profile chất lượng kèm số liệu.

**Hoàn thành khi:**

- [ ] Có so sánh wall time cùng input và nhận xét hình ở kích thước điện thoại.
- [ ] Cấu hình final đọc rõ chữ tiếng Việt, không có mất tiếng hoặc sai timing; lựa chọn draft được giải thích bằng lợi ích đo được.
- [ ] Không chuyển 30 fps sang fps khác hoặc giảm nội dung giữa hai mẫu so sánh.

### P5-05

**Đo video dài và điểm nặng khi hai cảnh overlap**

**Nhóm:** hiệu năng · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P5-03](#p5-03), [P5-04](#p5-04)

**Vì sao cần:** Một cảnh nhẹ 10 giây không thể hiện đầy đủ chi phí của video 120 giây, nhất là khi transition vẽ cả hai cảnh cùng lúc. Phép đo sát trường hợp sản xuất giúp phát hiện điểm tăng RAM, khởi động lặp lại hoặc tốc độ giảm trong các lượt chạy nối tiếp.

**Phạm vi:**

- Đo video 60 giây, video 120 giây có caption dài và đoạn 10–15 giây với hai cảnh nhiều thành phần overlap bằng profile đã chọn.
- Ghi cold/warm riêng và chạy một nhóm nhỏ nối tiếp; quan sát wall time, RAM nếu đo được, lỗi và những frame/cảnh chậm nổi bật.
- Kiểm tra project/temp/asset đang ở filesystem nào trong WSL, bundle/browser có được khởi tạo lại không và asset/font có được tải từ nguồn bên ngoài lúc render không.

**Đầu ra:**

- Báo cáo fixture dài/overlap và danh sách bottleneck có bằng chứng.

**Hoàn thành khi:**

- [ ] Báo cáo có đủ video 60 giây, 120 giây và overlap; không ngoại suy chỉ từ một đoạn ngắn.
- [ ] Mỗi bottleneck nêu rõ quan sát hoặc log hỗ trợ; nếu chưa xác định được nguyên nhân thì ghi là chưa xác định.
- [ ] Phân biệt độ mượt Player/Studio với thời gian render offline.

### P5-06

**Tối ưu đúng bottleneck đã đo**

**Nhóm:** hiệu năng · **Quy mô:** M · Có điều kiện; cần kết quả đo/pilot chứng minh nhu cầu.  
**Phụ thuộc:** [P5-05](#p5-05)

**Vì sao cần:** Thêm cache, raster hóa hoặc chỉnh worker mà không biết điểm nghẽn có thể tăng độ phức tạp nhưng không giảm thời gian. Task này chỉ thực hiện khi có vấn đề cụ thể, để mỗi thay đổi được đánh giá bằng lợi ích đo được và không làm hỏng hình đã đạt.

**Phạm vi:**

- Chọn một bottleneck ưu tiên từ P5-05 và áp dụng thay đổi nhỏ tương ứng: kích thước asset, lớp tĩnh, chi phí layout, khởi động bundle/browser hoặc I/O.
- Nếu điều chỉnh cache bundle, tính cả version/hash của asset; cập nhật asset trong bundle hoặc invalidation đúng khi file local đổi.
- Đo lại fixture chịu ảnh hưởng và kiểm tra hình/audio liên quan; hoàn tác lựa chọn không mang lại lợi ích đủ rõ.

**Đầu ra:**

- Một thay đổi tối ưu có báo cáo trước/sau, hoặc kết luận bỏ qua task vì chưa có bottleneck cần xử lý.

**Hoàn thành khi:**

- [ ] Mỗi thay đổi được giữ lại có nguyên nhân, số liệu so sánh và mẫu xác nhận không giảm chất lượng cần thiết.
- [ ] Không đưa API trả phí, cloud render, framework mới hoặc nâng phần cứng vào điều kiện hoàn thành task.
- [ ] Nếu không cần tối ưu, task được đóng với lý do và bằng chứng từ P5-05, không làm thêm cho đủ danh sách.

### P5-07

**Chốt ngân sách thời gian và cấu hình dùng cho pilot**

**Nhóm:** hiệu năng · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P5-05](#p5-05), [P5-06](#p5-06)

**Vì sao cần:** Render nhanh chưa chứng minh có thể làm 20 video mỗi ngày nếu TTS, duyệt và sửa lại chiếm nhiều thời gian. Một ngân sách có định nghĩa rõ giúp pilot kiểm chứng đúng mục tiêu và tránh biến số 100 hoặc 150 ms/frame thành lời hứa về máy chưa đo.

**Phạm vi:**

- Tổng hợp profile, concurrency, wall time 60/120 giây và điều kiện đo; xác nhận task tối ưu đã hoàn thành hoặc được bỏ qua có lý do.
- Tính phần render theo duration × fps × effective wall ms/frame / 1000, ghi riêng các bước ngoài metric và phần ước lượng chưa đo.
- Chọn ngân sách thử cho pilot về render và phút thao tác tay; dùng mốc 9 phút/video 120 giây chỉ như mục tiêu tham khảo cần kiểm chứng, không phải kết quả đã đạt.

**Đầu ra:**

- Cấu hình pilot đã chốt và bảng ngân sách theo từng bước của quy trình.

**Hoàn thành khi:**

- [ ] Người vận hành nhìn được phần đã đo, phần đang ước lượng và phần phải xác nhận trong pilot.
- [ ] Báo cáo không cộng encode hai lần hoặc chia concurrency thêm; không khẳng định đã đạt 15–20 video/ngày trước lô kiểm tra công suất.
- [ ] Không còn việc tối ưu không rõ tác dụng được coi là điều kiện chặn pilot.

## 11. Phase 6 — Pilot, xác nhận công suất và vận hành

**Mục tiêu:** Chạy pilot 5–10 video, xử lý vấn đề thực, kiểm chứng lô 15–20 video và có cách vận hành/khôi phục.

**Lý do có phase này:** Công suất cả ngày còn phụ thuộc nội dung, sửa tay, lỗi và render lại. Lô đại diện cùng runbook cho biết hệ thống có thể dùng thường xuyên trong điều kiện nào.

**Mốc bàn giao:** P6-08 hoàn thành với bằng chứng từ pilot, lô đại diện, khôi phục snapshot và các gate repository. Kết luận công suất nêu đúng điều kiện đã thử, kể cả khi chưa đạt mục tiêu.

### P6-01

**Chọn bộ nội dung pilot đại diện**

**Nhóm:** vận hành · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P0-04](#p0-04), [P2-10](#p2-10)

**Vì sao cần:** Nếu chỉ thử một chủ đề dễ và câu ngắn, các lỗi caption, asset hoặc kể chuyện sẽ xuất hiện muộn khi sản xuất thật. Một bộ nội dung nhỏ nhưng đa dạng giúp kiểm tra những tình huống thường gặp mà chưa phải mở rộng thư viện theo mọi ý tưởng có thể có.

**Phạm vi:**

- Chọn 5–10 video từ nguồn sách đang có, gồm độ dài 60, 90 và 120 giây cùng các dạng kể chuyện, đối chiếu, bài học và hành động cuối.
- Đưa vào một số trường hợp thực tế có câu tiếng Việt dài, số/tên riêng, từ lặp và thay đổi hình khi lời đọc còn tiếp tục.
- Ghi script/nguồn, template dự kiến và điểm cần kiểm tra của từng video; không tạo nguồn hoặc trích dẫn giả chỉ để đủ mẫu.

**Đầu ra:**

- Danh sách pilot với input, mục đích kiểm tra và độ dài mục tiêu.

**Hoàn thành khi:**

- [ ] Có 5–10 video dự kiến bao phủ cả ba nhóm độ dài và các template chính.
- [ ] Mỗi video có nguồn hoặc nhãn tình huống tự sáng tác phù hợp; input đủ cụ thể để bắt đầu pipeline.
- [ ] Danh sách phân biệt thiếu asset thực sự với biến thể có thể dùng thư viện hiện tại.

### P6-02

**Chuẩn hóa trạng thái job và đường tiếp tục khi lỗi**

**Nhóm:** vận hành · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P3-10](#p3-10), [P4-10](#p4-10)

**Vì sao cần:** Một lô đang chạy có thể bị dừng bởi một segment TTS hoặc một lượt render lỗi; làm lại toàn bộ lô sẽ lãng phí audio đã tạo và thời gian duyệt. Trạng thái và điểm tiếp tục rõ ràng giúp sửa đúng phần hỏng mà không vô tình báo video thiếu giọng là hoàn thành.

**Phạm vi:**

- Đối chiếu trạng thái hiện có và bổ sung tối thiểu các trạng thái cần phân biệt: tạo audio, cần xem timing, sẵn sàng render, render lỗi và hoàn thành.
- Nối đường retry/resume ở cấp job với xử lý segment và cache đã có; giữ audio hợp lệ và chỉ chạy lại bước bị ảnh hưởng.
- Thử một lỗi có kiểm soát trong môi trường test để kiểm tra tiếp tục job, không gọi dịch vụ trả phí và không làm mất dữ liệu đã hoàn tất.

**Đầu ra:**

- Bảng trạng thái/chuyển trạng thái và luồng resume dùng được trong UI hoặc CLI hiện có.

**Hoàn thành khi:**

- [ ] Job bị lỗi có thể tiếp tục từ bước phù hợp mà không tạo lại các audio segment không đổi.
- [ ] Thiếu audio bắt buộc không được gắn trạng thái hoàn thành; thiếu timing/SFX tùy chọn được biểu diễn đúng quy tắc fallback.
- [ ] Tái sử dụng bằng chứng Edge-only từ P4-10; chỉ kiểm tra mới các đường nối job/resume chưa được bao phủ.

### P6-03

**Sản xuất pilot và ghi thời gian sửa thực tế**

**Nhóm:** vận hành · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P6-01](#p6-01), [P6-02](#p6-02), [P5-07](#p5-07)

**Vì sao cần:** Các test kỹ thuật không đo được việc người dùng phải sửa nhiều câu, thay nhiều asset hoặc nghe lại vì giọng khó hiểu. Chạy pilot từ đầu đến file cuối cho biết lợi ích của hệ thống đối với một ngày làm việc thực, thay vì chỉ chứng minh renderer xuất được MP4.

**Phạm vi:**

- Chạy danh sách P6-01 bằng cấu hình P5-07: script, Edge TTS, shot plan, caption, storyboard, sửa và render final.
- Xem/nghe trọn từng file cuối; ghi lỗi nội dung, phát âm, caption, hình, timing và số vòng render lại.
- Ghi thời gian TTS, chờ/retry, render và phút thao tác tay riêng; chấm rubric hình/đọc/nhịp/audio đã thống nhất bằng nhận xét cụ thể.

**Đầu ra:**

- 5–10 video pilot cùng storyboard và snapshot tương ứng.
- Báo cáo thời gian toàn quy trình, lỗi và số vòng sửa của từng video.

**Hoàn thành khi:**

- [ ] Các video được xem với tiếng và được kiểm tra các nội dung quan trọng ở kích thước điện thoại.
- [ ] Mọi lỗi phát hiện và thời gian sửa được ghi lại; không chỉ báo trung bình của các lượt tốt nhất.
- [ ] Không tự xuất bản video; đầu ra của task là file và kết quả nghiệm thu nội bộ.

### P6-04

**Sửa nhóm lỗi lặp lại được pilot chứng minh**

**Nhóm:** vận hành · **Quy mô:** M · Có điều kiện; cần kết quả đo/pilot chứng minh nhu cầu.  
**Phụ thuộc:** [P6-03](#p6-03)

**Vì sao cần:** Nếu mỗi video đều cần cùng một thao tác sửa, sản lượng sẽ bị giới hạn bởi công việc tay dù tốc độ render đạt mục tiêu. Sửa đúng lỗi lặp ở template, prompt hoặc quy tắc chung giúp giảm công việc cho những video tiếp theo mà không mở rộng hệ thống tùy ý.

**Phạm vi:**

- Nhóm lỗi P6-03 theo nguyên nhân; ưu tiên lỗi làm sai nội dung, mất khả năng đọc/nghe và thao tác tay lặp nhiều lần.
- Chọn thay đổi nhỏ giải quyết từng nguyên nhân trong template, caption, prompt hoặc asset đã có; chỉ thêm asset khi các mẫu thực cho thấy cần.
- Chạy lại đúng video/shot bị ảnh hưởng và ghi số lỗi hoặc phút sửa đã giảm; không render lại toàn pilot nếu thay đổi không tác động các mẫu còn lại.
- Nếu sửa phần ảnh hưởng renderer, ghi lại thời gian của mẫu bị tác động và cập nhật ngân sách khi cần; không mở lại cả ma trận benchmark.

**Đầu ra:**

- Danh sách lỗi đã xử lý kèm mẫu trước/sau, hoặc kết luận không có lỗi cần chặn lô tiếp theo.

**Hoàn thành khi:**

- [ ] Không còn lỗi nghiêm trọng đã biết làm sai nguồn, mất giọng/chữ hoặc khiến video không dùng được.
- [ ] Các sửa đổi được kiểm tra trên trường hợp gây lỗi; việc chưa làm có lý do và ảnh hưởng được ghi rõ.
- [ ] Nếu pilot không có vấn đề cần sửa, đóng task với bằng chứng và chuyển bước; không bổ sung tính năng để lấp thời gian.

### P6-05

**Khôi phục một video từ snapshot đã duyệt**

**Nhóm:** vận hành · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P6-03](#p6-03), [P6-04](#p6-04)

**Vì sao cần:** Một video đã được duyệt sẽ khó bảo trì nếu chỉ còn MP4 hoặc phải gọi TTS lại để dựng lại. Kiểm tra khôi phục chứng minh rằng audio, timing, asset và version đã được lưu đủ, giúp sửa một chi tiết sau này mà không làm thay đổi các phần đã chốt.

**Phạm vi:**

- Chọn một video pilot và khôi phục bằng snapshot/manifest cùng audio, timing, font và asset version đã lưu trong môi trường test.
- Render lại các khung đại diện và đoạn có caption/transition; đối chiếu nội dung, duration, timing và bố cục theo chính sách version đã chọn.
- Kiểm tra input dạng cũ còn đọc được theo adapter; phân biệt hỗ trợ dữ liệu cũ với cam kết tái tạo đúng từng pixel qua các renderer khác phiên bản.

**Đầu ra:**

- Bản ghi khôi phục có danh sách tài nguyên đã dùng và các mẫu đối chiếu.

**Hoàn thành khi:**

- [ ] Khôi phục không cần tạo lại Edge TTS hoặc truy cập provider audio khác khi audio đã được lưu.
- [ ] Không mất timing, font hay asset đã dùng trong bản duyệt; khác biệt do migration nếu có được giải thích theo chính sách version.
- [ ] Lỗi thiếu metadata/tài nguyên được sửa trước lô kiểm tra công suất, không chỉ ghi thành ghi chú bỏ qua.

### P6-06

**Chạy lô đại diện 15–20 video và xác nhận công suất**

**Nhóm:** vận hành · **Quy mô:** M · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P6-04](#p6-04), [P6-05](#p6-05), [P5-07](#p5-07)

**Vì sao cần:** Một vài video pilot không phản ánh đầy đủ máy nóng, queue kéo dài, retry và thời gian duyệt của cả ngày. Lô gần quy mô sản xuất giúp trả lời trực tiếp mục tiêu 15–20 video/ngày bằng dữ liệu thật và chỉ ra phần nào còn giới hạn công suất.

**Phạm vi:**

- Chuẩn bị lô 15–20 input đại diện với phân bố độ dài 60–120 giây phù hợp kế hoạch thực; tái dùng phần chuẩn bị hợp lệ nhưng ghi rõ cache hit/miss.
- Chạy một render job cùng lúc, concurrency nội bộ đã chọn; giữ quy trình audio, storyboard, duyệt và sửa như sản xuất dự kiến.
- Tổng hợp số video hoàn tất, lỗi/retry, tổng wall time, thời gian hoạt động của máy và phút thao tác tay; ghi diễn biến tốc độ/bộ nhớ nếu đo được.

**Đầu ra:**

- Báo cáo công suất theo lô, dữ liệu từng video và kết luận mức sản lượng đạt được trong điều kiện đã thử.

**Hoàn thành khi:**

- [ ] Có kết quả cho toàn bộ lô, bao gồm job lỗi hoặc cần làm lại; không ngoại suy từ video nhanh nhất.
- [ ] Kết luận nêu điều kiện máy, độ dài, mức dùng cache, số giờ khả dụng và công sức người vận hành thay vì chỉ nêu video/ngày.
- [ ] Nếu chưa đạt mục tiêu, chỉ rõ bottleneck và task tiếp theo cần xử lý; không tuyên bố đạt hoặc tự mua/nâng dịch vụ để che phần thiếu.

### P6-07

**Viết hướng dẫn vận hành và khôi phục khi lỗi**

**Nhóm:** vận hành · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P6-06](#p6-06)

**Vì sao cần:** Một pipeline chỉ vận hành được khi nhớ các lệnh và thứ tự thao tác trong phiên phát triển sẽ khó duy trì hằng ngày. Hướng dẫn dựa trên lô đã chạy giúp người dùng tạo, kiểm tra và tiếp tục công việc mà không phải hỏi agent lại mỗi lần gặp cùng một lỗi.

**Phạm vi:**

- Ghi các bước thực tế: chuẩn bị nguồn/script, tạo audio, duyệt storyboard, render, kiểm tra final, lưu snapshot và xuất file theo nhu cầu.
- Ghi lệnh/config thật của repo, các trạng thái lỗi thường gặp và cách resume một segment/job; dẫn đến báo cáo benchmark/profile đã chọn.
- Bổ sung quy trình quay lại renderer trước, vị trí dữ liệu cần giữ và cách nhận biết không được xóa cache/asset còn được snapshot sử dụng.

**Đầu ra:**

- Runbook vận hành hằng ngày và phần xử lý lỗi/rollback.

**Hoàn thành khi:**

- [ ] Một lượt làm theo runbook trong môi trường test hoàn thành hoặc tiếp tục được một job bằng các lệnh đã ghi.
- [ ] Hướng dẫn không yêu cầu ElevenLabs, key trả phí hoặc bước phát sinh chi phí ngoài phạm vi đã chốt.
- [ ] Các thao tác có thể tác động worker/dữ liệu đang chạy được chỉ rõ và tuân thủ chính sách triển khai của repo.

### P6-08

**Chốt bản phát hành nội bộ và backlog sau pilot**

**Nhóm:** vận hành · **Quy mô:** S · Bắt buộc trong phạm vi kế hoạch.  
**Phụ thuộc:** [P6-05](#p6-05), [P6-07](#p6-07)

**Vì sao cần:** Nếu tiếp tục thêm pose, effect và template ngay sau pilot, bộ đã kiểm chứng có thể mất ổn định trước khi dùng thường xuyên. Chốt một phiên bản cùng bằng chứng nghiệm thu giúp bắt đầu sản xuất với phạm vi rõ và dành các ý tưởng mới cho những vấn đề thực sự đã quan sát.

**Phạm vi:**

- Tổng hợp gate từ các phase trước; chạy các bước lint/typecheck/test/build/E2E còn bắt buộc theo repo ở mốc tích hợp, không lặp mọi phép đo đã đủ bằng chứng.
- Gắn version template/asset/schema/render config theo cơ chế hiện có và áp dụng rollout nội bộ có đường quay lại; giữ renderer cũ cho đến khi chính sách dữ liệu cũ đã được xác nhận.
- Tạo backlog sau pilot từ nhu cầu thực: asset thiếu, thao tác tay còn nhiều hoặc bottleneck; ghi riêng việc theo dõi phản hồi/retention khi người dùng tự xuất bản.

**Đầu ra:**

- Bản phát hành nội bộ có ghi chú thay đổi, kết quả nghiệm thu và cách rollback.
- Backlog sau pilot với lý do và bằng chứng ưu tiên.

**Hoàn thành khi:**

- [ ] Các gate bắt buộc có kết quả hoặc lý do chặn cụ thể; không đánh dấu sẵn sàng nếu vẫn còn lỗi nghiêm trọng đã biết.
- [ ] Có thể xác định chính xác version và cấu hình của bản dùng cho sản xuất; đường quay lại được ghi trong runbook.
- [ ] Không tự đăng video, triển khai hạ tầng bên ngoài hoặc mua dịch vụ; các việc đó nằm ngoài task phát hành nội bộ này.

## 12. Cách xếp việc và giao task cho Claude Code

### 12.1. Các nhánh có thể làm song song

Dependency ghi tại từng task là điều kiện bắt đầu. Số phase dùng để nhóm mục tiêu; không yêu cầu làm xong mọi task của một phase rồi mới đọc hoặc chuẩn bị phase kế tiếp.

| Khi đã có | Có thể mở các nhánh | Điểm phải ghép lại |
| --- | --- | --- |
| Bộ mẫu, quy tắc và baseline ở Phase 0 | Hình mẫu `P1-01`; hợp đồng dữ liệu `P3-01`; môi trường Edge `P4-01`; công cụ đo `P5-01`, khi từng dependency đã đủ | Clip chuẩn `P1-08` và hợp đồng dữ liệu thống nhất |
| Hệ hình `P1-02` | Bố cục `P1-03` và asset mẫu `P1-04` | Styleframe `P1-05` |
| Manifest và cách nạp asset `P2-01`–`P2-02` | Cast `P2-03`, bối cảnh `P2-04`, props `P2-05` | Template `P2-06`–`P2-08`, catalog và gallery |
| Hợp đồng `P3-01` | Adapter dữ liệu cũ, kiểm tra nguồn, audio segment và boundary theo dependency tương ứng | Compiler/composition `P3-06`–`P3-07` và video tích hợp `P3-10` |
| Font/style và hợp đồng caption đã có | Ngắt dòng `P4-05` có thể đi song song với chuẩn hóa timing; manifest SFX `P4-08` có thể chuẩn bị riêng | Caption layer `P4-06`, mix `P4-09`, nghiệm thu `P4-10` |
| Gallery `P2-10` | Chuẩn bị nội dung pilot `P6-01` trong khi hoàn thiện tích hợp và benchmark | Pilot thật `P6-03` chỉ chạy khi pipeline và cấu hình đã sẵn sàng |

Đây là cách chia công việc phát triển. Trên cùng máy, vẫn xếp hàng các job render nặng và dành khoảng đo riêng cho benchmark. Không vừa chạy nhiều build/render vừa dùng số đo đó để chọn concurrency.

Khi giao cho nhiều agent, chia theo module hoặc đầu ra rõ, dùng cùng hợp đồng và chỉ định một người/agent ghép thay đổi. Hai agent cùng sửa schema, cache key hoặc composition cần thống nhất người phụ trách file trước khi làm. Không tạo hai implementation của cùng adapter chỉ vì hai phase cùng dùng nó.

### 12.2. Các mốc không nên đảo thứ tự

- Chốt hình/clip mẫu trước khi mở rộng cast, props và template. Nếu mẫu chưa tốt, sửa ngay ở Phase 1.
- Có hợp đồng dữ liệu trước khi sửa prompt, cache và editor theo cấu trúc mới.
- Chuẩn hóa timing theo audio cuối trước khi bật highlight từng token.
- Có video tích hợp trước khi dùng benchmark để kết luận chi phí của hệ thống mới.
- Chạy pilot nhỏ và sửa lỗi cản trở trước lô 15–20 video.

`P5-06` và `P6-04` là hai task có điều kiện. Dependency của chúng được coi là giải quyết khi task đã hoàn thành, hoặc được ghi **Không áp dụng** kèm bằng chứng rằng không có vấn đề cần sửa. Không coi một task bắt buộc đang bị chặn là không áp dụng để đi tiếp.

### 12.3. Vấn đề của video được giải quyết ở đâu?

| Vấn đề cần cải thiện | Task chính | Bằng chứng cần xem |
| --- | --- | --- |
| Hình đơn giản, thiếu điểm nhìn | `P1-01`–`P1-08` | Styleframe và clip cùng nội dung so với baseline |
| Các video giống nhau nhưng vẫn tốn công dựng | `P2-01`–`P2-10` | Gallery nhiều tình huống từ cùng bộ asset/template |
| Muốn tăng số shot nhưng giọng bị ngắt | `P3-01`, `P3-05`–`P3-07` | Một audio segment chạy liền qua ba shot |
| Sửa hình lại phải tạo giọng | `P3-05`, `P3-08`, `P3-10` | Số request TTS không tăng khi chỉ đổi hình |
| Phụ đề dài, khó đọc hoặc highlight sai | `P4-02`–`P4-06` | Câu tiếng Việt khó, từ lặp và mẫu thiếu boundary |
| Repo tham khảo kéo theo ElevenLabs | `P0-06`, `P4-01`, `P4-08`, `P4-10` | Video thực hoàn tất với cấu hình Edge TTS và nhánh lỗi không gọi provider khác |
| Render quá lâu hoặc khó dự đoán | `P5-01`–`P5-07` | Số đo cùng input, cấu hình ổn định, ngân sách thời gian |
| Đạt render nhưng vẫn không làm nổi 20 video/ngày | `P6-03`, `P6-04`, `P6-06` | Phút thao tác tay, số vòng sửa và kết quả toàn lô |
| Dữ liệu cũ hỏng hoặc không dựng lại được | `P3-02`, `P3-08`, `P6-05`, `P6-07` | Mở dữ liệu cũ, khôi phục snapshot và tiếp tục job lỗi |

### 12.4. Theo dõi tiến độ bằng đầu ra

Mỗi task cần một bản ghi ngắn trong nơi theo dõi việc của repository. Có thể dùng mẫu này mà không cần cài thêm công cụ quản lý:

```markdown
Task: P3-05
Trạng thái: Chưa làm / Đang làm / Cần sửa / Hoàn thành
Người hoặc agent thực hiện: ...
Module thực tế: ...
Đầu ra: đường dẫn code, dữ liệu hoặc clip ...
Bằng chứng nghiệm thu: input, thao tác, kết quả ...
Điểm còn thiếu hoặc task phát sinh: ...
```

Không cần viết một báo cáo dài cho mỗi thay đổi nhỏ. Một still chứng minh chữ không tràn hoặc một log chứng minh cache hit có thể đủ khi đúng với rủi ro của task. Các bài kiểm tra tích hợp dùng dịch vụ thật được gom vào mốc tích hợp; unit test dùng fixture/mô phỏng phù hợp.

## 13. Thông số và hợp đồng kỹ thuật dùng chung

Phần này giữ các quyết định kỹ thuật của kế hoạch trước để người thực hiện không phải tự suy lại trong từng task. Các tên type/field là đề xuất cần hòa vào code hiện có, chưa phải cam kết rằng repository đã có implementation.

### 13.1. Bốn đơn vị và nhịp kể

| Đơn vị | Trách nhiệm | Điều không nên gộp vào nó |
| --- | --- | --- |
| `NarrativeBeat` | Một ý hoặc bước tiến trong câu chuyện; tham chiếu nguồn | Một file audio bắt buộc hoặc một góc camera cố định |
| `AudioSegment` | Lời đọc liền mạch, file audio, duration thực và timing | Một lần đổi hình |
| `VisualShot` | Bố cục, asset, hành động, mốc bắt đầu/kết thúc | Yêu cầu tạo một file TTS riêng |
| `CaptionSegment` | Một cụm chữ dễ đọc theo lời và layout | Một lần cắt cảnh bắt buộc |

Một đoạn giọng 12 giây có thể phủ ba shot dài 3, 4 và 5 giây. Chốt duration sau khi tạo audio, rồi resolve shot/caption theo duration đó. Nếu một segment đổi lời và đổi độ dài, compiler tính lại offset của các segment sau; các file giọng không đổi vẫn giữ được cache.

Điểm xuất phát để thử: đoạn audio thường 10–25 giây, khoảng 4–8 đoạn cho video 60–120 giây; hook có thể ngắn hơn. Shot thường 2–6 giây; phép so sánh có thể cần 6–8 giây. Các con số này là hướng biên tập, không phải invariant của schema hoặc quota của Edge TTS.

Một video nên tập trung vào một bài học, có tình huống cụ thể, thay đổi nhìn thấy được và một hành động cuối. Chữ và hình cần bổ sung cho lời kể. Không tăng số cut chỉ vì caption sang trang; không tự chạy vòng camera rộng → vừa → cận, lật bối cảnh hoặc thêm 100–400 ms im lặng ở mỗi cut.

### 13.2. Hợp đồng audio và timing

Edge TTS dùng dịch vụ online để tạo giọng; các bước render đọc file đã chuẩn bị.[R23] Phiên bản source đã đối chiếu có lựa chọn `WordBoundary`/`SentenceBoundary`; cần yêu cầu `WordBoundary` rõ và kiểm tra API của phiên bản cài trong dự án.[R8]

```ts
type NarrationArtifact = {
  provider: 'edge-tts';
  audioAssetId: string;
  audioHash: string;
  durationMs: number;
  engineVersion: string;
  voice: string;
  words: {
    id: string;
    text: string;
    startMs: number;
    endMs: number;
  }[] | null;
  timingSource: 'provider' | 'estimated' | 'none';
  timingQuality: 'verified' | 'needs-review' | 'unavailable';
  warnings: string[];
};
```

`words` dùng millisecond tương đối với **file audio cuối cùng của segment**. Raw metadata lưu riêng để đối chiếu. Renderer chỉ cộng offset segment; không trim hoặc bù rate thêm lần nữa. Cue theo từ phải trỏ bằng token ID/index trong segment, vì một từ có thể xuất hiện nhiều lần.

Với thứ tự trim → time-stretch theo rate `r` → thêm padding đầu → đặt segment vào video:

```text
t_video = segmentStart + addedLead + (t_raw − actualTrimStart) / r
```

`actualTrimStart` phải là lượng audio thực sự bị cắt. Nếu rate đã được áp trong TTS, metadata thuộc audio đã tạo ở rate đó; không chia thêm. Khi thứ tự hậu xử lý khác, phép biến đổi cũng phải khác. Kiểm tra đầu–giữa–cuối để phân biệt offset cố định với drift tăng dần.

| Tình huống | Hành vi bắt buộc |
| --- | --- |
| Audio và timing đạt kiểm tra | Caption theo cụm; có thể highlight token |
| Audio tốt nhưng boundary thiếu/sai | Giữ audio, dùng timing cụm ước lượng có cảnh báo |
| Audio cache cũ hoặc upload chưa có timing | Dùng đường theo cụm; không bắt tạo lại toàn bộ giọng |
| Lỗi tạm thời khi tạo audio | Retry có giới hạn, backoff và resume theo segment |
| Hết retry hoặc sai cấu hình | Báo lỗi rõ; final chưa đủ giọng không được coi là hoàn tất |
| Thiếu SFX/nhạc tùy chọn | Bỏ track đó và ghi nhận |
| Không có cấu hình ElevenLabs | Luồng Edge TTS hoạt động bình thường |

Nhãn `verified` phải có căn cứ; parse được JSON hoặc khớp một tỷ lệ token không chứng minh timing chính xác. Không đặt mục tiêu sai số ±1 frame trước khi đo, không dùng tỷ lệ khớp thấp như 60% làm chứng nhận karaoke. Chuẩn hóa Unicode NFC, giữ dấu tiếng Việt và ghi rõ cách xử lý số/tên riêng. Mặc định không cần thêm mô hình speech alignment chạy local.

### 13.3. Caption, typography và vùng UI

`@remotion/captions` có helper chia trang và hỗ trợ ngắt theo khoảng nghỉ/page break ở các phiên bản được nêu trong tài liệu; lớp layout tiếng Việt vẫn cần đo chiều rộng thật.[R4] `measureText()` của `@remotion/layout-utils` dùng môi trường browser; cần font đã load và đúng family, size, weight, letter spacing.[R5]

- Chia cụm theo nghĩa, dấu câu và khoảng nghỉ; số ký tự chỉ là giới hạn phụ.
- Load đúng weight thực sự sử dụng. Nếu dùng 800, không chỉ load 700 rồi dựa vào đậm giả.
- Mục tiêu ban đầu là tối đa hai dòng, không mất/lặp token hoặc khoảng trắng. Có chính sách rõ cho một token quá dài.
- Highlight giữ nguyên layout; dùng đổi màu hoặc nhấn nhẹ đã kiểm tra. Không bắt mọi từ scale lên xuống.
- `split(" ")` chỉ tách theo khoảng trắng, không tự tạo ranh giới từ ngữ nghĩa tiếng Việt.
- Safe area là profile có thể chỉnh theo nền tảng; kiểm tra trên giao diện thực tế khi xuất bản. Các hướng dẫn UI của TikTok là nguồn tham khảo, không phải một tọa độ chung bảo đảm cho mọi video/platform.[R17]
- Nếu headline đã thể hiện đầy đủ câu hook với timing phù hợp, tránh đặt một caption thứ hai lặp nguyên câu ngay cạnh nó.

### 13.4. Timeline, motion và asset

Dùng một timeline đã resolve cho cả preview và export. Chuyển millisecond sang frame theo quy tắc chung, ưu tiên làm tròn các mốc tuyệt đối để tránh cộng dồn sai số. Motion tính từ frame; tránh CSS animation/transition chạy theo đồng hồ riêng, `Date.now()` hoặc randomness không có seed.[R19]

Tốc độ motion có thể tính ở frame cục bộ. `Sequence.playbackRate` tác động tới media/animation và thời lượng sequence, nên không dùng nó chỉ để nhân vật cử động nhanh hơn mà không xem tác động lên audio/timeline.[R7]

`TransitionSeries` tạo overlap và làm tổng duration ngắn đi.[R6] Nếu áp dụng phép bù `d_i = f_i + t_i`, tất cả đại lượng phải cùng hệ thời gian và chỉ tính các transition thực sự tồn tại:

```text
totalDuration = sum(d_i) − sum(t_i) = sum(f_i)
```

Audio vẫn chạy trên track chính. Cảnh mới cần hiện thông tin đúng lời liên quan; cảnh cũ giữ trạng thái hợp lý trong overlap. Thử trường hợp cả hai cảnh đều nhiều thành phần. Khởi đầu bằng hard cut và một chuyển cảnh nhẹ đã chọn.

Cho phép ảnh local qua Remotion `<Img>`; component này tham gia cơ chế chờ tải ảnh của Remotion.[R2] Chuẩn bị asset trước render, có ID/hash/source, rồi tham chiếu từ manifest. Bitmap và SVG được chọn theo chất lượng và số đo; ảnh raster không mặc nhiên nhanh hơn mọi vector. `React.memo` không phải cache một cảnh đã raster hóa.

Cache bundle cần tính source/lockfile/config và asset manifest/hash. Khi asset được thêm hoặc sửa sau bundling, cập nhật asset trong bundle theo luồng đã kiểm tra hoặc bundle lại; chỉ sửa `public/` nguồn rồi tái dùng bundle cũ có thể bỏ sót thay đổi.[R22]

### 13.5. Nguồn nội dung, schema và cache

`SourceClaim` cần ID riêng, loại `verbatim`/`paraphrase`/`illustration`, nội dung đã chốt và nguồn/điểm neo tương ứng. Trích nguyên văn và diễn giải phải được đối chiếu với nguồn; tình huống tự viết cần được nhận diện đúng. Một claim có thể đi qua nhiều shot mà vẫn giữ nguồn.

Đặt dữ liệu màn chữ ở dạng có cấu trúc:

```ts
type ScreenText =
  | {kind: 'punch'; text: string}
  | {kind: 'list'; items: {id: string; text: string; cueId?: string}[]}
  | {kind: 'versus'; left: string; right: string};
```

Delimiter của dữ liệu cũ chỉ được parse tại adapter. Kiểm tra schema đồng thời kiểm tra ngữ nghĩa: asset/pose tồn tại, anchor hỗ trợ tương tác, framing có chứa đối tượng cần nhìn, emphasis có trong nội dung, hai vế comparison đủ và đúng ý. Một lỗi trang trí có thể fallback có cảnh báo; lỗi làm sai nghĩa cần sửa. Ghi `normalizationWarnings` và số lần fallback để không coi mọi cảnh bị đưa về default là chất lượng đạt.

| Cache | Nhóm đầu vào cần xác định |
| --- | --- |
| Nội dung | Nguồn, yêu cầu video, version prompt |
| TTS | Lời đã chuẩn hóa, voice, rate, engine/version, cấu hình ảnh hưởng audio |
| Timing | Hash audio, raw metadata, trim/pad/rate, version xử lý timing |
| Visual plan | Beat/script, template catalog, asset/style version |
| Render | Props đã resolve, audio/timing, font/asset hash, renderer/template version, cấu hình xuất |

Đổi hình không làm mới audio. Đổi lời làm mới segment liên quan và timeline phụ thuộc. Đổi font làm tính lại layout liên quan. Snapshot giữ timing đã dùng hoặc tham chiếu bất biến, audio/font/asset hash, schema/template version và render settings.

Đọc được dữ liệu cũ và render giống từng pixel bằng renderer cũ là hai mục tiêu khác nhau. Chọn rõ chính sách giữ renderer cũ hoặc migration có ghi nhận; kiểm tra serializer/hash bằng fixture thật. Không làm đổi fingerprint cũ chỉ vì thêm default ở điểm đọc.

### 13.6. Ngân sách render và công suất

Giữ 30 fps cho vòng đầu. Đo concurrency nội bộ 1/2/4 với một render job tại một thời điểm. Dùng CLI benchmark hiện có hoặc lệnh bọc phù hợp với fixture; không xây lại cả hệ thống đo.[R9] Ghi wall time, số frame, điều kiện cache, lỗi và metric tài nguyên có thể thu được từ renderer/môi trường.[R16]

Nếu `c` là wall time của **toàn render job** chia số frame, đã phản ánh concurrency:

```text
render_seconds = duration_seconds × fps × c_ms_per_frame / 1000
```

| Độ dài ở 30 fps | Nếu c = 100 ms/frame | Nếu c = 150 ms/frame | 20 video nếu c = 150 ms/frame |
| --- | ---: | ---: | ---: |
| 60 giây | 3 phút | 4,5 phút | 90 phút |
| 90 giây | 4,5 phút | 6,75 phút | 135 phút |
| 120 giây | 6 phút | 9 phút | 180 phút |

Đây là số học theo giả định, chưa phải kết quả đo trên máy người dùng. Không chia tiếp cho concurrency. Không cộng encode lần hai nếu metric đã bao gồm encode. Nếu metric chỉ đo giai đoạn render frame, các bước ngoài nó phải ghi và cộng riêng. Không dùng một giá trị trung bình từ clip ngắn như lời hứa cho mọi video dài.

Mốc 9 phút cho video 120 giây là ngân sách thử tương ứng khoảng 3 giờ render cho 20 video. TTS, chuẩn bị nội dung, duyệt, chờ lỗi và render lại vẫn cần được ghi riêng. Một lượt xem đủ 20 video dài 60–120 giây đã mất 20–40 phút; đây mới là thời gian phát video, chưa gồm sửa.

Độ phân giải ảnh hưởng render; so 720p/1080p cùng điều kiện trước khi quyết định dùng draft.[R3] Duyệt bằng stills ở độ phân giải final và clip ngắn khi phù hợp. `premountFor` phục vụ preview Player/Studio, không phải biện pháp làm render offline nhanh hơn.[R15]

Khi chạy tool Linux trong WSL, ưu tiên repository và file làm việc ở filesystem Linux theo hướng dẫn Microsoft.[R10] RAM 48 GB không thay thế phép đo CPU, ổ đĩa, giới hạn WSL và nhiệt độ máy. Giữ benchmark không bị tranh tài nguyên bởi build/render khác.

### 13.7. Tiêu chí chất lượng và kiểm tra vừa đủ

Rubric nội bộ áp dụng cho `P1-08` và pilot: nhất quán hình, dễ đọc, hình bổ sung ý, nhịp kể, audio rõ, hành động cuối cụ thể. Chấm 1–5 kèm nhận xét vào khung/đoạn cụ thể; có thể dùng mục tiêu thử không mục nào dưới 3 và trung bình từ 4. Đây là quy ước quản trị để so mẫu, không phải thang đo khoa học hay dự báo retention.

Lỗi mất lời, chữ tràn/mất dấu, thiếu asset, sai nguồn, file hỏng hoặc lệch timing rõ cần được sửa bất kể điểm trung bình. Khi đã xuất bản theo quyết định của người dùng, mới so các chỉ số thực mà nền tảng cung cấp trên nhóm nội dung/độ dài tương tự; plan này không tự thực hiện đăng video.

| Thay đổi | Bằng chứng phù hợp |
| --- | --- |
| Màu, spacing, asset | Stills; clip ngắn nếu thay motion |
| Timeline, trim, rate | Fixture có phép tính kỳ vọng; nghe audio thực ở mốc quan trọng |
| Caption | Câu tiếng Việt dài, số/tên, từ lặp, thiếu boundary, không mất/lặp token |
| Schema, cache | Fixture cũ, dữ liệu lỗi, invalidation đúng phần |
| Snapshot | Khôi phục cùng audio/timing/asset/version đã lưu |
| Edge TTS và fallback | Một luồng tích hợp thực; nhánh lỗi dùng mô phỏng phù hợp |
| Tích hợp/phát hành | Gate lint/typecheck/test/build/E2E bắt buộc của repository và smoke flow liên quan |

Không chạy lại đầy đủ toàn bộ bộ kiểm tra cho mỗi sửa màu. Cũng không thay việc xem hình/nghe âm bằng test kiểm tra một giá trị rotation hoặc cấm mọi `<Img>`. Giữ `remotion` và các package `@remotion/*` cùng exact version đã xác minh; mismatch là rủi ro được tài liệu chính thức nêu.[R18]

## 14. Storyboard mẫu để dùng ở Phase 1

Đây là tình huống minh họa tự viết về thói quen đọc và cách bố trí đồ vật, không phải trích nguyên văn từ sách. Nếu gắn tên sách, đối chiếu bài học với đoạn nguồn được nhập. Mốc thời gian là mục tiêu biên tập, cần chốt lại sau Edge TTS; có thể giãn thành 15–20 giây theo ngữ điệu.

| Mốc dự kiến | Lời đọc minh họa | Hình/chữ | Chuyển động có mục đích |
| --- | --- | --- | --- |
| 0–3 giây | Định đọc sách, nhưng lại cầm điện thoại? | Điện thoại trước tay, sách ở ngăn kéo; chữ ngắn LẠI CẦM ĐIỆN THOẠI? | Nhấn điện thoại một lần |
| 3–6 giây | Một thứ trước mặt. Một thứ bị cất đi. | Giữ căn phòng, chỉ vị trí hai vật | Highlight lần lượt |
| 6–8,5 giây | Thử đổi chỗ chúng. | Cùng góc máy, sách lên bàn, điện thoại ra ngoài vùng chính | Dịch hai vật theo đường đơn giản |
| 8,5–12 giây | Để sách ở chỗ bạn thường ngồi. | Pose ngồi, sách dễ lấy | Đổi pose hoặc cắt vào tay/sách |
| 12–15 giây | Tối nay, bắt đầu bằng một trang. | Sách mở, chữ MỘT TRANG | Đổi state sách; SFX local nếu đã có |

Mẫu chỉ cần một bối cảnh, một nhân vật với một đến hai pose, sách và điện thoại. Giá trị của mẫu nằm ở nguyên nhân–thay đổi–hành động nhìn thấy được, giúp kiểm tra chất lượng mà chưa cần đi bộ, lip-sync hay 3D.

## 15. Tài nguyên và cách áp dụng có chọn lọc

| Tài nguyên | Dùng trong task nào | Cách dùng |
| --- | --- | --- |
| [Remotion official skills][R1] | `P0-06` và các task API/render | Hướng dẫn API theo version; vẫn review code và hình |
| [Captions][R4], [layout-utils][R5] | `P4-05`, `P4-06` | Tận dụng dữ liệu/helper, bổ sung ngắt dòng tiếng Việt |
| [Open Peeps][R11] | `P1-04`, `P2-03` | Một lựa chọn cast/pose nét vẽ; website công bố CC0 |
| [Microsoft Fluent Emoji][R12] | `P2-05` | Chọn ít props hợp style; kiểm tra MIT/notices của tài nguyên dùng |
| [Lucide][R20] | `P2-07`, `P2-08` | Icon cho chữ/checklist, giữ quy định license tương ứng |
| [what-if-animation][R21] | `P1-01`, `P1-05`–`P1-08`, `P3-06` | Học storyboard, cue theo lời, kiểm tra hình và motion |
| [whoosh][R13], [pageTurn][R14] | `P4-08`, `P4-09` | Chọn file phù hợp, kiểm tra nguồn và tải local; không dùng ở mọi cut |

Không trộn các thư viện hình nếu nét, màu và tỷ lệ không hợp nhau. Danh sách là nguồn để chọn tài sản, không phải yêu cầu nhập hết tất cả vào dự án.

### 15.1. Ranh giới áp dụng what-if-animation

Repo tham khảo dùng ElevenLabs cho giọng và SFX, còn upstream skill mô tả voice/timing và tạo âm thanh trong workflow riêng.[R21][R24] Kế hoạch này tiếp thu cách kể và cách review, giữ pipeline Edge TTS của dự án.

| Ý tưởng upstream | Cách triển khai trong backlog |
| --- | --- |
| Storyboard trước animation | Styleframe/contact sheet ở Phase 1 và gallery ở Phase 2 |
| Shot bám lời | Cue ID và timeline compiler ở `P3-06` |
| Timing của provider | Adapter Edge và timing chuẩn hóa ở `P4-02`–`P4-04` |
| Tạo SFX bằng API | Manifest SFX local tùy chọn ở `P4-08` |
| Cast nhất quán | Bộ nhỏ có ID, pose/anchor đã kiểm tra ở Phase 2 |
| Review ảnh và clip | Gate có bằng chứng trong mỗi phase |

Không cài nguyên `SKILL.md` rồi giao agent làm theo toàn bộ workflow. Chỉ thay lệnh TTS chưa làm schema/CLI của hai hệ thống tương thích. Không mặc định quyền sử dụng mọi audio đi kèm được quyết định bởi license của code repo; pack local của dự án phải có nguồn/điều khoản được ghi riêng.

MVP/pilot không bổ sung ElevenLabs, API tạo SFX, fallback audio trả phí, video AI theo từng shot, engine skeleton/physics/3D, editor rig đa năng hoặc cloud rendering. Khi pilot cho thấy nhu cầu mới, ghi task mới cùng lý do và tác động thay vì âm thầm nới phạm vi hiện tại.

## 16. Prompt để giao từng nhóm task cho Claude Code

Đưa file này vào context của dự án và yêu cầu bắt đầu ở task đã sẵn sàng. Đừng giao “hoàn thành tất cả phase” trong một lệnh rồi chỉ kiểm tra khi có video cuối; các mốc nhỏ giúp nhận ra sai hướng sớm.

```text
Hãy thực hiện kế hoạch Markdown này trên repository hiện có.

Mục tiêu: nâng chất lượng video sách 60–120 giây và kiểm chứng khả năng
sản xuất 15–20 video/ngày trên máy Windows/WSL hiện tại.
MVP/pilot giữ Edge TTS, không cần hoặc gọi ElevenLabs cho bất kỳ bước nào.

Task cần làm trong lượt này: [điền các ID đã đủ dependency].

1. Đọc hướng dẫn repository và đầu ra của các task phụ thuộc. Xác minh
   module/phiên bản thực tế trước khi sửa; các đường dẫn gợi ý không
   được coi là bằng chứng code đang có.
2. Với từng task, giữ đúng lý do, phạm vi, đầu ra và tiêu chí hoàn thành.
   Tận dụng component/adapter/queue sẵn có. Nếu còn quá rộng sau khi
   đọc code, chia task con có đầu ra riêng và cập nhật dependency.
3. Làm chủ động các bước đã được cho phép. Gate là review đầu ra cụ thể,
   không phải vòng xin lại sự đồng ý cho toàn bộ hướng làm.
4. Dùng fixture, stills, clip ngắn và test phù hợp rủi ro. Giữ gate bắt
   buộc của repository. Chưa đánh dấu xong khi thiếu bằng chứng.
5. Giữ preview/export dùng một timeline; audio/font/asset sẵn sàng local
   trước render. Thay hình không tạo lại TTS. Timing yếu thì caption
   theo cụm; audio bắt buộc lỗi thì báo và resume.
6. Cuối lượt, cập nhật trạng thái task, file/code/clip đầu ra, kiểm tra
   đã làm và phần còn thiếu. Chỉ ra task tiếp theo đã đủ dependency.
   Không tự báo đạt công suất hoặc chất lượng nếu chưa có số đo/mẫu.
```

**Lượt khởi đầu:** thực hiện `P0-01` rồi `P0-02`; chỉ sau khi nắm môi trường mới chạy Edge, fixture và baseline.  
**Lượt chứng minh chất lượng:** đi từ `P1-01` tới `P1-08`, giao một hoặc vài task liên quan mỗi lượt và giữ clip mẫu làm chuẩn.  
**Lượt mở nhánh:** sau quy tắc/hợp đồng tương ứng, cho phép chuẩn bị dữ liệu, adapter Edge và công cụ đo song song với phần hình; chỉ ghép khi dependency của task tích hợp đã đủ.

Đầu ra cần bàn giao cuối dự án là bộ template/asset đã kiểm tra, pipeline Edge TTS hoạt động, video mẫu, số đo công suất, snapshot khôi phục và runbook thực tế. Số lượng task hoàn thành chỉ có ý nghĩa khi những đầu ra này đạt tiêu chí.


## 17. Nguồn kiểm chứng


Các nguồn đã dùng trong bản kế hoạch trước, tra cứu ngày 30/10/2026; bản cập nhật này phân rã và làm rõ task. Các link dưới đây là tài liệu/repository gốc. API phải đối chiếu lại với phiên bản thực sự cài trong dự án trước khi triển khai.

[R1]: https://www.remotion.dev/docs/ai/skills "Remotion Agent Skills"
[R2]: https://www.remotion.dev/docs/img "Remotion Img"
[R3]: https://www.remotion.dev/docs/performance "Remotion Performance Tips"
[R4]: https://www.remotion.dev/docs/captions/create-tiktok-style-captions "createTikTokStyleCaptions"
[R5]: https://www.remotion.dev/docs/layout-utils/measure-text "measureText"
[R6]: https://www.remotion.dev/docs/transitions/transitionseries "TransitionSeries"
[R7]: https://www.remotion.dev/docs/sequence "Sequence"
[R8]: https://github.com/rany2/edge-tts/blob/master/src/edge_tts/communicate.py "edge-tts source"
[R9]: https://www.remotion.dev/docs/cli/benchmark "Remotion benchmark"
[R10]: https://learn.microsoft.com/en-us/windows/wsl/interop "Microsoft WSL file storage and performance"
[R11]: https://www.openpeeps.com/ "Open Peeps"
[R12]: https://github.com/microsoft/fluentui-emoji "Fluent Emoji"
[R13]: https://www.remotion.dev/docs/sfx/whoosh "whoosh source and license"
[R14]: https://www.remotion.dev/docs/sfx/page-turn "pageTurn source and license"
[R15]: https://www.remotion.dev/docs/player/premounting "Premounting"
[R16]: https://www.remotion.dev/docs/renderer/render-media "renderMedia"
[R17]: https://ads.tiktok.com/resources/help/article/creative-best-practices "TikTok creative best practices for performance ads"
[R18]: https://www.remotion.dev/docs/version-mismatch "Remotion version mismatch"
[R19]: https://www.remotion.dev/docs/animating-properties "Remotion animating properties"
[R20]: https://lucide.dev/license "Lucide license"
[R21]: https://github.com/kelano86/what-if-animation "What If Animation"
[R22]: https://www.remotion.dev/docs/assets "Importing assets and adding assets after bundling"
[R23]: https://github.com/rany2/edge-tts "Edge TTS README"
[R24]: https://github.com/kelano86/what-if-animation/blob/main/SKILL.md "What If Animation upstream skill"

- [Remotion Agent Skills][R1]
- [Img][R2], [Performance Tips][R3], [benchmark][R9]
- [Caption pages][R4], [measureText][R5]
- [TransitionSeries][R6], [Sequence][R7], [Premounting][R15]
- [edge-tts source][R8]
- [Microsoft WSL guidance][R10]
- [Open Peeps][R11], [Fluent Emoji][R12], [Lucide][R20]
- [whoosh][R13], [pageTurn][R14]
- [renderMedia][R16], [version mismatch][R18], [frame-based animation][R19]
- [TikTok creative guidance][R17]
- [what-if-animation][R21]
- [Importing assets][R22]
- [Edge TTS README][R23]
- [What If Animation upstream skill][R24]
