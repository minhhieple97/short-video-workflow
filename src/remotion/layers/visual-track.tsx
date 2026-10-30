import { linearTiming, TransitionSeries, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Easing } from "remotion";

import type { ShortVideoProps } from "@/features/videos/domain/composition-props";
import { renderModeFor } from "@/features/videos/domain/scene-shots";

import type { PeepLook } from "../peeps/peep";
import { SceneView } from "../scenes/scene-view";
import { planSceneVisuals, type SceneTransition } from "../timeline/scene-transitions";

function presentation(transition: SceneTransition): TransitionPresentation<Record<string, unknown>> {
  if (transition.kind === "fade") return fade() as TransitionPresentation<Record<string, unknown>>;
  if (transition.kind === "wipe")
    return wipe({ direction: transition.direction }) as TransitionPresentation<Record<string, unknown>>;
  return slide({ direction: transition.direction }) as TransitionPresentation<Record<string, unknown>>;
}

// The pictures of all scenes, joined by cuts or short transitions (see planSceneVisuals for why lengths stay exact).
export function VisualTrack({
  scenes,
  paceFactor,
  look,
}: Pick<ShortVideoProps, "scenes" | "paceFactor"> & { look: PeepLook }) {
  const plan = planSceneVisuals(
    scenes.map((scene) => ({
      mode: renderModeFor(scene.layout),
      setting: scene.illustration.setting,
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
              look={look}
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
