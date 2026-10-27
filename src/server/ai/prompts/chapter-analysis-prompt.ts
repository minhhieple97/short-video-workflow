import type { ChapterAnalysisInput } from "../contracts/chapter-analysis";
import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from "./untrusted-text";

export const CHAPTER_ANALYSIS_PROMPT_VERSION = "chapter-analysis-v1";

export function buildChapterAnalysisPrompt(input: ChapterAnalysisInput): string {
  return [
    `# Phân tích chương sách (${CHAPTER_ANALYSIS_PROMPT_VERSION})`,
    "",
    "Bạn là biên tập viên nội dung giáo dục. Hãy rút ra 1–3 bài học có thể áp dụng ngay từ chương sách dưới đây, viết bằng tiếng Việt tự nhiên, có dấu.",
    "",
    "## Quy tắc",
    `- ${UNTRUSTED_TEXT_RULE}`,
    "- Không bịa trích dẫn, câu nói nguyên văn, số liệu hay số trang. `sourceExcerpts[].text` phải là đoạn có thật, chép đúng từng chữ từ nội dung chương; nếu không chắc, để mảng rỗng.",
    "- `realLifeScenario` là tình huống minh họa mới do bạn sáng tác; đặt `exampleIsIllustrative` = true.",
    "- Không sao chép dài nội dung sách; ưu tiên diễn giải và ví dụ mới.",
    `- \`chapterId\` trong kết quả phải đúng là "${input.chapterId}".`,
    "",
    "## Định dạng đầu ra",
    "Chỉ trả về một đối tượng JSON, không kèm giải thích:",
    "```json",
    JSON.stringify(
      {
        chapterId: input.chapterId,
        lessons: [
          {
            title: "string",
            summary: "string",
            principle: "string",
            realLifeScenario: "string",
            commonMistake: "string",
            betterApproach: "string",
            actionableStep: "string",
            sourceExcerpts: [{ chapterId: input.chapterId, text: "string" }],
            exampleIsIllustrative: true,
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "## Thông tin chương",
    `- Sách: ${input.bookTitle}${input.author ? ` — ${input.author}` : ""}`,
    `- Chương: ${input.chapterTitle}`,
    "",
    "## Nội dung chương",
    fenceUntrustedText(input.chapterContent),
  ].join("\n");
}
