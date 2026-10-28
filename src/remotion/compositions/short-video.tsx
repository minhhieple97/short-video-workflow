import { useEffect, useState } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, Series } from "remotion";

import type { ShortVideoProps } from "@/features/videos/domain/composition-props";

import { BookBadge } from "../components/book-badge";
import { CaptionTrack } from "../components/caption-track";
import { CharacterLookContext, lookFor } from "../illustration/look";
import { SceneRenderer } from "../scenes/scene-renderer";
import { ensureFonts } from "../theme/fonts";
import { COLORS } from "../theme/tokens";

// Content-driven: every word on screen comes from props; nothing about a specific book is hard-coded here.
export function ShortVideo({ title, scenes, bookTitle, showCaptions }: ShortVideoProps) {
  const [handle] = useState(() => delayRender("Loading Be Vietnam Pro"));

  useEffect(() => {
    void ensureFonts().then(
      () => continueRender(handle),
      () => continueRender(handle),
    );
  }, [handle]);

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
              <SceneRenderer scene={scene} />
              {index > 0 ? <BookBadge title={bookTitle} /> : null}
              {showCaptions ? <CaptionTrack captions={scene.captions} /> : null}
              {scene.audioSrc ? <Audio src={scene.audioSrc} /> : null}
            </Series.Sequence>
          ))}
        </Series>
      </CharacterLookContext.Provider>
    </AbsoluteFill>
  );
}
