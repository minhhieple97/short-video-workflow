import { formatPreset, presetsInRange, type DurationRange } from "@/features/videos/domain/duration";
import { syllablesPerSecond, type Pace } from "@/features/videos/domain/pace";

// The remaining tenth covers pauses and uncertainty; real audio and scene timing still decide whether the range fits.
export function narrationBudget(seconds: number, pace: Pace): number {
  return Math.floor(seconds * syllablesPerSecond(pace) * 0.9);
}

// The lengths an AI may choose from, each with how much narration it holds, so the model picks a length and writes to it
// in one pass.
export function durationChoices(range: DurationRange, pace: Pace, unit: string): string {
  return presetsInRange(range)
    .map((seconds) => `${seconds} (${formatPreset(seconds)}) ≈ ${narrationBudget(seconds, pace)} ${unit}`)
    .join("; ");
}

export const NARRATION_BUDGET_RULE =
  "Ngân sách đã chừa 10% cho khoảng nghỉ và sai số, không phải số chữ phải lấp. Không thêm lời chỉ để đủ ngân sách. Thời lượng thật là audio đo được cộng đệm từng cảnh; sát mức tối thiểu vẫn có thể thiếu, không suy ra đủ thời lượng từ số chữ. Không tự đổi nhịp hay khoảng.";

export const DURATION_CHOICE_RULE =
  "Chọn mức vừa đủ kể trọn nguyên lý, động cơ và cách giải quyết; targetDurationSec là thời lượng video cuối. Nếu mức sát tối thiểu không đủ sau dự phòng, chọn mức dài hơn trong khoảng khi nguồn cho phép. Không kéo dài cho đủ hoặc bỏ phần của khung. " +
  NARRATION_BUDGET_RULE +
  " durationReason: một câu tiếng Việt (tối đa 200 ký tự) nói vì sao chọn độ dài đó.";
