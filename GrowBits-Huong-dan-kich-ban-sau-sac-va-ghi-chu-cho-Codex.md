# GrowBits — Hướng dẫn tạo kịch bản short video sâu sắc và thu hút

**Phạm vi:** Video tiếng Việt chuyển một bài học từ sách thành một câu chuyện có giá trị thực tế.  
**Quy trình đợt 1:** NotebookLM viết bản thảo → Claude Code biên tập thành kế hoạch cảnh → TTS → kiểm tra sẵn sàng → dựng video.  
**Mục đích tài liệu:** Hướng dẫn biên tập và phạm vi cải tiến để giao Codex triển khai theo hai đợt.  
**Mốc đối chiếu:** 31/10/2026, commit `af7bac4`; cần kiểm tra lại các thành phần liên quan nếu code tiếp tục thay đổi.  
**Trạng thái:** Các cải tiến trong tài liệu là công việc đề xuất; lần cập nhật này chỉ chỉnh tài liệu, chưa triển khai code hay chạy sản xuất thật.

> Mục tiêu không phải là kể dài hơn hoặc làm nhân vật đau khổ hơn. Mục tiêu là khiến người xem hiểu một lựa chọn, nhận ra giới hạn của nó, và nhìn thấy một cách hành động khác.

---

## 1. Những định hướng thống nhất

| Hạng mục              | Định hướng đợt 1                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nội dung              | Một video, một bài học chính, một câu hỏi trung tâm.                                                                                                            |
| Chiều sâu             | Đến từ động cơ, mâu thuẫn, lựa chọn và quan hệ nhân quả; không đến từ thêm lời triết lý.                                                                        |
| Thời lượng thử nghiệm | Dùng khoảng 60–90 giây sẵn có. Ưu tiên thành phẩm 75–85 giây; 82 giây chỉ là ví dụ phân bổ nội dung.                                                            |
| Giới hạn              | Trong đợt thử, 60–90 giây là khoảng bắt buộc theo phép đo hiện có; 75–85 giây là mục tiêu mềm. Không áp trần 90 giây lên toàn sản phẩm hoặc video cũ.           |
| Độ linh hoạt          | Video 65–72 giây trọn vẹn vẫn phù hợp. Dưới 60 giây trong đợt thử vẫn chịu xử lý `UNDER_MIN`; không tự nới khoảng, nhồi chữ hay đổi nhịp đọc.                   |
| Tốc độ đọc            | So sánh Chuẩn (+0%) và Nhanh (+15%) do người dùng chọn. Giữ các profile hiện có, kể cả Rất nhanh (+30%); chưa thêm +10%.                                        |
| Cấu trúc              | Giữ sáu phần và đúng thứ tự hiện tại; tạo khác biệt bằng góc kể, động cơ và diễn biến, không bằng thay enum hay bỏ phần.                                        |
| Độ chính xác          | Giữ ý và điều kiện áp dụng của bài học; phân biệt kiến thức trong sách, sự kiện thật và tình huống minh họa.                                                    |
| Kiểm tra chất lượng   | Đợt 1 dùng checklist cho người đánh giá bộ mẫu; chưa thêm lượt phản biện AI hoặc cổng duyệt tay vào mỗi video. Giữ kiểm tra nguồn và kiểm tra kỹ thuật sau TTS. |
| Giới hạn sửa          | Giữ một lượt sửa AI chung cho mỗi production item. Hết lượt mà vẫn không đạt kiểm tra tự động thì dừng với lỗi rõ ràng, giữ artifact.                           |

Các mốc 75–85 giây là **giả thuyết biên tập để thử nghiệm**, không phải quy tắc thuật toán hay cam kết về lượt xem. Thời lượng cuối được xác nhận bằng audio và video thực tế.

Đợt 1 cải thiện các prompt và hợp đồng tham chiếu draft cần thiết trong pipeline đang có. Đợt 2 chỉ là hướng phát triển cần đặc tả riêng: bước Claude phát triển truyện, brief đầu ra có cấu trúc, phản biện trước TTS, nới thứ tự, profile +10% và trạng thái chờ người duyệt (§8.4).

## 2. Thế nào là một câu chuyện có chiều sâu?

Các nguyên tắc ở §2–§3 dùng để sửa chỉ dẫn viết và đánh giá mẫu. Chúng không tự tạo thêm trường JSON, lượt gọi AI hay cổng duyệt trong pipeline.

### 2.1. Không chỉ kể nhân vật làm gì; phải hiểu vì sao họ làm vậy

Một bản thảo còn nông thường có dạng:

> Nhân vật muốn tiến bộ → làm sai → gặp khó khăn → nghe một lời khuyên → thành công.

Một bản thảo có chiều sâu cần trả lời thêm:

**Vì sao cách làm cũ từng có vẻ hợp lý?** Nhân vật đang bảo vệ điều gì, theo đuổi điều gì, hoặc nhận được lợi ích ngắn hạn nào từ nó? Khi cách làm đó không còn hiệu quả, nhân vật phải thay đổi lựa chọn nào?

Không cần biến nhân vật thành người có quá khứ phức tạp. Một niềm tin nhỏ nhưng cụ thể đã có thể tạo ra mâu thuẫn:

> “Đã bỏ một buổi thì phải làm bù gấp đôi. Như thế mới là có trách nhiệm.”

Đây là chất liệu cho một nhân vật minh họa, không phải kết luận tâm lý đúng với tất cả người xem.

### 2.2. Chiều sâu cần được thể hiện bằng hành động

| Cách viết yếu                     | Hướng viết tốt hơn                                                          |
| --------------------------------- | --------------------------------------------------------------------------- |
| “Cậu rất thất vọng về bản thân.”  | Cậu lật úp cuốn sách để không nhìn thấy tờ giấy ghi mục tiêu.               |
| “Cô ấy sợ bị đánh giá.”           | Cô viết xong câu hỏi, rồi xóa nó trước khi gửi vào nhóm.                    |
| “Anh nhận ra mình phải thay đổi.” | Lần này, anh gửi bản nháp thay vì dành cả tối sửa tiêu đề.                  |
| “Cô đã thành công.”               | Trong đúng hoàn cảnh từng bỏ cuộc, cô thực hiện được hành động nhỏ đã chọn. |

Đây là những chi tiết hư cấu minh họa cách viết. Chỉ sử dụng khi chúng phù hợp với nhân vật và nguyên lý đã được xác nhận từ nguồn.

### 2.3. Bài học phải giải thích được sự thay đổi

Chuỗi nhân quả cần rõ:

**Niềm tin hoặc cách làm cũ → lựa chọn → hệ quả → nhận ra giới hạn → áp dụng nguyên lý → lựa chọn mới → kết quả có thể quan sát.**

Không giải quyết mâu thuẫn bằng may mắn, đột nhiên có động lực, hoặc một câu “hãy tin vào bản thân”.

Một phép thử hữu ích: thay nguyên lý trong kịch bản bằng “hãy cố gắng hơn”. Nếu câu chuyện vẫn giữ nguyên logic, có thể bài học chưa thực sự tham gia vào việc giải quyết vấn đề.

Câu chuyện hư cấu giúp minh họa nguyên lý, **không phải bằng chứng khoa học chứng minh nguyên lý**.

### 2.4. Chiều sâu không đồng nghĩa với u buồn

