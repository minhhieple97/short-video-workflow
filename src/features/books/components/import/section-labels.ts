import type { SectionKind } from "../../domain/book-structure";

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  chapter: "Chương",
  part: "Phần",
  "front-matter": "Phần đầu sách",
  "table-of-contents": "Mục lục",
  "back-matter": "Phần cuối sách",
};
