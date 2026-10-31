import { GENERAL_LANE_CONCURRENCY, type WorkLane } from "@/shared/types/work-lane";

export type ConfigurableLane = Exclude<WorkLane, "general">;
export type ConcurrencyKey = ConfigurableLane | "renderThreads";
export type ConcurrencySettings = Record<ConcurrencyKey, number>;

export interface ConcurrencySettingDefinition {
  label: string;
  // What one more task at once costs, so the number can be chosen for the machine and the accounts at hand.
  description: string;
  defaultValue: number;
  max: number;
}

export const MIN_CONCURRENCY = 1;

export const CONCURRENCY_SETTINGS: Record<ConcurrencyKey, ConcurrencySettingDefinition> = {
  claude: {
    label: "Claude CLI",
    description:
      "Phân tích chương sách TXT/Markdown, tạo kịch bản, tiêu đề và caption, kế hoạch cảnh. Mỗi lượt là một tiến trình claude -p dùng hạn mức tài khoản Claude của bạn.",
    defaultValue: 1,
    max: 8,
  },
  notebooklm: {
    label: "NotebookLM",
    description:
      "Lập mục lục bài học cho sách PDF và viết bản thảo video. Mỗi lượt là một tiến trình uvx; hạn mức NotebookLM tính theo cửa sổ khoảng 5 giờ nên nhiều lượt dùng hết nhanh hơn.",
    defaultValue: 2,
    max: 8,
  },
  voice: {
    label: "Giọng đọc",
    description:
      "Lồng tiếng từng video (các cảnh của một video vẫn đọc lần lượt). edge-tts là dịch vụ trực tuyến: nhiều lượt cùng lúc dễ bị từ chối tạm thời.",
    defaultValue: 1,
    max: 8,
  },
  render: {
    label: "Render video",
    description: "Mỗi lượt mở một Chromium riêng và tốn nhiều RAM, CPU. Máy yếu nên để 1.",
    defaultValue: 1,
    max: 8,
  },
  renderThreads: {
    label: "Luồng mỗi lần render",
    description:
      "Số tab Chromium chụp khung hình cho một video. Không nên vượt số nhân CPU; đo bằng pnpm bench:render trước khi tăng.",
    defaultValue: 1,
    max: 16,
  },
  archive: {
    label: "Lưu Google Drive",
    description:
      "Upload bản render lên Drive. Các lượt dùng chung nhịp yêu cầu Drive và băng thông upload, nên lượt thứ hai, thứ ba chỉ nhanh hơn khi mạng còn dư.",
    defaultValue: 2,
    max: 8,
  },
  extraction: {
    label: "Trích xuất PDF",
    description: "Đọc lớp chữ và cắt trang cho OCR bằng Poppler, tốn CPU. Mỗi sách vẫn giữ trần chi phí OCR riêng.",
    defaultValue: 1,
    max: 8,
  },
};

// The order the Settings page lists them in.
export const CONCURRENCY_KEYS: readonly ConcurrencyKey[] = [
  "claude",
  "notebooklm",
  "voice",
  "render",
  "renderThreads",
  "archive",
  "extraction",
];

export function isConcurrencyKey(value: string): value is ConcurrencyKey {
  return CONCURRENCY_KEYS.some((key) => key === value);
}

export function isConcurrencyValue(key: ConcurrencyKey, value: number): boolean {
  return Number.isInteger(value) && value >= MIN_CONCURRENCY && value <= CONCURRENCY_SETTINGS[key].max;
}

// Stored rows over the defaults. A row the code no longer knows, or a value outside its range, is ignored.
export function resolveConcurrency(rows: readonly { key: string; value: number }[]): ConcurrencySettings {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const valueOf = (key: ConcurrencyKey): number => {
    const value = stored.get(key);
    return value !== undefined && isConcurrencyValue(key, value) ? value : CONCURRENCY_SETTINGS[key].defaultValue;
  };
  return {
    claude: valueOf("claude"),
    notebooklm: valueOf("notebooklm"),
    voice: valueOf("voice"),
    render: valueOf("render"),
    renderThreads: valueOf("renderThreads"),
    archive: valueOf("archive"),
    extraction: valueOf("extraction"),
  };
}

export function concurrencyForLane(settings: ConcurrencySettings, lane: WorkLane): number {
  return lane === "general" ? GENERAL_LANE_CONCURRENCY : settings[lane];
}