Không buộc mọi nhân vật phải tự ti, xấu hổ hoặc “chạm đáy”. Câu chuyện có thể sâu nhờ một nghịch lý, một cuộc đối thoại, một quyết định khó, một sự nhầm lẫn hài hước hoặc một chi tiết được hiểu lại.

Cái giá của sai lầm phải tương xứng với vấn đề. Một video về việc bắt đầu đọc sách không cần thêm mất việc, đổ vỡ quan hệ hay khủng hoảng cuộc đời.

## 3. Các nguyên tắc viết kịch bản

### 3.1. Hook đưa ra một lời hứa cụ thể

Hook nên mở một câu hỏi mà phần còn lại của video thực sự trả lời. Ưu tiên hành động, câu thoại hoặc sự đối lập có thể hình dung ngay.

Ví dụ minh họa:

> “Chưa đọc, đã nợ sáu mươi trang.”

Câu tiếp theo cần sớm làm rõ đây là mục tiêu đọc bù nhân vật tự đặt ra. Không giữ người xem bằng cách kéo dài một sự hiểu lầm không liên quan.

Tránh phóng đại kiểu “Cuốn sách này phá hủy cuộc đời Minh” nếu câu chuyện chỉ nói về việc bỏ một buổi đọc. Khoảng ba giây là mục tiêu biên tập mềm; giới hạn kỹ thuật vẫn là bốn giây theo audio và thời lượng cảnh thực tế.

### 3.2. Có một câu hỏi trung tâm để dẫn câu chuyện

Câu hỏi trung tâm không nhất thiết được đọc thành lời. Nó là điều người xem đang chờ được hiểu, chẳng hạn:

> “Vì sao càng cố bù mục tiêu, nhân vật càng không bắt đầu được?”

Mọi cảnh nên làm rõ câu hỏi này, tạo thêm hệ quả hoặc tiến gần tới câu trả lời. Cảnh chỉ trang trí bối cảnh nhưng không đóng góp nên được rút gọn.

### 3.3. Cách làm sai cần có sức hấp dẫn

Nhân vật không nên ngây ngô chỉ để bài học trông thông minh. Hãy cho thấy lợi ích ban đầu, sự tiện lợi hoặc lý do khiến họ tin cách làm cũ.

Một thành tựu nhỏ có thể giúp làm điều này, nhưng không bắt buộc phải có cảnh “ba ngày đầu rất tốt” trong mọi video.

### 3.4. Mỗi nhịp kể phải tạo ra một thay đổi

Thay đổi có thể nằm ở thông tin, kỳ vọng, lựa chọn hoặc hệ quả. Không cần một cú sốc ở mỗi cảnh.

Hai cảnh liên tiếp cùng nói “nhân vật buồn vì thất bại” thường chỉ kéo dài cảm xúc. Cảnh thứ hai nên cho thấy nhân vật làm gì vì cảm xúc đó, và hành động ấy khiến vấn đề đổi khác ra sao.

Phân biệt **nhịp kể biên tập**, **cảnh có một đoạn giọng đọc** và **shot hình ảnh**. Một cảnh có thể chứa nhiều chuyển biến nhỏ và nhiều shot; điều này không cho phép nhập, bỏ hoặc đảo các loại `NarrativeBeat`/cảnh bắt buộc. Giữ đủ sáu chức năng theo thứ tự, không cần đổi hình liên tục để giả lập sự hấp dẫn.

### 3.5. Bước ngoặt là một lựa chọn mới, không chỉ một câu nói hay

Bước ngoặt tốt khiến người xem hiểu lại điều đã xuất hiện, sau đó thấy nhân vật hành động khác.

Không chỉ viết:

> “Minh nhận ra mình không cần hoàn hảo.”

Cần làm rõ: nhận ra điều gì trong tình huống này, nguyên lý nào hỗ trợ cách nhìn đó, và tối nay Minh làm khác điều gì?

Không ép mọi bài học thành một sự thật trái trực giác. Khi nguồn không hỗ trợ một cú đảo chiều, ưu tiên giải thích đúng và kể rõ.

### 3.6. Kết quả nhỏ nhưng đáng tin

Một hành động mới chưa đủ để tuyên bố nhân vật “hết trì hoãn” hay “thay đổi hoàn toàn”.

Kết quả có thể là nhân vật mở lại cuốn sách, gửi được bản nháp, đặt một câu hỏi hoặc quay lại thói quen sau lần bỏ lỡ. Đó là bằng chứng cho thay đổi trong tình huống đang kể, không phải lời bảo đảm lâu dài.

### 3.7. Kết thúc giải quyết lời hứa của hook

Ưu tiên một chi tiết hoặc hành động cuối có ý nghĩa mới. `RESOLUTION` vẫn xử lý đúng tình huống mở đầu; hình ảnh không cần tua lại nguyên cảnh hay tạo một “thực tại thay thế” khó hiểu.

Khi nhân vật thử lại, cần làm rõ đó là lần sau hoặc tình huống tương tự. Khi kể hai phương án giả định, phải báo hiệu rõ đây là so sánh hai cách làm.

Giữ phần `ACTION` với một hành động áp dụng cụ thể; có thể viết rất gọn. Không cần thêm kết luận, châm ngôn, checklist và lời kêu gọi theo dõi nếu chúng lặp lại nhau.

### 3.8. Viết cho tai nghe và hình ảnh

Dùng tiếng Việt tự nhiên, câu dài ngắn đan xen, không cắt mọi câu thành những mảnh cụt. Thuật ngữ phải được giải thích qua tình huống khi cần.

Lời dẫn, chữ nhấn trên màn hình và hình ảnh nên bổ trợ nhau. Không bắt lời dẫn mô tả mọi thứ đã nhìn thấy. Chữ nhấn cần cô đọng; phụ đề là lớp riêng và vẫn có thể bám đầy đủ lời nói.

Hình ảnh nên đơn giản, có thể dựng được: một tờ giấy mục tiêu, lịch, một lựa chọn trước–sau. Shot plan hiện hỗ trợ bối cảnh, hành động, cảm xúc, nhân vật phụ, đạo cụ, nhãn, cỡ hình và thẻ chữ trong các danh sách cố định. Dùng khả năng đang có; không giả định renderer làm được mọi động tác cụ thể như xóa tin hoặc lật sách. Lời dẫn phải truyền đạt đủ diễn biến thiết yếu; không mở rộng renderer để bù cho câu chuyện yếu.

## 4. Quy trình đợt 1 và ranh giới biên tập

### Bước 1 — Dùng bài học đã có và nguồn liên quan

Dùng snapshot bài học đã chọn cùng nguồn mà bài học dẫn tới. Chốt nguyên lý, vấn đề nó giải quyết, điều kiện áp dụng và trích đoạn hỗ trợ trong phạm vi nguồn thực sự có. Không tạo một lượt phân tích hay “thẻ bài học” mới cho mỗi video; không phân tích lại cả sách để sửa cách kể.

| Lớp nội dung                               | Quyền biên tập                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kiến thức, khẳng định và trích dẫn từ sách | Có thể diễn đạt lại nhưng không thay nghĩa hoặc bỏ điều kiện quan trọng. Câu trích dẫn trực tiếp phải đúng nguồn.                                        |
| Sự kiện hoặc người có thật trong nguồn     | Không sáng tác lời thoại, kết quả hay suy nghĩ bên trong rồi trình bày như sự thật.                                                                      |
| Nhân vật và tình huống minh họa            | NotebookLM được xây dựng để minh họa đúng nguyên lý; phải giữ nhãn minh họa và không gán cho tác giả. Compiler đợt 1 vẫn bảo toàn chất liệu trong draft. |

