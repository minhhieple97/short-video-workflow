// How the lessons ticked in the "create video" dialog become videos: one video each, or all of them in one video.
export const CREATION_MODES = ["PER_LESSON", "MERGED"] as const;
export type CreationMode = (typeof CREATION_MODES)[number];

export const MAX_LESSONS_PER_VIDEO = 5;
export const MAX_VIDEOS_PER_REQUEST = 30;

// One lesson is one video whichever way is asked for; with several, the mode decides.
export function plannedVideoCount(selectedCount: number, mode: CreationMode): number {
  if (selectedCount === 0) return 0;
  return mode === "PER_LESSON" ? selectedCount : 1;
}

// What stops this selection from being created, in the user's words, or null when nothing does. The server enforces the
// same limits, so the dialog can say so before the click instead of after it.
export function creationProblem(selectedCount: number, mode: CreationMode): string | null {
  if (mode === "MERGED" && selectedCount > MAX_LESSONS_PER_VIDEO) {
    return `Một video chỉ ghép tối đa ${MAX_LESSONS_PER_VIDEO} bài học. Hãy bỏ bớt ${selectedCount - MAX_LESSONS_PER_VIDEO} bài hoặc chọn “Mỗi bài học một video”.`;
  }
  if (mode === "PER_LESSON" && selectedCount > MAX_VIDEOS_PER_REQUEST) {
    return `Mỗi lần tạo tối đa ${MAX_VIDEOS_PER_REQUEST} video. Hãy bỏ bớt ${selectedCount - MAX_VIDEOS_PER_REQUEST} bài và tạo phần còn lại ở lần sau.`;
  }
  return null;
}
