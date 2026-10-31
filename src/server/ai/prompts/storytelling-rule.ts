import { STORY_ANGLE_LABELS, STORY_ANGLES, type StoryAngle } from "@/features/videos/domain/story-angle";

// The craft every prompt that writes a story shares (the manual script and NotebookLM's draft). Changing it means bumping
// the versions of both. The characters, places and lines it asks for are made up for the video, so they are illustrative.
export const STORYTELLING_RULE = [
  "## Nghề kể chuyện",
  "- Hook: mở giữa một khoảnh khắc cụ thể, để lửng một câu hỏi trung tâm; lời hứa ấy được trả ở phần cách giải quyết. Không mở bằng khuôn “Có phải bạn…”, “Bạn có biết…”, “Tại sao bạn luôn…”, “Hãy tưởng tượng…”.",
  "- Nhân vật muốn gì và vì sao? Cách làm cũ từng hợp lý vì một lợi ích hay điều họ muốn bảo vệ. Không làm nhân vật ngây ngô để bài học trông thông minh.",
  "- Kể bằng hành động, không bằng tính từ: nhân vật có tên hoặc “bạn”, một chi tiết nhìn thấy được. Sai lầm có cái giá do chính lựa chọn gây ra, tương xứng với vấn đề; không ép nhân vật chạm đáy.",
  "- Mỗi nhịp đổi thông tin, lựa chọn hoặc hệ quả; hai cảnh liền không lặp ý. Một chi tiết có thể được hiểu lại kiểu “tưởng là A, hoá ra là B”, không ép cú đảo chiều khi nguồn không hỗ trợ.",
  "- Thoại: một hai câu ngắn trong “ngoặc kép”, chỉ của nhân vật tự nghĩ ra; lời tác giả hay người có thật chỉ được nhắc khi là câu nguyên văn trong nguồn.",
  "- Viết để đọc thành tiếng: câu dài ngắn đan xen, tiếng Việt tự nhiên; không cắt mọi câu thành mảnh cụt. Chữ nhấn bổ trợ lời dẫn, không giảng lại cùng một ý.",
  "- Bài học giải thích vì sao lựa chọn cũ tạo hệ quả và nguyên lý giúp làm khác ở đâu; giữ điều kiện, giới hạn của nguồn. Nếu thay bằng “hãy cố gắng hơn” mà câu chuyện vẫn đúng, cơ chế còn thiếu. Đừng mở bằng “Cuốn sách … dạy rằng”.",
  "- Cách giải quyết quay lại tình huống mở đầu, cho thấy lựa chọn mới và kết quả nhỏ quan sát được; nói rõ là lần sau hay hai phương án giả định. ACTION là một việc cụ thể làm được ngay, không thêm châm ngôn hay lời kêu gọi lặp ý.",
  "- Trung thực: nhân vật, nơi chốn, câu thoại tự nghĩ ra là tình huống minh hoạ; không gắn chúng cho tác giả hay cuốn sách, không nói đó là chuyện có thật, không kể ngôi “tôi” như trải nghiệm của người làm video, không bịa số liệu, nghiên cứu hay trích dẫn. Minh hoạ không chứng minh nguyên lý; chuyện thật giữ đúng sự kiện và tên người.",
].join("\n");

export const STORY_ANGLE_BRIEFS: Record<StoryAngle, string> = {
  PEAK_FIRST:
    "Hook là khoảnh khắc có hệ quả rõ nhất hoặc lạ nhất, chưa giải thích. Tình huống lùi lại kể điều nhân vật muốn và vì sao cách làm cũ có vẻ đúng. Sai lầm dẫn tới khoảnh khắc mở đầu, không thêm bi kịch. Cách giải quyết cho thấy lần sau nhân vật chọn khác ở đúng chỗ đó và kết quả nhỏ đổi theo.",
  DIALOGUE:
    "Hook là câu thoại bộc lộ một niềm tin hợp lý của nhân vật. Tình huống là vài lượt trao đổi ngắn làm rõ động cơ. Sai lầm là lựa chọn theo niềm tin ấy và hệ quả, không chỉ là cãi nhau. Cách giải quyết ở cuộc trò chuyện lần sau cho thấy nhân vật đổi một quyết định nhờ nguyên lý; không cần lặp cả cuộc thoại.",
  TWO_PATHS:
    "Hook mở hai lựa chọn và kết quả đối lập trong cùng tình huống. Báo hiệu rõ là hai phương án giả định hoặc hai người. Sai lầm là lối rẽ đầu có lợi trước mắt nhưng có cái giá; bài học giải thích điểm khác biệt. Cách giải quyết là lựa chọn còn lại và kết quả tương xứng, không dùng ví dụ hư cấu như phép thử chứng minh nguyên lý.",
  MYTH_BUST:
    "Hook mở một niềm tin có vẻ hợp lý của nhân vật, không khẳng định ai cũng tin như thế. Tình huống cho thấy lợi ích khiến họ giữ nó; sai lầm là lựa chọn và hệ quả làm lộ giới hạn. Bài học giải thích bằng ý của nguồn, không gắn cho “nghiên cứu cho thấy”. Cách giải quyết điều chỉnh lựa chọn trong cùng tình huống, không ép nguyên lý thành chân lý trái trực giác.",
  TWIST:
    "Hook cho thấy một điều tưởng có lợi nhưng có giới hạn chưa được giải thích. Tình huống dựng lý do nhân vật dựa vào nó; sai lầm cho thấy cái giá phát sinh từ chính lựa chọn ấy. Bài học giúp hiểu lại chi tiết đã có, không thêm biến cố bất ngờ vô cớ. Cách giải quyết cho thấy lần sau nhân vật đổi lựa chọn nào và quan sát được điều gì.",
  ESCALATION:
    "Hook gợi một cách xử lý được lặp lại nhưng vấn đề chưa hết. Tình huống nêu mục tiêu và lợi ích trước mắt của cách cũ; sai lầm là các lần lựa chọn dẫn tới hệ quả nối tiếp, mỗi mốc thêm thông tin chứ không chỉ thêm ngày buồn. Cách giải quyết là lần thử sau áp dụng nguyên lý để đổi mắt xích gây vấn đề, với một kết quả nhỏ cụ thể.",
};

