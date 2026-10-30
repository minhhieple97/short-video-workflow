import { describe, expect, it } from "vitest";

import { canMoveLesson, LESSON_STATUSES } from "@/features/lessons/domain/lesson-fields";

describe("canMoveLesson", () => {
  it("allows the moves the review flow has, and nothing else", () => {
    const allowed = LESSON_STATUSES.flatMap((from) =>
      LESSON_STATUSES.filter((to) => canMoveLesson(from, to)).map((to) => `${from}>${to}`),
    );

    expect(allowed.sort()).toEqual(
      ["DRAFT>APPROVED", "DRAFT>ARCHIVED", "APPROVED>ARCHIVED", "APPROVED>DRAFT", "ARCHIVED>DRAFT"].sort(),
    );
  });

  it("does not count staying where it is as a move", () => {
    for (const status of LESSON_STATUSES) expect(canMoveLesson(status, status)).toBe(false);
  });
});
