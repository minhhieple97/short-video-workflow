import { STORY_ANGLE_LABELS, type StoryAngle } from "@/features/videos/domain/story-angle";

// The craft every prompt that writes a story shares (the manual script and NotebookLM's draft). Changing it means bumping
// the versions of both. The characters, places and lines it asks for are made up for the video, so they are illustrative.
export const STORYTELLING_RULE = [
  "## Nghề kể chuyện",
  "- Hook: mở giữa một khoảnh khắc cụ thể (một hành động, một câu thoại, một chi tiết lạ), để lửng điều chưa giải thích; lời hứa ấy được trả ở phần cách giải quyết. Không mở bằng khuôn “Có phải bạn…”, “Bạn có biết…”, “Tại sao bạn luôn…”, “Hãy tưởng tượng…”.",
  "- Cụ thể, không tóm tắt: nhân vật có tên (đừng dùng mãi Lan, Minh, Hoa) hoặc “bạn”, một nơi, một lúc, một vật nhìn thấy được. Kể bằng việc nhân vật làm, không bằng tính từ (không “cô nản lòng”, mà “cô đóng laptop, không mở lại”).",
  "- Sai lầm có cái giá (thời gian, tiền, một mối quan hệ, sự tự tin) thể hiện bằng một chi tiết nhìn thấy được, không bịa số liệu.",
  "- Mỗi cảnh đẩy truyện đi tiếp bằng một sự thật mới, một cú đảo chiều hoặc một cái giá; hai cảnh liền nhau không nói cùng một ý. Trước bài học có một khoảnh khắc “tưởng là A, hoá ra là B”.",
  "- Thoại: tối đa một hai câu ngắn mỗi cảnh, trong “ngoặc kép”, chỉ của nhân vật tự nghĩ ra; lời tác giả hay người có thật chỉ được nhắc khi là câu nguyên văn trong nguồn.",
  "- Viết để đọc thành tiếng: câu ngắn (phần lớn dưới 14 từ) xen một câu rất ngắn để nhấn, lời nói tự nhiên (“thế mà”, “vậy mà”), chữ đắt nhất ở cuối câu.",
  "- Bài học là điều vừa nhìn ra, không phải bài giảng: một hai câu, bằng ý của sách, vì sao chuyện vừa rồi xảy ra; đừng mở bằng “Cuốn sách … dạy rằng”.",
  "- Cách giải quyết chiếu lại đúng khoảnh khắc mở đầu, lần này nhân vật làm khác và kết quả khác, thấy được bằng một chi tiết. Hành động là một việc làm được trong vài phút, đủ cụ thể để hình dung (làm gì, lúc nào, ở đâu), kết bằng một câu ngắn dễ nhớ.",
  "- Trung thực: nhân vật, nơi chốn, câu thoại tự nghĩ ra là tình huống minh hoạ; không gắn chúng cho tác giả hay cuốn sách, không nói đó là chuyện có thật, không kể ngôi “tôi” như trải nghiệm của người làm video, không bịa số liệu, nghiên cứu hay trích dẫn. Chuyện có thật trong sách: giữ đúng sự kiện và tên người, chỉ đổi thứ tự kể và nhịp câu.",
].join("\n");

