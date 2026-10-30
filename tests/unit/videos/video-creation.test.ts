import { describe, expect, it } from "vitest";

import {
  creationProblem,
  MAX_LESSONS_PER_VIDEO,
  MAX_VIDEOS_PER_REQUEST,
  plannedVideoCount,
} from "@/features/videos/domain/video-creation";
import { createVideoSchema, createVideosFromLessonsSchema } from "@/features/videos/schemas/video.schema";

describe("plannedVideoCount", () => {
  it("is one video for one lesson, whichever way is asked for", () => {
    expect(plannedVideoCount(1, "PER_LESSON")).toBe(1);
    expect(plannedVideoCount(1, "MERGED")).toBe(1);
  });

  it("is one video per lesson, or one in all, once several are ticked", () => {
    expect(plannedVideoCount(3, "PER_LESSON")).toBe(3);
    expect(plannedVideoCount(3, "MERGED")).toBe(1);
  });

  it("is none while nothing is ticked", () => {
    expect(plannedVideoCount(0, "PER_LESSON")).toBe(0);
    expect(plannedVideoCount(0, "MERGED")).toBe(0);
  });
});

describe("creationProblem", () => {
  it("accepts a selection within the limits of its mode", () => {
    expect(creationProblem(MAX_LESSONS_PER_VIDEO, "MERGED")).toBeNull();
    expect(creationProblem(MAX_VIDEOS_PER_REQUEST, "PER_LESSON")).toBeNull();
    expect(creationProblem(0, "MERGED")).toBeNull();
  });

  it("says how many lessons to drop when too many are joined into one video, and offers the other way", () => {
    expect(creationProblem(MAX_LESSONS_PER_VIDEO + 2, "MERGED")).toBe(
      "Một video chỉ ghép tối đa 5 bài học. Hãy bỏ bớt 2 bài hoặc chọn “Mỗi bài học một video”.",
    );
  });

  it("says how many to leave for later when too many videos are asked for at once", () => {
    expect(creationProblem(MAX_VIDEOS_PER_REQUEST + 1, "PER_LESSON")).toBe(
      "Mỗi lần tạo tối đa 30 video. Hãy bỏ bớt 1 bài và tạo phần còn lại ở lần sau.",
    );
  });

  it("is the limit the server enforces: the schemas refuse exactly what the dialog warns about", () => {
    const base = { bookId: "b", minDurationSec: 30, maxDurationSec: 60 };
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `lesson-${index}`);

    expect(createVideoSchema.safeParse({ ...base, title: "T", lessonIds: ids(MAX_LESSONS_PER_VIDEO) }).success).toBe(
      true,
    );
    expect(
      createVideoSchema.safeParse({ ...base, title: "T", lessonIds: ids(MAX_LESSONS_PER_VIDEO + 1) }).success,
    ).toBe(false);
    expect(createVideosFromLessonsSchema.safeParse({ ...base, lessonIds: ids(MAX_VIDEOS_PER_REQUEST) }).success).toBe(
      true,
    );
    expect(
      createVideosFromLessonsSchema.safeParse({ ...base, lessonIds: ids(MAX_VIDEOS_PER_REQUEST + 1) }).success,
    ).toBe(false);
  });
});

describe("createVideosFromLessonsSchema", () => {
  const valid = { bookId: "book-1", lessonIds: ["a", "b"], minDurationSec: 30, maxDurationSec: 60 };

  it("accepts lessons with a range and, optionally, a pace", () => {
    expect(createVideosFromLessonsSchema.safeParse(valid).success).toBe(true);
    expect(createVideosFromLessonsSchema.safeParse({ ...valid, pace: "FAST" }).success).toBe(true);
  });

  it("refuses no lessons, a lesson ticked twice and a range that is turned round", () => {
    const message = (input: unknown) => {
      const result = createVideosFromLessonsSchema.safeParse(input);
      return result.success ? null : result.error.issues[0]?.message;
    };

    expect(message({ ...valid, lessonIds: [] })).toBe("Chọn ít nhất một bài học đã duyệt.");
    expect(message({ ...valid, lessonIds: ["a", "a"] })).toBe("Mỗi bài học chỉ được chọn một lần.");
    expect(message({ ...valid, minDurationSec: 90, maxDurationSec: 60 })).toBe(
      "Thời lượng ngắn nhất không được dài hơn thời lượng dài nhất.",
    );
  });

  it("keeps the message the merged video always gave for too many lessons", () => {
    const result = createVideoSchema.safeParse({ ...valid, title: "T", lessonIds: ["a", "b", "c", "d", "e", "f"] });

    expect(result.success ? null : result.error.issues[0]?.message).toBe("Tối đa 5 bài học cho một video.");
  });
});
