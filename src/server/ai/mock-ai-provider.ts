import type { AiProvider, AiTaskResult } from "./ai-provider";
import type { ChapterAnalysisInput, ChapterAnalysisOutput, LessonDraft } from "./contracts/chapter-analysis";

const MAX_EXCERPT_LENGTH = 220;

function chapterTopic(title: string): string {
  return title.replace(/^(chương|chapter|phần|part)\s+[^\s:.\-–—]+\s*[:.\-–—]?\s*/iu, "").trim() || title;
}

function bodyParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 40 && !paragraph.startsWith("#"));
}

function firstSentence(paragraph: string): string {
  const match = /^.+?[.!?…](?=\s|$)/u.exec(paragraph);
  const sentence = (match?.[0] ?? paragraph).trim();
  return sentence.length > MAX_EXCERPT_LENGTH ? sentence.slice(0, MAX_EXCERPT_LENGTH).trim() : sentence;
}

// Deterministic, offline lessons for demos and tests. Excerpts are copied verbatim from the chapter.
export class MockAiProvider implements AiProvider {
  readonly mode = "mock" as const;

  analyzeChapter(input: ChapterAnalysisInput): Promise<AiTaskResult<ChapterAnalysisOutput>> {
    const topic = chapterTopic(input.chapterTitle);
    const paragraphs = bodyParagraphs(input.chapterContent);
    const excerptFrom = (index: number) => {
      const paragraph = paragraphs[index] ?? paragraphs[0];
      return paragraph ? [{ chapterId: input.chapterId, text: firstSentence(paragraph) }] : [];
    };

    const lessons: LessonDraft[] = [
      {
        title: `Ý chính: ${topic}`,
        summary: paragraphs[0] ? firstSentence(paragraphs[0]) : `Ý tưởng cốt lõi của chương "${topic}".`,
        principle: `Hiểu đúng "${topic}" giúp bạn thay đổi hành vi bằng những bước nhỏ, bền vững.`,
        realLifeScenario: "Minh, nhân viên văn phòng, muốn thay đổi thói quen nhưng luôn bỏ cuộc sau vài ngày.",
        commonMistake: "Đặt mục tiêu quá lớn ngay từ đầu rồi mất động lực khi chưa thấy kết quả.",
        betterApproach: "Chọn một hành động rất nhỏ, gắn với thói quen sẵn có và lặp lại mỗi ngày.",
        actionableStep: "Hôm nay, chọn một việc chỉ mất hai phút và làm ngay sau bữa tối.",
        sourceExcerpts: excerptFrom(0),
        exampleIsIllustrative: true,
      },
      {
        title: `Áp dụng: ${topic}`,
        summary: paragraphs[1] ? firstSentence(paragraphs[1]) : `Cách đưa "${topic}" vào cuộc sống hằng ngày.`,
        principle: "Môi trường và sự dễ dàng quyết định hành vi nhiều hơn ý chí.",
        realLifeScenario: "Lan muốn đọc sách mỗi tối nhưng điện thoại luôn ở cạnh gối.",
        commonMistake: "Dựa vào ý chí thay vì sắp xếp lại môi trường xung quanh.",
        betterApproach: "Đặt sẵn công cụ cho thói quen tốt ở nơi dễ thấy, cất xa thứ gây xao nhãng.",
        actionableStep: "Tối nay, đặt một cuốn sách lên gối và để điện thoại sạc ngoài phòng ngủ.",
        sourceExcerpts: excerptFrom(1),
        exampleIsIllustrative: true,
      },
    ];

    return Promise.resolve({ status: "completed", output: { chapterId: input.chapterId, lessons } });
  }
}
