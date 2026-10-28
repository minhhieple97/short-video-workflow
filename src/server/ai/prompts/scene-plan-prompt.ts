import { HOOK_MAX_SECONDS, SYLLABLES_PER_SECOND } from "@/features/videos/domain/duration";
import { STORY_SCENE_ORDER } from "@/features/videos/domain/narrative-beats";
import type { ScenePlanTaskInput } from "@/server/scene-plan/handoff";

import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from "./untrusted-text";

export const SCENE_PLAN_PROMPT_VERSION = "scene-plan-v1";

export function buildScenePlanPrompt(input: ScenePlanTaskInput): string {
  const hookSyllables = HOOK_MAX_SECONDS * SYLLABLES_PER_SECOND - 1;
  const syllableBudget = input.targetDurationSec * SYLLABLES_PER_SECOND;

  return [
    `# Biên tập bản thảo thành cảnh video (${SCENE_PLAN_PROMPT_VERSION})`,
    "",
    `Biên tập bản thảo dưới đây thành các cảnh cho một video dọc 9:16 dài tối đa ${input.targetDurationSec} giây, rồi trả về JSON.`,
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
    `- Lời dẫn đọc khoảng ${SYLLABLES_PER_SECOND} âm tiết/giây; tổng lời dẫn (hook + các cảnh) không quá ~${syllableBudget} âm tiết. Không nói nhanh để vừa: hãy rút gọn.`,
    "- Tiếng Việt tự nhiên, có dấu. onScreenText cô đọng (từ khoá, tối đa 120 ký tự; hook tối đa 60 ký tự), không phải đoạn văn.",
    "- visualVariant thuộc: HOOK_QUESTION, SPLIT_MISTAKE_SOLUTION, SCENARIO_CARD, BIG_TAKEAWAY, ACTION_CHECKLIST.",
    ...(input.revisionNote
      ? ["", "## Lần sửa duy nhất", `Chỉ sửa đúng điều sau và giữ nguyên phần còn lại: ${input.revisionNote}`]
      : []),
    "",
    "## Định dạng đầu ra",
    'Chỉ trả về JSON: {"hook": {"variant","narration","onScreenText","visualVariant"}, "scenes": [{"type","title","narration","onScreenText","visualVariant"}]}. variant của hook thuộc QUESTION, MISTAKE, CONTRAST.',
    "",
    "## Bản thảo và bài học nguồn",
    fenceUntrustedText(JSON.stringify({ draft: input.draft, lesson: input.lesson }, null, 2)),
  ].join("\n");
}
