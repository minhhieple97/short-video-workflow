import { HOOK_MAX_SECONDS } from "@/features/videos/domain/duration";

export type CorrectionTarget = "SCRIPT_STUDIO" | "SCENE_COMPILER";

export interface CorrectionIssue {
  code: string;
  // Our own wording (from preflight and readiness), never book text.
  message?: string;
}

// A video gets one AI correction, and it goes to the step that can fix the problem. What the book says, and which source
// backs it, belongs to the script studio (NotebookLM). Wording, structure and length belong to the compiler (Claude).
// Anything else (a voice-over that failed, a script that changed under the check) is not something an AI can repair.
const SCRIPT_STUDIO_CODES = new Set(["SOURCE_MISSING", "DRAFT_INVALID"]);
const SCENE_COMPILER_CODES = new Set([
  "OVER_TARGET",
  "OVER_MAX",
  "HOOK_TOO_LONG",
  "HOOK_MISSING",
  "NO_SCENES",
  "EMPTY_TEXT",
  "INVALID_AI_OUTPUT",
  "SCENE_PLAN_UNSUPPORTED_CLAIM",
]);

const MAX_NOTE_CHARS = 600;

const GUIDANCE: Record<string, string> = {
  OVER_TARGET: "Tổng thời lượng vượt preset: rút gọn lời dẫn cho vừa, không tăng preset và không đọc nhanh hơn.",
  OVER_MAX: "Tổng thời lượng vượt giới hạn tuyệt đối: rút gọn mạnh lời dẫn, không đọc nhanh hơn.",
  HOOK_TOO_LONG: `Hook đọc quá ${HOOK_MAX_SECONDS} giây: viết hook ngắn hơn nhưng vẫn gợi đủ vấn đề.`,
  HOOK_MISSING: "Thiếu HOOK ở đầu: mở bằng một HOOK có chữ trên màn hình.",
  NO_SCENES: "Chưa có cảnh nào: tạo đủ các cảnh theo mạch kể.",
  EMPTY_TEXT: "Có cảnh thiếu chữ trên màn hình: cảnh nào cũng cần chữ cô đọng.",
  INVALID_AI_OUTPUT: "Kết quả trước không đúng cấu trúc: trả đúng schema và đúng thứ tự mạch kể bắt buộc.",
  SCENE_PLAN_UNSUPPORTED_CLAIM: "Bỏ mọi số liệu hoặc câu trích dẫn không có trong bản thảo và bài học nguồn.",
  SOURCE_MISSING: "Có bài học thiếu trích đoạn nguồn: chỉ dùng ý có căn cứ rõ trong sách, bỏ ý không có căn cứ.",
  DRAFT_INVALID:
    "Bản thảo trước không đúng mạch kể: viết lại đủ hook, tình huống, sai lầm, bài học, giải quyết, hành động.",
};

export interface CorrectionPlan {
  target: CorrectionTarget;
  // Where the pipeline goes back to: the draft step for the script studio, the compile step for the compiler.
  rewindTo: "NONE" | "DRAFTED";
  note: string;
}

// Picks where the single correction goes, or null when none of the problems can be fixed by asking an AI again. With
// problems of both kinds the earlier step wins, because the compile step runs again afterwards anyway, and the note
// still carries every problem so the corrected draft is also written to the right length.
export function planCorrection(issues: readonly CorrectionIssue[]): CorrectionPlan | null {
  const fixable = issues.filter((issue) => SCRIPT_STUDIO_CODES.has(issue.code) || SCENE_COMPILER_CODES.has(issue.code));
  if (fixable.length === 0) return null;

  const target: CorrectionTarget = fixable.some((issue) => SCRIPT_STUDIO_CODES.has(issue.code))
    ? "SCRIPT_STUDIO"
    : "SCENE_COMPILER";
  const lines = [...new Set(fixable.map((issue) => GUIDANCE[issue.code] ?? issue.message ?? issue.code))];
  return {
    target,
    rewindTo: target === "SCRIPT_STUDIO" ? "NONE" : "DRAFTED",
    note: lines.join(" ").slice(0, MAX_NOTE_CHARS),
  };
}
