import {
  CHARACTER_ACTION_LABELS,
  CHARACTER_ACTIONS,
  ILLUSTRATION_SETTING_LABELS,
  ILLUSTRATION_SETTINGS,
} from "@/features/videos/domain/illustration";

function choices<T extends string>(values: readonly T[], labels: Record<T, string>): string {
  return values.map((value) => `${value} (${labels[value].toLowerCase()})`).join(", ");
}

export const ILLUSTRATION_RULE = [
  '- illustration: hook và mỗi cảnh có một hoạt cảnh hoạt hình {"setting","action"} khớp với lời dẫn của cảnh đó.',
  `  setting thuộc: ${choices(ILLUSTRATION_SETTINGS, ILLUSTRATION_SETTING_LABELS)}.`,
  `  action thuộc: ${choices(CHARACTER_ACTIONS, CHARACTER_ACTION_LABELS)}.`,
  "  Giữ cùng bối cảnh khi câu chuyện còn ở một nơi, chỉ đổi khi nhân vật chuyển chỗ; action thể hiện điều nhân vật đang làm hay cảm thấy (sai lầm → WORRIED, bài học → IDEA, hành động → WORKING hoặc CELEBRATING).",
].join("\n");

export const ILLUSTRATION_JSON = '"illustration":{"setting","action"}';