export function storyAngleRule(angle: StoryAngle): string {
  return `- Góc kể được giao cho video này: “${STORY_ANGLE_LABELS[angle]}”. ${STORY_ANGLE_BRIEFS[angle]} Vẫn đủ sáu phần theo đúng thứ tự và mọi quy tắc khác; góc kể chỉ quyết định cách kể, không cho thêm ý ngoài nguồn.`;
}

// The six angles side by side, for a notebook's chat persona, where the long fixed text of a NotebookLM draft lives (a question
// is limited to about 800 words). The question then only names the angle it gives (storyAngleName). Editing a brief changes
// this text and storyAngleRule's alike, so it bumps the versions of every prompt that uses either.
export const STORY_ANGLES_RULE = [
  "## Các góc kể",
  "Câu hỏi giao cho mỗi video đúng MỘT góc kể trong số dưới đây; chỉ áp dụng góc ấy, bỏ qua năm góc còn lại. Vẫn đủ sáu phần theo đúng thứ tự và mọi quy tắc khác; góc kể chỉ quyết định cách kể, không cho thêm ý ngoài nguồn.",
  ...STORY_ANGLES.map((angle) => `- ${angle} (“${STORY_ANGLE_LABELS[angle]}”): ${STORY_ANGLE_BRIEFS[angle]}`),
].join("\n");

export function storyAngleName(angle: StoryAngle): string {
  return `- Góc kể của video này: ${angle} (“${STORY_ANGLE_LABELS[angle]}”), theo mô tả ở mục “Các góc kể” của quy tắc viết bản thảo.`;
}

export const STORY_REWRITE_RULE =
  "- Viết lại cho hay hơn chứ không chỉ đổi chữ: cụ thể thay vì tóm tắt, câu ngắn, chữ đắt nhất ở cuối câu; giữ nhân vật, tên và câu thoại đã có trong cảnh và các cảnh khác; làm rõ lựa chọn và hệ quả từ chi tiết đã có, không thêm sự kiện; không mở bằng khuôn “Có phải bạn…”, “Bạn có biết…”.";

// For the scene-plan compiler, which only edits a draft that already holds the story: it keeps the draft's life and may not
// add facts, so a quotation or a number it keeps must read exactly as the source check will compare it.
export const SCENE_EDIT_RULE = [
  "- Biên tập như người dựng một video kể chuyện: giữ, và làm sắc hơn, sức hút của bản thảo. Giữ nhân vật, tên, nơi chốn, chi tiết nhìn thấy được và các cú đảo chiều; đừng làm phẳng chúng thành câu tóm tắt. Giữ lý do của lựa chọn, cơ chế thay đổi và kết quả nhỏ. Rút lời lặp, để câu dài ngắn tự nhiên.",
  "- Câu thoại trong “ngoặc kép” giữ đúng từng chữ như bản thảo; không bỏ ngoặc kép để lách kiểm tra nguồn hoặc thêm khẳng định mới. Số giữ đúng dạng như bản thảo: bản thảo viết “ba ngày” thì không đổi thành “3 ngày”.",
  "- Hook là khoảnh khắc đắt nhất của bản thảo, nói thẳng và cụ thể. Nếu hook của bản thảo là câu hỏi chung chung (“Có phải bạn…”, “Bạn có biết…”, “Tại sao bạn luôn…”), thay bằng khoảnh khắc cụ thể lấy từ chính tình huống bản thảo đã kể, không thêm sự kiện mới.",
  "- onScreenText là cụm đắt nhất của cảnh (một vế gây tò mò, một chi tiết), không chép lại nguyên lời dẫn.",
].join("\n");
