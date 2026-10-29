import { estimateNarrationSeconds, fitToRange } from "@/features/videos/domain/duration";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import { DEFAULT_VISUAL_VARIANT, type BodySceneType } from "@/features/videos/domain/scene-types";

import type {
  HookOption,
  SceneRegenerationInput,
  SceneRegenerationOutput,
  StoryboardScene,
  VideoScriptInput,
  VideoScriptOutput,
} from "./contracts/video-script";

const MOCK_HOOKS: HookOption[] = [
  {
    variant: "QUESTION",
    narration: "Vì sao bạn luôn bỏ cuộc sau ba ngày?",
    onScreenText: "VÌ SAO BẠN LUÔN BỎ CUỘC?",
    visualVariant: "HOOK_QUESTION",
    illustration: { setting: "NIGHT_ROOM", action: "THINKING" },
  },
  {
    variant: "MISTAKE",
    narration: "Sai lầm này khiến bạn mãi giậm chân.",
    onScreenText: "SAI LẦM AI CŨNG MẮC",
    visualVariant: "SPLIT_MISTAKE_SOLUTION",
    illustration: { setting: "OFFICE", action: "WORRIED" },
  },
  {
    variant: "CONTRAST",
    narration: "Hai phút mỗi ngày, một năm khác hẳn.",
    onScreenText: "2 PHÚT → 1 NĂM KHÁC BIỆT",
    visualVariant: "BIG_TAKEAWAY",
    illustration: { setting: "PARK", action: "CELEBRATING" },
  },
];

const CAPTION_WORDS = 7;

function caption(text: string): string {
  const words = text.replace(/[.!?…]+$/u, "").split(/\s+/);
  return words.length > CAPTION_WORDS ? `${words.slice(0, CAPTION_WORDS).join(" ")}…` : words.join(" ");
}

function scene(type: BodySceneType, title: string, narration: string): StoryboardScene {
  return { type, title, narration, onScreenText: caption(narration), visualVariant: DEFAULT_VISUAL_VARIANT[type] };
}

const firstSentence = (text: string) => text.split(/(?<=[.!?…])\s+/u)[0] ?? text;

// One story in the order every video follows. A short video, or one with several lessons, keeps the first sentence of each
// lesson's part so all five parts still fit. The proposed length is the shortest allowed one that holds the narration.
export function mockVideoScript(input: VideoScriptInput): VideoScriptOutput {
  const short = input.maxDurationSec <= 30 || input.lessons.length > 1;
  const part = (type: BodySceneType, title: string, pick: (lesson: LessonSnapshot) => string) =>
    scene(type, title, input.lessons.map((lesson) => (short ? firstSentence(pick(lesson)) : pick(lesson))).join(" "));
  const last = input.lessons.at(-1);
  const scenes = [
    part("SITUATION", "Tình huống", (lesson) => lesson.realLifeScenario),
    part("COMMON_MISTAKE", "Sai lầm", (lesson) => lesson.commonMistake),
    part("KEY_TAKEAWAY", "Điều cần nhớ", (lesson) => lesson.principle),
    part("BETTER_APPROACH", "Cách làm tốt hơn", (lesson) => lesson.betterApproach),
    ...(last ? [scene("ACTION_STEP", "Làm ngay", last.actionableStep)] : []),
  ];
  const [hook] = MOCK_HOOKS;
  const seconds = [hook?.narration ?? "", ...scenes.map((scene) => scene.narration)]
    .map(estimateNarrationSeconds)
    .reduce((sum, value) => sum + value, 0);
  return {
    videoId: input.videoId,
    targetDurationSec: fitToRange(seconds, input),
    durationReason: `Lời mẫu đọc khoảng ${Math.ceil(seconds)} giây.`,
    hookOptions: MOCK_HOOKS,
    scenes,
  };
}

const REWRITE_PREFIXES = ["Nói ngắn gọn: ", "Hãy hình dung: ", "Điều quan trọng là: "];

export function mockSceneRegeneration(input: SceneRegenerationInput): SceneRegenerationOutput {
  const prefix = REWRITE_PREFIXES[input.attempt % REWRITE_PREFIXES.length] ?? "";
  const base = input.scene.narration.replace(/^(Nói ngắn gọn|Hãy hình dung|Điều quan trọng là): /u, "");
  const narration = `${prefix}${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  return { sceneId: input.sceneId, scene: { ...input.scene, narration, onScreenText: caption(base) } };
}
