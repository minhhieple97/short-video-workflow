import { useEffect, useState } from "react";
import { AbsoluteFill, Html5Audio, Sequence, Series, useDelayRender } from "remotion";

import type { ShortVideoProps } from "@/features/videos/domain/composition-props";

import { BookBadge } from "../components/book-badge";
import { CaptionTrack } from "../components/caption-track";
import { CharacterLookContext, lookFor } from "../illustration/look";
import { SceneRenderer } from "../scenes/scene-renderer";
import { ensureFonts } from "../theme/fonts";
import { COLORS } from "../theme/tokens";

// Content-driven: every word on screen comes from props; nothing about a specific book is hard-coded here.
export function ShortVideo({ title, scenes, bookTitle, showCaptions, paceFactor = 1 }: ShortVideoProps) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading Be Vietnam Pro"));

  // Without the bundled font, Vietnamese diacritics would come out in a fallback font, so the render fails instead.
  useEffect(() => {
    void ensureFonts().then(
      () => continueRender(handle),
      (error: unknown) => cancelRender(error),
    );
  }, [handle, continueRender, cancelRender]);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background }}>
      <CharacterLookContext.Provider value={lookFor(title)}>
        <Series>
          {scenes.map((scene, index) => (
            <Series.Sequence
              key={scene.id}
              durationInFrames={scene.durationInFrames}
              name={`${index + 1}. ${scene.label}`}
            >
              {paceFactor === 1 ? (
                <SceneRenderer scene={scene} />
              ) : (
                // Only the picture runs on the faster clock: captions, badge and audio stay outside so they keep real time.
                <Sequence layout="none" playbackRate={paceFactor}>
                  <SceneRenderer scene={scene} />
                </Sequence>
              )}
              {index > 0 ? <BookBadge title={bookTitle} /> : null}
              {showCaptions ? <CaptionTrack captions={scene.captions} /> : null}
              {scene.audioSrc ? <Html5Audio src={scene.audioSrc} pauseWhenBuffering /> : null}
            </Series.Sequence>
          ))}
        </Series>
      </CharacterLookContext.Provider>
    </AbsoluteFill>
  );
}