Một suy nghĩ sáng tác cho nhân vật không trở thành kết luận của sách. “Minh thấy mình đang mắc nợ mục tiêu” không được đổi thành “tác giả chứng minh mọi người trì hoãn vì cảm giác mắc nợ” nếu nguồn không nói vậy.

Khi thiếu căn cứ cho một chi tiết quan trọng, bỏ chi tiết hoặc ghi vấn đề trong báo cáo đánh giá. Không dùng ký ức mô hình để lấp chỗ trống. Trang chưa biết phải biểu diễn là chưa xác định; tính đúng của trích đoạn và tính đúng của vị trí nguồn là hai việc riêng.

### Bước 2 — Giữ góc kể được giao, viết rõ logic ngay trong draft

Giữ cách xoay sáu góc kể hiện có theo video/phiên bản hoặc đợt/vị trí. Không thêm lượt sinh ba phương án rồi chọn. Trong cùng lượt viết, yêu cầu NotebookLM thể hiện được các điểm sau qua lời dẫn:

| Thành phần                  | Câu hỏi cần trả lời                                               |
| --------------------------- | ----------------------------------------------------------------- |
| Câu hỏi trung tâm           | Người xem chờ được hiểu điều gì?                                  |
| Mục tiêu và động cơ         | Nhân vật muốn gì; vì sao điều đó quan trọng ở đây?                |
| Sức hấp dẫn của cách làm cũ | Vì sao lựa chọn ban đầu từng hợp lý?                              |
| Hệ quả                      | Lựa chọn ấy dẫn tới cái giá cụ thể nào?                           |
| Nguyên lý và giới hạn       | Ý nào trong nguồn giải thích vấn đề; không được suy rộng tới đâu? |
| Lựa chọn mới                | Nhân vật làm khác điều gì nhờ nguyên lý?                          |
| Bằng chứng thay đổi         | Chi tiết cuối chứng minh điều gì, và chưa chứng minh điều gì?     |
| Ranh giới sáng tác          | Phần nào có nguồn, phần nào là minh họa?                          |

Đây là tiêu chí viết và đọc lại, chưa phải trường `brief` mới trong JSON. Đầu ra đợt 1 tiếp tục dùng các nhịp và hợp đồng hiện có. Không yêu cầu xuất suy luận dài hoặc coi điểm tự chấm của LLM là dự báo retention.

### Bước 3 — NotebookLM viết bản thảo trong giới hạn prompt

Viết tiếng Việt tự nhiên, đúng sáu phần và đúng thứ tự. Đưa quy tắc cố định ngắn gọn vào persona; câu hỏi giữ bài học, góc kể, khoảng thời lượng, nhịp đọc và định dạng. Giữ giới hạn 700 từ/câu hỏi và 10.000 ký tự/persona; kiểm tra cả đầu vào dài và lượt sửa.

Mục tiêu là nâng động cơ và nhân quả ngay khi viết draft. Đợt 1 không thêm lời gọi hoặc phản hồi có cấu trúc mới để giữ brief.

### Bước 4 — Claude biên tập draft thành kế hoạch cảnh

Claude làm sắc lời dẫn, hook và chữ nhấn trong phạm vi draft, giữ nhân vật, thoại, dữ kiện, nguyên lý và mạch kể. Chưa mở quyền sửa tiền đề hay tạo thoại minh họa mới tại compiler. Nếu draft có vấn đề cấu trúc câu chuyện, ghi nhận ở bộ so sánh; không lách source guard để cứu một mẫu.

Giữ đầu ra `illustration`, `shots` và `publish`, gồm kiểm tra nguồn cho nhãn đạo cụ, tag và card. Source guard kiểm tra số và câu trích dẫn theo chữ; nó không chứng minh đầy đủ tính trung thực về ý nghĩa.

### Bước 5 — Tạo giọng, kiểm tra và render theo pipeline hiện có

Tạo TTS ở nhịp người dùng chọn, đo audio, cập nhật timing, phụ đề và shot timeline. Giữ kiểm tra sẵn sàng sau TTS: audio, hook, khoảng thời lượng và trích đoạn nguồn của bài học.

Giữ một lượt sửa AI chung cho production item. Lỗi cấu trúc/nguồn/thời lượng được đưa về bước sửa theo cơ chế hiện có; lỗi mạng hoặc chờ quota không được nhập nhằng thành lượt biên tập. Hết lượt mà vẫn không đạt thì item thất bại với lý do và artifact được giữ, không tự đổi nhịp, nới khoảng hoặc render tiếp.

Checklist chất lượng (§7) dùng cho người đánh giá bộ thử, không thêm một bước duyệt tay cho mọi video. Bước phát triển truyện riêng và phản biện tự động trước TTS được hoãn sang đợt 2 (§8.4).

## 5. Ví dụ: phát triển chiều sâu mà không tăng số bài học

Ví dụ dưới đây là **dàn ý minh họa hư cấu**, không phải câu chuyện trích từ sách, không phải lời thoại hoàn chỉnh đã căn thời lượng. Giả định bài học đầu vào đã được nguồn xác nhận là: thiết kế phiên bản khởi đầu đủ nhỏ để dễ bắt đầu hơn.

### Bản còn nông

> Minh đặt mục tiêu đọc sách. Minh bận nên bỏ. Minh giảm mục tiêu. Minh đọc trở lại.

### Hướng phát triển đề xuất

Bảng dưới là các ý biên tập, không phải bảy `NarrativeBeat` hay bảy cảnh bắt buộc. Khi chuyển sang draft/scene plan, vẫn giữ đủ sáu loại theo thứ tự; phần niềm tin thuộc tình huống, hệ quả thuộc sai lầm, cơ chế thuộc bài học và áp dụng thuộc cách giải quyết.

| Nhịp              | Nội dung minh họa                                                                             | Giá trị thêm vào                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Hook              | “Chưa đọc, đã nợ sáu mươi trang.”                                                             | Một nghịch lý cụ thể, có thể giải đáp.                                                                     |
| Niềm tin ban đầu  | Minh tự đặt quy tắc: bỏ một tối thì tối sau phải đọc bù.                                      | Cách làm cũ có lý do: cậu muốn giữ lời với mình.                                                           |
| Vấn đề lớn dần    | Sau một hôm về muộn, mục tiêu tăng gấp đôi. Minh nhìn con số, rồi đóng sách.                  | Khó khăn không chỉ là thiếu thời gian; cách khắc phục cũng tạo thêm trở ngại.                              |
| Nhận ra giới hạn  | Càng cộng thêm việc phải làm, lần bắt đầu tiếp theo càng khó đối với Minh.                    | Người xem hiểu lại một chi tiết đã xuất hiện. Đây là diễn biến của nhân vật, không phải kết luận phổ quát. |
| Áp dụng nguyên lý | Minh thử một phiên bản khởi đầu nhỏ, thay vì mở sách với nghĩa vụ hoàn thành cả phần đọc bù.  | Bài học tác động trực tiếp tới lựa chọn.                                                                   |
| Kiểm chứng nhỏ    | Một tối bận khác, cậu vẫn mở sách và đọc được một đoạn ngắn.                                  | Chứng minh việc bắt đầu đã thay đổi; không tuyên bố có thói quen bền vững chỉ sau một tối.                 |
| Hành động kết     | “Tối nay, đặt sách ở chỗ bạn ngồi và đọc một đoạn ngắn.” Hình ảnh nhắc lại cuốn sách được mở. | Giữ phần ACTION cụ thể, trả lời mâu thuẫn ban đầu và tránh hứa hẹn thành công lớn.                         |

