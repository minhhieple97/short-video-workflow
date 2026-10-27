import { toCompositionProps, type ShortVideoProps } from "@/features/videos/domain/composition-props";

// Demo data for Remotion Studio only; real videos always pass their own props.
export const SAMPLE_PROPS: ShortVideoProps = toCompositionProps({
  title: "Một thói quen nhỏ tạo thay đổi lớn",
  book: { title: "Sách mẫu" },
  scenes: [
    {
      id: "hook",
      type: "HOOK",
      visualVariant: "HOOK_QUESTION",
      narration: "Vì sao bạn luôn bỏ cuộc sau ba ngày?",
      onScreenText: "VÌ SAO BẠN LUÔN BỎ CUỘC?",
      durationFrames: 75,
      hidden: false,
      audioAssetId: null,
    },
    {
      id: "situation",
      type: "SITUATION",
      visualVariant: "SCENARIO_CARD",
      narration: "Minh muốn tập thể dục sau giờ làm, nhưng ngày thứ ba thì bỏ cuộc.",
      onScreenText: "Mệt mỏi sau giờ làm",
      durationFrames: 120,
      hidden: false,
      audioAssetId: null,
    },
    {
      id: "mistake",
      type: "COMMON_MISTAKE",
      visualVariant: "SPLIT_MISTAKE_SOLUTION",
      narration: "Sai lầm là đặt mục tiêu một giờ mỗi ngày ngay từ đầu.",
      onScreenText: "Tập một giờ ngay ngày đầu",
      durationFrames: 105,
      hidden: false,
      audioAssetId: null,
    },
    {
      id: "approach",
      type: "BETTER_APPROACH",
      visualVariant: "SPLIT_MISTAKE_SOLUTION",
      narration: "Hãy bắt đầu bằng hai phút, ngay sau khi thay quần áo.",
      onScreenText: "Chỉ hai phút mỗi ngày",
      durationFrames: 105,
      hidden: false,
      audioAssetId: null,
    },
    {
      id: "action",
      type: "ACTION_STEP",
      visualVariant: "ACTION_CHECKLIST",
      narration: "Tối nay, mang giày chạy và bước ra cửa.",
      onScreenText: "Mang giày, bước ra cửa",
      durationFrames: 90,
      hidden: false,
      audioAssetId: null,
    },
  ],
});
