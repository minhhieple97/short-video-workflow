import { formatPreset, presetsInRange, type DurationRange } from "@/features/videos/domain/duration";

// The lengths an AI may choose from, each with how much narration it holds, so the model picks a length and writes to it
// in one pass.
export function durationChoices(range: DurationRange, unitsPerSecond: number, unit: string): string {
  return presetsInRange(range)
    .map((seconds) => `${seconds} (${formatPreset(seconds)}) ≈ ${Math.floor(seconds * unitsPerSecond)} ${unit}`)
    .join("; ");
}

export const DURATION_CHOICE_RULE =
  "Chọn độ dài vừa đủ để kể trọn khung với nội dung thật của bài học: bài học nhiều chi tiết, ví dụ, bước làm thì dài hơn; ý đơn giản thì ngắn hơn. Không kéo dài cho đủ, không bỏ phần nào của khung để cho ngắn. durationReason: một câu tiếng Việt (tối đa 200 ký tự) nói vì sao chọn độ dài đó.";