**Lưu ý về nguồn:** Quyết định không cộng dồn trang đọc là lựa chọn sáng tác cho nhân vật, không tự động là quy tắc của tác giả. Chỉ nêu tên một quy tắc hoặc cuốn sách cụ thể khi đã đối chiếu cách áp dụng với đoạn nguồn.

Ví dụ này cho thấy hướng nâng cấp: không thêm nhiều biến cố, mà làm rõ vì sao nhân vật tự tạo ra cách xử lý cũ và nó tác động tới hành vi tiếp theo như thế nào.

## 6. Thời lượng, nhịp kể và nhịp đọc

### 6.1. Phân biệt mục tiêu mềm và khoảng bắt buộc

Đợt thử dùng khoảng 60–90 giây người dùng chọn; ưu tiên thành phẩm 75–85 giây cho câu chuyện cần giải thích mâu thuẫn và lựa chọn. Video 65–72 giây trọn vẹn vẫn phù hợp. Không áp trần 90 giây lên toàn sản phẩm hoặc thay đổi video cũ.

`targetDurationSec` vẫn nhận các preset 30/45/60/90/120/180/240/300; trong khoảng thử là 60 hoặc 90. Không truyền 75, 82 hay 85 vào trường này. Mục tiêu đề xuất không thay thế khoảng bắt buộc của thành phẩm.

Nếu video thực tế dưới 60 giây trong đợt thử, giữ xử lý `UNDER_MIN` hiện có và một lượt sửa AI chung. Không thêm chữ vô nghĩa, tự nới khoảng hoặc đổi nhịp. Nếu không thể đạt bằng nội dung có căn cứ trong lượt sửa cho phép, dừng với lý do rõ ràng.

Ví dụ phân bổ biên tập cho một thành phẩm khoảng 82 giây:

| Khoảng thời gian | Vai trò gợi ý                                     |
| ---------------- | ------------------------------------------------- |
| 0–3 giây         | Hook cụ thể.                                      |
| 3–14 giây        | Tình huống, mục tiêu và lý do của lựa chọn cũ.    |
| 14–29 giây       | Cách làm cũ và hệ quả bắt đầu xuất hiện.          |
| 29–44 giây       | Mâu thuẫn rõ hơn hoặc một chi tiết được hiểu lại. |
| 44–63 giây       | Nguyên lý và lựa chọn mới của nhân vật.           |
| 63–76 giây       | Kết quả nhỏ có thể quan sát.                      |
| 76–82 giây       | Giải đáp hook và một hành động áp dụng.           |

Đây là ví dụ, không phải bảy cảnh hay mốc timestamp phải khớp. Có thể rút hoặc chia nhỏ các ý nhưng vẫn giữ thứ tự sáu phần. Timeline cuối theo audio thực tế. Hook vẫn có giới hạn kỹ thuật bốn giây.

### 6.2. Chọn nhịp trước khi viết và tổng hợp TTS

Đợt thử so sánh Chuẩn (+0%) và Nhanh (+15%) thành các nhóm riêng. Giữ cùng nhịp giữa bản cũ và mới trong từng cặp so sánh kịch bản. Chọn nhóm Nhanh khi vẫn nghe rõ, không làm mất khoảng lắng; hệ thống không tự tăng tốc để cứu một bản dài.

Giữ profile Rất nhanh (+30%) cho người dùng đang sử dụng, nhưng không đưa vào đợt thử này. Thêm +10% thuộc đợt 2 vì liên quan profile, ngân sách, cache và timing; không thêm mức đọc hoặc biến môi trường trong đợt 1.

Tốc độ giọng được áp dụng tại TTS. Renderer không tăng thêm tốc độ audio; hệ số chạy hình hiện có là phần riêng. Không thêm một tầng tăng tốc hậu kỳ. Phép chia thời lượng audio gốc cho hệ số tốc độ chỉ mô tả giả định biến đổi tuyến tính, không dự báo chính xác audio TTS được tổng hợp lại. Luôn đo file tạo ra.

### 6.3. Ngân sách lời dẫn có dự phòng

Thống nhất chính sách ngân sách giữa draft NotebookLM và compiler Claude; không yêu cầu compiler thêm lời để đạt một ngân sách cao hơn. Chênh lệch hiện tại là hệ số 0,9 ở draft so với 1,0 ở compiler, không phải bằng chứng tự thân rằng một bên sai.

Giữ dự phòng cho khoảng nghỉ mỗi cảnh, thời gian hiển thị tối thiểu và sai số ước lượng. Không đồng nhất bằng cách bỏ hệ số 0,9 rồi dùng hết ngân sách. Phân biệt ngân sách lời dẫn với thời lượng thành phẩm để không tính đệm hai lần.

Cần kiểm tra cả sát mức tối thiểu: mục tiêu 60 giây ở nhịp Chuẩn với hệ số 0,9 cho khoảng 216 đơn vị lời dẫn, tức khoảng 54 giây lời trước đệm theo ước lượng. Con số này không bảo đảm đạt tối thiểu 60 giây sau TTS. Kiểm tra ngân sách dùng cùng nhịp/khoảng, cảnh ngắn và nhiều cảnh; giữ phép đo và xử lý `UNDER_MIN` hiện có làm căn cứ cuối.

Từ hoặc đơn vị tách bằng khoảng trắng chỉ là ước lượng âm tiết. Số, tên riêng, chữ viết tắt và dấu câu có thể làm thời lượng khác dự kiến. Hiệu chỉnh từ audio thực tế của giọng và nhịp đang dùng, không từ kết quả tự ước lượng của LLM.

### 6.4. Sửa quá dài và cập nhật timing

Bỏ bối cảnh thừa, ý lặp và các câu kết trùng nhau; rút lời mô tả hình chỉ khi shot thực sự truyền đạt được thông tin đó. Bảo vệ lý do của lựa chọn cũ, cơ chế tạo bước ngoặt và hành động chứng minh thay đổi. Không bỏ loại cảnh bắt buộc hoặc cắt mất nguyên lý để giữ thời lượng.

Giữ nhịp người dùng đã chọn. Khi sửa lời trong lượt sửa AI cho phép, tạo lại audio cần thiết và cập nhật phụ đề, thời điểm chuyển cảnh/shot tương ứng. Không tự tăng tốc, cắt giọng, nới khoảng hay tạo video phần hai.

Kiểm tra toàn bộ thời lượng theo audio, đệm và quy tắc timeline hiện có; không cộng lại khoảng nghỉ đã nằm trong audio. Nghe thử độ tự nhiên cùng với kiểm tra giới hạn, không chỉ nhìn một con số dưới 90.

## 7. Checklist đánh giá kịch bản

### 7.1. Đánh giá biên tập trên bộ mẫu

Đợt 1 dùng checklist này cho người đọc/nghe bộ so sánh (§10); có thể đọc kịch bản trước khi tạo audio mẫu. Đây chưa phải cổng kiểm tra tự động trước TTS hoặc bước duyệt tay bắt buộc trong production. Nhận xét phải nêu đoạn cụ thể và đối chiếu nguồn, không chỉ đánh dấu “đạt”.

