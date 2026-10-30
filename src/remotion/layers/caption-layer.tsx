import { Html5Audio, Series } from "remotion";

import type { ShortVideoProps } from "@/features/videos/domain/composition-props";

import { CaptionPagesView } from "../captions/caption-pages-view";

// Every scene's voice and captions on their own exact frames, back to back, whatever the pictures do in between.
export function CaptionLayer({ scenes, showCaptions }: Pick<ShortVideoProps, "scenes" | "showCaptions">) {
  return (
    <Series>
      {scenes.map((scene) => (
        <Series.Sequence key={scene.id} durationInFrames={scene.durationInFrames} name={`${scene.label} (voice)`}>
          {showCaptions ? <CaptionPagesView pages={scene.captionPages} highlight={scene.karaoke} /> : null}
          {scene.audioSrc ? <Html5Audio src={scene.audioSrc} pauseWhenBuffering /> : null}
        </Series.Sequence>
      ))}
    </Series>
  );
}