const STORY_ANGLE_BRIEFS: Record<StoryAngle, string> = {
  PEAK_FIRST:
    "Hook là khoảnh khắc tệ nhất hoặc lạ nhất của câu chuyện, nói thẳng như một cảnh phim và chưa giải thích (kiểu sai lầm hoặc tương phản). Tình huống lùi lại (“Mọi chuyện bắt đầu từ…”) và kể ngắn dẫn tới khoảnh khắc đó. Sai lầm là bước đẩy thẳng tới đỉnh điểm. Cách giải quyết quay về đúng khoảnh khắc mở đầu và cho nó một kết cục khác.",
  DIALOGUE:
    "Truyện đi qua lời nói của hai người. Hook là một câu thoại gai góc của nhân vật. Tình huống là cuộc trò chuyện hai đến bốn lượt thoại ngắn, lộ ra niềm tin sai. Sai lầm là câu đáp hoặc việc làm theo sau. Cách giải quyết cho cuộc trò chuyện ấy diễn ra lại, đổi đúng một câu thoại và kết quả đổi theo.",
  TWO_PATHS:
    "Hai người (hoặc một người ở hai ngã rẽ), cùng một tình huống, cùng xuất phát, hai kết cục. Hook nêu sự đối lập (kiểu tương phản). Tình huống giới thiệu cả hai; sai lầm là lối rẽ của người thứ nhất và cái giá của nó; bài học là điểm khác biệt duy nhất; cách giải quyết là lối rẽ còn lại, chiếu lại đúng tình huống mở đầu; hành động là việc làm đầu tiên của lối rẽ đúng.",
  MYTH_BUST:
    "Hook nói thẳng một niềm tin quen thuộc, nghe rất hợp lý, rồi để lộ vết nứt (kiểu sai lầm). Tình huống cho thấy ai đó sống theo niềm tin ấy và trông như đi đúng hướng; sai lầm là nơi niềm tin ấy dẫn họ tới; bài học nói vì sao nó sai, bằng ý của sách; cách giải quyết làm ngược lại trong cùng tình huống. Niềm tin chỉ là nhận định phổ biến, không gắn cho “nghiên cứu cho thấy”.",
  TWIST:
    "Hook mở bằng một thành công hay niềm vui trông trọn vẹn rồi một chữ “nhưng” (kiểu tương phản). Tình huống tả mọi thứ đang tốt; sai lầm là điều tưởng là điểm mạnh nhưng thực ra chính là thứ làm mọi chuyện đổ vỡ; bài học giải thích vì sao; cách giải quyết làm lại đúng chỗ đó.",
  ESCALATION:
    "Truyện là một chuỗi mốc ngắn (các ngày trong tuần, các lần thử), mỗi mốc tệ hơn mốc trước. Hook nén cả chuỗi vào một câu có mốc đầu và mốc cuối. Tình huống và sai lầm là các mốc leo thang; bài học là điểm gãy; cách giải quyết chạy lại đúng chuỗi mốc ấy theo chiều đi lên.",
};

export function storyAngleRule(angle: StoryAngle): string {
  return `- Góc kể được giao cho video này: “${STORY_ANGLE_LABELS[angle]}”. ${STORY_ANGLE_BRIEFS[angle]} Vẫn đủ sáu phần theo đúng thứ tự và mọi quy tắc khác; góc kể chỉ quyết định cách kể, không cho thêm ý ngoài nguồn.`;
}

export const STORY_REWRITE_RULE =
  "- Viết lại cho hay hơn chứ không chỉ đổi chữ: cụ thể thay vì tóm tắt, câu ngắn, chữ đắt nhất ở cuối câu; giữ nhân vật, tên và câu thoại đã có trong cảnh và các cảnh khác; không mở bằng khuôn “Có phải bạn…”, “Bạn có biết…”.";

// For the scene-plan compiler, which only edits a draft that already holds the story: it keeps the draft's life and may not
// add facts, so a quotation or a number it keeps must read exactly as the source check will compare it.
export const SCENE_EDIT_RULE = [
  "- Biên tập như người dựng một video kể chuyện: giữ, và làm sắc hơn, sức hút của bản thảo. Giữ nhân vật, tên, nơi chốn, chi tiết nhìn thấy được và các cú đảo chiều; đừng làm phẳng chúng thành câu tóm tắt. Tách câu dài thành câu ngắn, đừng gộp câu ngắn thành câu dài.",
  "- Câu thoại trong “ngoặc kép” giữ đúng từng chữ như bản thảo (muốn đổi lời thì bỏ ngoặc kép và kể gián tiếp). Số giữ đúng dạng như bản thảo: bản thảo viết “ba ngày” thì không đổi thành “3 ngày”.",
  "- Hook là khoảnh khắc đắt nhất của bản thảo, nói thẳng và cụ thể. Nếu hook của bản thảo là câu hỏi chung chung (“Có phải bạn…”, “Bạn có biết…”, “Tại sao bạn luôn…”), thay bằng khoảnh khắc cụ thể lấy từ chính tình huống bản thảo đã kể, không thêm sự kiện mới.",
  "- onScreenText là cụm đắt nhất của cảnh (một vế gây tò mò, một chi tiết), không chép lại nguyên lời dẫn.",
].join("\n");
