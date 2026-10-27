import type { SceneRegenerationInput, VideoScriptInput } from "../contracts/video-script";
import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from "./untrusted-text";

export const VIDEO_SCRIPT_PROMPT_VERSION = "video-script-v1";

const SHARED_RULES = [
  `- ${UNTRUSTED_TEXT_RULE}`,
  "- Video dọc 9:16 cho TikTok / YouTube Shorts / Facebook Reels. Mọi lời dẫn và chữ trên màn hình bằng tiếng Việt tự nhiên, có dấu.",
  "- Một ý chính cho mỗi video; chỉ ghép bài học thứ hai khi chúng bổ trợ nhau và vẫn còn chỗ cho tình huống + hành động.",
  "- Không clickbait sai lệch, không bịa nghiên cứu, số liệu hay trích dẫn.",
  "- onScreenText cô đọng (từ khoá), không phải đoạn văn dài.",
  "- Lời dẫn đọc tự nhiên khoảng 4 âm tiết/giây; tổng thời lượng không vượt targetDurationSec. Nếu không đủ chỗ, giảm số cảnh thay vì nói nhanh.",
];

export function buildVideoScriptPrompt(input: VideoScriptInput): string {
  return [
    `# Kịch bản video ngắn (${VIDEO_SCRIPT_PROMPT_VERSION})`,
    "",
    `Viết kịch bản cho video "${input.title}" dài tối đa ${input.targetDurationSec} giây.`,
    "",
    "## Quy tắc",
    ...SHARED_RULES,
    "- hookOptions: 2–3 phương án hook cho 0–3 giây đầu (QUESTION = câu hỏi đánh trúng vấn đề, MISTAKE = sai lầm quen thuộc, CONTRAST = tương phản trước/sau). Lời hook tối đa ~11 âm tiết; onScreenText đọc được khi tắt tiếng.",
    "- scenes: các cảnh sau hook theo mạch SITUATION → COMMON_MISTAKE → BETTER_APPROACH → KEY_TAKEAWAY → ACTION_STEP (được gộp/bỏ bớt để vừa thời lượng). Không có logo, lời chào hay intro.",
    `- visualVariant thuộc: HOOK_QUESTION, SPLIT_MISTAKE_SOLUTION, SCENARIO_CARD, BIG_TAKEAWAY, ACTION_CHECKLIST.`,
    "",
    "## Định dạng đầu ra",
    `Chỉ trả về JSON: {"videoId": "${input.videoId}", "hookOptions": [{"variant","narration","onScreenText","visualVariant"}], "scenes": [{"type","title","narration","onScreenText","visualVariant"}]}`,
    "",
    "## Bài học nguồn (snapshot)",
    fenceUntrustedText(JSON.stringify(input.lessons, null, 2)),
  ].join("\n");
}

export function buildSceneRegenerationPrompt(input: SceneRegenerationInput): string {
  return [
    `# Viết lại một cảnh (${VIDEO_SCRIPT_PROMPT_VERSION})`,
    "",
    `Viết lại cảnh loại ${input.scene.type} theo cách khác, giữ cùng ý và độ dài tương đương. Không thay đổi các cảnh khác.`,
    "",
    "## Quy tắc",
    ...SHARED_RULES,
    "",
    "## Định dạng đầu ra",
    `Chỉ trả về JSON: {"sceneId": "${input.sceneId}", "scene": {"type","title","narration","onScreenText","visualVariant"}}`,
    "",
    "## Cảnh hiện tại và bài học nguồn",
    fenceUntrustedText(JSON.stringify({ scene: input.scene, lessons: input.lessons }, null, 2)),
  ].join("\n");
}
