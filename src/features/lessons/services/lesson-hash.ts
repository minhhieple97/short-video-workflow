import { createHash } from "node:crypto";

import { LESSON_TEXT_FIELDS, type LessonText } from "../domain/lesson-fields";

export function lessonContentHash(text: LessonText): string {
  return createHash("sha256")
    .update(JSON.stringify(LESSON_TEXT_FIELDS.map((field) => text[field])))
    .digest("hex");
}
