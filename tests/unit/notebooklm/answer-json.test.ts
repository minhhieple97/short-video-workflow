import { describe, expect, it } from "vitest";

import { extractJsonFromAnswer } from "@/features/notebooklm/domain/answer-json";

describe("extractJsonFromAnswer", () => {
  it("reads a fenced block wherever it sits in the answer", () => {
    expect(extractJsonFromAnswer('Đây là kết quả:\n```json\n[{"a": 1}]\n```\nNguồn [1].')).toEqual([{ a: 1 }]);
    expect(extractJsonFromAnswer('```\n{"b": "x"}\n```')).toEqual({ b: "x" });
  });

  it("falls back to the outermost object or array in prose", () => {
    expect(extractJsonFromAnswer('Kết quả: {"c": [1, 2]} — xong.')).toEqual({ c: [1, 2] });
    expect(extractJsonFromAnswer("Danh sách: [1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("returns null rather than guessing when there is no valid JSON", () => {
    expect(extractJsonFromAnswer("Tôi không tìm thấy chương nào.")).toBeNull();
    expect(extractJsonFromAnswer('{"title": "Chương 1" [1]}')).toBeNull();
  });
});