- [ ] Hook mở một câu hỏi cụ thể và phần sau thực sự giải đáp.
- [ ] Người xem hiểu vì sao nhân vật chọn cách làm cũ, không chỉ biết họ làm sai.
- [ ] Hậu quả liên quan đến lựa chọn, không xuất hiện ngẫu nhiên để ép cao trào.
- [ ] Đoạn giữa có tiến triển, không lặp cùng một trạng thái cảm xúc.
- [ ] Nguyên lý từ sách được dùng đúng, giữ điều kiện áp dụng và làm thay đổi một hành động cụ thể.
- [ ] Kết quả tương xứng, không suy rộng tình huống thành kết luận phổ quát.
- [ ] Phân biệt được phần có nguồn, phần diễn giải và phần minh họa; vị trí chưa biết không bị trình bày như đã xác minh.
- [ ] Kết thúc trọn vẹn với ACTION cụ thể, không lặp bài học hoặc ép lời kêu gọi theo dõi.
- [ ] Chữ trong lời dẫn, shot và bộ đăng tải giữ đúng căn cứ nguồn; hình không phải gánh thông tin template chưa thể hiện được.

Mẫu sai nguồn hoặc thiếu quan hệ nhân quả ở bước ngoặt không được tính là đạt chất lượng dù JSON hợp lệ. Ghi vấn đề để sửa chỉ dẫn; không dùng điểm LLM làm bằng chứng đã cải thiện.

### 7.2. Kiểm tra kỹ thuật và điều kiện dừng

Giữ kiểm tra tự động sau TTS: hook trong bốn giây, có audio cho các cảnh, thời lượng trong khoảng và bài học có trích đoạn nguồn. Với bộ mẫu, nghe thêm độ tự nhiên, điểm nhấn, phụ đề và sự khớp của shot.

Không mô tả kiểm tra hiện có như đã phát hiện được mọi sai lệch ý nghĩa hoặc lỗi nhân quả. Source guard chỉ chặn một số dạng số và câu trích dẫn; người đánh giá vẫn phải so nội dung với nguồn.

Giữ một lượt sửa AI chung cho item, không cộng thêm một lượt ở mỗi bước. Nếu vẫn không đạt kiểm tra tự động sau lượt sửa, item dừng ở trạng thái lỗi hiện có, giữ artifact và lý do để người dùng xử lý. Đợt 1 không thêm trạng thái chờ duyệt hoặc hứa pipeline tự phát hiện mọi vấn đề biên tập.

## 8. Ghi chú cụ thể để giao Codex

### 8.1. Mốc đối chiếu và các thành phần liên quan

Đối chiếu source tại commit `af7bac4` ngày 31/10/2026. Đây là bằng chứng về code, không phải xác nhận provider thật đã chạy đạt. Trước khi triển khai, đọc lại các thành phần bị thay đổi; giữ nguyên công việc khác đang có trong workspace.

| Thành phần                                                                                                                                                                      | Phiên bản hoặc vai trò đã đối chiếu                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [script-draft-prompt.ts](./src/server/script-studio/notebooklm/prompts/script-draft-prompt.ts)                                                                                  | `notebooklm-script-draft-v7`: bài học, góc kể, nhịp đọc, ngân sách và định dạng câu hỏi. |
| [chat-persona-prompt.ts](./src/server/script-studio/notebooklm/prompts/chat-persona-prompt.ts)                                                                                  | `notebooklm-chat-persona-v3`: quy tắc cố định, gồm quy tắc nguồn và `STORYTELLING_RULE`. |
| [storytelling-rule.ts](./src/server/ai/prompts/storytelling-rule.ts)                                                                                                            | `STORYTELLING_RULE`, `STORY_REWRITE_RULE`, `SCENE_EDIT_RULE` và `storyAngleRule`.        |
| [scene-plan-prompt.ts](./src/server/ai/prompts/scene-plan-prompt.ts)                                                                                                            | `scene-plan-v9`: compiler trong luồng hàng loạt.                                         |
| [video-script-prompt.ts](./src/server/ai/prompts/video-script-prompt.ts)                                                                                                        | `video-script-v10`: viết kịch bản và viết lại cảnh trong luồng thủ công.                 |
| [shot-rule.ts](./src/server/ai/prompts/shot-rule.ts)                                                                                                                            | Hợp đồng shot đang có; giữ `illustration`, `shots`, `publish` và quy tắc chữ nguồn.      |
| [script-studio-contracts.ts](./src/server/script-studio/script-studio-contracts.ts)                                                                                             | Schema trích đoạn, draft, thời lượng và thứ tự nhịp kể.                                  |
| [notebooklm-script-studio.ts](./src/features/notebooklm/services/notebooklm-script-studio.ts)                                                                                   | `draftAnswerSchema`, `writeDraft`, kết hợp phiên bản draft/persona cho cache.            |
| [narrative-beats.ts](./src/features/videos/domain/narrative-beats.ts), [duration.ts](./src/features/videos/domain/duration.ts), [pace.ts](./src/features/videos/domain/pace.ts) | Thứ tự bắt buộc, preset thời lượng và nhịp đọc do người dùng chọn.                       |
| [production-pipeline.service.ts](./src/features/productions/services/production-pipeline.service.ts), [ai-correction.ts](./src/features/productions/domain/ai-correction.ts)    | Checkpoint, tiến trình sản xuất và một lượt sửa AI chung.                                |
| [readiness.ts](./src/features/videos/domain/readiness.ts), [source-guard.ts](./src/server/scene-plan/source-guard.ts)                                                           | Kiểm tra sau TTS và lớp kiểm tra cơ học số/câu trích dẫn, gồm chữ trên shot.             |

Dùng tên thành phần và đoạn quy tắc để định vị; không dựa vào số dòng của bản prompt cũ. Chưa kiểm chứng chất lượng bằng một lượt chạy NotebookLM/Claude/TTS thật trong lần chỉnh tài liệu này.

### C01 — Trang draft chưa biết nhưng được gán là 1

**Định vị:** `CHAT_PERSONA_PROMPT`, đoạn `page ... (không có thì 1)`; `sourceExcerptSchema`; `ScriptSourcePanel` hiển thị `Trang {page}`.

**Phân loại:** Lỗi tham chiếu draft đã xác nhận. **Đợt 1, ưu tiên cao.**

Draft hiện qua schema, khoảng thời lượng và thứ tự, chưa xác minh trang bằng cách tìm lại trích đoạn trong canonical text. Phân tích bài học đã có bước tìm trích đoạn và suy ra vị trí; không suy từ C01 rằng dữ liệu `LessonSource` đã xác minh cũng bị gán trang 1.

Cho trích đoạn **draft** biểu diễn trang chưa xác định và hiển thị rõ “Chưa xác định trang”. Giữ vị trí có thật; không dựng locator thay thế. Không làm nullable kiểu trang dùng cho bắt đầu/kết thúc chương hoặc nới hợp đồng phân tích bài học chỉ để sửa draft. Thiếu vị trí và chưa xác minh nội dung là hai trạng thái khác nhau.

**Nghiệm thu:** Draft thiếu trang không bị gán 1; trang có thật giữ nguyên; UI xử lý được cả hai. Artifact cũ có số trang vẫn đọc được và không bị thay nội dung/fingerprint do mặc định mới. Không sửa migration đã áp dụng hoặc ghi lại dữ liệu cũ hàng loạt.

