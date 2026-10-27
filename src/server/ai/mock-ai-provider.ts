import type { AiProvider, AiTaskResult } from "./ai-provider";
import type { ChapterAnalysisInput, ChapterAnalysisOutput } from "./contracts/chapter-analysis";

export class MockAiProvider implements AiProvider {
  readonly mode = "mock" as const;

  analyzeChapter(input: ChapterAnalysisInput): Promise<AiTaskResult<ChapterAnalysisOutput>> {
    return Promise.resolve({
      status: "completed",
      output: {
        chapterId: input.chapterId,
        lessons: [
          {
            title: `Bài học mẫu từ "${input.chapterTitle}"`,
            summary: "Bài học mẫu do MockAiProvider tạo để kiểm thử luồng, không gọi AI thật.",
            principle: "Hành động nhỏ, lặp lại đều đặn tạo ra thay đổi lớn.",
            realLifeScenario: "Một nhân viên văn phòng luôn trì hoãn việc tập thể dục sau giờ làm.",
            commonMistake: "Đặt mục tiêu quá lớn ngay từ ngày đầu rồi bỏ cuộc sau ba ngày.",
            betterApproach: "Bắt đầu bằng một hành động rất ngắn, gắn với thói quen đã có.",
            actionableStep: "Tập hai phút ngay sau khi thay quần áo.",
            sourceExcerpts: [],
            exampleIsIllustrative: true,
          },
        ],
      },
    });
  }
}
