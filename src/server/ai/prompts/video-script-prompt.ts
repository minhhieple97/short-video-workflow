import { HOOK_MAX_SECONDS, MAX_STORY_SCENES } from "@/features/videos/domain/duration";
import { formatSyllablesPerSecond, paceProfile, syllablesPerSecond, type Pace } from "@/features/videos/domain/pace";
import { STORY_SCENE_ORDER } from "@/features/videos/domain/narrative-beats";

import type { SceneRegenerationInput, VideoScriptInput } from "../contracts/video-script";
import { DURATION_CHOICE_RULE, durationChoices } from "./duration-choice";
import { ILLUSTRATION_JSON, ILLUSTRATION_RULE } from "./illustration-rule";
import { PUBLISH_JSON, PUBLISH_RULE } from "./publish-rule";
import { STORY_REWRITE_RULE, STORYTELLING_RULE, storyAngleRule } from "./storytelling-rule";
import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from "./untrusted-text";

export const VIDEO_SCRIPT_PROMPT_VERSION = "video-script-v9";

const sharedRules = (pace: Pace) => [
  `- ${UNTRUSTED_TEXT_RULE}`,
  "- Video dọc 9:16 cho TikTok / YouTube Shorts / Facebook Reels. Mọi lời dẫn và chữ trên màn hình bằng tiếng Việt tự nhiên, có dấu.",
  "- Một ý chính cho mỗi video; chỉ ghép bài học thứ hai khi chúng bổ trợ nhau và vẫn còn chỗ cho tình huống + hành động.",
  "- Không clickbait sai lệch, không bịa nghiên cứu, số liệu hay trích dẫn của sách và tác giả (thoại của nhân vật tự nghĩ ra là tình huống minh hoạ, không phải trích dẫn).",
  "- onScreenText cô đọng: cụm đắt nhất của cảnh (một vế gây tò mò, một chi tiết), không phải đoạn văn dài và không chép lại nguyên lời dẫn.",
  `- Lời dẫn sẽ được đọc ở nhịp ${paceProfile(pace).label.toLowerCase()} (khoảng ${formatSyllablesPerSecond(pace)} âm tiết/giây), nên tính độ dài theo mức đó. Đừng viết vượt ngân sách chữ của thời lượng: rút gọn lời từng cảnh thay vì bỏ phần.`,
];

export function buildVideoScriptPrompt(input: VideoScriptInput): string {
  return [
    `# Kịch bản video ngắn (${VIDEO_SCRIPT_PROMPT_VERSION})`,
    "",
    `Viết kịch bản cho video "${input.title}". Độ dài do bạn chọn, trong khoảng ${input.minDurationSec}–${input.maxDurationSec} giây, sao cho hợp với nội dung.`,
    "",
    "## Quy tắc",
    ...sharedRules(input.pace),
    `- targetDurationSec (giây): chọn MỘT mức, kèm số âm tiết lời dẫn (cả hook) nó chứa: ${durationChoices(input, syllablesPerSecond(input.pace), "âm tiết")}. ${DURATION_CHOICE_RULE} Rồi viết lời dẫn khớp đúng mức đã chọn.`,
    `- hookOptions: 2–3 phương án hook cho 0–${HOOK_MAX_SECONDS} giây đầu, mỗi phương án một kiểu khác nhau (QUESTION = câu hỏi cụ thể gợi đúng một khoảnh khắc, không phải câu hỏi chung chung; MISTAKE = sai lầm hoặc khoảnh khắc tệ nhất, nói thẳng; CONTRAST = tương phản bất ngờ trước/sau). Phương án đầu theo góc kể được giao. Lời hook tối đa ~${Math.floor(HOOK_MAX_SECONDS * syllablesPerSecond(input.pace)) - 1} âm tiết; onScreenText đọc được khi tắt tiếng.`,
    `- scenes: đúng thứ tự ${STORY_SCENE_ORDER.join(" → ")}, mỗi phần ít nhất một cảnh, không dùng loại cảnh khác: tình huống đời thường → sai lầm trong tình huống đó → bài học trong sách và điều rút ra → quay lại xử lý đúng tình huống mở đầu bằng bài học → một hành động cụ thể làm được ngay. Tên sách và bài học chỉ nhắc từ cảnh KEY_TAKEAWAY trở đi. Nhiều bài học thì kể thành một câu chuyện theo cùng khung, không lặp khung cho từng bài. Không có logo, lời chào hay intro.`,
    `- Video dài hơn 60 giây: kể sâu hơn chứ không thêm bài học — mỗi phần có thể gồm nhiều cảnh (mỗi cảnh khoảng 8–15 giây), tình huống chi tiết hơn, nhiều bước hành động hơn; tối đa ${MAX_STORY_SCENES} cảnh.`,
    `- visualVariant thuộc: HOOK_QUESTION, SPLIT_MISTAKE_SOLUTION, SCENARIO_CARD, BIG_TAKEAWAY, ACTION_CHECKLIST.`,
    ILLUSTRATION_RULE,
    PUBLISH_RULE,
    "",
    STORYTELLING_RULE,
    storyAngleRule(input.storyAngle),
    "",
    "## Định dạng đầu ra",
    `Chỉ trả về JSON: {"videoId": "${input.videoId}", "targetDurationSec", "durationReason", "hookOptions": [{"variant","narration","onScreenText","visualVariant",${ILLUSTRATION_JSON}}], "scenes": [{"type","title","narration","onScreenText","visualVariant",${ILLUSTRATION_JSON}}], ${PUBLISH_JSON}}`,
    "",
    "## Sách và bài học nguồn (snapshot)",
    fenceUntrustedText(JSON.stringify({ book: input.book, lessons: input.lessons }, null, 2)),
  ].join("\n");
}

export function buildSceneRegenerationPrompt(input: SceneRegenerationInput): string {
  return [
    `# Viết lại một cảnh (${VIDEO_SCRIPT_PROMPT_VERSION})`,
    "",
    `Viết lại cảnh loại ${input.scene.type} theo cách khác, giữ cùng ý và độ dài tương đương. Không thay đổi các cảnh khác.`,
    "",
    "## Quy tắc",
    ...sharedRules(input.pace),
    STORY_REWRITE_RULE,
    "",
    "## Định dạng đầu ra",
    `Chỉ trả về JSON: {"sceneId": "${input.sceneId}", "scene": {"type","title","narration","onScreenText","visualVariant"}}`,
    "",
    "## Cảnh hiện tại và bài học nguồn",
    fenceUntrustedText(JSON.stringify({ scene: input.scene, lessons: input.lessons }, null, 2)),
  ].join("\n");
}
