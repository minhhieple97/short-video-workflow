import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import {
  normalizeHashtag,
  PUBLISH_HASHTAG_MAX,
  PUBLISH_TITLE_MAX,
  type PublishMetadataDraft,
} from "@/features/videos/domain/publish-metadata";

import type { PublishBook } from "./contracts/publish-metadata";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Built only from the book, the lesson and the hook, so the source guard accepts it.
export function mockPublishMetadata(input: {
  book: PublishBook;
  lessons: readonly LessonSnapshot[];
  hook: string;
}): PublishMetadataDraft {
  const [lesson] = input.lessons;
  const topic = lesson?.title ?? input.book.title;
  const source = input.book.author ? `Sách: ${input.book.title} – ${input.book.author}` : `Sách: ${input.book.title}`;
  return {
    title: clip(`${topic} | ${input.book.title}`.replace(/\s+/g, " "), PUBLISH_TITLE_MAX),
    caption: [input.hook, lesson?.summary ?? "", source, "Lưu lại để thử ngay hôm nay!"]
      .filter((line) => line.length > 0)
      .join("\n"),
    hashtags: [
      "sachhay",
      "baihoccuocsong",
      normalizeHashtag(topic).slice(0, PUBLISH_HASHTAG_MAX),
      normalizeHashtag(input.book.title).slice(0, PUBLISH_HASHTAG_MAX),
      "booktok",
    ],
  };
}
