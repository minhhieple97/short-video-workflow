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

function lessonScenes(lesson: LessonSnapshot, compact: boolean): StoryboardScene[] {
  if (compact) {
    return [
      scene("SITUATION", "Tình huống", `${lesson.realLifeScenario} ${lesson.commonMistake}`),
      scene("BETTER_APPROACH", "Cách làm tốt hơn", lesson.betterApproach),
    ];
  }
  return [
    scene("SITUATION", "Tình huống", lesson.realLifeScenario),
    scene("COMMON_MISTAKE", "Sai lầm", lesson.commonMistake),
    scene("BETTER_APPROACH", "Cách làm tốt hơn", lesson.betterApproach),
    scene("KEY_TAKEAWAY", "Điều cần nhớ", lesson.principle),
  ];
}

// Deterministic storyboard built from the lesson snapshots so demos and tests never need Claude.
export function mockVideoScript(input: VideoScriptInput): VideoScriptOutput {
  const compact = input.targetDurationSec <= 30 || input.lessons.length > 1;
  const scenes = input.lessons.flatMap((lesson) => lessonScenes(lesson, compact));
  const last = input.lessons.at(-1);
  if (last) scenes.push(scene("ACTION_STEP", "Làm ngay", last.actionableStep));
  return { videoId: input.videoId, hookOptions: MOCK_HOOKS, scenes };
}

const REWRITE_PREFIXES = ["Nói ngắn gọn: ", "Hãy hình dung: ", "Điều quan trọng là: "];

export function mockSceneRegeneration(input: SceneRegenerationInput): SceneRegenerationOutput {
  const prefix = REWRITE_PREFIXES[input.attempt % REWRITE_PREFIXES.length] ?? "";
  const base = input.scene.narration.replace(/^(Nói ngắn gọn|Hãy hình dung|Điều quan trọng là): /u, "");
  const narration = `${prefix}${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  return { sceneId: input.sceneId, scene: { ...input.scene, narration, onScreenText: caption(base) } };
}
