import { HOOK_MAX_SECONDS, MAX_STORY_SCENES } from "@/features/videos/domain/duration";
import { formatSyllablesPerSecond, paceProfile, syllablesPerSecond } from "@/features/videos/domain/pace";
import { STORY_SCENE_ORDER } from "@/features/videos/domain/narrative-beats";
import type { ScenePlanTaskInput } from "@/server/scene-plan/handoff";

import { ILLUSTRATION_JSON, ILLUSTRATION_RULE } from "./illustration-rule";
import { PUBLISH_JSON, PUBLISH_RULE } from "./publish-rule";
import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from "./untrusted-text";

export const SCENE_PLAN_PROMPT_VERSION = "scene-plan-v7";

export function buildScenePlanPrompt(input: ScenePlanTaskInput): string {
  const rate = syllablesPerSecond(input.pace);
  const hookSyllables = Math.floor(HOOK_MAX_SECONDS * rate) - 1;
  const syllables = (seconds: number) => Math.floor(seconds * rate);

  return [
    `# Biên tập bản thảo thành cảnh video (${SCENE_PLAN_PROMPT_VERSION})`,
    "",
    `Biên tập bản thảo dưới đây thành các cảnh cho một video dọc 9:16 dài khoảng ${input.targetDurationSec} giây (độ dài bản thảo đã chọn; video phải nằm trong ${input.minDurationSec}–${input.maxDurationSec} giây), rồi trả về JSON.`,
    "",
    "## Quy tắc",
    `- ${UNTRUSTED_TEXT_RULE}`,
    "- Bạn chỉ biên tập lời dẫn: làm cho dễ nghe, tự nhiên, đúng thời lượng. Bản thảo và bài học là toàn bộ căn cứ.",
    "- KHÔNG thêm trích dẫn, câu nói nguyên văn, số liệu, tỷ lệ, tên nghiên cứu hay khẳng định nào không có trong bản thảo hoặc bài học nguồn. Thiếu chỗ thì bỏ ý, đừng bịa thêm.",
    "- Cảnh có `illustrative: true` là tình huống minh hoạ do AI sáng tác: giữ nó là tình huống minh hoạ, đừng trình bày như lời tác giả.",
    "- Mạch kể bắt buộc: hook → tình huống đời thường → sai lầm → bài học trong sách → quay lại xử lý tình huống ban đầu → hành động cụ thể. Phần giải pháp phải quay lại đúng tình huống mở đầu và giải quyết lời hứa của hook.",
    "- Tên sách và bài học chỉ được nhắc từ cảnh bài học trở đi, không nhắc trong hook, tình huống và sai lầm.",
    `- hook: lời dẫn tối đa ~${hookSyllables} âm tiết (đọc xong trong ${HOOK_MAX_SECONDS} giây), có chữ trên màn hình ngay từ frame 0, không lời chào, không logo.`,
    `- scenes: đúng thứ tự ${STORY_SCENE_ORDER.join(" → ")}; mỗi loại ít nhất một cảnh, không dùng loại cảnh nào khác. Tương ứng bản thảo: SITUATION ← SITUATION, COMMON_MISTAKE ← MISTAKE, KEY_TAKEAWAY ← LESSON, BETTER_APPROACH ← RESOLUTION, ACTION_STEP ← ACTION.`,
    `- Video dài hơn 60 giây: kể sâu hơn chứ không thêm bài học — mỗi phần có thể gồm nhiều cảnh (mỗi cảnh khoảng 8–15 giây), tình huống chi tiết hơn, nhiều bước hành động hơn; tối đa ${MAX_STORY_SCENES} cảnh sau hook.`,
    `- Lời dẫn sẽ được đọc ở nhịp ${paceProfile(input.pace).label.toLowerCase()} (khoảng ${formatSyllablesPerSecond(input.pace)} âm tiết/giây); tổng lời dẫn (hook + các cảnh) khoảng ~${syllables(input.targetDurationSec)} âm tiết, không dưới ~${syllables(input.minDurationSec)} và không quá ~${syllables(input.maxDurationSec)}. Quá ngân sách thì rút gọn, đừng nhồi chữ; không thêm ý ngoài bản thảo để cho dài.`,
    "- Lời dẫn và chữ trên màn hình LUÔN bằng tiếng Việt tự nhiên, có dấu, kể cả khi trích đoạn nguồn bằng tiếng Anh (không chép câu tiếng Anh lên màn hình, trừ tên riêng, tên sách). onScreenText cô đọng (từ khoá, tối đa 120 ký tự; hook tối đa 60 ký tự), không phải đoạn văn.",
    "- visualVariant thuộc: HOOK_QUESTION, SPLIT_MISTAKE_SOLUTION, SCENARIO_CARD, BIG_TAKEAWAY, ACTION_CHECKLIST.",
    ILLUSTRATION_RULE,
    PUBLISH_RULE,
    ...(input.revisionNote
      ? ["", "## Lần sửa duy nhất", `Chỉ sửa đúng điều sau và giữ nguyên phần còn lại: ${input.revisionNote}`]
      : []),
    "",
    "## Định dạng đầu ra",
    `Chỉ trả về JSON: {"hook": {"variant","narration","onScreenText","visualVariant",${ILLUSTRATION_JSON}}, "scenes": [{"type","title","narration","onScreenText","visualVariant",${ILLUSTRATION_JSON}}], ${PUBLISH_JSON}}. variant của hook thuộc QUESTION, MISTAKE, CONTRAST.`,
    "",
    "## Bản thảo, bài học và sách nguồn",
    fenceUntrustedText(JSON.stringify({ draft: input.draft, lesson: input.lesson, book: input.book }, null, 2)),
  ].join("\n");
}