### C02 — Ngân sách draft và compiler khác nhau

**Định vị:** `wordsPerSecond` trong draft nhân `0.9`; `buildScenePlanPrompt` dùng `syllablesPerSecond` đầy đủ.

**Phân loại:** Chênh lệch đã xác nhận, chưa chứng minh tác động thực tế tới chất lượng hoặc audio. **Đợt 1, ưu tiên cao.**

Ở nhịp Chuẩn, mục tiêu 90 giây cho khoảng 324 đơn vị ở draft và 360 ở compiler, chênh khoảng 11,1%. Hệ số 0,9 có thể là dự phòng; không kết luận nó sai hoặc bỏ nó để đồng nhất.

Dùng chính sách ngân sách tương thích cho hai bước, có dự phòng và cách tính đệm rõ; compiler không thêm lời để lấp chênh lệch. Giữ estimator và readiness thực tế làm hai lớp riêng. Với mục tiêu sát tối thiểu, chính sách phải kiểm tra nguy cơ thiếu thời lượng thay vì hứa rằng ngân sách bảo thủ luôn đạt khoảng.

**Nghiệm thu:** Cùng nhịp/khoảng cho chỉ dẫn tương thích; không tính tốc độ hoặc đệm hai lần. Kiểm tra mục tiêu 60/90, nhịp Chuẩn/Nhanh, ít/nhiều cảnh; audio mới quyết định thành phẩm có trong khoảng. Giữ một lượt sửa và xử lý `UNDER_MIN`/quá dài hiện có.

### C03 — Phát triển truyện và biên tập thành cảnh là hai vai trò

**Định vị:** `SCENE_EDIT_RULE`; `buildScenePlanPrompt` yêu cầu “Bạn chỉ biên tập lời dẫn”; pipeline chuyển từ `DRAFTED` sang compile.

**Phân loại:** Giới hạn thiết kế hiện tại, chưa phải lỗi compiler. **Đợt 1 nâng draft; bước phát triển riêng hoãn sang đợt 2.**

Đợt 1 cải thiện động cơ, lựa chọn và nhân quả tại nơi viết draft, giữ compiler bảo toàn câu chuyện. Không thêm lượt gọi hoặc mở quyền sáng tác mới tại compiler.

Nếu đợt 2 có bước phát triển riêng, phải giữ draft gốc và lưu bản truyện phát triển có phiên bản/fingerprint để compiler dùng đúng bản, kể cả sau sự cố. Bản mới không tự xác minh các khẳng định nó chứa. Nguồn của nguyên lý và dữ kiện vẫn phải truy về nguồn gốc; chất liệu minh họa phải phân biệt rõ. Cache, claim, checkpoint và lượt sửa phải có đặc tả trước khi triển khai.

**Nghiệm thu đợt 1:** Bộ so sánh cho thấy động cơ và cơ chế được thể hiện rõ hơn trong draft, không chỉ đổi từ; luồng gọi AI và checkpoint không tăng.

### C04 — Giữ sáu phần, nâng cách triển khai

**Định vị:** `NARRATIVE_BEATS`, `findNarrativeOrderProblem`, `findStorySceneOrderProblem` và `storyAngleRule`.

**Phân loại:** Ràng buộc domain đã có chủ đích. **Đợt 1 giữ; nới cấu trúc hoãn sang đợt 2.**

Giữ thứ tự hook → tình huống → sai lầm → bài học → giải quyết → hành động, mỗi loại ít nhất một lần. Một phần có thể có nhiều cảnh; một cảnh có thể có nhiều shot. Không đồng nhất khung này với sáu cảnh rời rạc hoặc một đoạn dừng dài để giảng bài.

Làm sáu góc kể khác nhau bằng diễn biến, động cơ và lựa chọn. Không sửa enum, validator hay đầu ra để thử một cấu trúc mới trong đợt 1.

**Nghiệm thu:** Sáu góc kể giữ hợp đồng hiện có; phần bài học gọn nhưng giải thích được sự thay đổi. Ví dụ biên tập không bị dùng như JSON làm thiếu hoặc đảo loại cảnh.

### C05 — Đổi trọng tâm hướng dẫn “trên 60 giây”

**Định vị:** Persona phần bản thảo và compiler, đoạn “tình huống chi tiết hơn, nhiều bước hành động hơn”.

**Phân loại:** Cải tiến chỉ dẫn biên tập. **Đợt 1.**

Bản dài hơn cần làm rõ sức hấp dẫn của lựa chọn cũ, hệ quả, cơ chế và bằng chứng thay đổi. Nhiều cảnh, nhiều ngày thất bại hoặc nhiều bước áp dụng không tự tạo chiều sâu. Khoảng 8–15 giây/cảnh chỉ là tham khảo; không kéo dài một cảnh đã hết ý.

**Nghiệm thu:** Mỗi phần thêm có đóng góp cụ thể; bản dài không chỉ lặp ý hoặc kéo dài cảm xúc. Giữ giới hạn câu hỏi/persona và định dạng đầu ra.

### C06 — Tách mục tiêu mềm khỏi giới hạn sản phẩm

**Định vị:** Các chỉ dẫn `targetDurationSec`, lượng lời “không dưới”; `assessReadiness` đưa `UNDER_MIN` vào lỗi chặn.

**Phân loại:** Chính sách thời lượng hiện tại và yêu cầu biên tập cần thống nhất. **Đợt 1 giữ hợp đồng, thử phạm vi 60–90 giây.**

75–85 giây là ưu tiên đo được; 82 chỉ là ví dụ. Không thêm preset mới, không biến 75 thành hard-min, không đổi giới hạn toàn sản phẩm. Video 65–72 giây trong khoảng vẫn được chấp nhận; dưới 60 không tự được miễn readiness vì câu chuyện trọn vẹn.

Tránh yêu cầu vừa kể đúng một lượng chữ tối thiểu vừa cấm thêm ý. Prompt hướng tới câu chuyện đủ ý và ngân sách có dự phòng; runtime giữ khoảng đo được và lượt sửa hiện có, không tự nhồi chữ hoặc nới khoảng.

**Nghiệm thu:** Tách rõ đề xuất, ước lượng và phép đo. Không tự kéo dài bản trong khoảng chỉ để đạt 75 giây; thiếu/quá khoảng vẫn theo cơ chế hiện có.

### C07 — Bảo toàn thoại và dữ kiện theo giai đoạn

**Định vị:** `STORY_REWRITE_RULE`, `SCENE_EDIT_RULE`, `findUnsupportedClaims`.

**Phân loại:** Quy tắc bảo toàn đúng với compiler hiện tại. **Đợt 1 giữ lớp bảo vệ; mở quyền sửa chất liệu hư cấu thuộc đợt 2.**

Thoại minh họa mới, dù hợp lý, vẫn có thể bị chặn vì không có trong draft/bài học. Không xóa ngoặc kép hoặc tắt source guard để lách; kể gián tiếp không làm một khẳng định sai trở thành đúng. Không miễn toàn bộ nhịp `illustrative` khỏi kiểm tra: nó vẫn có thể chứa một khẳng định về sách.

