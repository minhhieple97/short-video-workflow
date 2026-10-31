import { PROP_IDS } from "@/features/videos/domain/props";
import { SHOT_SIZES } from "@/features/videos/domain/scene-shots";
import {
  CARD_LIMITS,
  CARD_STYLE_LABELS,
  CARD_STYLES,
  MAX_SHOT_PROPS,
  PARTNER_ACTION_LABELS,
  PARTNER_ACTIONS,
  PROP_LABEL_MAX,
  SHOT_MOOD_LABELS,
  SHOT_MOODS,
  SHOT_TAG_MAX,
} from "@/features/videos/domain/shot-plan";

function choices<T extends string>(values: readonly T[], labels: Record<T, string>): string {
  return values.map((value) => `${value} (${labels[value].toLowerCase()})`).join(", ");
}

const SIZE_LABELS: Record<(typeof SHOT_SIZES)[number], string> = {
  WIDE: "toàn cảnh",
  MEDIUM: "trung cảnh",
  CLOSE: "cận mặt, cho khoảnh khắc cảm xúc",
};

const cardLines = CARD_STYLES.map((style) => {
  const { minLines, maxLines, lineChars } = CARD_LIMITS[style];
  const count = minLines === maxLines ? `${minLines}` : `${minLines}–${maxLines}`;
  return `${style} (${CARD_STYLE_LABELS[style].toLowerCase()}, ${count} dòng ≤ ${lineChars} ký tự)`;
}).join(", ");

// Shared by the script and the scene-plan prompts, like the illustration rule: editing it bumps both versions.
export const SHOT_RULE = [
  "- shots: một cảnh là một đoạn giọng đọc; hình của nó được cắt thành 1–4 shot nối tiếp (mỗi shot ~2–6 giây; cảnh dài thì nhiều shot hơn, cảnh ngắn dưới 5 giây chỉ một shot). Mỗi shot chỉ ghi điều thay đổi:",
  "  from: 2–4 chữ đầu tiên của đoạn lời dẫn mà shot bắt đầu, chép nguyên văn từ narration của chính cảnh đó (shot đầu không cần).",
  "  setting, action: đổi nơi chốn hoặc việc nhân vật làm (cùng danh sách với illustration); các shot sau giữ nguyên cho tới khi đổi lại.",
  `  mood (chỉ shot đó): ${choices(SHOT_MOODS, SHOT_MOOD_LABELS)}.`,
  `  partner (chỉ shot đó, khi lời dẫn nói tới người thứ hai như người thân, đồng nghiệp): ${choices(PARTNER_ACTIONS, PARTNER_ACTION_LABELS)}.`,
  `  props (chỉ shot đó): tối đa ${MAX_SHOT_PROPS} đồ vật {"id","label"}; label tuỳ chọn, ≤ ${PROP_LABEL_MAX} ký tự, chỉ dùng chữ hoặc con số đã có trong lời dẫn.`,
  `  tag (chỉ shot đó): nhãn ngắn ≤ ${SHOT_TAG_MAX} ký tự trên hình, như mốc thời gian ("Ngày thứ 3", "23:00").`,
  `  size: ${SHOT_SIZES.map((size) => `${size} (${SIZE_LABELS[size]})`).join(", ")}; bỏ trống để tự luân phiên.`,
  `  card (chỉ shot đó): thay hình bằng thẻ chữ toàn màn hình {"style","lines"}: ${cardLines}. NUMBER: dòng đầu là con số ngắn, dòng sau là chú thích. QUOTE: một câu nguyên văn có trong bài học hoặc bản thảo nguồn.`,
  "  Cảnh BIG_TAKEAWAY và ACTION_CHECKLIST nên mở bằng một card (PUNCH cho bài học, LIST cho các bước); cả video chỉ vài card để hình vẫn là câu chuyện. Chữ trên shot (label, tag, card) được kiểm như lời dẫn: không số liệu, không trích dẫn ngoài nguồn.",
  `  id của props thuộc: ${PROP_IDS.join(", ")}.`,
].join("\n");

export const SHOT_JSON =
  '"shots":[{"from","setting","action","mood","partner","props":[{"id","label"}],"tag","size","card":{"style","lines":[]}}]';
