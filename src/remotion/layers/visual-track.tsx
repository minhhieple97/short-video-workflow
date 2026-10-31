import { linearTiming, TransitionSeries, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Easing } from "remotion";

import type { CompositionScene, ShortVideoProps } from "@/features/videos/domain/composition-props";
import { shotRenderMode } from "@/features/videos/domain/scene-shots";

import { SceneView } from "../scenes/scene-view";
import type { Cast } from "../stage/cast";
import { planSceneVisuals, type CutEdge, type SceneTransition } from "../timeline/scene-transitions";

function presentation(transition: SceneTransition): TransitionPresentation<Record<string, unknown>> {
  if (transition.kind === "fade") return fade() as TransitionPresentation<Record<string, unknown>>;
  if (transition.kind === "wipe")
    return wipe({ direction: transition.direction }) as TransitionPresentation<Record<string, unknown>>;
  return slide({ direction: transition.direction }) as TransitionPresentation<Record<string, unknown>>;
}

function edge(scene: CompositionScene, shot: CompositionScene["shots"][number] | undefined): CutEdge {
  return {
    mode: shot ? shotRenderMode(scene.layout, shot) : "STAGE",
    setting: shot?.setting ?? scene.illustration.setting,
  };
}

// The pictures of all scenes, joined by cuts or short transitions (see planSceneVisuals for why lengths stay exact).
export function VisualTrack({
  scenes,
  paceFactor,
  cast,
}: Pick<ShortVideoProps, "scenes" | "paceFactor"> & { cast: Cast }) {
  const plan = planSceneVisuals(
    scenes.map((scene) => ({
      enter: edge(scene, scene.shots[0]),
      exit: edge(scene, scene.shots.at(-1)),
      durationInFrames: scene.durationInFrames,
    })),
  );
  return (
    <TransitionSeries>
      {scenes.flatMap((scene, index) => {
        const visual = plan[index];
        if (!visual) return [];
        const enterAt = plan[index - 1]?.after.frames ?? 0;
        const items = [
          <TransitionSeries.Sequence
            key={scene.id}
            durationInFrames={visual.durationInFrames}
            name={`${index + 1}. ${scene.label}`}
          >
            <SceneView
              scene={scene}
              cast={cast}
              paceFactor={paceFactor}
              enterAt={enterAt}
              tailFrames={visual.durationInFrames - scene.durationInFrames}
            />
          </TransitionSeries.Sequence>,
        ];
        if (visual.after.frames > 0) {
          items.push(
            <TransitionSeries.Transition
              key={`${scene.id}-out`}
              presentation={presentation(visual.after)}
              timing={linearTiming({ durationInFrames: visual.after.frames, easing: Easing.inOut(Easing.cubic) })}
            />,
          );
        }
        return items;
      })}
    </TransitionSeries>
  );
}
