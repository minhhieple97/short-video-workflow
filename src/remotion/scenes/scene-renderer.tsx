import type { ComponentType } from "react";

import type { CompositionScene } from "@/features/videos/domain/composition-props";
import type { VisualVariant } from "@/features/videos/domain/scene-types";

import { ActionChecklistScene } from "./action-checklist";
import { BigTakeawayScene } from "./big-takeaway";
import { HookQuestionScene } from "./hook-question";
import { ScenarioCardScene } from "./scenario-card";
import { SplitMistakeSolutionScene } from "./split-mistake-solution";

const LAYOUTS: Record<VisualVariant, ComponentType<{ scene: CompositionScene }>> = {
  HOOK_QUESTION: HookQuestionScene,
  SPLIT_MISTAKE_SOLUTION: SplitMistakeSolutionScene,
  SCENARIO_CARD: ScenarioCardScene,
  BIG_TAKEAWAY: BigTakeawayScene,
  ACTION_CHECKLIST: ActionChecklistScene,
};

export function SceneRenderer({ scene }: Readonly<{ scene: CompositionScene }>) {
  const Layout = LAYOUTS[scene.layout];
  return <Layout scene={scene} />;
}
