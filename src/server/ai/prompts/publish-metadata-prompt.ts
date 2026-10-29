import type { PublishMetadataInput } from "../contracts/publish-metadata";
import { PUBLISH_JSON, PUBLISH_RULE } from "./publish-rule";
import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from "./untrusted-text";

export const PUBLISH_METADATA_PROMPT_VERSION = "publish-metadata-v1";

export function buildPublishMetadataPrompt(input: PublishMetadataInput): string {
  return [
    `# Tiêu đề, caption và hashtag cho video ngắn (${PUBLISH_METADATA_PROMPT_VERSION})`,
    "",
    "Viết tiêu đề, caption và hashtag để đăng video dọc 9:16 có kịch bản dưới đây, rồi trả về JSON.",
    "",
    "## Quy tắc",
    `- ${UNTRUSTED_TEXT_RULE}`,
    "- Tiêu đề và caption bằng tiếng Việt tự nhiên, có dấu; không chèn câu tiếng Anh, trừ tên riêng và tên sách.",
    "- Kịch bản là nội dung video thật: tiêu đề và caption chỉ hứa điều kịch bản nói tới.",
    PUBLISH_RULE,
    "",
    "## Định dạng đầu ra",
    `Chỉ trả về JSON: {"videoId": "${input.videoId}", ${PUBLISH_JSON}}`,
    "",
    "## Kịch bản, sách và bài học nguồn",
    fenceUntrustedText(JSON.stringify({ scenes: input.scenes, book: input.book, lessons: input.lessons }, null, 2)),
  ].join("\n");
}