Nếu có bản truyện phát triển ở đợt 2, kiểm tra bảo toàn của compiler dùng bản đó, còn khẳng định về sách đối chiếu nguồn gốc. Phải có ca thoại minh họa mới hợp lệ và ca trích dẫn gán cho tác giả bị bịa; không mô tả kiểm tra cơ học như đã chứng minh đúng về ý nghĩa.

**Nghiệm thu đợt 1:** Số/câu trích dẫn không có căn cứ tiếp tục bị chặn trong lời dẫn và chữ trên shot; nhãn minh họa được giữ. Chưa mở quyền tạo thoại mới ở compiler.

### 8.2. Thứ tự thực hiện đợt 1

1. Chụp baseline và đọc lại các thành phần ở §8.1; giữ nguyên code, dữ liệu và thay đổi khác ngoài phạm vi. Lưu phiên bản và artifact của mẫu cũ trước khi sửa prompt.
2. Sửa C01 từ hợp đồng draft qua parse/artifact/DTO tới UI và fake/test liên quan; giữ khả năng đọc artifact cũ và hợp đồng trang chương.
3. Sửa quy tắc kể chuyện dùng chung, persona, các góc kể và chỉ dẫn C05 theo §2–§4. Đồng bộ luồng thủ công; giữ thứ tự, `illustration`, `shots`, `publish` và kiểm tra nguồn.
4. Thống nhất ngân sách draft/compiler theo C02/C06, giữ pace, preset, timing và xử lý lỗi hiện có. Không lấy công thức chia tốc độ làm bằng chứng thay phép đo.
5. Tăng mọi phiên bản prompt bị ảnh hưởng trước khi chạy bản mới. Sửa `STORYTELLING_RULE` ảnh hưởng persona và video script; sửa persona cũng thay danh tính draft cache. Sửa `SCENE_EDIT_RULE` ảnh hưởng scene plan; các rule dùng chung khác phải tìm đủ nơi sử dụng. Không bump prompt phân tích chương/bài học để sửa cách kể.
6. Chạy kiểm tra kỹ thuật (§8.3), rồi so sánh 12 mẫu (§10). Báo cáo riêng kết quả offline, provider thật và nghe/xem thủ công; không coi test xanh là bằng chứng câu chuyện hay hơn.

Giữ phiên bản/fingerprint trong danh tính cache hiện có. Không xóa cache cũ hoặc sửa artifact cũ để ép chạy; không để bản mới vô tình dùng lại đầu ra baseline.

### 8.3. Kiểm tra kỹ thuật khi triển khai code

- Hợp đồng draft: trang có/không biết, không gán 1, artifact cũ còn đọc được; phân tích chương vẫn đòi vị trí hợp lệ. UI không trình bày trang chưa biết như đã xác minh.
- Prompt: giới hạn 700 từ/câu hỏi và 10.000 ký tự/persona, kể cả bài học dài, sáu góc kể và lượt sửa; phiên bản/cache thay theo đúng rule đã sửa.
- Ngân sách: hai bước tương thích ở cùng nhịp/khoảng, giữ dự phòng, không nhân tốc độ hay tính đệm hai lần; thử sát min/max, nhiều cảnh và audio vượt/thiếu ước lượng.
- Luồng: giữ hợp đồng sáu phần, đầu ra `illustration`/`shots`/`publish`, nguồn của chữ trên shot, một lượt sửa, dừng lỗi và phục hồi không tạo thêm video/audio/render ngoài cơ chế hiện có.

Quality gate bắt buộc khi triển khai code:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Đợt 1 chạm luồng worker nên cần E2E. Tests dùng fake/offline, không gọi tài khoản cá nhân. Lượt cập nhật **chỉ tài liệu** kiểm tra Markdown, liên kết local và tính nhất quán; không dùng kiểm tra đó thay quality gate của lần sửa code sau này.

### 8.4. Đợt 2 — Hướng phát triển hoãn lại

| Hạng mục                       | Cần chốt trong đặc tả riêng trước khi triển khai                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude phát triển truyện riêng | Đầu vào nguồn, quyền sửa, artifact trung gian bất biến, phiên bản/fingerprint, cache, checkpoint/claim, resume và ngân sách gọi/sửa. Không ghi đè draft NotebookLM. |
| Brief đầu ra có cấu trúc       | Những trường thực sự cần, schema trả lời/draft/artifact/compiler và tương thích bản cũ. Hiện thêm trường vào prompt thôi có thể bị loại khi parse.                  |
| Phản biện tự động trước TTS    | Tiêu chí, căn cứ theo đoạn, xử lý kết quả không chắc chắn, số lượt gọi/sửa và điều kiện dừng; không thay kiểm tra kỹ thuật sau TTS.                                 |
| Nới thứ tự sáu phần            | Dữ liệu mẫu chứng minh nhu cầu, thay đổi domain/schema/validator/renderer cần thiết và cách đọc artifact cũ.                                                        |
| Profile +10%                   | Tốc độ, đệm, hình ảnh, ngân sách, cache, UI và timing đồng bộ.                                                                                                      |
| Chờ người duyệt                | Trạng thái item/batch, hành động duyệt/tiếp tục, giữ hoặc làm cũ artifact và điều kiện retry/resume; chỉ ngoại lệ, không biến mọi video thành duyệt tay.            |

Chỉ xem xét đợt 2 sau khi có kết quả đợt 1 và xác định vấn đề còn lại. Bảng này không phải yêu cầu thực thi trong đợt 1; chưa chọn kiến trúc hoặc ngân sách mới.

## 9. Yêu cầu giao Codex triển khai đợt 1

> Cải thiện chất lượng kịch bản trong pipeline hiện có theo đợt 1 của tài liệu này. Trước khi sửa, đối chiếu lại các thành phần ở §8.1 và bảo toàn công việc khác trong workspace.
>
> Giữ NotebookLM viết draft dựa trên nguồn, Claude biên tập thành cảnh. Sửa quy tắc để cách làm cũ có lý do, hệ quả có quan hệ nhân quả, nguyên lý tạo lựa chọn mới và kết quả nhỏ đáng tin. Giữ sáu góc kể cùng sáu phần đúng thứ tự; không ép bi kịch hoặc cú đảo chiều thiếu căn cứ. Áp dụng nhất quán quy tắc dùng chung cho luồng thủ công.
>
> Sửa C01 trong tham chiếu draft: trang chưa biết không được gán 1; cập nhật schema, parse/artifact/DTO, UI và test liên quan, giữ artifact cũ và kiểu trang chương. Không coi một trích đoạn có trang là đã được xác minh về ý nghĩa.
>
> Thống nhất ngân sách giữa NotebookLM và compiler, giữ dự phòng cho audio/đệm và xử lý sát tối thiểu; không bỏ hệ số dự phòng chỉ để bằng nhau. Dùng khoảng 60–90 giây cho bộ thử, ưu tiên thành phẩm 75–85 giây; 82 là ví dụ, không phải giá trị `targetDurationSec` mới. Không đổi preset, mặc định toàn sản phẩm, video cũ hoặc tự thay khoảng người dùng chọn.
>
> Thử Chuẩn và Nhanh +15% thành nhóm riêng, giữ nhịp giữa mỗi cặp trước/sau. Không thêm +10%, tầng tăng tốc hậu kỳ, lượt gọi AI, brief, cổng phản biện, checkpoint hoặc trạng thái mới. Giữ source guard, nhãn minh họa, `illustration`, `shots`, `publish` và kiểm tra nguồn của chữ trên shot. Không mở quyền tạo thoại mới cho compiler hoặc xóa ngoặc để lách kiểm tra.
>
> Giữ một lượt sửa AI chung cho mỗi production item, cơ chế chờ quota/retry hạ tầng và kiểm tra sau TTS. Hết lượt mà vẫn không đạt thì dừng lỗi rõ ràng, giữ artifact; không render tiếp hoặc tự đổi nhịp/nới khoảng. Checklist biên tập là đánh giá bộ mẫu, chưa phải cổng tự động phát hiện mọi lỗi nhân quả.
>
> Bump mọi phiên bản prompt bị ảnh hưởng và giữ baseline trước khi so sánh. Không bump prompt phân tích chương/bài học, không phân tích lại sách để sửa cách kể. Chạy quality gate ở §8.3 và bộ 12 mẫu ở §10. Báo cáo đã đổi gì, kiểm tra nào đã thực hiện, số lượt sửa/gọi và phần chưa xác minh. Các mục đợt 2 chỉ được đặc tả riêng sau kết quả đợt 1.

