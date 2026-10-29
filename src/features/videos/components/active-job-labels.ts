import type { ActiveJobLabels } from "./active-job-watcher";

// Plain module so server pages can pass these to ActiveJobWatcher (a client component's exports are references there).
export function scriptJobLabels(sceneNumber: number | null): ActiveJobLabels {
  return sceneNumber === null
    ? { running: "Worker đang tạo kịch bản…", cancel: "Huỷ tạo kịch bản", cancelled: "Đã huỷ tạo kịch bản." }
    : {
        running: `Worker đang viết lại cảnh ${sceneNumber}…`,
        cancel: "Huỷ viết lại cảnh",
        cancelled: "Đã huỷ viết lại cảnh.",
      };
}

export const PUBLISH_JOB_LABELS: ActiveJobLabels = {
  running: "Worker đang viết tiêu đề, caption và hashtag…",
  cancel: "Huỷ",
  cancelled: "Đã huỷ viết tiêu đề và caption.",
};