## 10. Đánh giá sau khi triển khai

### 10.1. Bộ 12 mẫu cố định

Chọn và chốt snapshot bài học cùng trích đoạn trước khi viết prompt mới; không dùng nhãn lỗi dưới đây làm bằng chứng rằng output hiện tại chắc chắn mắc lỗi đó. Mỗi góc kể có hai mẫu. Trường hợp nguồn mỏng vẫn giữ min 60; một kết quả dừng đúng vì không đủ nội dung có căn cứ có thể đạt kiểm tra an toàn, nhưng không tính là video chất lượng đã hoàn tất.

| Mẫu | Góc kể     | Tình huống cần kiểm tra                                                                           |
| --- | ---------- | ------------------------------------------------------------------------------------------------- |
| G01 | PEAK_FIRST | Đủ cấu trúc nhưng thiếu lý do khiến cách làm cũ hấp dẫn.                                          |
| G02 | DIALOGUE   | Có cảm xúc/thoại nhưng nguyên lý chưa giải thích được lựa chọn mới.                               |
| G03 | TWO_PATHS  | Câu chuyện tốt nhưng dài; rút gọn mà giữ được cơ chế và hai lối rẽ.                               |
| G04 | MYTH_BUST  | Trích đoạn có thật nhưng không xác định được trang; không tự điền 1.                              |
| G05 | TWIST      | Người hoặc sự kiện có thật; không thêm thoại, ý nghĩ hay kết quả rồi gán cho nguồn.               |
| G06 | ESCALATION | Nguồn mỏng; không thêm ngày thất bại hoặc dữ kiện bịa để đạt tối thiểu.                           |
| G07 | PEAK_FIRST | Hook dễ quá dài; kiểm tra bốn giây thực tế và giải đáp lời hứa.                                   |
| G08 | DIALOGUE   | Thoại minh họa trong draft; compiler giữ đúng và giữ nhãn, không đổi thành lời tác giả.           |
| G09 | TWO_PATHS  | Nguyên lý có điều kiện áp dụng; giữ điều kiện, không hứa kết quả phổ quát.                        |
| G10 | MYTH_BUST  | Số, tên riêng hoặc nguồn tiếng Anh; lời dẫn Việt tự nhiên, trích đoạn nguyên văn, timing được đo. |
| G11 | TWIST      | Mục tiêu sát min 60 giây; kiểm tra dự phòng, đệm và xử lý UNDER_MIN theo audio.                   |
| G12 | ESCALATION | Chữ trên props/tag/card và bộ đăng tải; giữ hợp đồng và nguồn, không chỉ kiểm tra narration.      |

### 10.2. Cách so sánh và lưu bằng chứng

Mỗi mẫu có bản cũ và bản mới cùng bài học, nguồn, góc kể, khoảng, pace, model và effort. Lưu phiên bản prompt/persona, fingerprint hoặc task/artifact ID, lời dẫn, kết quả kiểm tra, số lượt gọi/sửa, thời lượng và lý do dừng. Không đổi shot rule hoặc phong cách renderer đồng thời để quy kết quả cho kịch bản.

Chạy nhóm Chuẩn trước. Khi thử Nhanh +15%, dùng cùng nhịp cho cả bản cũ/mới; thay pace là một phép thử riêng. Không đưa bản nhịp Chuẩn so với bản Nhanh rồi kết luận riêng về prompt.

Tăng phiên bản liên quan để bản mới đi qua danh tính cache mới; giữ artifact baseline, không xóa cache để giả lập thay đổi. Output cũ có sẵn chỉ là baseline dùng được khi xác nhận cùng đầu vào và cấu hình. Thiếu baseline hoặc chưa có lượt chạy thật phải ghi rõ, không dùng fake làm bằng chứng chất lượng provider thật.

Người đánh giá đối chiếu trích đoạn nguồn rồi đọc/nghe từng cặp, ưu tiên không biết bản nào cũ/mới. Chọn bản tốt hơn hoặc ngang nhau, ghi câu/đoạn làm rõ động cơ, hệ quả, cơ chế, kết và độ tự nhiên; chỉ ra cả lỗi mới phát sinh. Có thể dùng nhận xét LLM để hỗ trợ, không lấy điểm tự chấm làm tiêu chí thông qua.

### 10.3. Điều kiện kết luận

- Kiểm tra kỹ thuật phải đạt quality gate; mẫu có vấn đề nguồn, bỏ điều kiện quan trọng, nhãn sai hoặc vi phạm hợp đồng chưa được coi là đạt dù lời văn hay hơn.
- Audio/video hoàn tất của đợt thử phải nằm trong 60–90 giây theo phép đo, hook không quá bốn giây. Ưu tiên 75–85 không được dùng để loại một video 65–72 giây trọn vẹn.
- Để kết luận đợt 1 cải thiện trên bộ mẫu: ít nhất 8/12 mẫu được người đánh giá chọn bản mới tốt hơn với lý do cụ thể, trong đó có tiến bộ về động cơ hoặc nhân quả, và không còn lỗi nguồn nghiêm trọng chưa xử lý. Mẫu chưa chạy, thất bại hoặc chỉ đạt kiểm tra an toàn không tính vào 8 mẫu tốt hơn; đây chưa phải bằng chứng hiệu quả khán giả.
- Báo cáo riêng tỷ lệ dừng, số lượt sửa/gọi, thời lượng và lỗi; nếu chưa đạt thì nêu vấn đề còn lại, không tự mở rộng sang đợt 2. Chưa có người nghe hoặc output thật thì chỉ kết luận đã đạt phần kỹ thuật tương ứng.

Khi có dữ liệu đăng thực tế, theo dõi giữ người xem đoạn đầu, thời lượng xem trung bình, tỷ lệ xem hết, điểm rời, phản hồi, lượt lưu/chia sẻ khi có. So sánh cùng nền tảng và nội dung tương đồng; thời lượng khác nhau phải được xét tới. Không đổi đồng thời hook, góc kể, nhịp đọc và phong cách dựng rồi quy kết quả cho một yếu tố.

---

**Nguyên tắc chốt:** Người xem cần hiểu vì sao lựa chọn cũ từng hấp dẫn, điều gì làm nó bộc lộ giới hạn và lựa chọn mới khác ở đâu. Bảo vệ ba điểm đó trong nguồn và hợp đồng hiện có trước khi thêm lời, thêm cảnh hoặc thêm bước sản xuất.
